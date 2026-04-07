import { desc, inArray } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { auth0 } from '@/lib/auth0';
import { upsertAuth0SubjectRefreshToken } from '@/lib/auth0-subject-refresh-token';
import { enqueueInitialIntakeScan } from '@/lib/automation/intake-bootstrap';
import { resumePausedIntakeRunsForActor } from '@/lib/automation/resume-paused-runs';
import { kickoffV2IntakeFromSession } from '@/lib/automation/v2-kickoff';
import { db } from '@/lib/db';
import { applications } from '@/lib/db/schema/applications';
import { jobs } from '@/lib/db/schema/jobs';
import { organizations } from '@/lib/db/schema/organizations';
import { buildFallbackJdTemplate, jdTemplateSchema, normalizeJdTemplate } from '@/lib/jd-template';
import { upsertJobScopedOfferTemplate } from '@/lib/offer-template-seeding';
import { resolveUserOrganizationId, upsertUserWorkspaceContext } from '@/lib/user-workspace';

export const runtime = 'nodejs';

const createJobSchema = z.object({
  title: z.string().trim().min(1).max(180),
  team: z.string().trim().max(180).optional(),
  description: z.string().trim().max(5000).optional(),
  organizationId: z.string().trim().min(1).optional(),
  status: z.enum(['draft', 'active', 'paused', 'closed']).default('draft'),
  jdSynthesis: jdTemplateSchema.optional(),
});

type JobStatus = 'draft' | 'active' | 'paused' | 'closed';

type JobCountBucket = {
  applied: number;
  reviewed: number;
  interviewed: number;
};

type JobRow = {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
  organizationId: string | null;
  jdTemplate: unknown;
};

type OrganizationRow = {
  id: string;
  name: string;
};

const REVIEWED_STAGES = new Set(['reviewed', 'interview_scheduled', 'interviewed', 'offer_sent', 'hired']);
const INTERVIEWED_STAGES = new Set(['interview_scheduled', 'interviewed', 'offer_sent', 'hired']);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-') || 'job';
}

function formatOpenedAt(date: Date): string {
  const month = date.toLocaleString('en-US', { month: 'short' });
  const day = date.toLocaleString('en-US', { day: '2-digit' });
  return `Opened ${month} ${day}`;
}

function normalizeStatus(status: string): JobStatus {
  if (status === 'draft' || status === 'active' || status === 'paused' || status === 'closed') {
    return status;
  }

  return 'paused';
}

async function loadApplicationCounts(jobIds: string[]): Promise<Map<string, JobCountBucket>> {
  const counts = new Map<string, JobCountBucket>();

  for (const jobId of jobIds) {
    counts.set(jobId, {
      applied: 0,
      reviewed: 0,
      interviewed: 0,
    });
  }

  if (jobIds.length === 0) {
    return counts;
  }

  const rows = await db
    .select({
      jobId: applications.jobId,
      stage: applications.stage,
    })
    .from(applications)
    .where(inArray(applications.jobId, jobIds));

  for (const row of rows) {
    const bucket = counts.get(row.jobId);
    if (!bucket) {
      continue;
    }

    bucket.applied += 1;

    if (REVIEWED_STAGES.has(row.stage)) {
      bucket.reviewed += 1;
    }

    if (INTERVIEWED_STAGES.has(row.stage)) {
      bucket.interviewed += 1;
    }
  }

  return counts;
}

function toResponseJob(params: {
  row: {
    id: string;
    title: string;
    status: string;
    createdAt: Date;
    organizationId: string | null;
    jdTemplate: unknown;
  };
  counts: JobCountBucket;
  organizationName: string | null;
}) {
  const parsedTemplate = jdTemplateSchema.safeParse(params.row.jdTemplate);
  const jdSynthesis = parsedTemplate.success ? normalizeJdTemplate(parsedTemplate.data) : null;
  const team = jdSynthesis?.department ?? 'General';
  const description = jdSynthesis?.roleSummary ?? '';

  return {
    id: params.row.id,
    slug: `${slugify(params.row.title)}-${params.row.id.slice(-6)}`,
    title: params.row.title,
    team,
    status: normalizeStatus(params.row.status),
    openedAt: formatOpenedAt(params.row.createdAt),
    manager: params.organizationName ? `${params.organizationName} Hiring Team` : 'Hiring Team',
    description,
    jdSynthesis,
    applied: params.counts.applied,
    reviewed: params.counts.reviewed,
    interviewed: params.counts.interviewed,
    organizationId: params.row.organizationId,
    organizationName: params.organizationName,
  };
}

export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const refreshToken = session.tokenSet?.refreshToken;
  if (typeof refreshToken === 'string' && refreshToken.trim()) {
    await upsertAuth0SubjectRefreshToken({
      userId: session.user.sub,
      refreshToken,
    });

    await resumePausedIntakeRunsForActor(session.user.sub).catch(() => null);
  }

  const jobRows: JobRow[] = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      status: jobs.status,
      createdAt: jobs.createdAt,
      organizationId: jobs.organizationId,
      jdTemplate: jobs.jdTemplate,
    })
    .from(jobs)
    .orderBy(desc(jobs.createdAt))
    .limit(150);

  const jobIds = jobRows.map((job: JobRow) => job.id);
  const applicationCounts = await loadApplicationCounts(jobIds);

  const organizationIds = Array.from(new Set(jobRows.map((job: JobRow) => job.organizationId).filter(Boolean))) as string[];
  const organizationRows: OrganizationRow[] =
    organizationIds.length > 0
      ? await db
          .select({
            id: organizations.id,
            name: organizations.name,
          })
          .from(organizations)
          .where(inArray(organizations.id, organizationIds))
      : [];

  const organizationNameById = new Map<string, string>(organizationRows.map((row: OrganizationRow) => [row.id, row.name]));

  return NextResponse.json({
    status: 'success',
    jobs: jobRows.map((row: JobRow) =>
      toResponseJob({
        row,
        counts: applicationCounts.get(row.id) ?? { applied: 0, reviewed: 0, interviewed: 0 },
        organizationName: row.organizationId ? organizationNameById.get(row.organizationId) ?? null : null,
      }),
    ),
  });
}

export async function POST(request: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const refreshToken = session.tokenSet?.refreshToken;
  if (typeof refreshToken === 'string' && refreshToken.trim()) {
    await upsertAuth0SubjectRefreshToken({
      userId: session.user.sub,
      refreshToken,
    });

    await resumePausedIntakeRunsForActor(session.user.sub).catch(() => null);
  }

  const payload = createJobSchema.safeParse(await request.json());
  if (!payload.success) {
    return NextResponse.json(
      {
        message: 'Invalid job payload.',
        issues: payload.error.issues,
      },
      { status: 400 },
    );
  }

  const data = payload.data;
  const organizationId = await resolveUserOrganizationId({
    userId: session.user.sub,
    explicitOrganizationId: data.organizationId,
    createIfMissing: true,
  });

  if (!organizationId) {
    return NextResponse.json({ message: 'Unable to resolve organization for this account.' }, { status: 500 });
  }

  await upsertUserWorkspaceContext({
    userId: session.user.sub,
    organizationId,
    avatarUrl: typeof session.user.picture === 'string' ? session.user.picture : undefined,
  });

  const template = data.jdSynthesis
    ? normalizeJdTemplate(data.jdSynthesis)
    : buildFallbackJdTemplate({
        title: data.title,
        department: data.team,
        roleSummary: data.description,
      });

  const [insertedJob] = await db
    .insert(jobs)
    .values({
      organizationId,
      title: data.title,
      status: data.status,
      jdTemplate: template,
    })
    .returning({
      id: jobs.id,
      title: jobs.title,
      status: jobs.status,
      createdAt: jobs.createdAt,
      organizationId: jobs.organizationId,
      jdTemplate: jobs.jdTemplate,
    });

  const organizationName = organizationId
    ? (
        await db
          .select({
            name: organizations.name,
          })
          .from(organizations)
          .where(inArray(organizations.id, [organizationId]))
          .limit(1)
      )[0]?.name ?? null
    : null;

  const initialOfferTemplate = insertedJob.organizationId
    ? await upsertJobScopedOfferTemplate({
        organizationId: insertedJob.organizationId,
        jobId: insertedJob.id,
        jobTitle: insertedJob.title,
        companyName: organizationName,
        jdTemplate: insertedJob.jdTemplate,
      })
        .then((seeded) => ({
          enabled: true,
          seeded: true,
          templateId: seeded.templateId,
          templateName: seeded.templateName,
          inserted: seeded.inserted,
          updated: seeded.updated,
          error: null,
        }))
        .catch((error) => ({
          enabled: true,
          seeded: false,
          templateId: null,
          templateName: null,
          inserted: false,
          updated: false,
          error: error instanceof Error ? error.message : 'Template seeding failed.',
        }))
    : {
        enabled: false,
        seeded: false,
        templateId: null,
        templateName: null,
        inserted: false,
        updated: false,
        error: null,
      };

  const tokenVaultLoginHint = session.user.sub;

  const initialIntake =
    insertedJob.status === 'active'
      ? await enqueueInitialIntakeScan({
          jobId: insertedJob.id,
          organizationId: insertedJob.organizationId,
          actorUserId: session.user.sub,
          tokenVaultLoginHint,
          trigger: 'api.jobs.post',
        })
      : {
          enabled: false,
          inserted: false,
          runId: null,
          idempotencyKey: null,
          scheduledFor: null,
        };

  const initialIntakeKickoff =
    insertedJob.status === 'active'
      ? await kickoffV2IntakeFromSession({
          jobId: insertedJob.id,
          organizationId: insertedJob.organizationId,
          actorUserId: session.user.sub,
          tokenVaultLoginHint,
          trigger: 'api.jobs.post',
        })
      : {
          attempted: false,
          ok: false,
          status: null,
          functionName: 'v2-agent-intercept',
          message: 'Job status is not active; kickoff skipped.',
          data: null,
        };

  return NextResponse.json({
    status: 'success',
    job: toResponseJob({
      row: insertedJob,
      counts: { applied: 0, reviewed: 0, interviewed: 0 },
      organizationName,
    }),
    initialOfferTemplate,
    initialIntake,
    initialIntakeKickoff,
  });
}
