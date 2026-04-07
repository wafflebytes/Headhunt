import { desc, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { proxyToSupabaseAutomationFunction } from '@/lib/automation/supabase-dispatch';
import { db } from '@/lib/db';
import { jobs } from '@/lib/db/schema/jobs';
import { userWorkspaces } from '@/lib/db/schema/user-workspaces';

export const runtime = 'nodejs';

function isAuthorized(request: NextRequest): boolean {
  const configuredSecret = process.env.CRON_SECRET?.trim() || process.env.AUTOMATION_CRON_SECRET?.trim();
  if (!configuredSecret) {
    return false;
  }

  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const headerSecret = request.headers.get('x-cron-secret')?.trim();
  const automationHeader = request.headers.get('x-automation-secret')?.trim();

  return bearer === configuredSecret || headerSecret === configuredSecret || automationHeader === configuredSecret;
}

function buildQuarterHourBucket(date = new Date()): string {
  const next = new Date(date);
  const roundedMinutes = Math.floor(next.getUTCMinutes() / 15) * 15;
  next.setUTCMinutes(roundedMinutes, 0, 0);
  return next.toISOString().slice(0, 16);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

async function resolveFallbackIntakeContext(): Promise<{
  jobId: string | null;
  organizationId: string | null;
  actorUserId: string | null;
  tokenVaultLoginHint: string | null;
}> {
  const configuredJobId = asNonEmptyString(process.env.AUTOMATION_INTAKE_JOB_ID);
  const configuredOrgId = asNonEmptyString(process.env.AUTOMATION_INTAKE_ORGANIZATION_ID);
  let actorUserId =
    asNonEmptyString(process.env.HEADHUNT_FOUNDER_USER_ID) ??
    asNonEmptyString(process.env.AUTH0_FOUNDER_USER_ID) ??
    null;
  let tokenVaultLoginHint =
    asNonEmptyString(process.env.AUTH0_TOKEN_VAULT_LOGIN_HINT) ??
    actorUserId ??
    null;

  const resolveWorkspaceActor = async (organizationId: string | null) => {
    if (actorUserId || !organizationId) {
      return;
    }

    const [workspace] = await db
      .select({ userId: userWorkspaces.userId })
      .from(userWorkspaces)
      .where(eq(userWorkspaces.organizationId, organizationId))
      .orderBy(desc(userWorkspaces.updatedAt))
      .limit(1);

    if (!workspace?.userId) {
      return;
    }

    actorUserId = workspace.userId;
    if (!tokenVaultLoginHint) {
      tokenVaultLoginHint = workspace.userId;
    }
  };

  if (configuredJobId) {
    await resolveWorkspaceActor(configuredOrgId).catch(() => null);

    return {
      jobId: configuredJobId,
      organizationId: configuredOrgId,
      actorUserId,
      tokenVaultLoginHint,
    };
  }

  const [latestActive] = await db
    .select({
      id: jobs.id,
      organizationId: jobs.organizationId,
    })
    .from(jobs)
    .where(eq(jobs.status, 'active'))
    .orderBy(desc(jobs.createdAt))
    .limit(1);

  const resolvedOrganizationId = (latestActive?.organizationId as string | null | undefined) ?? configuredOrgId ?? null;
  await resolveWorkspaceActor(resolvedOrganizationId).catch(() => null);

  return {
    jobId: latestActive?.id ?? null,
    organizationId: resolvedOrganizationId,
    actorUserId,
    tokenVaultLoginHint,
  };
}

async function handleCron(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const fallbackContext = await resolveFallbackIntakeContext().catch(() => ({
    jobId: null,
    organizationId: null,
    actorUserId: null,
    tokenVaultLoginHint: null,
  }));

  return proxyToSupabaseAutomationFunction({
    request,
    functionName: 'v2-orchestrator-cron',
    fallbackBody: {
      job: 'all',
      limit: 8,
      autoIntakeEnabled: true,
      intakeBucket: buildQuarterHourBucket(),
      organizationId: fallbackContext.organizationId,
      jobId: fallbackContext.jobId,
      actorUserId: fallbackContext.actorUserId,
      tokenVaultLoginHint: fallbackContext.tokenVaultLoginHint,
      architecture: 'v2',
      trigger: 'vercel-cron-intake-polling',
    },
  });
}

export async function GET(request: NextRequest) {
  return handleCron(request);
}

export async function POST(request: NextRequest) {
  return handleCron(request);
}
