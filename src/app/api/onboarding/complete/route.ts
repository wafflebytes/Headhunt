import { and, eq, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { auth0 } from '@/lib/auth0';
import { upsertAuth0SubjectRefreshToken } from '@/lib/auth0-subject-refresh-token';
import { enqueueInitialIntakeScan } from '@/lib/automation/intake-bootstrap';
import { resumePausedIntakeRunsForActor } from '@/lib/automation/resume-paused-runs';
import { kickoffV2IntakeFromSession } from '@/lib/automation/v2-kickoff';
import { db } from '@/lib/db';
import { jobs } from '@/lib/db/schema/jobs';
import { organizations } from '@/lib/db/schema/organizations';
import { buildFallbackJdTemplate, jdTemplateSchema, normalizeJdTemplate } from '@/lib/jd-template';
import { upsertJobScopedOfferTemplate } from '@/lib/offer-template-seeding';
import {
  ONBOARDING_COOKIE_NAME,
  serializeOnboardingCookieValue,
} from '@/lib/onboarding';
import {
  areAllRequiredIntegrationsConnected,
  getOnboardingIntegrationStatuses,
} from '@/lib/onboarding-status';
import { getUserWorkspaceContext, upsertUserWorkspaceContext } from '@/lib/user-workspace';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

const onboardingPersistencePayloadSchema = z.object({
  role: z.enum(['founder', 'hr']).optional(),
  organizationName: z.string().trim().max(180).optional(),
  jobTitle: z.string().trim().max(180).optional(),
  jobDepartment: z.string().trim().max(180).optional(),
  jdSynthesis: jdTemplateSchema.optional(),
});

type OnboardingPersistencePayload = z.infer<typeof onboardingPersistencePayloadSchema>;

async function readOnboardingPayload(request: NextRequest): Promise<OnboardingPersistencePayload | null> {
  const raw = await request.text();
  if (!raw.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const validated = onboardingPersistencePayloadSchema.safeParse(parsed);
    if (!validated.success) {
      return null;
    }

    return validated.data;
  } catch {
    return null;
  }
}

async function persistOnboardingOrganizationAndJob(
  payload: OnboardingPersistencePayload | null,
  options?: {
    workspaceOrganizationId?: string | null;
  },
) {
  const organizationName = payload?.organizationName?.trim();
  const workspaceOrganizationId = options?.workspaceOrganizationId?.trim() || null;

  if (!organizationName && !workspaceOrganizationId) {
    return {
      persistedOrganizationId: null,
      persistedJobId: null,
    };
  }

  let persistedOrganizationId = workspaceOrganizationId;
  if (persistedOrganizationId) {
    if (organizationName) {
      await db
        .update(organizations)
        .set({
          name: organizationName,
        })
        .where(eq(organizations.id, persistedOrganizationId));
    }
  } else {
    const [insertedOrganization] = await db
      .insert(organizations)
      .values({
        name: organizationName ?? 'Headhunt Demo Organization',
      })
      .returning({ id: organizations.id });

    persistedOrganizationId = insertedOrganization?.id ?? null;
  }

  if (!persistedOrganizationId) {
    return {
      persistedOrganizationId: null,
      persistedJobId: null,
    };
  }

  const titleFromPayload = payload?.jobTitle?.trim() || payload?.jdSynthesis?.title?.trim();
  if (!titleFromPayload) {
    return {
      persistedOrganizationId,
      persistedJobId: null,
    };
  }

  const [existingJob] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.organizationId, persistedOrganizationId),
        sql`lower(${jobs.title}) = lower(${titleFromPayload})`,
      ),
    )
    .limit(1);

  const jdTemplate = payload?.jdSynthesis
    ? normalizeJdTemplate(payload.jdSynthesis)
    : buildFallbackJdTemplate({
        title: titleFromPayload,
        department: payload?.jobDepartment,
      });

  const now = new Date();

  if (existingJob?.id) {
    await db
      .update(jobs)
      .set({
        title: titleFromPayload,
        status: 'active',
        jdTemplate,
        updatedAt: now,
      })
      .where(eq(jobs.id, existingJob.id));

    return {
      persistedOrganizationId,
      persistedJobId: existingJob.id,
    };
  }

  const [insertedJob] = await db
    .insert(jobs)
    .values({
      organizationId: persistedOrganizationId,
      title: titleFromPayload,
      status: 'active',
      jdTemplate,
    })
    .returning({ id: jobs.id });

  return {
    persistedOrganizationId,
    persistedJobId: insertedJob?.id ?? null,
  };
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

  try {
    const onboardingPayload = await readOnboardingPayload(request);
    const statuses = await getOnboardingIntegrationStatuses(request.nextUrl.origin);

    if (!areAllRequiredIntegrationsConnected(statuses)) {
      return NextResponse.json(
        {
          message: 'Please connect Google and Slack before entering the dashboard. Cal.com can be added later.',
          allRequiredConnected: false,
          integrations: statuses,
        },
        { status: 409 },
      );
    }

    const workspaceContext = await getUserWorkspaceContext(session.user.sub);

    const { persistedOrganizationId, persistedJobId } = await persistOnboardingOrganizationAndJob(onboardingPayload, {
      workspaceOrganizationId: workspaceContext?.organizationId,
    });

    await upsertUserWorkspaceContext({
      userId: session.user.sub,
      organizationId: persistedOrganizationId ?? undefined,
      role: onboardingPayload?.role ?? undefined,
      avatarUrl: typeof session.user.picture === 'string' ? session.user.picture : undefined,
    });

    const [persistedJobContext] = persistedJobId
      ? await db
          .select({
            id: jobs.id,
            title: jobs.title,
            jdTemplate: jobs.jdTemplate,
          })
          .from(jobs)
          .where(eq(jobs.id, persistedJobId))
          .limit(1)
      : [];

    const [persistedOrganization] = persistedOrganizationId
      ? await db
          .select({
            name: organizations.name,
          })
          .from(organizations)
          .where(eq(organizations.id, persistedOrganizationId))
          .limit(1)
      : [];

    const initialOfferTemplate =
      persistedJobContext && persistedOrganizationId
        ? await upsertJobScopedOfferTemplate({
            organizationId: persistedOrganizationId,
            jobId: persistedJobContext.id,
            jobTitle: persistedJobContext.title,
            companyName: persistedOrganization?.name,
            jdTemplate: persistedJobContext.jdTemplate,
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

    const initialIntake = persistedJobId
      ? await enqueueInitialIntakeScan({
          jobId: persistedJobId,
          organizationId: persistedOrganizationId,
          actorUserId: session.user.sub,
          tokenVaultLoginHint,
          trigger: 'api.onboarding.complete',
        })
      : {
          enabled: false,
          inserted: false,
          runId: null,
          idempotencyKey: null,
          scheduledFor: null,
        };

    const initialIntakeKickoff = persistedJobId
      ? await kickoffV2IntakeFromSession({
          jobId: persistedJobId,
          organizationId: persistedOrganizationId,
          actorUserId: session.user.sub,
          tokenVaultLoginHint,
          trigger: 'api.onboarding.complete',
        })
      : {
          attempted: false,
          ok: false,
          status: null,
          functionName: 'v2-agent-intercept',
          message: 'No persisted job id available for kickoff.',
          data: null,
        };

    const response = NextResponse.json({
      success: true,
      allRequiredConnected: true,
      integrations: statuses,
      persistedOrganizationId,
      persistedJobId,
      initialOfferTemplate,
      initialIntake,
      initialIntakeKickoff,
    });

    response.cookies.set(ONBOARDING_COOKIE_NAME, serializeOnboardingCookieValue(session.user.sub), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: ONE_YEAR_SECONDS,
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      {
        message: 'Failed to complete onboarding.',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
