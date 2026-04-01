import { tool } from 'ai';
import { gmail_v1, google } from 'googleapis';
import { z } from 'zod';

import { auth0 } from '@/lib/auth0';
import { getGoogleAccessToken, withGmailRead } from '@/lib/auth0-ai';
import { db } from '@/lib/db';
import { auditLogs } from '@/lib/db/schema/audit-logs';

const runInterceptInputSchema = z.object({
  query: z.string().default('in:inbox newer_than:14d'),
  maxResults: z.number().int().min(1).max(25).default(10),
  candidateLikeOnly: z.boolean().default(true),
  includeBody: z.boolean().default(true),
  organizationId: z.string().optional(),
  actorUserId: z.string().min(1).optional(),
});

export type FetchInterceptMessagesInput = {
  query: string;
  maxResults: number;
  candidateLikeOnly: boolean;
  includeBody: boolean;
};

export type InterceptMessage = {
  messageId: string;
  threadId: string | null;
  from: string | null;
  subject: string | null;
  receivedAt: string | null;
  snippet: string;
  body: string;
  candidateLike: boolean;
  signals: string[];
};

const POSITIVE_SIGNALS = [
  'resume',
  'cv',
  'application',
  'applying',
  'cover letter',
  'interested in',
  'job opening',
  'position',
] as const;

const NEGATIVE_SIGNALS = ['unsubscribe', 'newsletter', 'otp', 'invoice', 'receipt', 'promotion'] as const;

function decodeBase64Url(value: string | null | undefined): string {
  if (!value) return '';

  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function toPlainText(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractPlainTextPart(part: gmail_v1.Schema$MessagePart | undefined): string {
  if (!part) return '';

  if (part.mimeType === 'text/plain') {
    return decodeBase64Url(part.body?.data);
  }

  if (part.mimeType === 'text/html') {
    return toPlainText(decodeBase64Url(part.body?.data));
  }

  for (const child of part.parts ?? []) {
    const parsed = extractPlainTextPart(child);
    if (parsed) {
      return parsed;
    }
  }

  return '';
}

function getHeader(part: gmail_v1.Schema$MessagePart | undefined, name: string): string | null {
  const header = (part?.headers ?? []).find((item) => item.name?.toLowerCase() === name.toLowerCase());
  return header?.value ?? null;
}

function compact(value: string, limit = 1400): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, limit);
}

function classifyCandidateLike(params: { from: string | null; subject: string | null; body: string; snippet: string }) {
  const source = `${params.from ?? ''}\n${params.subject ?? ''}\n${params.body}\n${params.snippet}`.toLowerCase();

  const positive = POSITIVE_SIGNALS.filter((keyword) => source.includes(keyword));
  const negative = NEGATIVE_SIGNALS.filter((keyword) => source.includes(keyword));

  const candidateLike = positive.length > 0 && negative.length === 0;

  return {
    candidateLike,
    signals: [...positive, ...negative.map((keyword) => `not:${keyword}`)],
  };
}

export async function fetchInterceptMessages(input: FetchInterceptMessagesInput): Promise<InterceptMessage[]> {
  const accessToken = await getGoogleAccessToken();
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const gmail = google.gmail('v1');
  const listed = await gmail.users.messages.list({
    auth,
    userId: 'me',
    q: input.query,
    maxResults: input.maxResults,
  });

  const messages = listed.data.messages ?? [];

  const normalized = (
    await Promise.all(
      messages.map(async (message) => {
        const messageId = message.id;
        if (!messageId) {
          return null;
        }

        const detail = await gmail.users.messages.get({
          auth,
          userId: 'me',
          id: messageId,
          format: 'full',
        });

        const payload = detail.data.payload;
        const from = getHeader(payload, 'From');
        const subject = getHeader(payload, 'Subject');
        const body = compact(extractPlainTextPart(payload), 5000);
        const snippet = compact(detail.data.snippet ?? '', 600);
        const classification = classifyCandidateLike({
          from,
          subject,
          body,
          snippet,
        });

        return {
          messageId,
          threadId: detail.data.threadId ?? null,
          from,
          subject,
          receivedAt: detail.data.internalDate ? new Date(Number(detail.data.internalDate)).toISOString() : null,
          snippet,
          body: input.includeBody ? body : '',
          candidateLike: classification.candidateLike,
          signals: classification.signals,
        };
      }),
    )
  ).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return input.candidateLikeOnly ? normalized.filter((entry) => entry.candidateLike) : normalized;
}

export const runInterceptTool = withGmailRead(
  tool({
    description:
      'Pull inbound Gmail messages for recruiting intercept, return normalized candidate-like email entries, and persist an audit log.',
    inputSchema: runInterceptInputSchema,
    execute: async (input) => {
      const actorUserId = input.actorUserId ?? (await auth0.getSession())?.user?.sub ?? null;

      if (!actorUserId) {
        return {
          check: 'run_intercept',
          status: 'error',
          message: 'Unauthorized: missing actor identity for intercept run.',
        };
      }

      try {
        const filtered = await fetchInterceptMessages({
          query: input.query,
          maxResults: input.maxResults,
          candidateLikeOnly: input.candidateLikeOnly,
          includeBody: input.includeBody,
        });

        await db.insert(auditLogs).values({
          organizationId: input.organizationId ?? null,
          actorType: 'agent',
          actorId: 'run_intercept',
          actorDisplayName: 'Intercept Agent',
          action: 'intercept.executed',
          resourceType: 'gmail_inbox',
          resourceId: actorUserId,
          metadata: {
            query: input.query,
            maxResults: input.maxResults,
            fetchedCount: filtered.length,
            returnedCount: filtered.length,
            candidateLikeOnly: input.candidateLikeOnly,
          },
          result: 'success',
        });

        return {
          check: 'run_intercept',
          status: 'success',
          query: input.query,
          fetchedCount: filtered.length,
          returnedCount: filtered.length,
          candidateLikeOnly: input.candidateLikeOnly,
          messages: filtered,
        };
      } catch (error) {
        return {
          check: 'run_intercept',
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error while running intercept.',
        };
      }
    },
  }),
);
