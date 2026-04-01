import { tool } from 'ai';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { CandidateIngestAccessError, ingestCandidateFromEmail } from '@/lib/actions/candidates-ingest';
import { withGmailRead } from '@/lib/auth0-ai';
import { auth0 } from '@/lib/auth0';
import { db } from '@/lib/db';
import { auditLogs } from '@/lib/db/schema/audit-logs';
import { jobs } from '@/lib/db/schema/jobs';
import { fetchInterceptMessages } from '@/lib/tools/intercept';
import { generateIntelCard, runTriage } from '@/lib/tools/triage-intel';

const runIntakeE2EInputSchema = z.object({
  organizationId: z.string().optional(),
  jobId: z.string().optional(),
  query: z.string().default('in:inbox newer_than:7d'),
  maxResults: z.number().int().min(1).max(25).default(8),
  processLimit: z.number().int().min(1).max(10).default(3),
  candidateLikeOnly: z.boolean().default(true),
  includeBody: z.boolean().default(true),
  generateIntel: z.boolean().default(true),
  requirements: z.array(z.string().min(1)).optional(),
});

function normalizeEmail(value: string | null): string | null {
  if (!value) return null;
  return value.trim().toLowerCase();
}

function titleCaseFromEmail(email: string) {
  const local = email.split('@')[0] ?? 'candidate';
  return local
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function parseSender(from: string | null) {
  const fallback = {
    name: 'Unknown Candidate',
    email: null as string | null,
  };

  if (!from) return fallback;

  const bracketMatch = from.match(/^(.*)<([^>]+)>\s*$/);
  if (bracketMatch) {
    const email = normalizeEmail(bracketMatch[2]);
    const name = bracketMatch[1].replace(/"/g, '').trim() || (email ? titleCaseFromEmail(email) : fallback.name);
    return { name, email };
  }

  const firstEmail = from.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  if (firstEmail) {
    const email = normalizeEmail(firstEmail);
    return {
      name: titleCaseFromEmail(email ?? firstEmail),
      email,
    };
  }

  return fallback;
}

function compact(value: string, limit = 6000): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, limit);
}

function buildEmailText(message: { subject: string | null; body: string; snippet: string }) {
  return compact([`Subject: ${message.subject ?? '(no subject)'}`, '', message.body || message.snippet].join('\n'));
}

async function loadActiveJobs(organizationId?: string) {
  const rows: Array<{ id: string; title: string; organizationId: string | null }> = await db
    .select({ id: jobs.id, title: jobs.title, organizationId: jobs.organizationId })
    .from(jobs)
    .where(eq(jobs.status, 'active'))
    .limit(50);

  return organizationId ? rows.filter((job: { organizationId: string | null }) => job.organizationId === organizationId) : rows;
}

export const runIntakeE2ETool = withGmailRead(
  tool({
    description:
      'Run a true end-to-end intake pass from Gmail intercept to DB ingest and optional intel generation for candidate-like messages.',
    inputSchema: runIntakeE2EInputSchema,
    execute: async (input) => {
      const session = await auth0.getSession();
      const actorId = session?.user?.sub ?? null;

      if (!actorId) {
        return {
          check: 'run_intake_e2e',
          status: 'error',
          message: 'Unauthorized: missing actor identity for intake run.',
        };
      }

      const actorDisplayName = session?.user?.name ?? session?.user?.email ?? actorId;
      const activeJobs = await loadActiveJobs(input.organizationId);
      const fallbackJobId = input.jobId ?? activeJobs[0]?.id ?? null;

      const intercepted = await fetchInterceptMessages({
        query: input.query,
        maxResults: input.maxResults,
        candidateLikeOnly: input.candidateLikeOnly,
        includeBody: input.includeBody,
      });

      const messages = intercepted.slice(0, input.processLimit);

      const messageResults: Array<Record<string, unknown>> = [];
      let ingestedCreated = 0;
      let ingestedIdempotent = 0;
      let intelGenerated = 0;

      for (const message of messages) {
        const rawEmailText = buildEmailText(message);
        const sender = parseSender(message.from);

        if (!sender.email) {
          messageResults.push({
            messageId: message.messageId,
            subject: message.subject,
            status: 'skipped',
            reason: 'No parseable sender email in From header.',
          });
          continue;
        }

        try {
          const triage = await runTriage({
            organizationId: input.organizationId,
            from: message.from ?? undefined,
            subject: message.subject ?? '',
            body: rawEmailText,
            sourceMessageId: message.messageId,
            sourceThreadId: message.threadId ?? undefined,
            jobs: activeJobs.map((job: { id: string; title: string }) => ({ id: job.id, title: job.title })),
          });

          if (triage.classification !== 'application') {
            messageResults.push({
              messageId: message.messageId,
              threadId: message.threadId,
              from: message.from,
              subject: message.subject,
              status: 'skipped',
              reason: `Triage routed as ${triage.classification}; non-application messages are not ingested.`,
              triage,
            });
            continue;
          }

          const triageJobId = triage.jobId ?? null;
          const resolvedJobId = input.jobId ?? triageJobId ?? fallbackJobId;

          if (!resolvedJobId) {
            messageResults.push({
              messageId: message.messageId,
              subject: message.subject,
              from: message.from,
              triage,
              status: 'skipped',
              reason: 'No active or resolved job id available for ingest.',
            });
            continue;
          }

          const ingest = await ingestCandidateFromEmail({
            jobId: resolvedJobId,
            organizationId: input.organizationId,
            candidateName: sender.name,
            candidateEmail: sender.email,
            rawEmailText,
            source: {
              gmailMessageId: message.messageId,
              gmailThreadId: message.threadId ?? undefined,
              receivedAt: message.receivedAt ?? undefined,
            },
            actorId,
            actorDisplayName,
            enforceVisibility: true,
          });

          if (ingest.idempotent) {
            ingestedIdempotent += 1;
          } else {
            ingestedCreated += 1;
          }

          let intel: Record<string, unknown> | null = null;
          if (input.generateIntel && triage.classification === 'application') {
            const intelResult = await generateIntelCard({
              candidateId: ingest.candidate.id,
              jobId: resolvedJobId,
              actorUserId: actorId,
              organizationId: input.organizationId,
              emailText: rawEmailText,
              requirements: input.requirements,
            });

            intel = intelResult;
            if (intelResult.status === 'success') {
              intelGenerated += 1;
            }
          }

          messageResults.push({
            messageId: message.messageId,
            threadId: message.threadId,
            from: message.from,
            subject: message.subject,
            candidateEmail: sender.email,
            candidateId: ingest.candidate.id,
            jobId: resolvedJobId,
            ingestStatus: ingest.idempotent ? 'idempotent' : 'created',
            triage,
            intel,
            status: 'processed',
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown intake error.';
          const errorCode = error instanceof CandidateIngestAccessError ? 'INGEST_FORBIDDEN' : 'INTAKE_FAILED';

          messageResults.push({
            messageId: message.messageId,
            subject: message.subject,
            from: message.from,
            status: 'error',
            error: {
              code: errorCode,
              message: errorMessage,
            },
          });
        }
      }

      await db.insert(auditLogs).values({
        organizationId: input.organizationId ?? null,
        actorType: 'agent',
        actorId: 'run_intake_e2e',
        actorDisplayName: 'Intake E2E Runner',
        action: 'intake.e2e.executed',
        resourceType: 'gmail_inbox',
        resourceId: actorId,
        metadata: {
          query: input.query,
          maxResults: input.maxResults,
          processLimit: input.processLimit,
          candidateLikeOnly: input.candidateLikeOnly,
          generateIntel: input.generateIntel,
          interceptedCount: intercepted.length,
          processedCount: messages.length,
          ingestedCreated,
          ingestedIdempotent,
          intelGenerated,
        },
        result: 'success',
      });

      return {
        check: 'run_intake_e2e',
        status: 'success',
        query: input.query,
        actorUserId: actorId,
        activeJobsCount: activeJobs.length,
        interceptedCount: intercepted.length,
        processedCount: messages.length,
        ingestedCreated,
        ingestedIdempotent,
        intelGenerated,
        messages: messageResults,
      };
    },
  }),
);
