import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { auth0 } from '@/lib/auth0';
import { buildIdempotencyKey, enqueueAutomationRun } from '@/lib/automation/queue';
import { db } from '@/lib/db';
import { candidates } from '@/lib/db/schema/candidates';
import { jobs } from '@/lib/db/schema/jobs';
import { canViewCandidate } from '@/lib/fga/fga';
import { runFinalScheduleFlowTool, sendInterviewProposalTool } from '@/lib/tools/scheduling';

const requestSchema = z.object({
  candidateId: z.string().min(1),
  jobId: z.string().min(1),
  provider: z.enum(['google', 'cal']),
  timezone: z.string().min(1).default('America/Los_Angeles'),
  sendMode: z.enum(['send', 'draft']).default('send'),
  slotStartISOs: z.array(z.string().datetime()).max(6).optional(),
});

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-') || 'job'
  );
}

function extractSuffixFromJobSlug(value: string): string | null {
  const normalized = value.trim();
  const parts = normalized.split('-').filter(Boolean);
  const suffix = parts.at(-1) ?? '';
  if (suffix.length !== 6) {
    return null;
  }

  if (!/^[a-z0-9]{6}$/i.test(suffix)) {
    return null;
  }

  return suffix;
}

async function resolveJobId(jobIdOrSlug: string): Promise<string | null> {
  const normalized = jobIdOrSlug.trim();
  if (!normalized) return null;

  const [direct] = await db.select({ id: jobs.id, title: jobs.title }).from(jobs).where(eq(jobs.id, normalized)).limit(1);
  if (direct?.id) {
    return direct.id;
  }

  const suffix = extractSuffixFromJobSlug(normalized);
  if (!suffix) {
    return null;
  }

  const candidates = await db
    .select({ id: jobs.id, title: jobs.title })
    .from(jobs)
    .where(sql`right(${jobs.id}, 6) = ${suffix}`)
    .limit(10);

  if (candidates.length === 0) {
    return null;
  }

  const exact = candidates.find((row: { id: string; title: string }) => `${slugify(row.title)}-${row.id.slice(-6)}` === normalized);
  if (exact?.id) {
    return exact.id;
  }

  if (candidates.length === 1) {
    return candidates[0]?.id ?? null;
  }

  return null;
}

function buildRecheckQuery(params: { provider: 'google' | 'cal'; candidateEmail: string }): string {
  const base = `from:${params.candidateEmail} newer_than:7d`;

  if (params.provider === 'cal') {
    return `${base} subject:\"Interview availability request\"`;
  }

  return `${base} subject:\"Interview Availability\"`;
}

function extractErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage;
    }

    const maybeText = (error as { text?: unknown }).text;
    if (typeof maybeText === 'string' && maybeText.trim()) {
      return maybeText;
    }

    const maybeError = (error as { error?: unknown }).error;
    if (typeof maybeError === 'string' && maybeError.trim()) {
      return maybeError;
    }

    const maybeCause = (error as { cause?: unknown }).cause;
    if (maybeCause) {
      const causeMessage = extractErrorMessage(maybeCause);
      if (causeMessage !== 'Unknown error') {
        return causeMessage;
      }
    }
  }

  return 'Unknown error';
}

function isTokenVaultAuthorizationRequiredMessage(error: unknown): boolean {
  return /authorization required to access the token vault/i.test(extractErrorMessage(error));
}

export async function POST(req: NextRequest) {
  const session = await auth0.getSession();
  const actorUserId = session?.user?.sub ?? null;

  if (!actorUserId) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  let parsed: z.infer<typeof requestSchema>;
  try {
    parsed = requestSchema.parse(await req.json());
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Invalid request body.' },
      { status: 400 },
    );
  }

  const [candidate] = await db
    .select({
      id: candidates.id,
      name: candidates.name,
      contactEmail: candidates.contactEmail,
      organizationId: candidates.organizationId,
      sourceEmailThreadId: candidates.sourceEmailThreadId,
      jobId: candidates.jobId,
    })
    .from(candidates)
    .where(eq(candidates.id, parsed.candidateId))
    .limit(1);

  if (!candidate) {
    return NextResponse.json({ message: `Candidate ${parsed.candidateId} not found.` }, { status: 404 });
  }

  const canView = await canViewCandidate(actorUserId, parsed.candidateId);
  if (!canView) {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }

  const resolvedJobId = (await resolveJobId(parsed.jobId)) ?? candidate.jobId;
  const [job] = await db
    .select({ id: jobs.id, title: jobs.title, organizationId: jobs.organizationId })
    .from(jobs)
    .where(eq(jobs.id, resolvedJobId))
    .limit(1);

  if (!job) {
    return NextResponse.json({ message: `Job ${parsed.jobId} not found.` }, { status: 404 });
  }

  if (!candidate.contactEmail?.trim()) {
    return NextResponse.json({ message: 'Candidate is missing contactEmail.' }, { status: 400 });
  }

  const now = new Date();
  const windowStartISO = now.toISOString();
  const windowEndISO = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();

  let sendResult: any;

  if (parsed.provider === 'google') {
    const selectedStarts = (parsed.slotStartISOs ?? []).slice(0, 6);

    if (selectedStarts.length === 0) {
      return NextResponse.json({ message: 'slotStartISOs is required for provider=google.' }, { status: 400 });
    }

    const execute = sendInterviewProposalTool.execute;
    if (!execute) {
      return NextResponse.json(
        { status: 'error', message: 'sendInterviewProposalTool is not executable.' },
        { status: 500 },
      );
    }

    try {
      sendResult = await execute(
        {
          candidateId: parsed.candidateId,
          jobId: resolvedJobId,
          organizationId: candidate.organizationId ?? job.organizationId ?? undefined,
          actorUserId,
          replyOnApplicationThread: true,
          useCalendarAvailability: false,
          proposedTimes: selectedStarts,
          durationMinutes: 30,
          slotIntervalMinutes: 30,
          maxSuggestions: 3,
          sendMode: parsed.sendMode,
          timezone: parsed.timezone,
        },
        {} as any,
      );
    } catch (error) {
      const message = extractErrorMessage(error);
      return NextResponse.json(
        { status: 'error', message },
        { status: isTokenVaultAuthorizationRequiredMessage(error) ? 401 : 500 },
      );
    }
  } else {
    const execute = runFinalScheduleFlowTool.execute;
    if (!execute) {
      return NextResponse.json(
        { status: 'error', message: 'runFinalScheduleFlowTool is not executable.' },
        { status: 500 },
      );
    }

    try {
      sendResult = await execute(
        {
          candidateId: parsed.candidateId,
          jobId: resolvedJobId,
          organizationId: candidate.organizationId ?? job.organizationId ?? undefined,
          actorUserId,
          action: 'request_candidate_windows',
          forceRequestResend: false,
          sendMode: parsed.sendMode,
          timezone: parsed.timezone,
          durationMinutes: 30,
          targetDayCount: 3,
          slotsPerDay: 1,
          maxSlotsToEmail: 3,
          lookbackDays: 14,
          maxResults: 10,
          windowStartISO,
          windowEndISO,
          username: process.env.CAL_PUBLIC_USERNAME?.trim() || undefined,
          teamSlug: process.env.CAL_PUBLIC_TEAM_SLUG?.trim() || undefined,
          organizationSlug: process.env.CAL_PUBLIC_ORGANIZATION_SLUG?.trim() || undefined,
        },
        {} as any,
      );
    } catch (error) {
      const message = extractErrorMessage(error);
      return NextResponse.json(
        { status: 'error', message },
        { status: isTokenVaultAuthorizationRequiredMessage(error) ? 401 : 500 },
      );
    }
  }

  if (!sendResult || typeof sendResult !== 'object' || sendResult.status !== 'success') {
    return NextResponse.json(sendResult ?? { status: 'error', message: 'Scheduling send failed.' }, { status: 500 });
  }

  // Strict delayed re-ingest after send succeeds.
  const recheckAt = new Date(Date.now() + 3 * 60 * 1000);
  const query = buildRecheckQuery({ provider: parsed.provider, candidateEmail: candidate.contactEmail.trim().toLowerCase() });

  let delayedRecheck: {
    inserted: boolean;
    runId: string | null;
    scheduledFor: string;
    query: string;
    error?: string;
  };

  try {
    const recheckRun = await enqueueAutomationRun({
      handlerType: 'intake.scan',
      resourceType: 'candidate',
      resourceId: parsed.candidateId,
      idempotencyKey: buildIdempotencyKey([
        'scheduling-recheck',
        parsed.provider,
        parsed.candidateId,
        resolvedJobId,
        sendResult?.request?.providerId ?? sendResult?.proposal?.providerId ?? sendResult?.request?.subject ?? sendResult?.proposal?.subject ?? windowStartISO,
      ]),
      payload: {
        agentName: 'intercept',
        trigger: 'scheduling_delayed_recheck',
        organizationId: candidate.organizationId ?? job.organizationId ?? null,
        jobId: resolvedJobId,
        actorUserId,
        query,
        maxResults: 10,
        processLimit: 6,
        candidateLikeOnly: false,
        includeBody: true,
        generateIntel: false,
      },
      nextAttemptAt: recheckAt,
      maxAttempts: 2,
    });

    delayedRecheck = {
      inserted: recheckRun.inserted,
      runId: recheckRun.runId,
      scheduledFor: recheckAt.toISOString(),
      query,
    };
  } catch (error) {
    delayedRecheck = {
      inserted: false,
      runId: null,
      scheduledFor: recheckAt.toISOString(),
      query,
      error: extractErrorMessage(error),
    };
  }

  return NextResponse.json({
    ...sendResult,
    delayedRecheck,
  });
}
