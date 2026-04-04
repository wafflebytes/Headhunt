import { and, desc, eq, inArray, ne, type SQL } from 'drizzle-orm';
import { FastMCP, UserError, type ContentResult } from 'fastmcp';
import { z } from 'zod';

import { db } from '../src/lib/db';
import {
  APPLICATION_STAGES,
  APPLICATION_STATUSES,
  applications,
} from '../src/lib/db/schema/applications';
import { CANDIDATE_STAGES, candidates } from '../src/lib/db/schema/candidates';
import { JOB_STATUSES, jobs } from '../src/lib/db/schema/jobs';
import { canViewCandidate } from '../src/lib/fga/fga';
import type { McpSessionAuth } from './types';

const READ_ONLY_TOOL_ANNOTATIONS = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
} as const;

const PIPELINE_STAGES = Array.from(new Set([...APPLICATION_STAGES, ...CANDIDATE_STAGES]));

function jsonResult(payload: unknown): ContentResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function getSessionUserId(session: McpSessionAuth | undefined): string {
  if (!session?.userId) {
    throw new UserError('Unauthorized: missing authenticated user identity.');
  }

  return session.userId;
}

function createVisibilityChecker(userId: string) {
  const cache = new Map<string, Promise<boolean>>();

  return async (candidateId: string): Promise<boolean> => {
    const cached = cache.get(candidateId);
    if (cached) {
      return cached;
    }

    const pending = canViewCandidate(userId, candidateId);
    cache.set(candidateId, pending);
    return pending;
  };
}

function createStageCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const stage of PIPELINE_STAGES) {
    counts[stage] = 0;
  }

  return counts;
}

function createStatusCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const status of APPLICATION_STATUSES) {
    counts[status] = 0;
  }

  return counts;
}

function incrementCounter(counter: Record<string, number>, key: string) {
  counter[key] = (counter[key] ?? 0) + 1;
}

function toIsoString(value: Date | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value.toISOString();
}

type JobHealthAccumulator = {
  averageScore: number | null;
  jobId: string;
  jobTitle: string;
  latestActivityAt: string | null;
  scoreCount: number;
  scoreTotal: number;
  stageCounts: Record<string, number>;
  stalledCandidates: number;
  statusCounts: Record<string, number>;
  visibleCandidates: number;
};

export function registerHeadhuntMcpTools(server: FastMCP<McpSessionAuth>) {
  server.addTool({
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    canAccess: (auth) => Boolean(auth?.userId),
    description:
      'List jobs and summarize how many candidates in each job are visible to the current operator.',
    execute: async (args, context) => {
      const actorUserId = getSessionUserId(context.session);
      const isVisibleCandidate = createVisibilityChecker(actorUserId);

      const filters: SQL[] = [];
      if (args.organizationId) {
        filters.push(eq(jobs.organizationId, args.organizationId));
      } else if (context.session?.orgId) {
        filters.push(eq(jobs.organizationId, context.session.orgId));
      }

      if (args.status) {
        filters.push(eq(jobs.status, args.status));
      }

      const rows = await db
        .select({
          createdAt: jobs.createdAt,
          id: jobs.id,
          organizationId: jobs.organizationId,
          status: jobs.status,
          title: jobs.title,
          updatedAt: jobs.updatedAt,
        })
        .from(jobs)
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(desc(jobs.updatedAt))
        .limit(args.limit);

      const jobIds: string[] = [];
      for (const row of rows) {
        jobIds.push(row.id);
      }
      const candidateRows =
        jobIds.length > 0
          ? await db
              .select({ candidateId: candidates.id, jobId: candidates.jobId })
              .from(candidates)
              .where(inArray(candidates.jobId, jobIds))
          : [];

      const visibleCountsByJobId = new Map<string, number>();
      for (const candidateRow of candidateRows) {
        const canView = await isVisibleCandidate(candidateRow.candidateId);
        if (!canView) {
          continue;
        }

        visibleCountsByJobId.set(
          candidateRow.jobId,
          (visibleCountsByJobId.get(candidateRow.jobId) ?? 0) + 1,
        );
      }

      const jobsPayload: Array<{
        createdAt: string | null;
        id: string;
        organizationId: string | null;
        status: string;
        title: string;
        updatedAt: string | null;
        visibleCandidateCount: number;
      }> = [];

      for (const row of rows) {
        jobsPayload.push({
          createdAt: toIsoString(row.createdAt),
          id: row.id,
          organizationId: row.organizationId,
          status: row.status,
          title: row.title,
          updatedAt: toIsoString(row.updatedAt),
          visibleCandidateCount: visibleCountsByJobId.get(row.id) ?? 0,
        });
      }

      return jsonResult({
        jobs: jobsPayload,
        total: rows.length,
      });
    },
    name: 'list_jobs',
    parameters: z.object({
      limit: z.number().int().min(1).max(200).default(50),
      organizationId: z.string().min(1).optional(),
      status: z.enum(JOB_STATUSES).optional(),
    }),
  });

  server.addTool({
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    canAccess: (auth) => Boolean(auth?.userId),
    description:
      'List candidate pipeline entries with stage/status while applying candidate-level FGA visibility checks.',
    execute: async (args, context) => {
      const actorUserId = getSessionUserId(context.session);
      const isVisibleCandidate = createVisibilityChecker(actorUserId);

      const filters: SQL[] = [];
      if (args.jobId) {
        filters.push(eq(applications.jobId, args.jobId));
      }

      if (args.stage) {
        filters.push(eq(applications.stage, args.stage));
      }

      if (args.status) {
        filters.push(eq(applications.status, args.status));
      }

      if (args.organizationId) {
        filters.push(eq(candidates.organizationId, args.organizationId));
      } else if (context.session?.orgId) {
        filters.push(eq(candidates.organizationId, context.session.orgId));
      }

      if (!args.includeRejected) {
        filters.push(ne(applications.stage, 'rejected'));
      }

      const rows = await db
        .select({
          applicationId: applications.id,
          applicationStatus: applications.status,
          candidateEmail: candidates.contactEmail,
          candidateId: candidates.id,
          candidateName: candidates.name,
          candidateScore: candidates.score,
          candidateUpdatedAt: candidates.updatedAt,
          jobId: applications.jobId,
          jobTitle: jobs.title,
          stage: applications.stage,
          updatedAt: applications.updatedAt,
        })
        .from(applications)
        .innerJoin(candidates, eq(applications.candidateId, candidates.id))
        .innerJoin(jobs, eq(applications.jobId, jobs.id))
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(desc(applications.updatedAt), desc(candidates.updatedAt))
        .limit(args.limit);

      const visibleRows: Array<{
        applicationId: string;
        candidateEmail: string;
        candidateId: string;
        candidateName: string;
        candidateScore: number | null;
        candidateUpdatedAt: string | null;
        jobId: string;
        jobTitle: string;
        status: string;
        stage: string;
        updatedAt: string | null;
      }> = [];
      let filteredOutByFga = 0;

      for (const row of rows) {
        const canView = await isVisibleCandidate(row.candidateId);
        if (!canView) {
          filteredOutByFga += 1;
          continue;
        }

        visibleRows.push({
          applicationId: row.applicationId,
          candidateEmail: row.candidateEmail,
          candidateId: row.candidateId,
          candidateName: row.candidateName,
          candidateScore: row.candidateScore,
          candidateUpdatedAt: toIsoString(row.candidateUpdatedAt),
          jobId: row.jobId,
          jobTitle: row.jobTitle,
          status: row.applicationStatus,
          stage: row.stage,
          updatedAt: toIsoString(row.updatedAt),
        });
      }

      return jsonResult({
        filteredOutByFga,
        pipeline: visibleRows,
        total: visibleRows.length,
      });
    },
    name: 'list_pipeline',
    parameters: z.object({
      includeRejected: z.boolean().default(true),
      jobId: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(200).default(100),
      organizationId: z.string().min(1).optional(),
      stage: z.enum(APPLICATION_STAGES).optional(),
      status: z.enum(APPLICATION_STATUSES).optional(),
    }),
  });

  server.addTool({
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    canAccess: (auth) => Boolean(auth?.userId),
    description: 'Get full candidate details, including application and job context, after FGA authorization.',
    execute: async (args, context) => {
      const actorUserId = getSessionUserId(context.session);

      const candidateRows = await db
        .select({
          candidateEmail: candidates.contactEmail,
          candidateId: candidates.id,
          candidateName: candidates.name,
          candidateStage: candidates.stage,
          createdAt: candidates.createdAt,
          intelConfidence: candidates.intelConfidence,
          jobId: candidates.jobId,
          jobStatus: jobs.status,
          jobTitle: jobs.title,
          organizationId: candidates.organizationId,
          qualificationChecks: candidates.qualificationChecks,
          score: candidates.score,
          scoreBreakdown: candidates.scoreBreakdown,
          sourceEmailMessageId: candidates.sourceEmailMessageId,
          sourceEmailReceivedAt: candidates.sourceEmailReceivedAt,
          sourceEmailThreadId: candidates.sourceEmailThreadId,
          summary: candidates.summary,
          updatedAt: candidates.updatedAt,
          workHistory: candidates.workHistory,
        })
        .from(candidates)
        .innerJoin(jobs, eq(candidates.jobId, jobs.id))
        .where(eq(candidates.id, args.candidateId))
        .limit(1);

      const candidateRow = candidateRows[0];
      if (!candidateRow) {
        throw new UserError('Candidate not found.');
      }

      const canView = await canViewCandidate(actorUserId, candidateRow.candidateId);
      if (!canView) {
        throw new UserError('Forbidden: candidate is not visible to this user.');
      }

      const applicationRows = await db
        .select({
          applicationId: applications.id,
          createdAt: applications.createdAt,
          stage: applications.stage,
          status: applications.status,
          updatedAt: applications.updatedAt,
        })
        .from(applications)
        .where(eq(applications.candidateId, args.candidateId))
        .orderBy(desc(applications.updatedAt))
        .limit(1);

      return jsonResult({
        application: applicationRows[0]
          ? {
              ...applicationRows[0],
              createdAt: toIsoString(applicationRows[0].createdAt),
              updatedAt: toIsoString(applicationRows[0].updatedAt),
            }
          : null,
        candidate: {
          contactEmail: candidateRow.candidateEmail,
          createdAt: toIsoString(candidateRow.createdAt),
          id: candidateRow.candidateId,
          intelConfidence: candidateRow.intelConfidence,
          jobId: candidateRow.jobId,
          jobStatus: candidateRow.jobStatus,
          jobTitle: candidateRow.jobTitle,
          name: candidateRow.candidateName,
          organizationId: candidateRow.organizationId,
          qualificationChecks: candidateRow.qualificationChecks,
          score: candidateRow.score,
          scoreBreakdown: candidateRow.scoreBreakdown,
          sourceEmailMessageId: candidateRow.sourceEmailMessageId,
          sourceEmailReceivedAt: toIsoString(candidateRow.sourceEmailReceivedAt),
          sourceEmailThreadId: candidateRow.sourceEmailThreadId,
          stage: candidateRow.candidateStage,
          summary: candidateRow.summary,
          updatedAt: toIsoString(candidateRow.updatedAt),
          workHistory: candidateRow.workHistory,
        },
      });
    },
    name: 'get_candidate_detail',
    parameters: z.object({
      candidateId: z.string().min(1),
    }),
  });

  server.addTool({
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    canAccess: (auth) => Boolean(auth?.userId),
    description:
      'Summarize pipeline health using only candidates visible through FGA checks, with stage/status distribution and alerts.',
    execute: async (args, context) => {
      const actorUserId = getSessionUserId(context.session);
      const isVisibleCandidate = createVisibilityChecker(actorUserId);

      const filters: SQL[] = [];
      if (args.jobId) {
        filters.push(eq(candidates.jobId, args.jobId));
      }

      if (args.organizationId) {
        filters.push(eq(candidates.organizationId, args.organizationId));
      } else if (context.session?.orgId) {
        filters.push(eq(candidates.organizationId, context.session.orgId));
      }

      const rows = await db
        .select({
          applicationStage: applications.stage,
          applicationStatus: applications.status,
          candidateId: candidates.id,
          candidateScore: candidates.score,
          candidateStage: candidates.stage,
          candidateUpdatedAt: candidates.updatedAt,
          jobId: candidates.jobId,
          jobTitle: jobs.title,
        })
        .from(candidates)
        .innerJoin(jobs, eq(candidates.jobId, jobs.id))
        .leftJoin(
          applications,
          and(eq(applications.candidateId, candidates.id), eq(applications.jobId, candidates.jobId)),
        )
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(desc(candidates.updatedAt))
        .limit(args.limit);

      const stageTotals = createStageCounts();
      const statusTotals = createStatusCounts();
      const jobsById = new Map<string, JobHealthAccumulator>();
      let filteredOutByFga = 0;
      let totalVisibleCandidates = 0;

      for (const row of rows) {
        const canView = await isVisibleCandidate(row.candidateId);
        if (!canView) {
          filteredOutByFga += 1;
          continue;
        }

        const resolvedStage = row.applicationStage ?? row.candidateStage;
        if (!args.includeRejected && resolvedStage === 'rejected') {
          continue;
        }

        totalVisibleCandidates += 1;
        incrementCounter(stageTotals, resolvedStage);

        const status = row.applicationStatus ?? 'active';
        incrementCounter(statusTotals, status);

        let jobHealth = jobsById.get(row.jobId);
        if (!jobHealth) {
          jobHealth = {
            averageScore: null,
            jobId: row.jobId,
            jobTitle: row.jobTitle,
            latestActivityAt: null,
            scoreCount: 0,
            scoreTotal: 0,
            stageCounts: createStageCounts(),
            stalledCandidates: 0,
            statusCounts: createStatusCounts(),
            visibleCandidates: 0,
          };
          jobsById.set(row.jobId, jobHealth);
        }

        jobHealth.visibleCandidates += 1;
        incrementCounter(jobHealth.stageCounts, resolvedStage);
        incrementCounter(jobHealth.statusCounts, status);

        if (resolvedStage === 'applied' || resolvedStage === 'reviewed') {
          jobHealth.stalledCandidates += 1;
        }

        if (typeof row.candidateScore === 'number') {
          jobHealth.scoreCount += 1;
          jobHealth.scoreTotal += row.candidateScore;
          jobHealth.averageScore = Number(
            (jobHealth.scoreTotal / Math.max(jobHealth.scoreCount, 1)).toFixed(1),
          );
        }

        const activity = toIsoString(row.candidateUpdatedAt);
        if (activity && (!jobHealth.latestActivityAt || activity > jobHealth.latestActivityAt)) {
          jobHealth.latestActivityAt = activity;
        }
      }

      const alerts: string[] = [];
      if ((stageTotals.applied ?? 0) >= 5 && (stageTotals.reviewed ?? 0) * 2 < (stageTotals.applied ?? 0)) {
        alerts.push('Backlog risk: applied candidates are outpacing reviewed candidates by more than 2x.');
      }

      if ((stageTotals.interviewed ?? 0) > 0 && (stageTotals.offer_sent ?? 0) === 0) {
        alerts.push('No offers sent yet despite interviewed candidates in the funnel.');
      }

      if (filteredOutByFga > 0) {
        alerts.push(`${filteredOutByFga} candidate records were excluded by FGA visibility checks.`);
      }

      const jobsSummary = Array.from(jobsById.values())
        .map((jobHealth) => ({
          averageScore: jobHealth.averageScore,
          jobId: jobHealth.jobId,
          jobTitle: jobHealth.jobTitle,
          latestActivityAt: jobHealth.latestActivityAt,
          stageCounts: jobHealth.stageCounts,
          stalledCandidates: jobHealth.stalledCandidates,
          statusCounts: jobHealth.statusCounts,
          visibleCandidates: jobHealth.visibleCandidates,
        }))
        .sort((left, right) => right.visibleCandidates - left.visibleCandidates);

      return jsonResult({
        alerts,
        filteredOutByFga,
        generatedAt: new Date().toISOString(),
        jobs: jobsSummary,
        stageTotals,
        statusTotals,
        totalVisibleCandidates,
      });
    },
    name: 'summarize_pipeline_health',
    parameters: z.object({
      includeRejected: z.boolean().default(false),
      jobId: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(1000).default(500),
      organizationId: z.string().min(1).optional(),
    }),
  });
}
