import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { applications } from '@/lib/db/schema/applications';
import { auditLogs } from '@/lib/db/schema/audit-logs';
import { candidateIdentityKeys } from '@/lib/db/schema/candidate-identity-keys';
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

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

type CandidateIdentityResolution =
  | 'source_message_match'
  | 'source_thread_match'
  | 'email_job_match'
  | 'created_new';

type CandidateIdentityKeyType =
  | 'gmail_message_id'
  | 'gmail_thread_id'
  | 'email_job';

export async function ingestCandidateFromEmail(input: IngestCandidateFromEmailInput) {
  const normalizedCandidateEmail = normalizeEmail(input.candidateEmail);
  if (!normalizedCandidateEmail) {
    throw new Error('candidateEmail is required for ingest.');
  }

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

  const result = await db.transaction(async (tx) => {
    const sourceMessageId = input.source.gmailMessageId;
    const sourceThreadId = input.source.gmailThreadId ?? null;
    const sourceReceivedAt = input.source.receivedAt ? new Date(input.source.receivedAt) : null;
    let identityResolution: CandidateIdentityResolution = 'created_new';

    const existingJob = await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, input.jobId)).limit(1);
    if (!existingJob[0]) {
      await tx.insert(jobs).values({
        id: input.jobId,
        organizationId: input.organizationId ?? null,
        title: `Imported job ${input.jobId}`,
        status: 'active',
      });
    }

    const existingCandidateBySourceMessage = await tx
      .select()
      .from(candidates)
      .where(eq(candidates.sourceEmailMessageId, sourceMessageId))
      .limit(1);

    const existingCandidateBySourceThread = sourceThreadId
      ? await tx
          .select()
          .from(candidates)
          .where(and(eq(candidates.jobId, input.jobId), eq(candidates.sourceEmailThreadId, sourceThreadId)))
          .orderBy(desc(candidates.updatedAt))
          .limit(1)
      : [];

    const existingCandidateByEmailAndJob = await tx
      .select()
      .from(candidates)
      .where(
        and(
          eq(candidates.jobId, input.jobId),
          sql`lower(${candidates.contactEmail}) = ${normalizedCandidateEmail}`,
        ),
      )
      .orderBy(desc(candidates.updatedAt))
      .limit(1);

    let candidateRow = existingCandidateBySourceMessage[0] ?? null;
    if (candidateRow) {
      identityResolution = 'source_message_match';
    }

    if (!candidateRow && existingCandidateBySourceThread[0]) {
      candidateRow = existingCandidateBySourceThread[0];
      identityResolution = 'source_thread_match';
    }

    if (!candidateRow && existingCandidateByEmailAndJob[0]) {
      candidateRow = existingCandidateByEmailAndJob[0];
      identityResolution = 'email_job_match';
    }

    let idempotent = Boolean(candidateRow);

    if (!candidateRow) {
      const insertedCandidates = await tx
        .insert(candidates)
        .values({
          organizationId: input.organizationId ?? null,
          jobId: input.jobId,
          name: input.candidateName,
          contactEmail: normalizedCandidateEmail,
          summary: compactSummary(input.rawEmailText),
          sourceEmailMessageId: sourceMessageId,
          sourceEmailThreadId: sourceThreadId,
          sourceEmailReceivedAt: sourceReceivedAt,
        })
        .returning();

      candidateRow = insertedCandidates[0];
      identityResolution = 'created_new';
    } else {
      idempotent = true;

      const patch: Partial<typeof candidates.$inferInsert> = {};

      if (candidateRow.contactEmail !== normalizedCandidateEmail) {
        patch.contactEmail = normalizedCandidateEmail;
      }

      if (!candidateRow.sourceEmailThreadId && sourceThreadId) {
        patch.sourceEmailThreadId = sourceThreadId;
      }

      if (
        sourceReceivedAt &&
        (!candidateRow.sourceEmailReceivedAt || sourceReceivedAt.getTime() > candidateRow.sourceEmailReceivedAt.getTime())
      ) {
        patch.sourceEmailReceivedAt = sourceReceivedAt;
      }

      if (Object.keys(patch).length > 0) {
        patch.updatedAt = new Date();

        const [updatedCandidate] = await tx
          .update(candidates)
          .set(patch)
          .where(eq(candidates.id, candidateRow.id))
          .returning();

        if (updatedCandidate) {
          candidateRow = updatedCandidate;
        }
      }
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

    const now = new Date();
    const identityKeyInputs: Array<{
      keyType: CandidateIdentityKeyType;
      keyValue: string;
      seenAt: Date;
    }> = [
      {
        keyType: 'gmail_message_id',
        keyValue: sourceMessageId,
        seenAt: sourceReceivedAt ?? now,
      },
      {
        keyType: 'email_job',
        keyValue: normalizedCandidateEmail,
        seenAt: sourceReceivedAt ?? now,
      },
    ];

    if (sourceThreadId) {
      identityKeyInputs.push({
        keyType: 'gmail_thread_id',
        keyValue: sourceThreadId,
        seenAt: sourceReceivedAt ?? now,
      });
    }

    try {
      for (const identityKey of identityKeyInputs) {
        await tx
          .insert(candidateIdentityKeys)
          .values({
            organizationId: input.organizationId ?? candidateRow.organizationId ?? null,
            jobId: input.jobId,
            candidateId: candidateRow.id,
            keyType: identityKey.keyType,
            keyValue: identityKey.keyValue,
            metadata: {
              source: 'ingest_candidate_from_email',
              sourceMessageId,
              sourceThreadId,
              identityResolution,
            },
            firstSeenAt: identityKey.seenAt,
            lastSeenAt: identityKey.seenAt,
          })
          .onConflictDoUpdate({
            target: [
              candidateIdentityKeys.keyType,
              candidateIdentityKeys.keyValue,
              candidateIdentityKeys.jobId,
            ],
            set: {
              candidateId: candidateRow.id,
              organizationId: input.organizationId ?? candidateRow.organizationId ?? null,
              lastSeenAt: identityKey.seenAt,
              metadata: {
                source: 'ingest_candidate_from_email',
                sourceMessageId,
                sourceThreadId,
                identityResolution,
              },
              updatedAt: now,
            },
          });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/relation\s+"candidate_identity_keys"\s+does\s+not\s+exist/i.test(message)) {
        console.warn('candidate_identity_keys table missing; skipping identity-key upserts for ingest.', {
          jobId: input.jobId,
          candidateId: candidateRow.id,
          sourceMessageId,
        });
      } else {
        throw error;
      }
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
        candidateEmail: normalizedCandidateEmail,
        sourceMessageId,
        sourceThreadId,
        identityResolution,
        identityKeys: identityKeyInputs.map((identityKey) => ({
          type: identityKey.keyType,
          value: identityKey.keyValue,
        })),
      },
      result: 'success',
    });

    return {
      idempotent,
      identityResolution,
      candidate: candidateRow,
      application: applicationRow,
    };
  });

  if (result.identityResolution === 'created_new') {
    try {
      await addCandidateRelation(input.actorId, result.candidate.id, 'owner');
    } catch (error) {
      console.error('FGA tuple write failed; candidate ingest committed without visibility tuple.', {
        actorId: input.actorId,
        candidateId: result.candidate.id,
        error,
      });
    }
  }

  return result;
}
