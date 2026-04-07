import { and, desc, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { auth0 } from '@/lib/auth0';
import { upsertAuth0SubjectRefreshToken } from '@/lib/auth0-subject-refresh-token';
import { resumePausedIntakeRunsForActor } from '@/lib/automation/resume-paused-runs';
import { db } from '@/lib/db';
import { applications } from '@/lib/db/schema/applications';
import { automationRuns } from '@/lib/db/schema/automation-runs';
import { candidates } from '@/lib/db/schema/candidates';
import { interviews } from '@/lib/db/schema/interviews';
import { jobs } from '@/lib/db/schema/jobs';
import { offers } from '@/lib/db/schema/offers';
import { organizations } from '@/lib/db/schema/organizations';
import { getUserWorkspaceContext } from '@/lib/user-workspace';

export const runtime = 'nodejs';

const SEEDED_DEMO_ORGANIZATION_ID = process.env.HEADHUNT_DEMO_ORGANIZATION_ID?.trim() || 'org_demo_headhunt';

const SERVER_CACHE_TTL_MS = 10 * 1000;
const SERVER_CACHE_MAX_USERS = 50;

type ServerCacheEntry = {
  cachedAtMs: number;
  payload: unknown;
  inFlight: Promise<unknown> | null;
};

const serverCacheByUserId = new Map<string, ServerCacheEntry>();

function cacheHeaders() {
  return {
    // Authenticated endpoint; allow short private caching for snappy nav.
    'Cache-Control': 'private, max-age=5, stale-while-revalidate=15',
  };
}

function getFreshCachedPayload(userId: string): unknown | null {
  const entry = serverCacheByUserId.get(userId);
  if (!entry?.payload) return null;
  if (Date.now() - entry.cachedAtMs > SERVER_CACHE_TTL_MS) return null;
  return entry.payload;
}

async function getOrBuildCachedPayload(userId: string, build: () => Promise<unknown>): Promise<unknown> {
  const existingFresh = getFreshCachedPayload(userId);
  if (existingFresh) {
    return existingFresh;
  }

  const existing = serverCacheByUserId.get(userId);
  if (existing?.inFlight) {
    return existing.inFlight;
  }

  const entry: ServerCacheEntry = existing ?? {
    cachedAtMs: 0,
    payload: null,
    inFlight: null,
  };

  entry.inFlight = (async () => {
    try {
      const payload = await build();
      entry.payload = payload;
      entry.cachedAtMs = Date.now();
      return payload;
    } finally {
      entry.inFlight = null;
    }
  })();

  serverCacheByUserId.set(userId, entry);
  if (serverCacheByUserId.size > SERVER_CACHE_MAX_USERS) {
    serverCacheByUserId.clear();
  }

  return entry.inFlight;
}

const PIPELINE_STAGE_ORDER = ['reviewed', 'interview_scheduled', 'interviewed', 'offer_sent', 'hired'] as const;

const PIPELINE_STAGE_LABELS: Record<(typeof PIPELINE_STAGE_ORDER)[number], string> = {
  reviewed: 'Applied',
  interview_scheduled: 'Interview Scheduled',
  interviewed: 'Interviewed',
  offer_sent: 'Offer Sent',
  hired: 'Hired',
};

const PIPELINE_STAGE_COLORS: Record<(typeof PIPELINE_STAGE_ORDER)[number], string> = {
  reviewed: 'bg-[#e0f2fe] text-[#0369a1] border-[#bae6fd]',
  interview_scheduled: 'bg-[#fffbeb] text-[#b45309] border-[#fde68a]',
  interviewed: 'bg-[#eef2ff] text-[#4338ca] border-[#c7d2fe]',
  offer_sent: 'bg-[#fff7ed] text-[#c2410c] border-[#fed7aa]',
  hired: 'bg-[#f0fdf4] text-[#15803d] border-[#bbf7d0]',
};

const PIPELINE_METRIC_STAGES = new Set(['applied', 'reviewed', 'interview_scheduled', 'interviewed', 'offer_sent']);
const OFFER_PENDING_STATUSES = new Set(['awaiting_approval', 'approved']);
const FOLLOW_UP_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type CandidateStage =
  | 'applied'
  | 'reviewed'
  | 'interview_scheduled'
  | 'interviewed'
  | 'offer_sent'
  | 'hired'
  | 'rejected';

type OfferStatus =
  | 'draft'
  | 'awaiting_approval'
  | 'approved'
  | 'sent'
  | 'accepted'
  | 'declined'
  | 'withdrawn';

type OrganizationRow = {
  id: string;
  name: string;
};

type JobRow = {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
};

type ApplicationRow = {
  candidateId: string;
  stage: string;
  updatedAt: Date;
};

type CandidateRow = {
  id: string;
  organizationId: string | null;
  name: string;
  jobId: string;
  stage: string;
  score: number | null;
  objectiveScore: number | null;
  intelConfidence: number | null;
  summary: string | null;
  sourceEmailMessageId: string;
  sourceEmailThreadId: string | null;
  sourceEmailReceivedAt: Date | null;
  createdAt: Date;
};

type InterviewRow = {
  id: string;
  candidateId: string;
  scheduledAt: Date;
  status: string;
  durationMinutes: number;
  googleMeetLink: string | null;
};

type OfferRow = {
  id: string;
  candidateId: string;
  jobId: string;
  status: string;
  terms: unknown;
  cibaAuthReqId: string | null;
  createdAt: Date;
};

type CandidateRecord = {
  id: string;
  organizationId: string | null;
  name: string;
  role: string;
  jobId: string;
  stage: CandidateStage;
  objectiveScore: number;
  confidenceScore: number;
  score: number;
  confidence: number[];
  source: string;
  owner: 'Triage' | 'Liaison' | 'Analyst' | 'Dispatch';
  latency: string;
  intelConfidence: number | null;
  summary: string | null;
  intelBullets: string[];
  analysisStatus: 'pending' | 'paused' | 'ready' | 'failed' | 'unknown';
  analysisUpdatedAt: Date | null;
  roundsCompleted: number;
  nextInterviewAt: Date | null;
  nextInterviewMeetLink: string | null;
  firstInterviewAt: Date | null;
  offerStatus: OfferStatus | null;
  offerStartDate: string | null;
};

function extractBullets(summary: string | null): string[] {
  if (!summary) return [];
  const normalized = summary
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line
        .replace(/^(((?:[-*•\u2022\u25CF\u25A0\u25AA\u2013\u2014])|(?:\d+\.))\s+)+/, '')
        .trim(),
    )
    .filter(Boolean);

  if (lines.length >= 3) {
    return lines.slice(0, 3);
  }

  const sentences = normalized
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  return sentences.slice(0, 3);
}

function mapAnalysisStatus(status: string | null | undefined): 'pending' | 'paused' | 'ready' | 'failed' | 'unknown' {
  if (!status) return 'unknown';

  if (status === 'completed') return 'ready';
  if (status === 'dead_letter') return 'failed';
  if (status === 'paused_awaiting_reauth') return 'paused';
  if (status === 'pending' || status === 'running' || status === 'retrying') return 'pending';
  if (status === 'cancelled') return 'unknown';
  return 'unknown';
}

type ApprovalRecord = {
  id: string;
  action: string;
  status: 'pending' | 'approved' | 'denied';
  candidateName: string;
  jobTitle: string;
  comp: string;
  requestedAt: string;
  expires: string;
  authReqId: string;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-') || 'job';
}

function formatRelativeTime(timestamp: Date): string {
  const deltaMs = Date.now() - timestamp.getTime();
  const deltaMinutes = Math.max(Math.floor(deltaMs / 60000), 0);

  if (deltaMinutes < 1) return 'just now';
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;

  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;

  const deltaDays = Math.floor(deltaHours / 24);
  return `${deltaDays}d ago`;
}

function formatExpiryLabel(expiresAtMs: number): string {
  const remaining = Math.floor((expiresAtMs - Date.now()) / 1000);
  if (remaining <= 0) {
    return 'expired';
  }

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s remaining`;
  }

  return `${seconds}s remaining`;
}

function confidenceSegments(confidence: number | null): number[] {
  const normalized = Math.max(0, Math.min(100, confidence ?? 0));
  const filled = Math.max(0, Math.min(10, Math.round(normalized / 10)));

  return Array.from({ length: 10 }, (_, index) => (index < filled ? 1 : 0));
}

function resolveOwner(stage: CandidateStage): 'Triage' | 'Liaison' | 'Analyst' | 'Dispatch' {
  if (stage === 'interview_scheduled') return 'Liaison';
  if (stage === 'interviewed') return 'Analyst';
  if (stage === 'offer_sent' || stage === 'hired') return 'Dispatch';
  return 'Triage';
}

function safeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return null;
}

function formatCompensation(terms: unknown): string {
  if (!terms || typeof terms !== 'object' || Array.isArray(terms)) {
    return 'Comp package pending';
  }

  const record = terms as Record<string, unknown>;
  const baseSalary = safeNumber(record.baseSalary);
  const equityPercent = safeNumber(record.equityPercent);

  if (!baseSalary) {
    return 'Comp package pending';
  }

  const salaryLabel = `$${Math.round(baseSalary / 1000)}k`;
  if (equityPercent && equityPercent > 0) {
    return `${salaryLabel} + ${equityPercent}%`;
  }

  return salaryLabel;
}

function parseStartDateLabel(terms: unknown): string | null {
  if (!terms || typeof terms !== 'object' || Array.isArray(terms)) {
    return null;
  }

  const record = terms as Record<string, unknown>;
  if (typeof record.startDate !== 'string') {
    return null;
  }

  const parsed = new Date(record.startDate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function mapApprovalStatus(status: OfferStatus): 'pending' | 'approved' | 'denied' | null {
  if (status === 'awaiting_approval' || status === 'approved' || status === 'sent') {
    return 'pending';
  }

  if (status === 'accepted') {
    return 'approved';
  }

  if (status === 'declined' || status === 'withdrawn') {
    return 'denied';
  }

  return null;
}

async function resolveOrganization(userId: string) {
  const workspace = await getUserWorkspaceContext(userId);
  const scopedOrganizationId = workspace?.organizationId ?? null;

  if (!scopedOrganizationId) {
    return null;
  }

  const [organization] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
    })
    .from(organizations)
    .where(inArray(organizations.id, [scopedOrganizationId]))
    .limit(1);

  return (organization ?? null) as OrganizationRow | null;
}

async function resolveHiringOrganizationIds(primaryOrganizationId: string | null): Promise<string[]> {
  const ids = new Set<string>();

  if (primaryOrganizationId) {
    ids.add(primaryOrganizationId);
  }

  // In demo environments we want seeded candidates visible even if the user created their own workspace.
  if (SEEDED_DEMO_ORGANIZATION_ID && primaryOrganizationId !== SEEDED_DEMO_ORGANIZATION_ID) {
    const [seeded] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, SEEDED_DEMO_ORGANIZATION_ID))
      .limit(1);

    if (seeded?.id) {
      ids.add(seeded.id);
    }
  }

  return Array.from(ids);
}

function emptyResponse() {
  return {
    status: 'success',
    organization: null,
    metrics: {
      candidatesInPipeline: 0,
      openRoles: 0,
      avgDaysToFirstInterview: 0,
      interviewsThisWeek: 0,
      offersPendingApproval: 0,
      candidatesNeedingFollowUp: 0,
    },
    agents: [],
    pendingApprovals: [],
    approvals: [],
    candidates: [],
    pipelineStages: PIPELINE_STAGE_ORDER.map((stage) => ({
      key: stage,
      label: PIPELINE_STAGE_LABELS[stage],
      color: PIPELINE_STAGE_COLORS[stage],
      count: 0,
      cards: [],
    })),
  };
}

export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.sub;

  const cached = getFreshCachedPayload(userId);
  if (cached) {
    return NextResponse.json(cached, { headers: cacheHeaders() });
  }

  void resumePausedIntakeRunsForActor(userId).catch(() => null);

  const refreshToken = session.tokenSet?.refreshToken;
  if (typeof refreshToken === 'string' && refreshToken.trim()) {
    await upsertAuth0SubjectRefreshToken({
      userId,
      refreshToken,
    });
  }

  const payload = await getOrBuildCachedPayload(userId, async () => {
    const organization = await resolveOrganization(userId);

    const hiringOrganizationIds = await resolveHiringOrganizationIds(organization?.id ?? null);

    const jobRows: JobRow[] = organization
      ? await db
          .select({
            id: jobs.id,
            title: jobs.title,
            status: jobs.status,
            createdAt: jobs.createdAt,
          })
          .from(jobs)
          .where(inArray(jobs.organizationId, hiringOrganizationIds.length ? hiringOrganizationIds : [organization.id]))
          .orderBy(desc(jobs.createdAt))
          .limit(400)
      : await db
          .select({
            id: jobs.id,
            title: jobs.title,
            status: jobs.status,
            createdAt: jobs.createdAt,
          })
          .from(jobs)
          .orderBy(desc(jobs.createdAt))
          .limit(400);

    if (jobRows.length === 0) {
      return {
        ...emptyResponse(),
        organization,
      };
    }

    const jobIds = jobRows.map((job: JobRow) => job.id);
    const jobById = new Map<string, JobRow>(jobRows.map((job: JobRow) => [job.id, job]));
    const jobSlugById = new Map<string, string>(
      jobRows.map((job: JobRow) => [job.id, `${slugify(job.title)}-${job.id.slice(-6)}`]),
    );

    const candidateRows: CandidateRow[] = await db
      .select({
        id: candidates.id,
        organizationId: candidates.organizationId,
        name: candidates.name,
        jobId: candidates.jobId,
        stage: candidates.stage,
        score: candidates.score,
        objectiveScore: candidates.objectiveScore,
        intelConfidence: candidates.intelConfidence,
        summary: candidates.summary,
        sourceEmailMessageId: candidates.sourceEmailMessageId,
        sourceEmailThreadId: candidates.sourceEmailThreadId,
        sourceEmailReceivedAt: candidates.sourceEmailReceivedAt,
        createdAt: candidates.createdAt,
      })
      .from(candidates)
      .where(inArray(candidates.jobId, jobIds))
      .orderBy(desc(candidates.createdAt))
      .limit(1200);

    const candidateIds = candidateRows.map((candidate: CandidateRow) => candidate.id);
    if (candidateIds.length === 0) {
      return {
        ...emptyResponse(),
        organization,
        metrics: {
          ...emptyResponse().metrics,
          openRoles: jobRows.filter((job: JobRow) => job.status === 'active').length,
        },
      };
    }

    const [applicationRows, runRows, interviewRows, offerRows] = await Promise.all([
      db
        .select({
          candidateId: applications.candidateId,
          stage: applications.stage,
          updatedAt: applications.updatedAt,
        })
        .from(applications)
        .where(inArray(applications.candidateId, candidateIds))
        .orderBy(desc(applications.updatedAt)),
      db
        .select({
          resourceId: automationRuns.resourceId,
          status: automationRuns.status,
          updatedAt: automationRuns.updatedAt,
        })
        .from(automationRuns)
        .where(
          and(
            eq(automationRuns.handlerType, 'candidate.score'),
            eq(automationRuns.resourceType, 'candidate'),
            inArray(automationRuns.resourceId, candidateIds),
          ),
        )
        .orderBy(desc(automationRuns.createdAt))
        .limit(5000),
      db
        .select({
          id: interviews.id,
          candidateId: interviews.candidateId,
          scheduledAt: interviews.scheduledAt,
          status: interviews.status,
          durationMinutes: interviews.durationMinutes,
          googleMeetLink: interviews.googleMeetLink,
        })
        .from(interviews)
        .where(inArray(interviews.candidateId, candidateIds))
        .orderBy(interviews.scheduledAt),
      db
        .select({
          id: offers.id,
          candidateId: offers.candidateId,
          jobId: offers.jobId,
          status: offers.status,
          terms: offers.terms,
          cibaAuthReqId: offers.cibaAuthReqId,
          createdAt: offers.createdAt,
        })
        .from(offers)
        .where(inArray(offers.candidateId, candidateIds))
        .orderBy(desc(offers.createdAt)),
    ]);

    const latestApplicationStageByCandidate = new Map<string, CandidateStage>();
    for (const row of applicationRows as ApplicationRow[]) {
      if (!latestApplicationStageByCandidate.has(row.candidateId)) {
        latestApplicationStageByCandidate.set(row.candidateId, row.stage as CandidateStage);
      }
    }

    const latestCandidateScoreRunByCandidate = new Map<string, { status: string; updatedAt: Date }>();
    for (const row of runRows as Array<{ resourceId: string; status: string; updatedAt: Date }>) {
      if (!latestCandidateScoreRunByCandidate.has(row.resourceId)) {
        latestCandidateScoreRunByCandidate.set(row.resourceId, {
          status: row.status,
          updatedAt: row.updatedAt,
        });
      }
    }

    const firstInterviewByCandidate = new Map<string, Date>();
    const nextInterviewByCandidate = new Map<string, Date>();
    const nextInterviewMeetLinkByCandidate = new Map<string, string | null>();
    const latestScheduledInterviewByCandidate = new Map<string, { scheduledAt: Date; googleMeetLink: string | null }>();
    const scheduledInterviewCountByCandidate = new Map<string, number>();

    for (const row of interviewRows as InterviewRow[]) {
      if (row.status !== 'cancelled') {
        scheduledInterviewCountByCandidate.set(
          row.candidateId,
          (scheduledInterviewCountByCandidate.get(row.candidateId) ?? 0) + 1,
        );
      }

      if (!firstInterviewByCandidate.has(row.candidateId)) {
        firstInterviewByCandidate.set(row.candidateId, row.scheduledAt);
      }

      if (row.status === 'scheduled') {
        latestScheduledInterviewByCandidate.set(row.candidateId, {
          scheduledAt: row.scheduledAt,
          googleMeetLink: row.googleMeetLink ?? null,
        });
      }

      if (row.status === 'scheduled' && row.scheduledAt.getTime() >= Date.now()) {
        const existingNext = nextInterviewByCandidate.get(row.candidateId);
        if (!existingNext || row.scheduledAt.getTime() < existingNext.getTime()) {
          nextInterviewByCandidate.set(row.candidateId, row.scheduledAt);
          nextInterviewMeetLinkByCandidate.set(row.candidateId, row.googleMeetLink ?? null);
        }
      }
    }

    const latestOfferByCandidate = new Map<string, OfferRow>();
    for (const offer of offerRows as OfferRow[]) {
      if (!latestOfferByCandidate.has(offer.candidateId)) {
        latestOfferByCandidate.set(offer.candidateId, offer);
      }
    }

    const pipelineStageBuckets = new Map<(typeof PIPELINE_STAGE_ORDER)[number], CandidateRecord[]>(
      PIPELINE_STAGE_ORDER.map((stage) => [stage, []]),
    );

    const stageCounts = {
      applied: 0,
      reviewed: 0,
      interviewScheduled: 0,
      interviewed: 0,
      offerSent: 0,
      hired: 0,
    };

    const candidateRecords: CandidateRecord[] = [];
    const candidateRecordById = new Map<string, CandidateRecord>();
    const daysToFirstInterview: number[] = [];
    let candidatesInPipeline = 0;
    let candidatesNeedingFollowUp = 0;
    const followUpThreshold = Date.now() - FOLLOW_UP_THRESHOLD_MS;

    for (const candidate of candidateRows) {
      const job = jobById.get(candidate.jobId);
      const stage =
        latestApplicationStageByCandidate.get(candidate.id) ?? (candidate.stage as CandidateStage);
      const resolvedObjectiveScore =
        candidate.objectiveScore ??
        candidate.score ??
        Math.max(45, Math.min(98, (candidate.intelConfidence ?? 72) - 8));
      const confidenceScore =
        candidate.intelConfidence ?? Math.max(30, Math.min(98, resolvedObjectiveScore - 6));
      const analysisRun = latestCandidateScoreRunByCandidate.get(candidate.id) ?? null;
      const analysisStatus = mapAnalysisStatus(analysisRun?.status);
      const analysisUpdatedAt = analysisRun?.updatedAt ?? null;
      const intelBullets = extractBullets(candidate.summary);
      const roundsCompleted = scheduledInterviewCountByCandidate.get(candidate.id) ?? 0;
      const firstInterviewAt = firstInterviewByCandidate.get(candidate.id) ?? null;
      const resolvedNextInterview =
        nextInterviewByCandidate.get(candidate.id) ??
        latestScheduledInterviewByCandidate.get(candidate.id)?.scheduledAt ??
        null;
      const resolvedNextMeetLink =
        nextInterviewMeetLinkByCandidate.get(candidate.id) ??
        latestScheduledInterviewByCandidate.get(candidate.id)?.googleMeetLink ??
        null;

      const record: CandidateRecord = {
        id: candidate.id,
        organizationId: candidate.organizationId ?? null,
        name: candidate.name,
        role: job?.title ?? 'Role unavailable',
        jobId: jobSlugById.get(candidate.jobId) ?? candidate.jobId,
        stage,
        objectiveScore: resolvedObjectiveScore,
        confidenceScore,
        score: resolvedObjectiveScore,
        confidence: confidenceSegments(confidenceScore),
        source: candidate.sourceEmailThreadId ?? candidate.sourceEmailMessageId,
        owner: resolveOwner(stage),
        latency: '0',
        intelConfidence: candidate.intelConfidence,
        summary: candidate.summary,
        intelBullets,
        analysisStatus,
        analysisUpdatedAt,
        roundsCompleted,
        nextInterviewAt: resolvedNextInterview,
        nextInterviewMeetLink: resolvedNextMeetLink,
        firstInterviewAt,
        offerStatus: (latestOfferByCandidate.get(candidate.id)?.status as OfferStatus | undefined) ?? null,
        offerStartDate: parseStartDateLabel(latestOfferByCandidate.get(candidate.id)?.terms ?? null),
      };

      candidateRecords.push(record);
      candidateRecordById.set(record.id, record);

      if (PIPELINE_METRIC_STAGES.has(stage)) {
        candidatesInPipeline += 1;
      }

      switch (stage) {
        case 'applied':
          stageCounts.applied += 1;
          break;
        case 'reviewed':
          stageCounts.reviewed += 1;
          if (!candidate.sourceEmailReceivedAt || candidate.sourceEmailReceivedAt.getTime() <= followUpThreshold) {
            candidatesNeedingFollowUp += 1;
          }
          break;
        case 'interview_scheduled':
          stageCounts.interviewScheduled += 1;
          break;
        case 'interviewed':
          stageCounts.interviewed += 1;
          break;
        case 'offer_sent':
          stageCounts.offerSent += 1;
          break;
        case 'hired':
          stageCounts.hired += 1;
          break;
        default:
          break;
      }

      if (stage === 'applied') {
        pipelineStageBuckets.get('reviewed')?.push(record);
      } else if ((PIPELINE_STAGE_ORDER as readonly string[]).includes(stage)) {
        pipelineStageBuckets.get(stage as (typeof PIPELINE_STAGE_ORDER)[number])?.push(record);
      }

      if (firstInterviewAt && candidate.sourceEmailReceivedAt) {
        const deltaDays = Math.round(
          (firstInterviewAt.getTime() - candidate.sourceEmailReceivedAt.getTime()) / DAY_MS,
        );
        if (Number.isFinite(deltaDays) && deltaDays >= 0 && deltaDays <= 120) {
          daysToFirstInterview.push(deltaDays);
        }
      }
    }

    const openRoles = jobRows.filter((job: JobRow) => job.status === 'active').length;

    const avgDaysToFirstInterview =
      daysToFirstInterview.length > 0
        ? Math.round(
            daysToFirstInterview.reduce((sum: number, days: number) => sum + days, 0) /
              daysToFirstInterview.length,
          )
        : 0;

  const now = new Date();
  const dayOfWeek = now.getDay();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - dayOfWeek);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const interviewsThisWeek = (interviewRows as InterviewRow[]).filter(
    (interview: InterviewRow) =>
      interview.scheduledAt.getTime() >= weekStart.getTime() && interview.scheduledAt.getTime() < weekEnd.getTime(),
  ).length;

  const offersPendingApproval = (offerRows as OfferRow[]).filter((offer: OfferRow) =>
    OFFER_PENDING_STATUSES.has(offer.status),
  ).length;

  const pipelineBuckets = PIPELINE_STAGE_ORDER.map((stage) => {
    const inStage = pipelineStageBuckets.get(stage) ?? [];
    inStage.sort((left: CandidateRecord, right: CandidateRecord) => right.score - left.score);

    const cards = inStage.map((candidate: CandidateRecord) => {
      let eta = 'Follow up';

      if (stage === 'interview_scheduled') {
        eta = candidate.nextInterviewAt
          ? candidate.nextInterviewAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : 'Scheduling';
      } else if (stage === 'interviewed') {
        eta = 'Digest ready';
      } else if (stage === 'offer_sent') {
        if (candidate.offerStatus === 'awaiting_approval') {
          eta = 'Needs approval';
        } else if (candidate.offerStatus === 'approved') {
          eta = 'Ready to send';
        } else {
          eta = 'Pending';
        }
      } else if (stage === 'hired') {
        eta = candidate.offerStartDate ? `Starts ${candidate.offerStartDate}` : 'Onboarding';
      } else if (stage === 'reviewed') {
        eta = 'Needs reply';
      }

      return {
        id: candidate.id,
        name: candidate.name,
        role: candidate.role,
        score: candidate.score,
        intelConfidence: candidate.intelConfidence ?? candidate.score,
        eta,
      };
    });

    return {
      key: stage,
      label: PIPELINE_STAGE_LABELS[stage],
      color: PIPELINE_STAGE_COLORS[stage],
      count: inStage.length,
      cards,
    };
  });

  const approvals: ApprovalRecord[] = (offerRows as OfferRow[])
    .map((offer: OfferRow) => {
      const status = mapApprovalStatus(offer.status as OfferStatus);
      if (!status) {
        return null;
      }

      const candidate = candidateRecordById.get(offer.candidateId);
      const job = jobById.get(offer.jobId);
      if (!candidate || !job) {
        return null;
      }

      const expiresAtMs = offer.createdAt.getTime() + 45 * 60 * 1000;

      return {
        id: offer.id,
        action: 'send_offer',
        status,
        candidateName: candidate.name,
        jobTitle: job.title,
        comp: formatCompensation(offer.terms),
        requestedAt: formatRelativeTime(offer.createdAt),
        expires: status === 'pending' ? formatExpiryLabel(expiresAtMs) : 'resolved',
        authReqId: offer.cibaAuthReqId ?? `authreq_${offer.id.slice(-8)}`,
      };
    })
    .filter((item: ApprovalRecord | null): item is ApprovalRecord => item !== null);

  const offerById = new Map<string, OfferRow>((offerRows as OfferRow[]).map((offer: OfferRow) => [offer.id, offer]));

  const pendingApprovals = approvals
    .filter((approval: ApprovalRecord) => approval.status === 'pending')
    .slice(0, 12)
    .map((approval: ApprovalRecord) => {
      const backingOffer = offerById.get(approval.id);
      const candidate = backingOffer?.candidateId ? candidateRecordById.get(backingOffer.candidateId) : undefined;
      const requestedAtMs = backingOffer?.createdAt?.getTime() ?? Date.now() - 8 * 60 * 1000;
      const expiresAtMs = requestedAtMs + 45 * 60 * 1000;

      return {
        _id: `pending_${approval.id}`,
        actionType: 'send_offer_packet',
        resourceId: candidate?.id ?? approval.id,
        message: `Release offer packet to ${approval.candidateName} for ${approval.jobTitle}.`,
        requestedAtMs,
        expiresAtMs,
        authReqId: approval.authReqId,
        payloadJson: JSON.stringify({
          candidate: {
            actionType: 'send_offer_packet',
            candidateName: approval.candidateName,
            jobTitle: approval.jobTitle,
            stage: candidate?.stage ?? 'offer_sent',
            score: candidate?.score ?? 0,
          },
        }),
      };
    });

  const agents = [
    {
      _id: 'agent_triage',
      name: 'Triage Agent',
      action: `Prioritizing ${stageCounts.applied + stageCounts.reviewed} inbound candidates and fit checks.`,
      last: 'Last action 2m ago',
      files: [],
    },
    {
      _id: 'agent_liaison',
      name: 'Liaison Agent',
      action: `Coordinating ${stageCounts.interviewScheduled} scheduled interview loops and follow-ups.`,
      last: 'Last action 8m ago',
      files: [],
    },
    {
      _id: 'agent_analyst',
      name: 'Analyst Agent',
      action: `Summarizing signal quality for ${stageCounts.interviewed} interviewed candidates.`,
      last: 'Last action 14m ago',
      files: [],
    },
    {
      _id: 'agent_dispatch',
      name: 'Dispatch Agent',
      action: `Managing ${stageCounts.offerSent} offer-stage candidates and clearance workflows.`,
      last: 'Last action 5m ago',
      files: [],
    },
    {
      _id: 'agent_intercept',
      name: 'Intercept Agent',
      action: `Monitoring candidate inbox activity across ${candidateRecords.length} active profiles.`,
      last: 'Last action 11m ago',
      files: [],
    },
  ];

    return {
      status: 'success',
      organization,
      metrics: {
        candidatesInPipeline,
        openRoles,
        avgDaysToFirstInterview,
        interviewsThisWeek,
        offersPendingApproval,
        candidatesNeedingFollowUp,
      },
      agents,
      pendingApprovals,
      approvals,
      candidates: candidateRecords,
      pipelineStages: pipelineBuckets,
    };
  });

  return NextResponse.json(payload, { headers: cacheHeaders() });
}
