import { tool } from 'ai';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { gmail_v1, google } from 'googleapis';
import pdf from 'pdf-parse';
import { z } from 'zod';

import { CandidateIngestAccessError, ingestCandidateFromEmail } from '@/lib/actions/candidates-ingest';
import { buildIdempotencyKey, enqueueAutomationRun } from '@/lib/automation/queue';
import { getGoogleAccessToken, withGmailRead } from '@/lib/auth0-ai';
import { auth0 } from '@/lib/auth0';
import { db } from '@/lib/db';
import { auditLogs } from '@/lib/db/schema/audit-logs';
import { candidateIdentityKeys } from '@/lib/db/schema/candidate-identity-keys';
import { candidates } from '@/lib/db/schema/candidates';
import { jobs } from '@/lib/db/schema/jobs';
import { organizations } from '@/lib/db/schema/organizations';
import { fetchInterceptMessages } from '@/lib/tools/intercept';
import { generateIntelCard, runTriage } from '@/lib/tools/triage-intel';

const runIntakeE2EInputSchema = z.object({
  organizationId: z.string().optional(),
  jobId: z.string().optional(),
  actorUserId: z.string().optional(),
  actorDisplayName: z.string().optional(),
  tokenVaultLoginHint: z.string().optional(),
  automationMode: z.boolean().optional(),
  query: z
    .string()
    .default(
      'in:inbox newer_than:14d -category:promotions -category:social -subject:newsletter -subject:digest -subject:unsubscribe',
    ),
  maxResults: z.number().int().min(1).max(25).default(20),
  processLimit: z.number().int().min(1).max(10).default(8),
  candidateLikeOnly: z.boolean().default(true),
  includeBody: z.boolean().default(true),
  generateIntel: z.boolean().default(true),
  requirements: z.array(z.string().min(1)).optional(),
});

type RunIntakeE2EInput = z.infer<typeof runIntakeE2EInputSchema>;

const MIN_TRIAGE_CONFIDENCE_FOR_AUTOMATION = 0.62;
const MIN_IDENTITY_CONFIDENCE_FOR_AUTO_INGEST = 0.45;
const MAX_RESUME_PDF_BYTES = 10 * 1024 * 1024;

function normalizeEmail(value: string | null): string | null {
  if (!value) return null;
  return value.trim().toLowerCase();
}

function parseSenderEmail(from: string | null): string | null {
  if (!from) return null;
  const firstEmail = from.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  return normalizeEmail(firstEmail);
}

const NAME_STOP_WORDS = new Set([
  'application',
  'applying',
  'apply',
  'resume',
  'cv',
  'cover',
  'letter',
  'founding',
  'engineer',
  'designer',
  'role',
  'position',
  'intern',
  'job',
  'interview',
  'availability',
  'schedule',
  'thread',
]);

function toTitleCaseName(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function normalizePossibleName(value: string | null): string | null {
  if (!value) return null;

  const cleaned = value
    .replace(/[|,:;()\[\]{}<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || cleaned.includes('@')) return null;

  const words = cleaned.split(' ').filter(Boolean);
  if (words.length < 2 || words.length > 4) return null;

  for (const word of words) {
    if (!/^[A-Za-z][A-Za-z'\-]{0,39}$/.test(word)) {
      return null;
    }

    if (NAME_STOP_WORDS.has(word.toLowerCase())) {
      return null;
    }
  }

  return toTitleCaseName(words.join(' '));
}

function extractNameFromSubject(subject: string | null): string | null {
  if (!subject) return null;

  const normalized = subject.replace(/\s+/g, ' ').trim();

  const explicitPatterns = [
    /\bapplication\b\s*[-:|]\s*[^-:|]{2,120}\s*[-:|]\s*([^-:|]{2,120})$/i,
    /^([^-:|]{2,120})\s*[-:|]\s*(?:application|applying|resume|cv)\b/i,
    /\b(?:application|applying)\s+(?:for|to)\b[^-:|]{0,120}\s*[-:|]\s*([^-:|]{2,120})$/i,
  ] as const;

  for (const pattern of explicitPatterns) {
    const match = normalized.match(pattern);
    const candidateName = normalizePossibleName(match?.[1] ?? null);
    if (candidateName) {
      return candidateName;
    }
  }

  const segments = normalized.split(/[-|:]/).map((segment) => segment.trim());
  for (const segment of segments) {
    const candidateName = normalizePossibleName(segment);
    if (candidateName) {
      return candidateName;
    }
  }

  return null;
}

function extractNameFromBody(body: string): string | null {
  const normalized = body.replace(/\r\n/g, '\n');

  const bodyPatterns = [
    /^\s*name\s*:\s*([^\n]{2,100})$/im,
    /\bmy\s+name\s+is\s+([A-Za-z][A-Za-z'\- ]{1,80})\b/i,
    /\bi\s+am\s+([A-Za-z][A-Za-z'\- ]{1,80})\b/i,
    /\bi'm\s+([A-Za-z][A-Za-z'\- ]{1,80})\b/i,
  ] as const;

  for (const pattern of bodyPatterns) {
    const match = normalized.match(pattern);
    const candidateName = normalizePossibleName(match?.[1] ?? null);
    if (candidateName) {
      return candidateName;
    }
  }

  const signoffPattern = /^(thanks|thank you|regards|best|sincerely|cheers)[!,.]?$/i;
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 1; index -= 1) {
    const line = lines[index];
    const previousLine = lines[index - 1];

    if (!signoffPattern.test(previousLine)) {
      continue;
    }

    const candidateName = normalizePossibleName(line);
    if (candidateName) {
      return candidateName;
    }
  }

  return null;
}

function extractCandidateIdentity(params: {
  from: string | null;
  subject: string | null;
  body: string;
  snippet: string;
}) {
  const nameFromSubject = extractNameFromSubject(params.subject);
  if (nameFromSubject) {
    return {
      name: nameFromSubject,
      nameSource: 'subject' as const,
      email: parseSenderEmail(params.from),
    };
  }

  const nameFromBody = extractNameFromBody(params.body || params.snippet);
  if (nameFromBody) {
    return {
      name: nameFromBody,
      nameSource: 'body' as const,
      email: parseSenderEmail(params.from),
    };
  }

  return {
    name: 'Candidate Applicant',
    nameSource: 'fallback' as const,
    email: parseSenderEmail(params.from),
  };
}

function getCandidateIdentityConfidence(nameSource: 'subject' | 'body' | 'fallback'): number {
  if (nameSource === 'subject') {
    return 0.9;
  }

  if (nameSource === 'body') {
    return 0.75;
  }

  return 0.4;
}

function compact(value: string, limit = 6000): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, limit);
}

function decodeBase64UrlToBuffer(value: string | null | undefined): Buffer {
  if (!value) return Buffer.from('');

  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function collectPdfAttachmentParts(part: gmail_v1.Schema$MessagePart | undefined, output: Array<{
  attachmentId: string;
  fileName: string;
  mimeType: string;
  size: number | null;
}>) {
  if (!part) return;

  const fileName = typeof part.filename === 'string' ? part.filename.trim() : '';
  const mimeType = typeof part.mimeType === 'string' ? part.mimeType : '';
  const isPdf = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
  const attachmentId = typeof part.body?.attachmentId === 'string' ? part.body.attachmentId : null;

  if (isPdf && attachmentId) {
    output.push({
      attachmentId,
      fileName: fileName || 'attachment.pdf',
      mimeType: mimeType || 'application/pdf',
      size: typeof part.body?.size === 'number' ? part.body.size : null,
    });
  }

  for (const child of part.parts ?? []) {
    collectPdfAttachmentParts(child, output);
  }
}

function prioritizeResumeAttachments(parts: Array<{ attachmentId: string; fileName: string; mimeType: string; size: number | null }>) {
  const resumeNamePattern = /(resume|cv)([^a-z0-9]|$)/i;

  return [...parts].sort((left, right) => {
    const leftPreferred = resumeNamePattern.test(left.fileName);
    const rightPreferred = resumeNamePattern.test(right.fileName);
    if (leftPreferred !== rightPreferred) {
      return leftPreferred ? -1 : 1;
    }

    const leftSize = left.size ?? Number.POSITIVE_INFINITY;
    const rightSize = right.size ?? Number.POSITIVE_INFINITY;
    if (leftSize !== rightSize) {
      return leftSize - rightSize;
    }

    return left.fileName.localeCompare(right.fileName);
  });
}

async function fetchResumePdfText(params: {
  messageId: string;
  tokenVaultLoginHint: string;
  automationMode: boolean;
}): Promise<string | null> {
  const accessToken = await getGoogleAccessToken({
    loginHint: params.tokenVaultLoginHint,
    allowTokenVaultFallback: params.automationMode ? false : true,
  });

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail('v1');

  const detail = await gmail.users.messages.get({
    auth,
    userId: 'me',
    id: params.messageId,
    format: 'full',
  });

  const attachments: Array<{ attachmentId: string; fileName: string; mimeType: string; size: number | null }> = [];
  collectPdfAttachmentParts(detail.data.payload, attachments);

  const prioritized = prioritizeResumeAttachments(attachments);
  for (const attachment of prioritized) {
    if (typeof attachment.size === 'number' && attachment.size > MAX_RESUME_PDF_BYTES) {
      continue;
    }

    const attachmentResponse = await gmail.users.messages.attachments.get({
      auth,
      userId: 'me',
      messageId: params.messageId,
      id: attachment.attachmentId,
    });

    const buffer = decodeBase64UrlToBuffer(attachmentResponse.data.data);
    if (buffer.length === 0 || buffer.length > MAX_RESUME_PDF_BYTES) {
      continue;
    }

    const parsed = await pdf(buffer);
    const text = parsed.text?.replace(/\u0000/g, '').trim();
    if (text) {
      return compact(text, 12000);
    }
  }

  return null;
}

function buildEmailText(message: { subject: string | null; body: string; snippet: string }) {
  const subjectLine = `Subject: ${message.subject ?? '(no subject)'}`;
  const rawBody = message.body || message.snippet || '';
  const normalizedBody = rawBody
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const combined = [subjectLine, '', normalizedBody].join('\n');
  return combined.slice(0, 15000);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function extractJobTemplateRequirements(jdTemplate: unknown): string[] {
  const template = asRecord(jdTemplate);
  return asStringList(template.requirements);
}

function isIsoAfter(left: string | null, right: string | null) {
  if (!left || !right) {
    return false;
  }

  const leftMs = new Date(left).getTime();
  const rightMs = new Date(right).getTime();

  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) {
    return false;
  }

  return leftMs > rightMs;
}

type SchedulingReplyMatchSource = 'thread_key' | 'email_key' | 'none';

type SchedulingReplyCandidateMatch = {
  id: string;
  jobId: string;
  stage: string;
};

function dedupeCandidateMatches(rows: SchedulingReplyCandidateMatch[]): SchedulingReplyCandidateMatch[] {
  const seen = new Set<string>();

  return rows.filter((row) => {
    if (seen.has(row.id)) {
      return false;
    }

    seen.add(row.id);
    return true;
  });
}

async function loadIdentityKeyCandidateMatches(params: {
  jobId: string;
  keyType: 'gmail_thread_id' | 'email_job';
  keyValue: string;
}) {
  const rows: Array<{ id: string; jobId: string; stage: string; updatedAt: Date | null }> = await db
    .select({
      id: candidates.id,
      jobId: candidates.jobId,
      stage: candidates.stage,
      updatedAt: candidates.updatedAt,
    })
    .from(candidateIdentityKeys)
    .innerJoin(candidates, eq(candidateIdentityKeys.candidateId, candidates.id))
    .where(
      and(
        eq(candidateIdentityKeys.jobId, params.jobId),
        eq(candidateIdentityKeys.keyType, params.keyType),
        eq(candidateIdentityKeys.keyValue, params.keyValue),
      ),
    )
    .orderBy(desc(candidates.updatedAt))
    .limit(5);

  return dedupeCandidateMatches(
    rows.map((row) => ({
      id: row.id,
      jobId: row.jobId,
      stage: row.stage,
    })),
  );
}

async function resolveSchedulingReplyCandidateMatches(params: {
  jobId: string;
  senderEmail: string | null;
  sourceThreadId: string | null;
}) {
  if (params.sourceThreadId) {
    const threadMatches = await loadIdentityKeyCandidateMatches({
      jobId: params.jobId,
      keyType: 'gmail_thread_id',
      keyValue: params.sourceThreadId,
    });

    if (threadMatches.length > 0) {
      return {
        matchSource: 'thread_key' as const,
        matches: threadMatches,
      };
    }
  }

  if (params.senderEmail) {
    const emailMatches = await loadIdentityKeyCandidateMatches({
      jobId: params.jobId,
      keyType: 'email_job',
      keyValue: params.senderEmail,
    });

    if (emailMatches.length > 0) {
      return {
        matchSource: 'email_key' as const,
        matches: emailMatches,
      };
    }
  }

  return {
    matchSource: 'none' as const,
    matches: [] as SchedulingReplyCandidateMatch[],
  };
}

async function upsertSchedulingReplyIdentitySignals(params: {
  candidateId: string;
  jobId: string;
  organizationId: string | null;
  senderEmail: string | null;
  sourceMessageId: string;
  sourceThreadId: string | null;
  receivedAt: string | null;
  matchSource: SchedulingReplyMatchSource;
  triageConfidence: number;
}) {
  const seenAt = params.receivedAt ? new Date(params.receivedAt) : new Date();
  const now = new Date();

  const keyInputs: Array<{ keyType: 'gmail_message_id' | 'gmail_thread_id' | 'email_job'; keyValue: string }> = [
    {
      keyType: 'gmail_message_id',
      keyValue: params.sourceMessageId,
    },
  ];

  if (params.sourceThreadId) {
    keyInputs.push({
      keyType: 'gmail_thread_id',
      keyValue: params.sourceThreadId,
    });
  }

  if (params.senderEmail) {
    keyInputs.push({
      keyType: 'email_job',
      keyValue: params.senderEmail,
    });
  }

  for (const keyInput of keyInputs) {
    await db
      .insert(candidateIdentityKeys)
      .values({
        organizationId: params.organizationId,
        jobId: params.jobId,
        candidateId: params.candidateId,
        keyType: keyInput.keyType,
        keyValue: keyInput.keyValue,
        metadata: {
          source: 'intake_scheduling_reply',
          matchSource: params.matchSource,
          triageConfidence: params.triageConfidence,
        },
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
      })
      .onConflictDoUpdate({
        target: [
          candidateIdentityKeys.keyType,
          candidateIdentityKeys.keyValue,
          candidateIdentityKeys.jobId,
        ],
        set: {
          candidateId: params.candidateId,
          organizationId: params.organizationId,
          lastSeenAt: seenAt,
          metadata: {
            source: 'intake_scheduling_reply',
            matchSource: params.matchSource,
            triageConfidence: params.triageConfidence,
          },
          updatedAt: now,
        },
      });
  }
}

async function loadLatestAvailabilityRequestContext(candidateId: string) {
  const [latestLog] = await db
    .select({
      metadata: auditLogs.metadata,
      timestamp: auditLogs.timestamp,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.resourceType, 'candidate'),
        eq(auditLogs.resourceId, candidateId),
        inArray(auditLogs.action, ['interview.availability.request.sent', 'interview.availability.request.drafted']),
      ),
    )
    .orderBy(desc(auditLogs.timestamp))
    .limit(1);

  if (!latestLog) {
    return null;
  }

  const metadata = asRecord(latestLog.metadata);

  return {
    timestampISO: latestLog.timestamp?.toISOString() ?? null,
    providerId: asString(metadata.providerId),
    providerThreadId: asString(metadata.providerThreadId),
    threadId: asString(metadata.threadId),
  };
}

async function loadLatestProposalContext(candidateId: string) {
  const [latestLog] = await db
    .select({
      metadata: auditLogs.metadata,
      timestamp: auditLogs.timestamp,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.resourceType, 'candidate'),
        eq(auditLogs.resourceId, candidateId),
        inArray(auditLogs.action, ['interview.proposal.sent', 'interview.proposal.drafted']),
      ),
    )
    .orderBy(desc(auditLogs.timestamp))
    .limit(1);

  if (!latestLog) {
    return null;
  }

  const metadata = asRecord(latestLog.metadata);

  return {
    timestampISO: latestLog.timestamp?.toISOString() ?? null,
    providerId: asString(metadata.providerId),
    providerThreadId: asString(metadata.providerThreadId),
    applicationThreadId: asString(metadata.applicationThreadId),
    subject: asString(metadata.subject),
  };
}

async function loadActiveJobs(organizationId?: string) {
  const rows: Array<{ id: string; title: string; organizationId: string | null; jdTemplate: Record<string, unknown> }> =
    await db
      .select({ id: jobs.id, title: jobs.title, organizationId: jobs.organizationId, jdTemplate: jobs.jdTemplate })
    .from(jobs)
    .where(eq(jobs.status, 'active'))
    .limit(50);

  return organizationId
    ? rows.filter((job: { organizationId: string | null }) => job.organizationId === organizationId)
    : rows;
}

export const runIntakeE2ETool = withGmailRead(
  tool({
    description:
      'Run a true end-to-end intake pass from Gmail intercept to DB ingest and optional intel generation for candidate-like messages.',
    inputSchema: runIntakeE2EInputSchema,
    execute: runIntakeE2E,
  }),
);

export async function runIntakeE2E(input: RunIntakeE2EInput) {
      const session = await auth0.getSession().catch((error) => {
        if (error instanceof Error && /outside a request scope|next-dynamic-api-wrong-context/i.test(error.message)) {
          return null;
        }

        throw error;
      });
      const actorId =
        session?.user?.sub ??
        input.actorUserId?.trim() ??
        process.env.HEADHUNT_FOUNDER_USER_ID?.trim() ??
        process.env.AUTH0_FOUNDER_USER_ID?.trim() ??
        null;

      if (!actorId) {
        return {
          check: 'run_intake_e2e',
          status: 'error',
          message: 'Unauthorized: missing actor identity for intake run.',
        };
      }

      const actorDisplayName =
        session?.user?.name ??
        session?.user?.email ??
        input.actorDisplayName?.trim() ??
        actorId;
      const requestedOrganizationId = input.organizationId ?? null;
      const requestedJobId = input.jobId ?? null;

      const requestedOrganization = requestedOrganizationId
        ? (
            await db
              .select({ id: organizations.id })
              .from(organizations)
              .where(eq(organizations.id, requestedOrganizationId))
              .limit(1)
          )[0] ?? null
        : null;

      const requestedJob = requestedJobId
        ? (
            await db
              .select({
                id: jobs.id,
                title: jobs.title,
                organizationId: jobs.organizationId,
                status: jobs.status,
                jdTemplate: jobs.jdTemplate,
              })
              .from(jobs)
              .where(eq(jobs.id, requestedJobId))
              .limit(1)
          )[0] ?? null
        : null;

      if (requestedJob && requestedJob.status !== 'active') {
        return {
          check: 'run_intake_e2e',
          status: 'error',
          message: `Requested job ${requestedJob.id} is ${requestedJob.status}. Pick an active job before running intake.`,
          requestedJobId,
          requestedJobStatus: requestedJob.status,
        };
      }

      const resolvedOrganizationId = requestedOrganization?.id ?? requestedJob?.organizationId ?? null;
      const activeJobs = await loadActiveJobs(resolvedOrganizationId ?? undefined);
      const fallbackJobId = requestedJob?.id ?? activeJobs[0]?.id ?? null;
      const usedFallbackOrganizationId = Boolean(requestedOrganizationId && !requestedOrganization?.id);
      const usedFallbackJobId = Boolean(requestedJobId && !requestedJob?.id);

      const intercepted = await fetchInterceptMessages({
        query: input.query,
        maxResults: input.maxResults,
        candidateLikeOnly: input.candidateLikeOnly,
        includeBody: input.includeBody,
        tokenVaultLoginHint: input.tokenVaultLoginHint ?? actorId,
        automationMode: input.automationMode ?? false,
      });

      const messages = intercepted.slice(0, input.processLimit);

      const messageResults: Array<Record<string, unknown>> = [];
      let ingestedCreated = 0;
      let ingestedIdempotent = 0;
      let intelGenerated = 0;
      let uncertainManualReviewCount = 0;
      let ambiguousIdentityCount = 0;

      for (const message of messages) {
        const rawEmailText = buildEmailText(message);
        const candidateIdentity = extractCandidateIdentity({
          from: message.from,
          subject: message.subject,
          body: message.body,
          snippet: message.snippet,
        });

        if (!candidateIdentity.email) {
          uncertainManualReviewCount += 1;
          messageResults.push({
            messageId: message.messageId,
            subject: message.subject,
            status: 'skipped',
            reason: 'No parseable sender email in From header.',
            reasonCode: 'missing_sender_email',
            manualReviewRequired: true,
          });
          continue;
        }

        try {
          const triage = await runTriage({
            organizationId: resolvedOrganizationId ?? undefined,
            from: message.from ?? undefined,
            subject: message.subject ?? '',
            body: rawEmailText,
            sourceMessageId: message.messageId,
            sourceThreadId: message.threadId ?? undefined,
            jobs: activeJobs.map((job: { id: string; title: string }) => ({ id: job.id, title: job.title })),
          });

          const shouldEnforceTriageBoundary =
            triage.automationSafe === false &&
            (triage.classification === 'scheduling_reply' ||
              (triage.classification === 'application' && !requestedJob?.id));

          if (shouldEnforceTriageBoundary) {
            uncertainManualReviewCount += 1;
            messageResults.push({
              messageId: message.messageId,
              threadId: message.threadId,
              from: message.from,
              subject: message.subject,
              status: 'skipped',
              reason: `Triage boundary blocked auto-routing (${triage.boundaryReason ?? 'uncertain_input'}).`,
              reasonCode: triage.boundaryReason ?? 'uncertain_input',
              manualReviewRequired: true,
              triage,
            });
            continue;
          }

          if (triage.classification === 'scheduling_reply') {
            const schedulingJobId = requestedJob?.id ?? triage.jobId ?? fallbackJobId;

            if (!schedulingJobId) {
              messageResults.push({
                messageId: message.messageId,
                threadId: message.threadId,
                from: message.from,
                subject: message.subject,
                status: 'skipped',
                reason: 'Scheduling reply detected but no active job context was resolved.',
                triage,
              });
              continue;
            }

            const identityMatch = await resolveSchedulingReplyCandidateMatches({
              jobId: schedulingJobId,
              senderEmail: candidateIdentity.email,
              sourceThreadId: message.threadId ?? null,
            });
            const matchedCandidates = identityMatch.matches;

            if (matchedCandidates.length > 1) {
              ambiguousIdentityCount += 1;
              uncertainManualReviewCount += 1;
              messageResults.push({
                messageId: message.messageId,
                threadId: message.threadId,
                from: message.from,
                subject: message.subject,
                status: 'skipped',
                reason: 'Scheduling reply matched multiple candidate records for the same job/email; manual merge required.',
                reasonCode: 'ambiguous_candidate_email_match',
                manualReviewRequired: true,
                identityMatchSource: identityMatch.matchSource,
                triage,
              });
              continue;
            }

            const matchedCandidate = matchedCandidates[0];

            if (!matchedCandidate) {
              messageResults.push({
                messageId: message.messageId,
                threadId: message.threadId,
                from: message.from,
                subject: message.subject,
                status: 'skipped',
                reason: 'Scheduling reply detected but no matching candidate record found for resolved job.',
                reasonCode: 'candidate_not_found_for_scheduling_reply',
                identityMatchSource: identityMatch.matchSource,
                triage,
              });
              continue;
            }

            await upsertSchedulingReplyIdentitySignals({
              candidateId: matchedCandidate.id,
              jobId: schedulingJobId,
              organizationId: resolvedOrganizationId,
              senderEmail: candidateIdentity.email,
              sourceMessageId: message.messageId,
              sourceThreadId: message.threadId ?? null,
              receivedAt: message.receivedAt ?? null,
              matchSource: identityMatch.matchSource,
              triageConfidence: triage.confidence,
            });

            if (['interview_scheduled', 'interviewed', 'offer_sent', 'hired'].includes(matchedCandidate.stage)) {
              messageResults.push({
                messageId: message.messageId,
                threadId: message.threadId,
                from: message.from,
                subject: message.subject,
                status: 'skipped',
                reason: `Candidate ${matchedCandidate.id} is already at stage ${matchedCandidate.stage}; skipping additional scheduling booking.`,
                reasonCode: 'candidate_stage_already_advanced',
                triage,
              });
              continue;
            }

            const requestContext = await loadLatestAvailabilityRequestContext(matchedCandidate.id);
            const proposalContext = requestContext ? null : await loadLatestProposalContext(matchedCandidate.id);

            const effectiveContext = requestContext
              ? { kind: 'availability_request' as const, timestampISO: requestContext.timestampISO, threadId: requestContext.providerThreadId ?? requestContext.threadId }
              : proposalContext
                ? { kind: 'proposal' as const, timestampISO: proposalContext.timestampISO, threadId: proposalContext.providerThreadId ?? proposalContext.applicationThreadId }
                : null;

            if (!effectiveContext) {
              messageResults.push({
                messageId: message.messageId,
                threadId: message.threadId,
                from: message.from,
                subject: message.subject,
                status: 'skipped',
                reason:
                  'Scheduling reply detected but no prior availability request (Cal) or proposal (Google) context exists; waiting for liaison send step first.',
                reasonCode: 'missing_prior_scheduling_context',
                triage,
              });
              continue;
            }

            const contextThreadId = effectiveContext.threadId;
            if (contextThreadId && message.threadId && contextThreadId !== message.threadId) {
              messageResults.push({
                messageId: message.messageId,
                threadId: message.threadId,
                from: message.from,
                subject: message.subject,
                status: 'skipped',
                reason: 'Scheduling reply is on a different thread than the latest scheduling context; skipping.',
                reasonCode: 'reply_thread_mismatch',
                triage,
              });
              continue;
            }

            if (!isIsoAfter(message.receivedAt, effectiveContext.timestampISO)) {
              messageResults.push({
                messageId: message.messageId,
                threadId: message.threadId,
                from: message.from,
                subject: message.subject,
                status: 'skipped',
                reason: 'Scheduling reply is not newer than the latest scheduling send; waiting for a fresh candidate reply.',
                reasonCode: 'reply_not_newer_than_send',
                triage,
              });
              continue;
            }

            const schedulingRequestFingerprint =
              (requestContext?.providerId ?? proposalContext?.providerId ?? effectiveContext.timestampISO ?? message.messageId) as string;

            const handlerType = effectiveContext.kind === 'availability_request'
              ? 'scheduling.reply.parse_book'
              : 'scheduling.reply.parse_book_google';

            const schedulingRun = await enqueueAutomationRun({
              handlerType,
              resourceType: 'candidate',
              resourceId: matchedCandidate.id,
              idempotencyKey: buildIdempotencyKey([
                'scheduling-reply',
                handlerType,
                matchedCandidate.id,
                schedulingRequestFingerprint,
              ]),
              payload: {
                agentName: 'liaison',
                candidateId: matchedCandidate.id,
                jobId: schedulingJobId,
                organizationId: resolvedOrganizationId,
                actorUserId: actorId,
                timezone: 'America/Los_Angeles',
                threadId: message.threadId ?? contextThreadId ?? undefined,
                query: `rfc822msgid:${message.messageId}`,
                lookbackDays: 14,
                maxResults: 10,
                durationMinutes: 30,
                sendMode: 'send',
                confirmationSendMode: 'send',
                username: process.env.CAL_PUBLIC_USERNAME?.trim() || undefined,
                teamSlug: process.env.CAL_PUBLIC_TEAM_SLUG?.trim() || undefined,
                organizationSlug: process.env.CAL_PUBLIC_ORGANIZATION_SLUG?.trim() || undefined,
              },
              maxAttempts: 6,
            });

            messageResults.push({
              messageId: message.messageId,
              threadId: message.threadId,
              from: message.from,
              subject: message.subject,
              candidateName: candidateIdentity.name,
              candidateNameSource: candidateIdentity.nameSource,
              candidateEmail: candidateIdentity.email,
              candidateId: matchedCandidate.id,
              jobId: schedulingJobId,
              identityMatchSource: identityMatch.matchSource,
              status: 'processed',
              triage,
              automationBoundary: {
                automationSafe: triage.automationSafe,
                boundaryReason: triage.boundaryReason,
                suggestedAction: triage.suggestedAction,
              },
              automation: {
                schedulingEnqueued: schedulingRun.inserted,
                schedulingRunId: schedulingRun.runId,
              },
            });
            continue;
          }

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

          if (requestedJob?.id && triageJobId && triageJobId !== requestedJob.id) {
            messageResults.push({
              messageId: message.messageId,
              threadId: message.threadId,
              from: message.from,
              subject: message.subject,
              status: 'skipped',
              reason: `Triage matched ${triageJobId}, which does not match requested job ${requestedJob.id}.`,
              triage,
            });
            continue;
          }

          const resolvedJobId = requestedJob?.id ?? triageJobId ?? fallbackJobId;
          const resolvedJobContext =
            requestedJob?.id === resolvedJobId
              ? requestedJob
              : activeJobs.find((job) => job.id === resolvedJobId) ?? null;
          const resolvedRequirements =
            input.requirements && input.requirements.length > 0
              ? input.requirements
              : extractJobTemplateRequirements(resolvedJobContext?.jdTemplate);

          if (!resolvedJobId) {
            uncertainManualReviewCount += 1;
            messageResults.push({
              messageId: message.messageId,
              subject: message.subject,
              from: message.from,
              triage,
              status: 'skipped',
              reason: 'No active or resolved job id available for ingest.',
              reasonCode: 'missing_job_context',
              manualReviewRequired: true,
            });
            continue;
          }

          const identityConfidence = getCandidateIdentityConfidence(candidateIdentity.nameSource);
          if (
            candidateIdentity.nameSource === 'fallback' &&
            identityConfidence < MIN_IDENTITY_CONFIDENCE_FOR_AUTO_INGEST &&
            triage.confidence < MIN_TRIAGE_CONFIDENCE_FOR_AUTOMATION
          ) {
            uncertainManualReviewCount += 1;
            messageResults.push({
              messageId: message.messageId,
              threadId: message.threadId,
              from: message.from,
              subject: message.subject,
              status: 'skipped',
              reason:
                'Application-like email has low-confidence candidate identity extraction and low triage confidence; manual review required before ingest.',
              reasonCode: 'low_identity_confidence',
              manualReviewRequired: true,
              triage,
            });
            continue;
          }

          const ingest = await ingestCandidateFromEmail({
            jobId: resolvedJobId,
            organizationId: resolvedOrganizationId ?? undefined,
            candidateName: candidateIdentity.name,
            candidateEmail: candidateIdentity.email,
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

          let resumeText: string | null = null;
          try {
            resumeText = await fetchResumePdfText({
              messageId: message.messageId,
              tokenVaultLoginHint: input.tokenVaultLoginHint ?? actorId,
              automationMode: input.automationMode ?? false,
            });
          } catch {
            resumeText = null;
          }

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
              organizationId: resolvedOrganizationId ?? undefined,
              emailText: rawEmailText,
              resumeText: resumeText ?? undefined,
              requirements: resolvedRequirements,
            });

            intel = intelResult;
            if (intelResult.status === 'success') {
              intelGenerated += 1;
            }
          }

          const scoreRun = await enqueueAutomationRun({
            handlerType: 'candidate.score',
            resourceType: 'candidate',
            resourceId: ingest.candidate.id,
            // Keep idempotency aligned with webhook-triggered candidate.score enqueues.
            idempotencyKey: buildIdempotencyKey(['webhook', 'candidate-score', ingest.candidate.id, message.messageId]),
            payload: {
              agentName: 'analyst',
              candidateId: ingest.candidate.id,
              jobId: resolvedJobId,
              organizationId: resolvedOrganizationId,
              actorUserId: actorId,
              emailText: rawEmailText,
              resumeText: resumeText ?? undefined,
              requirements: resolvedRequirements,
              turns: 1,
              maxEvidenceChars: 2500,
              automationMode: true,
            },
            maxAttempts: 6,
          });

          messageResults.push({
            messageId: message.messageId,
            threadId: message.threadId,
            from: message.from,
            subject: message.subject,
            candidateName: candidateIdentity.name,
            candidateNameSource: candidateIdentity.nameSource,
            candidateEmail: candidateIdentity.email,
            candidateId: ingest.candidate.id,
            jobId: resolvedJobId,
            identityResolution: ingest.identityResolution,
            ingestStatus: ingest.idempotent ? 'idempotent' : 'created',
            triage,
            automationBoundary: {
              automationSafe: triage.automationSafe,
              boundaryReason: triage.boundaryReason,
              suggestedAction: triage.suggestedAction,
            },
            intel,
            automation: {
              scoreEnqueued: scoreRun.inserted,
              scoreRunId: scoreRun.runId,
            },
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
        organizationId: resolvedOrganizationId,
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
          requestedOrganizationId,
          resolvedOrganizationId,
          usedFallbackOrganizationId,
          requestedJobId,
          resolvedRequestedJobId: requestedJob?.id ?? null,
          usedFallbackJobId,
          interceptedCount: intercepted.length,
          processedCount: messages.length,
          ingestedCreated,
          ingestedIdempotent,
          intelGenerated,
          uncertainManualReviewCount,
          ambiguousIdentityCount,
        },
        result: 'success',
      });

      return {
        check: 'run_intake_e2e',
        status: 'success',
        query: input.query,
        actorUserId: actorId,
        requestedOrganizationId,
        resolvedOrganizationId,
        usedFallbackOrganizationId,
        requestedJobId,
        resolvedRequestedJobId: requestedJob?.id ?? null,
        usedFallbackJobId,
        activeJobsCount: activeJobs.length,
        interceptedCount: intercepted.length,
        processedCount: messages.length,
        ingestedCreated,
        ingestedIdempotent,
        intelGenerated,
        uncertainManualReviewCount,
        ambiguousIdentityCount,
        messages: messageResults,
      };
}
