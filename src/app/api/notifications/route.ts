import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { auth0 } from '@/lib/auth0';
import { db } from '@/lib/db';
import { auditLogs } from '@/lib/db/schema/audit-logs';
import { candidates } from '@/lib/db/schema/candidates';
import { jobs } from '@/lib/db/schema/jobs';

export const runtime = 'nodejs';

type NotificationItem = {
  id: string;
  createdAt: string;
  title: string;
  subtitle: string | null;
  candidateId: string;
  jobId: string | null;
};

const NOTIFICATION_ACTIONS = ['candidate.ingest.created', 'interview.scheduled'] as const;

function formatLocalSlotLabel(timestamp: Date): string {
  if (Number.isNaN(timestamp.getTime())) return '';

  return timestamp.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function extractJobId(metadata: Record<string, unknown>): string | null {
  return typeof metadata.jobId === 'string' ? metadata.jobId : null;
}

function extractScheduledAt(metadata: Record<string, unknown>): Date | null {
  const scheduledAt = typeof metadata.scheduledAt === 'string' ? metadata.scheduledAt : null;
  const selectedStartISO = typeof metadata.selectedStartISO === 'string' ? metadata.selectedStartISO : null;
  const candidateISO = scheduledAt ?? selectedStartISO;
  if (!candidateISO) return null;

  const parsed = new Date(candidateISO);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function GET(request: Request) {
  const session = await auth0.getSession().catch(() => null);
  const userId = session?.user?.sub ?? null;

  if (!userId) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const notificationFilter = and(
    eq(auditLogs.resourceType, 'candidate'),
    inArray(auditLogs.action, [...NOTIFICATION_ACTIONS]),
    or(eq(auditLogs.actorId, userId), sql`${auditLogs.metadata} ->> 'actorUserId' = ${userId}`),
  );

  try {
    const [latest] = await db
      .select({ id: auditLogs.id, timestamp: auditLogs.timestamp })
      .from(auditLogs)
      .where(notificationFilter)
      .orderBy(desc(auditLogs.timestamp))
      .limit(1);

    const etag = latest
      ? `W/"notifications:${latest.id}:${latest.timestamp.getTime()}"`
      : 'W/"notifications:empty"';

    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: etag,
          'Cache-Control': 'private, max-age=0, must-revalidate',
        },
      });
    }

    const rows: Array<{
      id: string;
      timestamp: Date;
      resourceId: string;
      action: string;
      metadata: Record<string, unknown>;
    }> = await db
      .select({
        id: auditLogs.id,
        timestamp: auditLogs.timestamp,
        resourceId: auditLogs.resourceId,
        action: auditLogs.action,
        metadata: auditLogs.metadata,
      })
      .from(auditLogs)
      .where(notificationFilter)
      .orderBy(desc(auditLogs.timestamp))
      .limit(25);

    const candidateIds = Array.from(new Set(rows.map((row) => row.resourceId).filter(Boolean)));
    const jobIds = Array.from(
      new Set(
        rows
          .map((row) => (typeof row.metadata.jobId === 'string' ? row.metadata.jobId : null))
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const candidateRows: Array<{ id: string; name: string; jobId: string }> = candidateIds.length
      ? await db
          .select({ id: candidates.id, name: candidates.name, jobId: candidates.jobId })
          .from(candidates)
          .where(inArray(candidates.id, candidateIds))
      : [];

    const jobRows: Array<{ id: string; title: string }> = jobIds.length
      ? await db
          .select({ id: jobs.id, title: jobs.title })
          .from(jobs)
          .where(inArray(jobs.id, jobIds))
      : [];

    const candidateById = new Map<string, (typeof candidateRows)[number]>(candidateRows.map((row) => [row.id, row]));
    const jobById = new Map<string, (typeof jobRows)[number]>(jobRows.map((row) => [row.id, row]));

    const notifications: NotificationItem[] = rows.map((row) => {
      const candidate = candidateById.get(row.resourceId);
      const jobId = extractJobId(row.metadata) ?? candidate?.jobId ?? null;
      const job = jobId ? jobById.get(jobId) : null;

      const candidateName = candidate?.name ?? 'Candidate applicant';
      const scheduledAt = extractScheduledAt(row.metadata);
      const slotLabel = scheduledAt ? formatLocalSlotLabel(scheduledAt) : null;

      if (row.action === 'interview.scheduled') {
        const subtitleParts = [job?.title ?? null, slotLabel].filter(Boolean);

        return {
          id: row.id,
          createdAt: row.timestamp.toISOString(),
          title: `Interview fixed with ${candidateName}`,
          subtitle: subtitleParts.length ? subtitleParts.join(' • ') : null,
          candidateId: row.resourceId,
          jobId,
        };
      }

      return {
        id: row.id,
        createdAt: row.timestamp.toISOString(),
        title: `${candidateName} applied`,
        subtitle: job?.title ?? null,
        candidateId: row.resourceId,
        jobId,
      };
    });

    return NextResponse.json(
      {
        check: 'notifications',
        status: 'success',
        serverNow: new Date().toISOString(),
        notifications,
      },
      {
        headers: {
          ETag: etag,
          'Cache-Control': 'private, max-age=0, must-revalidate',
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        check: 'notifications',
        status: 'success',
        serverNow: new Date().toISOString(),
        notifications: [],
        warning: message,
      },
      {
        headers: {
          ETag: 'W/"notifications:disabled"',
          'Cache-Control': 'private, max-age=0, must-revalidate',
        },
      },
    );
  }
}
