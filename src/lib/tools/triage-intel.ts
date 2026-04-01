import { and, eq } from 'drizzle-orm';
import { generateObject, tool } from 'ai';
import { z } from 'zod';

import { db } from '@/lib/db';
import { applications } from '@/lib/db/schema/applications';
import { auditLogs } from '@/lib/db/schema/audit-logs';
import {
  candidateQualificationCheckSchema,
  candidateScoreBreakdownItemSchema,
  candidates,
  candidateWorkHistoryItemSchema,
} from '@/lib/db/schema/candidates';
import { canViewCandidate } from '@/lib/fga/fga';
import { jobs } from '@/lib/db/schema/jobs';
import { nim, nimChatModelId } from '@/lib/nim';
import { auth0 } from '@/lib/auth0';

const TRIAGE_CLASSIFICATIONS = ['application', 'scheduling_reply', 'inquiry', 'irrelevant'] as const;
const TRIAGE_ROUTES = ['analyst', 'liaison', 'none'] as const;
type TriageClassification = (typeof TRIAGE_CLASSIFICATIONS)[number];
type TriageRoute = (typeof TRIAGE_ROUTES)[number];
type NormalizedTriageResult = {
  classification: TriageClassification;
  jobId: string | null;
  confidence: number;
  route: TriageRoute;
  reasoning: string;
  fallback: boolean;
};

const triageResultSchema = z.object({
  classification: z.string().min(1),
  jobId: z.string().nullable().optional(),
  confidence: z.number().min(0).max(100).optional(),
  reasoning: z.string().min(1).optional(),
});

const triageInputSchema = z.object({
  organizationId: z.string().optional(),
  from: z.string().optional(),
  subject: z.string().default(''),
  body: z.string().min(1),
  sourceMessageId: z.string().optional(),
  sourceThreadId: z.string().optional(),
  jobs: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
      }),
    )
    .optional(),
});

const intelCardOutputSchema = z.object({
  score: z.number().int().min(0).max(100),
  confidence: z.number().int().min(0).max(100),
  summary: z.string().min(1),
  scoreBreakdown: z.array(candidateScoreBreakdownItemSchema).min(3).max(8),
  qualificationChecks: z.array(candidateQualificationCheckSchema).max(20),
  workHistory: z.array(candidateWorkHistoryItemSchema).max(20),
});

const intelCardInputSchema = z.object({
  candidateId: z.string().min(1),
  jobId: z.string().min(1),
  actorUserId: z.string().min(1).optional(),
  organizationId: z.string().optional(),
  emailText: z.string().min(1),
  resumeText: z.string().optional(),
  requirements: z.array(z.string().min(1)).optional(),
});

function compact(value: string, limit = 280): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, limit);
}

async function loadActiveJobsForTriage(organizationId?: string) {
  if (organizationId) {
    return db
      .select({ id: jobs.id, title: jobs.title })
      .from(jobs)
      .where(and(eq(jobs.status, 'active'), eq(jobs.organizationId, organizationId)))
      .limit(25);
  }

  return db
    .select({ id: jobs.id, title: jobs.title })
    .from(jobs)
    .where(eq(jobs.status, 'active'))
    .limit(25);
}

function normalizeTriageRoute(classification: TriageClassification) {
  if (classification === 'application') return 'analyst';
  if (classification === 'scheduling_reply') return 'liaison';
  return 'none';
}

function normalizeConfidence(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0.5;
  }

  if (value > 1) {
    return Math.max(0, Math.min(1, value / 100));
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeClassification(raw: string): TriageClassification {
  const value = raw.trim().toLowerCase();

  if (value.includes('schedule') || value.includes('availability') || value.includes('calendar')) {
    return 'scheduling_reply';
  }

  if (
    value.includes('application') ||
    value.includes('apply') ||
    value.includes('resume') ||
    value.includes('cv') ||
    value.includes('cover')
  ) {
    return 'application';
  }

  if (value.includes('inquiry') || value.includes('question') || value.includes('ask')) {
    return 'inquiry';
  }

  if ((TRIAGE_CLASSIFICATIONS as readonly string[]).includes(value)) {
    return value as TriageClassification;
  }

  return 'irrelevant';
}

function pickJobIdByTextMatch(input: { subject?: string; body: string }, knownJobs: Array<{ id: string; title: string }>) {
  const source = `${input.subject ?? ''}\n${input.body}`.toLowerCase();

  let best: { id: string; score: number } | null = null;

  for (const job of knownJobs) {
    const title = job.title.toLowerCase();
    const fullTitleMatch = source.includes(title) ? 2 : 0;
    const tokenMatches = title
      .split(/\W+/)
      .filter((token) => token.length >= 3)
      .reduce((score, token) => score + (source.includes(token) ? 1 : 0), 0);

    const score = fullTitleMatch + tokenMatches;
    if (score <= 0) continue;

    if (!best || score > best.score) {
      best = { id: job.id, score };
    }
  }

  return best?.id ?? null;
}

function heuristicClassification(source: string): TriageClassification {
  const lower = source.toLowerCase();

  const negativeSignals = [
    'newsletter',
    'substack',
    'unsubscribe',
    'invoice',
    'receipt',
    'promotion',
    'promo',
    'interview prep club',
  ];
  const schedulingSignals = ['availability', 'available', 'schedule', 'reschedule', 'calendar invite', 'time works'];
  const applicationSignals = ['application', 'apply', 'applying', 'resume', 'cv', 'cover letter', 'job opening'];
  const inquirySignals = ['question', 'inquiry', 'can you clarify', 'would like to know'];

  const hasNegative = negativeSignals.some((signal) => lower.includes(signal));
  const hasScheduling = schedulingSignals.some((signal) => lower.includes(signal));
  const hasApplication = applicationSignals.some((signal) => lower.includes(signal));
  const hasInquiry = inquirySignals.some((signal) => lower.includes(signal));

  if (hasNegative && !hasApplication && !hasScheduling) return 'irrelevant';
  if (hasScheduling) return 'scheduling_reply';
  if (hasApplication) return 'application';
  if (hasInquiry) return 'inquiry';
  return 'irrelevant';
}

function buildFallbackTriage(input: RunTriageInput, knownJobs: Array<{ id: string; title: string }>) {
  const source = `${input.subject ?? ''}\n${input.body}`;
  const classification = heuristicClassification(source);
  const route: TriageRoute = normalizeTriageRoute(classification);
  const matchedJobId = pickJobIdByTextMatch({ subject: input.subject, body: input.body }, knownJobs);

  return {
    classification,
    jobId: matchedJobId,
    confidence: classification === 'irrelevant' ? 0.78 : 0.62,
    route,
    reasoning: 'Heuristic fallback classification applied because structured triage generation failed.',
    fallback: true,
  };
}

export type RunTriageInput = z.infer<typeof triageInputSchema>;
export type GenerateIntelCardInput = z.infer<typeof intelCardInputSchema>;

export async function runTriage(input: RunTriageInput) {
  const knownJobs: Array<{ id: string; title: string }> = input.jobs ?? (await loadActiveJobsForTriage(input.organizationId));
  const prompt = [
    'You are the Headhunt triage agent.',
    'Classify the email into exactly one of: application, scheduling_reply, inquiry, irrelevant.',
    'Pick jobId only from the known jobs list when clearly matched. Otherwise set jobId = null.',
    'Return high confidence only when evidence is explicit in the email.',
    `Known jobs JSON: ${JSON.stringify(knownJobs)}`,
    `Email from: ${input.from ?? 'unknown'}`,
    `Email subject: ${input.subject || '(empty)'}`,
    `Email body:\n${input.body}`,
  ].join('\n\n');

  let triage: NormalizedTriageResult;

  try {
    const { object } = await generateObject({
      model: nim.chatModel(nimChatModelId),
      schema: triageResultSchema,
      temperature: 0,
      prompt,
    });

    const classification = normalizeClassification(object.classification);
    const route = normalizeTriageRoute(classification);
    const modelJobId = object.jobId ?? null;
    const matchedJobId = knownJobs.some((job: { id: string }) => job.id === modelJobId)
      ? modelJobId
      : pickJobIdByTextMatch({ subject: input.subject, body: input.body }, knownJobs);

    triage = {
      classification,
      jobId: matchedJobId,
      confidence: normalizeConfidence(object.confidence),
      route,
      reasoning: object.reasoning ?? 'Structured triage generation succeeded.',
      fallback: false,
    };
  } catch {
    triage = buildFallbackTriage(input, knownJobs);
  }

  await db.insert(auditLogs).values({
    organizationId: input.organizationId ?? null,
    actorType: 'agent',
    actorId: 'run_triage',
    actorDisplayName: 'Triage Agent',
    action: 'triage.classified',
    resourceType: 'email',
    resourceId: input.sourceMessageId ?? `triage:${Date.now()}`,
    metadata: {
      sourceThreadId: input.sourceThreadId ?? null,
      classification: triage.classification,
      jobId: triage.jobId,
      confidence: triage.confidence,
      route: triage.route,
      reasoning: triage.reasoning,
      fallback: triage.fallback,
    },
    result: 'success',
  });

  return {
    check: 'run_triage',
    ...triage,
    knownJobsCount: knownJobs.length,
  };
}

export async function generateIntelCard(input: GenerateIntelCardInput) {
  const actorUserId = input.actorUserId ?? (await auth0.getSession())?.user?.sub ?? null;

  if (!actorUserId) {
    return {
      check: 'generate_intel_card',
      status: 'error' as const,
      message: 'Unauthorized: missing actor identity for intel generation.',
    };
  }

  const [candidate] = await db
    .select({
      id: candidates.id,
      name: candidates.name,
      contactEmail: candidates.contactEmail,
      jobId: candidates.jobId,
      organizationId: candidates.organizationId,
    })
    .from(candidates)
    .where(eq(candidates.id, input.candidateId))
    .limit(1);

  if (!candidate) {
    return {
      check: 'generate_intel_card',
      status: 'error' as const,
      message: `Candidate ${input.candidateId} not found.`,
    };
  }

  const canView = await canViewCandidate(actorUserId, candidate.id);
  if (!canView) {
    return {
      check: 'generate_intel_card',
      status: 'error' as const,
      message: `Forbidden: no candidate visibility access for ${input.candidateId}.`,
    };
  }

  const [job] = await db.select({ id: jobs.id, title: jobs.title }).from(jobs).where(eq(jobs.id, input.jobId)).limit(1);

  const requirements = input.requirements ?? [];

  const intelPrompt = [
    'You are the Headhunt analyst agent.',
    'Produce a structured candidate intel card.',
    'Score must be 0-100 and confidence must be 0-100.',
    'Use evidence from the email and resume text only.',
    `Candidate name: ${candidate.name}`,
    `Candidate email: ${candidate.contactEmail}`,
    `Job title: ${job?.title ?? 'unknown'}`,
    `Job requirements JSON: ${JSON.stringify(requirements)}`,
    `Application email text:\n${input.emailText}`,
    `Resume text (may be empty):\n${input.resumeText ?? ''}`,
  ].join('\n\n');

  let intel: z.infer<typeof intelCardOutputSchema>;
  let intelFallback = false;

  try {
    const { object } = await generateObject({
      model: nim.chatModel(nimChatModelId),
      schema: intelCardOutputSchema,
      temperature: 0,
      prompt: intelPrompt,
    });

    intel = object;
  } catch {
    intelFallback = true;
    const summarySource = input.resumeText?.trim() || input.emailText;
    const truncatedSummary = compact(summarySource, 1000) || `Fallback intel generated for ${candidate.name}.`;

    intel = {
      score: 68,
      confidence: 44,
      summary: truncatedSummary,
      scoreBreakdown: [
        {
          dimension: 'Experience Signal',
          score: 68,
          reasoning: 'Fallback score based on detected application content.',
        },
        {
          dimension: 'Role Alignment',
          score: 66,
          reasoning: 'Fallback estimate pending a richer structured model response.',
        },
        {
          dimension: 'Communication Quality',
          score: 70,
          reasoning: 'Fallback estimate derived from clarity of inbound email.',
        },
      ],
      qualificationChecks: requirements.slice(0, 5).map((requirement) => ({
        requirement,
        met: false,
        evidence: 'Fallback mode: requires manual verification from resume/email artifacts.',
      })),
      workHistory: [],
    };
  }

  const updatedAt = new Date();

  await db.transaction(async (tx: typeof db) => {
    await tx
      .update(candidates)
      .set({
        stage: 'reviewed',
        score: intel.score,
        intelConfidence: intel.confidence,
        scoreBreakdown: intel.scoreBreakdown,
        qualificationChecks: intel.qualificationChecks,
        workHistory: intel.workHistory,
        summary: compact(intel.summary, 1000),
        updatedAt,
      })
      .where(eq(candidates.id, input.candidateId));

    await tx
      .update(applications)
      .set({
        stage: 'reviewed',
        updatedAt,
      })
      .where(and(eq(applications.candidateId, input.candidateId), eq(applications.jobId, input.jobId)));

    await tx.insert(auditLogs).values({
      organizationId: input.organizationId ?? candidate.organizationId ?? null,
      actorType: 'agent',
      actorId: 'generate_intel_card',
      actorDisplayName: 'Analyst Agent',
      action: 'candidate.intel.generated',
      resourceType: 'candidate',
      resourceId: input.candidateId,
      metadata: {
        actorUserId,
        jobId: input.jobId,
        score: intel.score,
        confidence: intel.confidence,
        scoreBreakdown: intel.scoreBreakdown,
        qualificationChecks: intel.qualificationChecks,
        workHistory: intel.workHistory,
        fallback: intelFallback,
      },
      result: 'success',
    });
  });

  return {
    check: 'generate_intel_card',
    status: 'success' as const,
    candidateId: input.candidateId,
    jobId: input.jobId,
    stage: 'reviewed',
    fallback: intelFallback,
    ...intel,
  };
}

export const runTriageTool = tool({
  description:
    'Classify incoming recruiting email text and choose route: analyst (application), liaison (scheduling), or none.',
  inputSchema: triageInputSchema,
  execute: runTriage,
});

export const generateIntelCardTool = tool({
  description:
    'Generate a structured intel card for a candidate and persist score outputs plus stage transitions to reviewed.',
  inputSchema: intelCardInputSchema,
  execute: generateIntelCard,
});
