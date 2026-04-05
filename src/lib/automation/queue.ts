import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { generateObject } from 'ai';
import { z } from 'zod';

import { db } from '@/lib/db';
import { automationRuns } from '@/lib/db/schema/automation-runs';
import { auditLogs } from '@/lib/db/schema/audit-logs';
import { candidates } from '@/lib/db/schema/candidates';
import { interviews } from '@/lib/db/schema/interviews';
import { jobs } from '@/lib/db/schema/jobs';
import { offers } from '@/lib/db/schema/offers';
import {
  buildTranscriptJdAlignmentPrompt,
  buildTranscriptSlackDigestMessage,
} from '@/lib/prompts/interview-transcript-digest';
import { nim, nimChatModelId } from '@/lib/nim';
import { runIntakeE2ETool } from '@/lib/tools/intake-e2e';
import { runFinalScheduleFlowTool } from '@/lib/tools/scheduling';
import {
  summarizeCalBookingTranscriptTool,
  summarizeDriveTranscriptPdfTool,
} from '@/lib/tools/interview-transcripts';
import { runMultiAgentCandidateScoreTool } from '@/lib/tools/multi-agent-candidate-score';
import { draftOfferLetterTool, pollOfferClearanceTool, submitOfferForClearanceTool } from '@/lib/tools/offers';
import { sendSlackMessageTool } from '@/lib/tools/slack';

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

type TranscriptSummaryPayload = {
  executiveSummary: string;
  recommendation: string;
  recommendationRationale: string;
  overallRubricScore: number;
  candidateStrengths: string[];
  candidateRisks: string[];
  actionableFollowUps: string[];
  quotedEvidence: Array<{
    quote: string;
    whyItMatters: string;
  }>;
};

const transcriptJdAlignmentSchema = z.object({
  jdFitVerdict: z.enum(['Strong Match', 'Match', 'Mixed', 'Weak Match']),
  jdAlignmentSummary: z.string().min(1),
  matchedSignals: z.array(z.string().min(1)).min(2).max(8),
  gapSignals: z.array(z.string().min(1)).min(1).max(8),
  riskFlags: z.array(z.string().min(1)).min(1).max(8),
  founderFollowUps: z.array(z.string().min(1)).min(2).max(8),
});

type TranscriptJdAlignment = z.infer<typeof transcriptJdAlignmentSchema>;

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

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function defaultOfferStartDate(daysFromNow = 14) {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function asQuotedEvidence(
  value: unknown,
): Array<{ quote: string; whyItMatters: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const row = asRecord(entry);
      if (!row) {
        return null;
      }

      const quote = asString(row.quote);
      const whyItMatters = asString(row.whyItMatters);
      if (!quote || !whyItMatters) {
        return null;
      }

      return {
        quote,
        whyItMatters,
      };
    })
    .filter((entry): entry is { quote: string; whyItMatters: string } => Boolean(entry));
}

function asTranscriptSummary(value: unknown): TranscriptSummaryPayload | null {
  const row = asRecord(value);
  if (!row) {
    return null;
  }

  const executiveSummary = asString(row.executiveSummary);
  const recommendation = asString(row.recommendation);
  const recommendationRationale = asString(row.recommendationRationale);
  const overallRubricScore = asNumber(row.overallRubricScore);

  if (!executiveSummary || !recommendation || !recommendationRationale || typeof overallRubricScore !== 'number') {
    return null;
  }

  return {
    executiveSummary,
    recommendation,
    recommendationRationale,
    overallRubricScore,
    candidateStrengths: asStringArray(row.candidateStrengths),
    candidateRisks: asStringArray(row.candidateRisks),
    actionableFollowUps: asStringArray(row.actionableFollowUps),
    quotedEvidence: asQuotedEvidence(row.quotedEvidence),
  };
}

function buildFallbackTranscriptJdAlignment(summary: TranscriptSummaryPayload): TranscriptJdAlignment {
  const matchedSignals = summary.candidateStrengths.slice(0, 5);
  const gapSignals = summary.candidateRisks.slice(0, 5);
  const riskFlags = summary.candidateRisks.slice(0, 5);
  const founderFollowUps = summary.actionableFollowUps.slice(0, 5);

  const fitVerdict =
    summary.recommendation === 'Strong Hire' || summary.recommendation === 'Hire'
      ? 'Match'
      : summary.recommendation === 'Leaning Hire'
        ? 'Mixed'
        : 'Weak Match';

  return {
    jdFitVerdict: fitVerdict,
    jdAlignmentSummary: summary.recommendationRationale,
    matchedSignals: matchedSignals.length > 0 ? matchedSignals : ['No explicit matched signals were captured.'],
    gapSignals: gapSignals.length > 0 ? gapSignals : ['No explicit JD gaps were captured.'],
    riskFlags: riskFlags.length > 0 ? riskFlags : ['No explicit risk flags were captured.'],
    founderFollowUps:
      founderFollowUps.length > 0
        ? founderFollowUps
        : ['Run one additional focused interview round to validate role-critical requirements.'],
  };
}

async function resolveTranscriptDigestContext(payload: AutomationPayload) {
  const candidateId = asString(payload.candidateId);
  const jobId = asString(payload.jobId);

  const [candidateRow] = candidateId
    ? await db
      .select({
        id: candidates.id,
        name: candidates.name,
        contactEmail: candidates.contactEmail,
      })
      .from(candidates)
      .where(eq(candidates.id, candidateId))
      .limit(1)
    : [];

  const [jobRow] = jobId
    ? await db
      .select({
        id: jobs.id,
        title: jobs.title,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1)
    : [];

  return {
    candidateId,
    jobId,
    candidateName: asString(payload.candidateName) ?? candidateRow?.name ?? 'Unknown candidate',
    candidateEmail: asString(payload.candidateEmail) ?? candidateRow?.contactEmail ?? 'unknown@example.com',
    jobTitle: asString(payload.jobTitle) ?? jobRow?.title ?? 'Unknown role',
    jobRequirements: asStringArray(payload.jobRequirements),
  };
}

function transcriptSourceLabel(source: string | undefined): string {
  if (source === 'cal_transcript') {
    return 'Cal.com transcript';
  }

  if (source === 'drive_pdf') {
    return 'Google Drive transcript PDF';
  }

  return source ?? 'Transcript source unavailable';
}

async function generateTranscriptJdAlignment(params: {
  summary: TranscriptSummaryPayload;
  candidateName: string;
  candidateEmail: string;
  jobTitle: string;
  jobRequirements: string[];
}) {
  try {
    const { object } = await generateObject({
      model: nim.chatModel(nimChatModelId),
      schema: transcriptJdAlignmentSchema,
      temperature: 0.1,
      prompt: buildTranscriptJdAlignmentPrompt({
        candidateName: params.candidateName,
        candidateEmail: params.candidateEmail,
        jobTitle: params.jobTitle,
        jobRequirements: params.jobRequirements,
        executiveSummary: params.summary.executiveSummary,
        recommendation: params.summary.recommendation,
        recommendationRationale: params.summary.recommendationRationale,
        overallRubricScore: params.summary.overallRubricScore,
        candidateStrengths: params.summary.candidateStrengths,
        candidateRisks: params.summary.candidateRisks,
        actionableFollowUps: params.summary.actionableFollowUps,
        quotedEvidence: params.summary.quotedEvidence,
      }),
    });

    return object;
  } catch {
    return buildFallbackTranscriptJdAlignment(params.summary);
  }
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

function missingAutomationContextError(params: { handlerType: string; missing: string[] }) {
  return {
    check: 'automation_context',
    status: 'error',
    handlerType: params.handlerType,
    boundary: 'manual_review_required',
    message: `Missing required automation context: ${params.missing.join(', ')}. Provide explicit ids before retrying.`,
  };
}

export async function executeAutomationHandler(run: {
  handlerType: string;
  payload: AutomationPayload;
}): Promise<any> {
  if (run.handlerType === 'scheduling.request.send') {
    if (typeof runFinalScheduleFlowTool.execute !== 'function') {
      return {
        check: 'run_final_schedule_flow',
        status: 'error',
        message: 'Final scheduling tool is unavailable in automation runtime.',
      };
    }

    const actorUserId =
      asString(run.payload.actorUserId) ??
      process.env.HEADHUNT_FOUNDER_USER_ID?.trim() ??
      process.env.AUTH0_FOUNDER_USER_ID?.trim();
    const candidateId = asString(run.payload.candidateId);
    const jobId = asString(run.payload.jobId);

    if (!candidateId || !jobId) {
      return missingAutomationContextError({
        handlerType: run.handlerType,
        missing: [
          ...(candidateId ? [] : ['candidateId']),
          ...(jobId ? [] : ['jobId']),
        ],
      });
    }

    return runFinalScheduleFlowTool.execute({
      candidateId,
      jobId,
      organizationId: asString(run.payload.organizationId),
      actorUserId,
      action: 'request_candidate_windows',
      forceRequestResend: asBoolean(run.payload.forceRequestResend) ?? false,
      sendMode: asString(run.payload.sendMode) === 'draft' ? 'draft' : 'send',
      timezone: asString(run.payload.timezone) ?? 'America/Los_Angeles',
      lookbackDays: asNumber(run.payload.lookbackDays) ?? 14,
      maxResults: asNumber(run.payload.maxResults) ?? 10,
      durationMinutes: asNumber(run.payload.durationMinutes) ?? 30,
      targetDayCount: asNumber(run.payload.targetDayCount) ?? 3,
      slotsPerDay: asNumber(run.payload.slotsPerDay) ?? 1,
      maxSlotsToEmail: asNumber(run.payload.maxSlotsToEmail) ?? 3,
      eventTypeSlug: asString(run.payload.eventTypeSlug),
      username: asString(run.payload.username),
      teamSlug: asString(run.payload.teamSlug),
      organizationSlug: asString(run.payload.organizationSlug),
      customMessage: asString(run.payload.customMessage),
    }, {} as any);
  }

  if (run.handlerType === 'intake.scan') {
    if (typeof runIntakeE2ETool.execute !== 'function') {
      return {
        check: 'run_intake_e2e',
        status: 'error',
        message: 'Intake scan tool is unavailable in automation runtime.',
      };
    }

    return runIntakeE2ETool.execute({
      organizationId: asString(run.payload.organizationId),
      jobId: asString(run.payload.jobId),
      query: asString(run.payload.query) ??
        'in:inbox newer_than:14d -category:promotions -category:social -subject:newsletter -subject:digest -subject:unsubscribe',
      maxResults: Math.max(1, Math.min(25, asNumber(run.payload.maxResults) ?? 20)),
      processLimit: Math.max(1, Math.min(10, asNumber(run.payload.processLimit) ?? 8)),
      candidateLikeOnly: typeof run.payload.candidateLikeOnly === 'boolean' ? run.payload.candidateLikeOnly : true,
      includeBody: typeof run.payload.includeBody === 'boolean' ? run.payload.includeBody : true,
      generateIntel: typeof run.payload.generateIntel === 'boolean' ? run.payload.generateIntel : true,
      requirements: Array.isArray(run.payload.requirements)
        ? run.payload.requirements.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : undefined,
    }, {} as any);
  }

  if (run.handlerType === 'candidate.score') {
    if (typeof runMultiAgentCandidateScoreTool.execute !== 'function') {
      return {
        check: 'run_multi_agent_candidate_score',
        status: 'error',
        message: 'Candidate score tool is unavailable in automation runtime.',
      };
    }

    const automationMode = asBoolean(run.payload.automationMode) ?? true;

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
      turns: asNumber(run.payload.turns) ?? (automationMode ? 1 : 3),
      maxEvidenceChars: asNumber(run.payload.maxEvidenceChars) ?? (automationMode ? 2500 : 9000),
      automationMode,
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
    const offerId = asString(run.payload.offerId);
    const founderUserId =
      asString(run.payload.founderUserId) ??
      process.env.HEADHUNT_FOUNDER_USER_ID?.trim() ??
      process.env.AUTH0_FOUNDER_USER_ID?.trim();

    if (!offerId) {
      return missingAutomationContextError({
        handlerType: run.handlerType,
        missing: ['offerId'],
      });
    }

    return pollOfferClearanceTool.execute({
      offerId,
      organizationId: asString(run.payload.organizationId),
      actorUserId,
      founderUserId,
      authReqId: asString(run.payload.authReqId),
      allowSystemBypass: true,
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

    const candidateId = asString(run.payload.candidateId);
    const jobId = asString(run.payload.jobId);
    if (!candidateId || !jobId) {
      return missingAutomationContextError({
        handlerType: run.handlerType,
        missing: [
          ...(candidateId ? [] : ['candidateId']),
          ...(jobId ? [] : ['jobId']),
        ],
      });
    }

    return runFinalScheduleFlowTool.execute({
      candidateId,
      jobId,
      organizationId: asString(run.payload.organizationId),
      actorUserId: asString(run.payload.actorUserId),
      action: 'auto',
      forceRequestResend: false,
      sendMode: asString(run.payload.sendMode) === 'draft' ? 'draft' : 'send',
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

  if (run.handlerType === 'offer.draft.create') {
    if (typeof draftOfferLetterTool.execute !== 'function') {
      return {
        check: 'draft_offer_letter',
        status: 'error',
        message: 'Offer draft tool is unavailable in automation runtime.',
      };
    }

    const actorUserId =
      asString(run.payload.actorUserId) ??
      process.env.HEADHUNT_FOUNDER_USER_ID?.trim() ??
      process.env.AUTH0_FOUNDER_USER_ID?.trim();
    const candidateId = asString(run.payload.candidateId);
    const jobId = asString(run.payload.jobId);

    if (!candidateId || !jobId) {
      return missingAutomationContextError({
        handlerType: run.handlerType,
        missing: [
          ...(candidateId ? [] : ['candidateId']),
          ...(jobId ? [] : ['jobId']),
        ],
      });
    }

    const terms = asRecord(run.payload.terms) ?? {};
    const baseSalary = asNumber(terms.baseSalary) ?? 180_000;
    const currency = asString(terms.currency) ?? 'USD';
    const startDate = asString(terms.startDate) ?? defaultOfferStartDate();
    const equityPercent = asNumber(terms.equityPercent);
    const bonusTargetPercent = asNumber(terms.bonusTargetPercent);
    const signOnBonus = asNumber(terms.signOnBonus);
    const notes = asString(terms.notes);

    return draftOfferLetterTool.execute({
      candidateId,
      jobId,
      organizationId: asString(run.payload.organizationId),
      actorUserId,
      templateId: asString(run.payload.templateId),
      terms: {
        baseSalary,
        currency,
        startDate,
        ...(typeof equityPercent === 'number' ? { equityPercent } : {}),
        ...(typeof bonusTargetPercent === 'number' ? { bonusTargetPercent } : {}),
        ...(typeof signOnBonus === 'number' ? { signOnBonus } : {}),
        ...(notes ? { notes } : {}),
      },
    }, {} as any);
  }

  if (run.handlerType === 'offer.submit.clearance') {
    if (typeof submitOfferForClearanceTool.execute !== 'function') {
      return {
        check: 'submit_offer_for_clearance',
        status: 'error',
        message: 'Offer submit tool is unavailable in automation runtime.',
      };
    }

    const actorUserId = await resolveOfferClearanceActor(run.payload);
    const founderUserId =
      asString(run.payload.founderUserId) ??
      process.env.HEADHUNT_FOUNDER_USER_ID?.trim() ??
      process.env.AUTH0_FOUNDER_USER_ID?.trim();

    return submitOfferForClearanceTool.execute({
      offerId: asString(run.payload.offerId),
      candidateId: asString(run.payload.candidateId),
      jobId: asString(run.payload.jobId),
      organizationId: asString(run.payload.organizationId),
      actorUserId,
      founderUserId,
      requestedExpirySeconds: asNumber(run.payload.requestedExpirySeconds),
      forceReissue: asBoolean(run.payload.forceReissue) ?? false,
      allowSystemBypass: asBoolean(run.payload.allowSystemBypass) ?? true,
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

    let calResult: unknown;
    let calRecord: Record<string, unknown> | undefined;

    try {
      calResult = await summarizeCalBookingTranscriptTool.execute({
        bookingUid,
        candidateId: asString(run.payload.candidateId),
        jobId: asString(run.payload.jobId),
        organizationId: asString(run.payload.organizationId),
        actorUserId: asString(run.payload.actorUserId),
        maxTranscriptChars: asNumber(run.payload.maxTranscriptChars) ?? 28000,
        jobRequirements: asStringArray(run.payload.jobRequirements),
      }, {} as any);

      calRecord = asRecord(calResult);
    } catch (error) {
      calRecord = {
        check: 'summarize_cal_booking_transcript',
        status: 'error',
        message: error instanceof Error ? error.message : 'Cal transcript summary failed.',
        fallback: {
          nextTool: 'summarize_drive_transcript_pdf',
          reason: 'cal_transcript_exception',
        },
      };
      calResult = calRecord;
    }

    if (asString(calRecord?.status) === 'success') {
      return calResult;
    }

    if (typeof summarizeDriveTranscriptPdfTool.execute !== 'function') {
      return calResult;
    }

    const shouldTryDriveFallback =
      Boolean(asString(run.payload.driveFileId)) ||
      Boolean(asString(run.payload.driveQuery)) ||
      Boolean(asString(run.payload.driveFolderId)) ||
      Boolean(asString(run.payload.driveFolderName)) ||
      asString(asRecord(calRecord?.fallback)?.nextTool) === 'summarize_drive_transcript_pdf';

    if (!shouldTryDriveFallback) {
      return calResult;
    }

    let driveResult: unknown;
    let driveRecord: Record<string, unknown> | undefined;

    try {
      driveResult = await summarizeDriveTranscriptPdfTool.execute({
        driveFileId: asString(run.payload.driveFileId),
        driveQuery: asString(run.payload.driveQuery),
        driveFolderId: asString(run.payload.driveFolderId),
        driveFolderName: asString(run.payload.driveFolderName),
        candidateId: asString(run.payload.candidateId),
        jobId: asString(run.payload.jobId),
        organizationId: asString(run.payload.organizationId),
        actorUserId: asString(run.payload.actorUserId),
        maxTranscriptChars: asNumber(run.payload.maxTranscriptChars) ?? 28000,
        jobRequirements: asStringArray(run.payload.jobRequirements),
      }, {} as any);

      driveRecord = asRecord(driveResult);
    } catch (error) {
      driveRecord = {
        check: 'summarize_drive_transcript_pdf',
        status: 'error',
        message: error instanceof Error ? error.message : 'Drive transcript summary fallback failed.',
      };
      driveResult = driveRecord;
    }

    if (asString(driveRecord?.status) === 'success') {
      return {
        ...(driveRecord ?? {}),
        fallbackUsed: true,
        fallbackFrom: 'cal_transcript',
        calFailure: {
          status: asString(calRecord?.status) ?? 'error',
          message: asString(calRecord?.message) ?? 'Cal transcript summary failed before Drive fallback.',
        },
      };
    }

    return {
      ...(driveRecord ?? {}),
      check: asString(driveRecord?.check) ?? 'summarize_drive_transcript_pdf',
      status: 'error',
      message: asString(driveRecord?.message) ?? asString(calRecord?.message) ?? 'Transcript summary failed on Cal and Drive fallback.',
      fallbackUsed: true,
      fallbackFrom: 'cal_transcript',
      calFailure: {
        status: asString(calRecord?.status) ?? 'error',
        message: asString(calRecord?.message) ?? 'Cal transcript summary failed.',
      },
      driveFailure: {
        status: asString(driveRecord?.status) ?? 'error',
        message: asString(driveRecord?.message) ?? 'Drive transcript summary fallback failed.',
      },
    };
  }

  if (run.handlerType === 'interview.transcript.debrief.slack') {
    if (typeof sendSlackMessageTool.execute !== 'function') {
      return {
        check: 'interview_transcript_slack_digest',
        status: 'error',
        message: 'Slack message tool is unavailable in automation runtime.',
      };
    }

    let transcriptResult = asRecord(run.payload.transcriptResult);
    let summary = asTranscriptSummary(run.payload.summary) ?? asTranscriptSummary(run.payload.transcriptSummary);

    if (!summary) {
      const fetched = await executeAutomationHandler({
        handlerType: 'interview.transcript.fetch',
        payload: run.payload,
      });

      const fetchedRecord = asRecord(fetched);
      if (!fetchedRecord || asString(fetchedRecord.status) !== 'success') {
        return {
          check: 'interview_transcript_slack_digest',
          status: 'error',
          message:
            asString(fetchedRecord?.message) ??
            'Unable to summarize transcript before generating Slack digest.',
          transcriptResult: fetched,
        };
      }

      transcriptResult = fetchedRecord;
      summary = asTranscriptSummary(fetchedRecord.summary);
    }

    if (!summary) {
      return {
        check: 'interview_transcript_slack_digest',
        status: 'error',
        message: 'Transcript summary payload is missing required fields.',
      };
    }

    const candidateId = asString(run.payload.candidateId) ?? asString(transcriptResult?.candidateId);
    const jobId = asString(run.payload.jobId) ?? asString(transcriptResult?.jobId);

    const digestContext = await resolveTranscriptDigestContext({
      ...run.payload,
      ...(candidateId ? { candidateId } : {}),
      ...(jobId ? { jobId } : {}),
    });

    const jdAlignment = await generateTranscriptJdAlignment({
      summary,
      candidateName: digestContext.candidateName,
      candidateEmail: digestContext.candidateEmail,
      jobTitle: digestContext.jobTitle,
      jobRequirements: digestContext.jobRequirements,
    });

    const source = asString(run.payload.source) ?? asString(transcriptResult?.source);
    const bookingUid = asString(run.payload.bookingUid) ?? asString(transcriptResult?.bookingUid);
    const slackChannel =
      asString(run.payload.slackChannel) ??
      process.env.HEADHUNT_TRANSCRIPT_SLACK_CHANNEL?.trim() ??
      'new-channel';

    const slackMessage = buildTranscriptSlackDigestMessage({
      candidateName: digestContext.candidateName,
      candidateEmail: digestContext.candidateEmail,
      candidateId: digestContext.candidateId,
      jobTitle: digestContext.jobTitle,
      jobId: digestContext.jobId,
      bookingUid,
      sourceLabel: transcriptSourceLabel(source),
      recommendation: summary.recommendation,
      overallRubricScore: summary.overallRubricScore,
      jdFitVerdict: jdAlignment.jdFitVerdict,
      jdAlignmentSummary: jdAlignment.jdAlignmentSummary,
      matchedSignals: jdAlignment.matchedSignals,
      gapSignals: jdAlignment.gapSignals,
      riskFlags: jdAlignment.riskFlags,
      founderFollowUps: jdAlignment.founderFollowUps,
    });

    let slackResult: unknown;
    let slackRecord: Record<string, unknown> | undefined;

    try {
      slackResult = await sendSlackMessageTool.execute(
        {
          channel: slackChannel,
          text: slackMessage,
        },
        {} as any,
      );
      slackRecord = asRecord(slackResult);
    } catch (error) {
      slackRecord = {
        check: 'send_slack_message',
        status: 'error',
        message: error instanceof Error ? error.message : 'Slack digest delivery failed.',
      };
      slackResult = slackRecord;
    }

    if (asString(slackRecord?.status) === 'error') {
      return {
        check: 'interview_transcript_slack_digest',
        status: 'error',
        channel: slackChannel,
        message: asString(slackRecord?.message) ?? 'Slack digest delivery failed.',
        digest: {
          recommendation: summary.recommendation,
          overallRubricScore: summary.overallRubricScore,
          jdFitVerdict: jdAlignment.jdFitVerdict,
        },
      };
    }

    return {
      check: 'interview_transcript_slack_digest',
      status: 'success',
      mode: 'sent',
      channel: slackChannel,
      candidateId: digestContext.candidateId,
      jobId: digestContext.jobId,
      bookingUid,
      source,
      digest: {
        recommendation: summary.recommendation,
        overallRubricScore: summary.overallRubricScore,
        jdAlignment: jdAlignment,
      },
      slack: slackResult,
    };
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
