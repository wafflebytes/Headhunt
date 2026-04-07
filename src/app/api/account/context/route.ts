import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { auth0 } from '@/lib/auth0';
import { db } from '@/lib/db';
import { jobs } from '@/lib/db/schema/jobs';
import {
  getUserWorkspaceContext,
  upsertUserWorkspaceContext,
} from '@/lib/user-workspace';

export const runtime = 'nodejs';

function cacheHeaders() {
  return {
    'Cache-Control': 'private, max-age=10, stale-while-revalidate=30',
  };
}

export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.sub;

  const sessionAvatar = typeof session.user.picture === 'string' ? session.user.picture : undefined;

  const existingWorkspace = await getUserWorkspaceContext(userId);

  await upsertUserWorkspaceContext({
    userId,
    organizationId: existingWorkspace?.organizationId ?? undefined,
    avatarUrl: sessionAvatar,
  });

  const workspace = existingWorkspace ?? (await getUserWorkspaceContext(userId));

  const workspaceJobs = workspace?.organizationId
    ? await db
        .select({
          id: jobs.id,
          title: jobs.title,
          status: jobs.status,
          organizationId: jobs.organizationId,
          updatedAt: jobs.updatedAt,
        })
        .from(jobs)
        .where(eq(jobs.organizationId, workspace.organizationId))
        .orderBy(desc(jobs.updatedAt))
        .limit(40)
    : [];

  return NextResponse.json({
    status: 'success',
    user: {
      sub: userId,
      name: session.user.name ?? null,
      email: session.user.email ?? null,
      picture: session.user.picture ?? null,
    },
    workspace: {
      organizationId: workspace?.organizationId ?? null,
      organizationName: workspace?.organizationName ?? null,
      role: workspace?.role ?? null,
      avatarUrl: workspace?.avatarUrl ?? null,
    },
    jobs: workspaceJobs,
  }, { headers: cacheHeaders() });
}
