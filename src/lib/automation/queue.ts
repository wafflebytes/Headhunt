import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { automationRuns } from '@/lib/db/schema/automation-runs';
import { auditLogs } from '@/lib/db/schema/audit-logs';
import { interviews } from '@/lib/db/schema/interviews';
import { offers } from '@/lib/db/schema/offers';
import { runFinalScheduleFlowTool } from '@/lib/tools/scheduling';
import { summarizeCalBookingTranscriptTool } from '@/lib/tools/interview-transcripts';
import { runMultiAgentCandidateScoreTool } from '@/lib/tools/multi-agent-candidate-score';
import { pollOfferClearanceTool } from '@/lib/tools/offers';

type RunStatus = 'pending' | 'running' | 'retrying' | 'completed' | 'dead_letter' | 'cancelled';

type AutomationPayload = Record<string, unknown>;

type EnqueueInput = {
  handlerType: string;
  resourceType: string;
  resourceId: string;
  replayedFromRunId?: string;
  idempotencyKey: string;
  payload: AutomationPayload;
  nextAttemptAt?: Date;
  maxAttempts?: number;
};

export function buildIdempotencyKey(parts: Array<string | number | null | undefined>): string {
  return parts
    .filter((part): part is string | number => part !== null && part !== undefined)
    .map((part) => String(part).trim())
    .filter(Boolean)
    .join(':')
    .slice(0, 240);
}

export async function enqueueAutomationRun(input: EnqueueInput) {
  const now = new Date();

  const inserted = await db
    .insert(automationRuns)
    .values({
      handlerType: input.handlerType,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      replayedFromRunId: input.replayedFromRunId ?? null,
      idempotencyKey: input.idempotencyKey,
      status: 'pending',
      payload: input.payload,
      result: {},
      nextAttemptAt: input.nextAttemptAt ?? now,
      maxAttempts: input.maxAttempts ?? 8,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [automationRuns.handlerType, automationRuns.idempotencyKey],
    })
    .returning({ id: automationRuns.id });

  return {
    inserted: inserted.length > 0,
    runId: inserted[0]?.id ?? null,
  };
}

async function claimDueRuns(limit: number) {
  const now = new Date();
  const due = await db
    .select({ id: automationRuns.id })
    .from(automationRuns)
    .where(and(inArray(automationRuns.status, ['pending', 'retrying']), lte(automationRuns.nextAttemptAt, now)))
    .orderBy(asc(automationRuns.nextAttemptAt), asc(automationRuns.createdAt))
    .limit(limit);

  const claimed: Array<{
    id: string;
    handlerType: string;
    resourceType: string;
    resourceId: string;
    payload: AutomationPayload;
    attemptCount: number;
    maxAttempts: number;
  }> = [];

  for (const row of due) {
    const updated = await db
      .update(automationRuns)
      .set({
        status: 'running',
        startedAt: now,
        updatedAt: now,
      })
      .where(and(eq(automationRuns.id, row.id), inArray(automationRuns.status, ['pending', 'retrying'])))
      .returning({
        id: automationRuns.id,
        handlerType: automationRuns.handlerType,
        resourceType: automationRuns.resourceType,
        resourceId: automationRuns.resourceId,
        payload: automationRuns.payload,
        attemptCount: automationRuns.attemptCount,
        maxAttempts: automationRuns.maxAttempts,
      });

    if (updated[0]) {
      claimed.push(updated[0]);
    }
  }

  return claimed;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function extractCalBookingUid(eventId: string | undefined): string | null {
  if (!eventId) return null;
  if (eventId.startsWith('cal:')) {
    const uid = eventId.slice(4).trim();
    return uid || null;
  }
  return null;
}

async function resolveOfferClearanceActor(payload: AutomationPayload) {
  const explicitActor = asString(payload.actorUserId);
  if (explicitActor) {
    return explicitActor;
  }

  const offerId = asString(payload.offerId);
  if (offerId) {
    const [offerRow] = await db
      .select({
        initiatedBy: offers.initiatedBy,
        cibaApprovedBy: offers.cibaApprovedBy,
      })
      .from(offers)
      .where(eq(offers.id, offerId))
      .limit(1);

    const fallbackActor = asString(offerRow?.initiatedBy) ?? asString(offerRow?.cibaApprovedBy);
    if (fallbackActor) {
      return fallbackActor;
    }
  }

  return process.env.HEADHUNT_FOUNDER_USER_ID?.trim() ?? process.env.AUTH0_FOUNDER_USER_ID?.trim();
}

export async function executeAutomationHandler(run: {
  handlerType: string;
  payload: AutomationPayload;
}) {
  if (run.handlerType === 'candidate.score') {
    if (typeof runMultiAgentCandidateScoreTool.execute !== 'function') {
      return {
        check: 'run_multi_agent_candidate_score',
        status: 'error',
        message: 'Candidate score tool is unavailable in automation runtime.',
      };
    }

    return runMultiAgentCandidateScoreTool.execute({
      candidateId: asString(run.payload.candidateId) ?? '',
      jobId: asString(run.payload.jobId),
      organizationId: asString(run.payload.organizationId),
      actorUserId: asString(run.payload.actorUserId),
      emailText: asString(run.payload.emailText),
      resumeText: asString(run.payload.resumeText),
      externalContext: asString(run.payload.externalContext),
      requirements: Array.isArray(run.payload.requirements)
        ? run.payload.requirements.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : undefined,
      turns: asNumber(run.payload.turns) ?? 3,
      maxEvidenceChars: asNumber(run.payload.maxEvidenceChars) ?? 9000,
    }, {} as any);
  }

  if (run.handlerType === 'offer.clearance.poll') {
    if (typeof pollOfferClearanceTool.execute !== 'function') {
      return {
        check: 'poll_offer_clearance',
        status: 'error',
        message: 'Offer clearance poll tool is unavailable in automation runtime.',
      };
    }

    const actorUserId = await resolveOfferClearanceActor(run.payload);
    const founderUserId =
      asString(run.payload.founderUserId) ??
      process.env.HEADHUNT_FOUNDER_USER_ID?.trim() ??
      process.env.AUTH0_FOUNDER_USER_ID?.trim();

    return pollOfferClearanceTool.execute({
      offerId: asString(run.payload.offerId) ?? '',
      organizationId: asString(run.payload.organizationId),
      actorUserId,
      founderUserId,
      authReqId: asString(run.payload.authReqId),
    }, {} as any);
  }

  if (run.handlerType === 'scheduling.reply.parse_book') {
    if (typeof runFinalScheduleFlowTool.execute !== 'function') {
      return {
        check: 'run_final_schedule_flow',
        status: 'error',
        message: 'Final scheduling tool is unavailable in automation runtime.',
      };
    }

    return runFinalScheduleFlowTool.execute({
      candidateId: asString(run.payload.candidateId) ?? '',
      jobId: asString(run.payload.jobId) ?? '',
      organizationId: asString(run.payload.organizationId),
      actorUserId: asString(run.payload.actorUserId),
      action: 'book_from_reply',
      sendMode: asString(run.payload.sendMode) === 'send' ? 'send' : 'draft',
      timezone: asString(run.payload.timezone) ?? 'America/Los_Angeles',
      targetDayCount: asNumber(run.payload.targetDayCount) ?? 3,
      slotsPerDay: asNumber(run.payload.slotsPerDay) ?? 1,
      maxSlotsToEmail: asNumber(run.payload.maxSlotsToEmail) ?? 3,
      threadId: asString(run.payload.threadId),
      query: asString(run.payload.query),
      lookbackDays: asNumber(run.payload.lookbackDays) ?? 14,
      maxResults: asNumber(run.payload.maxResults) ?? 10,
      eventTypeSlug: asString(run.payload.eventTypeSlug),
      username: asString(run.payload.username),
      teamSlug: asString(run.payload.teamSlug),
      organizationSlug: asString(run.payload.organizationSlug),
      durationMinutes: asNumber(run.payload.durationMinutes) ?? 30,
    }, {} as any);
  }

  if (run.handlerType === 'interview.transcript.fetch') {
    if (typeof summarizeCalBookingTranscriptTool.execute !== 'function') {
      return {
        check: 'summarize_cal_booking_transcript',
        status: 'error',
        message: 'Transcript summary tool is unavailable in automation runtime.',
      };
    }

    const bookingUid = asString(run.payload.bookingUid);
    if (!bookingUid) {
      return {
        check: 'summarize_cal_booking_transcript',
        status: 'error',
        message: 'Missing bookingUid for transcript fetch automation.',
      };
    }

    return summarizeCalBookingTranscriptTool.execute({
      bookingUid,
      candidateId: asString(run.payload.candidateId),
      jobId: asString(run.payload.jobId),
      organizationId: asString(run.payload.organizationId),
      actorUserId: asString(run.payload.actorUserId),
      maxTranscriptChars: asNumber(run.payload.maxTranscriptChars) ?? 28000,
    }, {} as any);
  }

  if (run.handlerType === 'dead_letter.notify') {
    return {
      check: 'automation_dead_letter_notify',
      status: 'success',
      mode: 'noop',
      message: 'Dead-letter summary ready for notification integration.',
      payload: run.payload,
    };
  }

  if (run.handlerType === 'scheduling.reply.reminder') {
    return {
      check: 'automation_scheduling_reply_reminder',
      status: 'success',
      mode: 'noop',
      message: 'Reminder queued for manual follow-up.',
      payload: run.payload,
    };
  }

  return {
    check: 'automation_run',
    status: 'error',
    message: `Unknown handler type: ${run.handlerType}`,
  };
}

function computeRetryDelayMs(attemptNumber: number) {
  const baseMs = 30_000;
  const cappedExponent = Math.min(8, Math.max(0, attemptNumber - 1));
  const jitter = Math.floor(Math.random() * 3_000);
  return baseMs * Math.pow(2, cappedExponent) + jitter;
}

function isRetryableSuccess(result: Record<string, unknown>): boolean {
  const check = asString(result.check);
  const mode = asString(result.mode);
  return check === 'poll_offer_clearance' && mode === 'awaiting_clearance';
}

function shouldEscalateToManualReview(handlerType: string, result: Record<string, unknown>): boolean {
  if (handlerType !== 'scheduling.reply.parse_book') {
    return false;
  }

  const check = asString(result.check);
  const mode = asString(result.mode);
  const status = asString(result.status);

  if (status === 'error') {
    return true;
  }

  if (check === 'run_final_schedule_flow' && mode !== 'scheduled') {
    return true;
  }

  return false;
}

export async function processAutomationQueue(limit = 10) {
  const claimed = await claimDueRuns(limit);
  const now = new Date();

  let completed = 0;
  let retried = 0;
  let deadLettered = 0;

  for (const run of claimed) {
    try {
      const rawResult = await executeAutomationHandler(run);
      const result = rawResult && typeof rawResult === 'object' ? (rawResult as Record<string, unknown>) : {};
      const status = asString(result.status);

      if (status === 'success' && !isRetryableSuccess(result)) {
        const manualReviewNeeded = shouldEscalateToManualReview(run.handlerType, result);
        const finalResult = manualReviewNeeded
          ? {
              ...result,
              manualReviewRequired: true,
              manualReviewReason: 'Automation could not safely complete booking from candidate reply.',
            }
          : result;

        await db
          .update(automationRuns)
          .set({
            status: 'completed',
            result: finalResult,
            finishedAt: now,
            updatedAt: now,
            lastError: null,
            lastErrorAt: null,
          })
          .where(eq(automationRuns.id, run.id));

        if (manualReviewNeeded) {
          await db.insert(auditLogs).values({
            organizationId: asString((asRecord(run.payload)?.organizationId)) ?? null,
            actorType: 'system',
            actorId: 'automation.manual_review',
            actorDisplayName: 'Automation Worker',
            action: 'automation.manual_review.required',
            resourceType: run.resourceType,
            resourceId: run.resourceId,
            metadata: {
              handlerType: run.handlerType,
              runId: run.id,
              result: finalResult,
            },
            result: 'pending',
          });
        }

        completed += 1;
        continue;
      }

      const nextAttemptCount = run.attemptCount + 1;
      const reachedMax = nextAttemptCount >= run.maxAttempts;

      if (reachedMax) {
        await db
          .update(automationRuns)
          .set({
            status: 'dead_letter',
            result,
            attemptCount: nextAttemptCount,
            finishedAt: now,
            updatedAt: now,
            lastError: asString(result.message) ?? 'Automation run exhausted retry attempts.',
            lastErrorAt: now,
          })
          .where(eq(automationRuns.id, run.id));

        deadLettered += 1;
      } else {
        await db
          .update(automationRuns)
          .set({
            status: 'retrying',
            result,
            attemptCount: nextAttemptCount,
            nextAttemptAt: new Date(now.getTime() + computeRetryDelayMs(nextAttemptCount)),
            updatedAt: now,
            lastError: asString(result.message) ?? 'Retrying due to non-terminal automation response.',
            lastErrorAt: now,
          })
          .where(eq(automationRuns.id, run.id));

        retried += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown automation error.';
      const nextAttemptCount = run.attemptCount + 1;
      const reachedMax = nextAttemptCount >= run.maxAttempts;

      if (reachedMax) {
        await db
          .update(automationRuns)
          .set({
            status: 'dead_letter',
            attemptCount: nextAttemptCount,
            finishedAt: now,
            updatedAt: now,
            lastError: message,
            lastErrorAt: now,
          })
          .where(eq(automationRuns.id, run.id));

        deadLettered += 1;
      } else {
        await db
          .update(automationRuns)
          .set({
            status: 'retrying',
            attemptCount: nextAttemptCount,
            nextAttemptAt: new Date(now.getTime() + computeRetryDelayMs(nextAttemptCount)),
            updatedAt: now,
            lastError: message,
            lastErrorAt: now,
          })
          .where(eq(automationRuns.id, run.id));

        retried += 1;
      }
    }
  }

  return {
    claimed: claimed.length,
    completed,
    retried,
    deadLettered,
  };
}

export async function enqueueWatchdogs(params?: {
  replyStaleHours?: number;
  transcriptStaleHours?: number;
  offerPendingHours?: number;
  actorUserId?: string;
}) {
  const now = new Date();
  const replyStaleHours = params?.replyStaleHours ?? 48;
  const transcriptStaleHours = params?.transcriptStaleHours ?? 2;
  const offerPendingHours = params?.offerPendingHours ?? 24;

  let enqueued = 0;

  // Reply watchdog: requested availability but still no scheduled interview.
  const staleReplies = await db.execute(sql`
    select
      al.resource_id as candidate_id,
      (al.metadata->>'jobId') as job_id,
      max(al.timestamp) as last_requested_at
    from audit_logs al
    where al.action in ('interview.availability.request.sent', 'interview.availability.request.drafted')
      and al.timestamp < now() - (${replyStaleHours}::text || ' hours')::interval
    group by al.resource_id, (al.metadata->>'jobId')
  `);

  for (const row of staleReplies.rows as Array<{ candidate_id: string; job_id: string | null; last_requested_at: string }>) {
    if (!row.job_id) continue;

    const [scheduledInterview] = await db
      .select({ id: interviews.id })
      .from(interviews)
      .where(and(eq(interviews.candidateId, row.candidate_id), eq(interviews.jobId, row.job_id), eq(interviews.status, 'scheduled')))
      .limit(1);

    if (scheduledInterview) {
      continue;
    }

    const bucket = now.toISOString().slice(0, 13);
    const result = await enqueueAutomationRun({
      handlerType: 'scheduling.reply.reminder',
      resourceType: 'candidate',
      resourceId: row.candidate_id,
      idempotencyKey: buildIdempotencyKey(['reply-stale', row.candidate_id, row.job_id, bucket]),
      payload: {
        candidateId: row.candidate_id,
        jobId: row.job_id,
        lastRequestedAt: row.last_requested_at,
      },
      nextAttemptAt: now,
      maxAttempts: 2,
    });

    if (result.inserted) {
      enqueued += 1;
    }
  }

  // Transcript watchdog: interview long past scheduled time but summary still missing.
  const staleTranscripts = await db
    .select({
      id: interviews.id,
      candidateId: interviews.candidateId,
      jobId: interviews.jobId,
      scheduledAt: interviews.scheduledAt,
      googleCalendarEventId: interviews.googleCalendarEventId,
    })
    .from(interviews)
    .where(
      and(
        eq(interviews.status, 'scheduled'),
        lte(interviews.scheduledAt, new Date(now.getTime() - transcriptStaleHours * 60 * 60 * 1000)),
      ),
    )
    .limit(100);

  for (const interview of staleTranscripts) {
    const bucket = now.toISOString().slice(0, 13);
    const bookingUid = extractCalBookingUid(interview.googleCalendarEventId ?? undefined);
    if (!bookingUid) {
      continue;
    }

    const result = await enqueueAutomationRun({
      handlerType: 'interview.transcript.fetch',
      resourceType: 'interview',
      resourceId: interview.id,
      idempotencyKey: buildIdempotencyKey(['transcript-stale', interview.id, bucket]),
      payload: {
        interviewId: interview.id,
        bookingUid,
        candidateId: interview.candidateId,
        jobId: interview.jobId,
        scheduledAt: interview.scheduledAt.toISOString(),
        actorUserId: params?.actorUserId,
      },
      nextAttemptAt: now,
      maxAttempts: 6,
    });

    if (result.inserted) {
      enqueued += 1;
    }
  }

  // Offer watchdog: pending approval too long, queue poll run.
  const staleOffers = await db
    .select({
      id: offers.id,
      candidateId: offers.candidateId,
      jobId: offers.jobId,
      organizationId: offers.organizationId,
      cibaAuthReqId: offers.cibaAuthReqId,
    })
    .from(offers)
    .where(
      and(
        eq(offers.status, 'awaiting_approval'),
        lte(offers.updatedAt, new Date(now.getTime() - offerPendingHours * 60 * 60 * 1000)),
      ),
    )
    .limit(100);

  for (const offer of staleOffers) {
    const bucket = now.toISOString().slice(0, 13);
    const result = await enqueueAutomationRun({
      handlerType: 'offer.clearance.poll',
      resourceType: 'offer',
      resourceId: offer.id,
      idempotencyKey: buildIdempotencyKey(['offer-pending', offer.id, bucket]),
      payload: {
        offerId: offer.id,
        organizationId: offer.organizationId,
        candidateId: offer.candidateId,
        jobId: offer.jobId,
        authReqId: offer.cibaAuthReqId,
        actorUserId: params?.actorUserId,
      },
      nextAttemptAt: now,
      maxAttempts: 8,
    });

    if (result.inserted) {
      enqueued += 1;
    }
  }

  // Dead-letter notification watchdog: summarize unresolved dead letters hourly.
  const [deadLetterCountRow] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(automationRuns)
    .where(eq(automationRuns.status, 'dead_letter'));

  const deadLetterCount = Number(deadLetterCountRow?.count ?? 0);
  if (deadLetterCount > 0) {
    const bucket = now.toISOString().slice(0, 13);
    const result = await enqueueAutomationRun({
      handlerType: 'dead_letter.notify',
      resourceType: 'automation',
      resourceId: 'dead_letter',
      idempotencyKey: buildIdempotencyKey(['dead-letter-notify', bucket]),
      payload: {
        deadLetterCount,
        generatedAt: now.toISOString(),
      },
      nextAttemptAt: now,
      maxAttempts: 3,
    });

    if (result.inserted) {
      enqueued += 1;
    }
  }

  await db.insert(auditLogs).values({
    organizationId: null,
    actorType: 'system',
    actorId: 'automation.watchdogs',
    actorDisplayName: 'Automation Watchdog',
    action: 'automation.watchdogs.enqueued',
    resourceType: 'automation',
    resourceId: 'watchdogs',
    metadata: {
      enqueued,
      replyStaleHours,
      transcriptStaleHours,
      offerPendingHours,
    },
    result: 'success',
  });

  return {
    enqueued,
  };
}

export async function replayAutomationRun(runId: string) {
  const [existing] = await db
    .select({
      handlerType: automationRuns.handlerType,
      resourceType: automationRuns.resourceType,
      resourceId: automationRuns.resourceId,
      idempotencyKey: automationRuns.idempotencyKey,
      payload: automationRuns.payload,
      maxAttempts: automationRuns.maxAttempts,
    })
    .from(automationRuns)
    .where(eq(automationRuns.id, runId))
    .limit(1);

  if (!existing) {
    return null;
  }

  const now = new Date();
  const replay = await db
    .insert(automationRuns)
    .values({
      handlerType: existing.handlerType,
      resourceType: existing.resourceType,
      resourceId: existing.resourceId,
      replayedFromRunId: runId,
      idempotencyKey: buildIdempotencyKey([existing.idempotencyKey, 'replay', now.toISOString()]),
      payload: existing.payload ?? {},
      result: {},
      status: 'pending' as RunStatus,
      attemptCount: 0,
      maxAttempts: existing.maxAttempts ?? 8,
      nextAttemptAt: now,
      updatedAt: now,
    })
    .returning({ id: automationRuns.id, status: automationRuns.status });

  return replay[0] ?? null;
}
