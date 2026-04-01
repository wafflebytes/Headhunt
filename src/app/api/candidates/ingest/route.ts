import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { auth0 } from '@/lib/auth0';
import { db } from '@/lib/db';
import { applications } from '@/lib/db/schema/applications';
import { auditLogs } from '@/lib/db/schema/audit-logs';
import { candidates } from '@/lib/db/schema/candidates';
import { jobs } from '@/lib/db/schema/jobs';

const ingestCandidateSchema = z.object({
  jobId: z.string().min(1),
  organizationId: z.string().min(1).optional(),
  candidateName: z.string().min(1),
  candidateEmail: z.string().email(),
  rawEmailText: z.string().min(1),
  source: z.object({
    gmailMessageId: z.string().min(1),
    gmailThreadId: z.string().min(1).optional(),
    receivedAt: z.string().datetime().optional(),
  }),
});

function compactSummary(rawEmailText: string): string {
  return rawEmailText.replace(/\s+/g, ' ').trim().slice(0, 280);
}

export async function POST(request: NextRequest) {
  const session = await auth0.getSession();

  if (!session?.user) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const payload = await request.json();
  const parsed = ingestCandidateSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      {
        message: 'Invalid ingest payload.',
        errors: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const { jobId, organizationId, candidateName, candidateEmail, rawEmailText, source } = parsed.data;
  const actorId = session.user.sub ?? 'unknown';
  const actorDisplayName = session.user.name ?? session.user.email ?? actorId;

  try {
    const result = await db.transaction(async (tx: typeof db) => {
      const sourceMessageId = source.gmailMessageId;
      const sourceThreadId = source.gmailThreadId ?? null;
      const sourceReceivedAt = source.receivedAt ? new Date(source.receivedAt) : null;

      // Ensure the referenced job exists for this early ingest flow.
      const existingJob = await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
      if (!existingJob[0]) {
        await tx.insert(jobs).values({
          id: jobId,
          organizationId: organizationId ?? null,
          title: `Imported job ${jobId}`,
          status: 'active',
        });
      }

      const existingCandidate = await tx
        .select()
        .from(candidates)
        .where(eq(candidates.sourceEmailMessageId, sourceMessageId))
        .limit(1);

      let candidateRow = existingCandidate[0];
      let idempotent = false;

      if (!candidateRow) {
        const insertedCandidates = await tx
          .insert(candidates)
          .values({
            organizationId: organizationId ?? null,
            jobId,
            name: candidateName,
            contactEmail: candidateEmail,
            summary: compactSummary(rawEmailText),
            sourceEmailMessageId: sourceMessageId,
            sourceEmailThreadId: sourceThreadId,
            sourceEmailReceivedAt: sourceReceivedAt,
          })
          .returning();

        candidateRow = insertedCandidates[0];
      } else {
        idempotent = true;
      }

      const existingApplication = await tx
        .select()
        .from(applications)
        .where(and(eq(applications.candidateId, candidateRow.id), eq(applications.jobId, jobId)))
        .limit(1);

      let applicationRow = existingApplication[0];

      if (!applicationRow) {
        const insertedApplications = await tx
          .insert(applications)
          .values({
            candidateId: candidateRow.id,
            jobId,
            stage: 'applied',
            status: 'active',
          })
          .returning();

        applicationRow = insertedApplications[0];
      } else {
        idempotent = true;
      }

      await tx.insert(auditLogs).values({
        organizationId: organizationId ?? candidateRow.organizationId ?? null,
        actorType: 'user',
        actorId,
        actorDisplayName,
        action: idempotent ? 'candidate.ingest.idempotent' : 'candidate.ingest.created',
        resourceType: 'candidate',
        resourceId: candidateRow.id,
        metadata: {
          jobId,
          candidateEmail,
          sourceMessageId,
          sourceThreadId,
        },
        result: 'success',
      });

      return {
        idempotent,
        candidate: candidateRow,
        application: applicationRow,
      };
    });

    return NextResponse.json({
      message: result.idempotent ? 'Candidate already ingested for this source message.' : 'Candidate ingested.',
      ...result,
    });
  } catch (error) {
    console.error('Candidate ingest failed', error);
    return NextResponse.json({ message: 'Failed to ingest candidate.' }, { status: 500 });
  }
}
