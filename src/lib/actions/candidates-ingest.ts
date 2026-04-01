import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { applications } from '@/lib/db/schema/applications';
import { auditLogs } from '@/lib/db/schema/audit-logs';
import { candidates } from '@/lib/db/schema/candidates';
import { jobs } from '@/lib/db/schema/jobs';
import { addCandidateRelation, canViewCandidate } from '@/lib/fga/fga';

export class CandidateIngestAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CandidateIngestAccessError';
  }
}

export type IngestCandidateFromEmailInput = {
  jobId: string;
  organizationId?: string;
  candidateName: string;
  candidateEmail: string;
  rawEmailText: string;
  source: {
    gmailMessageId: string;
    gmailThreadId?: string;
    receivedAt?: string;
  };
  actorId: string;
  actorDisplayName: string;
  enforceVisibility?: boolean;
};

function compactSummary(rawEmailText: string): string {
  return rawEmailText.replace(/\s+/g, ' ').trim().slice(0, 280);
}

export async function ingestCandidateFromEmail(input: IngestCandidateFromEmailInput) {
  const existingCandidateBySource = await db
    .select({ id: candidates.id })
    .from(candidates)
    .where(eq(candidates.sourceEmailMessageId, input.source.gmailMessageId))
    .limit(1);

  if (input.enforceVisibility !== false && existingCandidateBySource[0]) {
    const hasAccess = await canViewCandidate(input.actorId, existingCandidateBySource[0].id);
    if (!hasAccess) {
      throw new CandidateIngestAccessError('Forbidden: candidate is not visible to this user.');
    }
  }

  return db.transaction(async (tx: typeof db) => {
    const sourceMessageId = input.source.gmailMessageId;
    const sourceThreadId = input.source.gmailThreadId ?? null;
    const sourceReceivedAt = input.source.receivedAt ? new Date(input.source.receivedAt) : null;

    const existingJob = await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, input.jobId)).limit(1);
    if (!existingJob[0]) {
      await tx.insert(jobs).values({
        id: input.jobId,
        organizationId: input.organizationId ?? null,
        title: `Imported job ${input.jobId}`,
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
          organizationId: input.organizationId ?? null,
          jobId: input.jobId,
          name: input.candidateName,
          contactEmail: input.candidateEmail,
          summary: compactSummary(input.rawEmailText),
          sourceEmailMessageId: sourceMessageId,
          sourceEmailThreadId: sourceThreadId,
          sourceEmailReceivedAt: sourceReceivedAt,
        })
        .returning();

      candidateRow = insertedCandidates[0];
      await addCandidateRelation(input.actorId, candidateRow.id, 'owner');
    } else {
      idempotent = true;
    }

    const existingApplication = await tx
      .select()
      .from(applications)
      .where(and(eq(applications.candidateId, candidateRow.id), eq(applications.jobId, input.jobId)))
      .limit(1);

    let applicationRow = existingApplication[0];

    if (!applicationRow) {
      const insertedApplications = await tx
        .insert(applications)
        .values({
          candidateId: candidateRow.id,
          jobId: input.jobId,
          stage: 'applied',
          status: 'active',
        })
        .returning();

      applicationRow = insertedApplications[0];
    } else {
      idempotent = true;
    }

    await tx.insert(auditLogs).values({
      organizationId: input.organizationId ?? candidateRow.organizationId ?? null,
      actorType: 'user',
      actorId: input.actorId,
      actorDisplayName: input.actorDisplayName,
      action: idempotent ? 'candidate.ingest.idempotent' : 'candidate.ingest.created',
      resourceType: 'candidate',
      resourceId: candidateRow.id,
      metadata: {
        jobId: input.jobId,
        candidateEmail: input.candidateEmail,
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
}
