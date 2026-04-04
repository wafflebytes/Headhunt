import { TokenVaultError } from '@auth0/ai/interrupts';
import { and, desc, eq } from 'drizzle-orm';
import { google } from 'googleapis';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { CAL_COM_API_BASE_URL, getAccessToken, getGoogleAccessToken } from '@/lib/auth0-ai';
import { auth0 } from '@/lib/auth0';
import { db } from '@/lib/db';
import { auditLogs } from '@/lib/db/schema/audit-logs';
import { candidates } from '@/lib/db/schema/candidates';
import { founderSlotRangeSchema, founderSlotSelections } from '@/lib/db/schema/founder-slot-selections';
import { jobs } from '@/lib/db/schema/jobs';
import { canViewCandidate } from '@/lib/fga/fga';

const CAL_EVENT_TYPES_API_VERSION = process.env.CAL_EVENT_TYPES_API_VERSION || '2024-09-04';
const CAL_WEB_BASE_URL = process.env.CAL_COM_WEB_BASE_URL || 'https://cal.com';
const CAL_INTERVIEW_EVENT_TYPE_TITLE = process.env.CAL_INTERVIEW_EVENT_TYPE_TITLE || 'Interview 30 min';
const CAL_INTERVIEW_EVENT_TYPE_SLUG = process.env.CAL_INTERVIEW_EVENT_TYPE_SLUG || 'interview-30-min';
const CAL_USERNAME_OVERRIDE = process.env.CAL_PUBLIC_USERNAME?.trim() || null;
const CAL_TEAM_SLUG_OVERRIDE = process.env.CAL_PUBLIC_TEAM_SLUG?.trim() || null;
const CAL_ORGANIZATION_SLUG_OVERRIDE = process.env.CAL_PUBLIC_ORGANIZATION_SLUG?.trim() || null;

type SlotRange = z.infer<typeof founderSlotRangeSchema>;

type CalEventTypeIdentity = {
  id: number | null;
  slug: string | null;
  username: string | null;
  teamSlug: string | null;
  organizationSlug: string | null;
  bookingUrl: string | null;
};

const requestSchema = z.object({
  candidateId: z.string().min(1),
  jobId: z.string().min(1),
  organizationId: z.string().min(1).optional(),
  timezone: z.string().default('America/Los_Angeles'),
  durationMinutes: z.number().int().min(15).max(180).default(30),
  ranges: z.array(founderSlotRangeSchema).min(1).max(24),
  action: z.enum(['save', 'save_and_send']).default('save'),
  sendMode: z.enum(['send', 'draft']).default('send'),
  customMessage: z.string().max(2000).optional(),
});

const querySchema = z.object({
  candidateId: z.string().min(1),
  jobId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : null;
  }

  return null;
}

function normalizeSlotRanges(ranges: SlotRange[]): SlotRange[] {
  const dedupe = new Set<string>();
  const normalized = ranges
    .map((range) => {
      const start = new Date(range.startISO);
      const end = new Date(range.endISO);

      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new Error('Each slot range must include valid ISO datetimes.');
      }

      if (end <= start) {
        throw new Error('Each slot range endISO must be after startISO.');
      }

      return {
        startISO: start.toISOString(),
        endISO: end.toISOString(),
      };
    })
    .sort((a, b) => new Date(a.startISO).getTime() - new Date(b.startISO).getTime())
    .filter((range) => {
      const signature = `${range.startISO}|${range.endISO}`;
      if (dedupe.has(signature)) {
        return false;
      }
      dedupe.add(signature);
      return true;
    });

  if (normalized.length === 0) {
    throw new Error('At least one valid slot range is required.');
  }

  return normalized;
}

function formatRange(range: SlotRange, timezone: string): string {
  const start = new Date(range.startISO);
  const end = new Date(range.endISO);

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
      timeZoneName: 'short',
    });
    return `${formatter.format(start)} - ${formatter.format(end)}`;
  } catch {
    return `${start.toISOString()} - ${end.toISOString()}`;
  }
}

function toBase64Url(value: string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function withCalHeaders(accessToken: string, includeJson = false) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'cal-api-version': CAL_EVENT_TYPES_API_VERSION,
  };

  if (includeJson) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

function collectCalEventTypeRecords(payload: unknown): Array<Record<string, unknown>> {
  const root = asRecord(payload);
  if (!root) {
    return [];
  }

  const data = root.data;
  if (Array.isArray(data)) {
    return data.map(asRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry));
  }

  const dataRecord = asRecord(data);
  if (!dataRecord) {
    return [];
  }

  const listCandidates = [
    dataRecord.eventTypes,
    dataRecord.items,
    dataRecord.results,
    dataRecord.data,
  ];

  for (const candidate of listCandidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }

    return candidate.map(asRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry));
  }

  return [dataRecord];
}

function parseEventTypeIdentity(record: Record<string, unknown>): CalEventTypeIdentity {
  const user = asRecord(record.user);
  const owner = asRecord(record.owner);
  const team = asRecord(record.team);
  const organization = asRecord(record.organization);
  const firstUser = Array.isArray(record.users)
    ? asRecord(record.users.find((value) => asRecord(value)))
    : null;

  const id = asInteger(record.id) ?? asInteger(record.eventTypeId);
  const slug = asString(record.slug);
  const username =
    asString(record.username) ??
    asString(record.ownerUsername) ??
    asString(user?.username) ??
    asString(owner?.username) ??
    asString(firstUser?.username);
  const teamSlug = asString(record.teamSlug) ?? asString(team?.slug);
  const organizationSlug = asString(record.organizationSlug) ?? asString(organization?.slug);
  const bookingUrl =
    asString(record.bookingUrl) ??
    asString(record.url) ??
    asString(record.link) ??
    asString(record.publicLink);

  return {
    id,
    slug,
    username,
    teamSlug,
    organizationSlug,
    bookingUrl,
  };
}

function parseLengthMinutes(record: Record<string, unknown>): number | null {
  return (
    asInteger(record.lengthInMinutes) ??
    asInteger(record.length) ??
    asInteger(record.duration) ??
    asInteger(record.durationMinutes)
  );
}

function parseCalEnvEventTypeId(): number | null {
  const raw = process.env.CAL_INTERVIEW_EVENT_TYPE_ID?.trim() || process.env.CAL_TEST_EVENT_TYPE_ID?.trim();
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function fetchCalProfile(accessToken: string) {
  const url = new URL('/v2/me', CAL_COM_API_BASE_URL).toString();
  const response = await fetch(url, {
    headers: withCalHeaders(accessToken),
  });

  if (!response.ok) {
    return {
      username: null,
      teamSlug: null,
      organizationSlug: null,
    };
  }

  const payload = (await response.json()) as unknown;
  const data = asRecord(asRecord(payload)?.data) ?? asRecord(payload);
  const user = asRecord(data?.user);
  const team = asRecord(data?.team);
  const organization = asRecord(data?.organization);

  return {
    username: asString(data?.username) ?? asString(user?.username),
    teamSlug: asString(data?.teamSlug) ?? asString(team?.slug),
    organizationSlug: asString(data?.organizationSlug) ?? asString(organization?.slug),
  };
}

function buildCalBookingUrl(identity: CalEventTypeIdentity): string | null {
  if (identity.bookingUrl && /^https?:\/\//i.test(identity.bookingUrl)) {
    return identity.bookingUrl;
  }

  if (!identity.slug) {
    return null;
  }

  const base = CAL_WEB_BASE_URL.replace(/\/+$/, '');

  if (identity.username) {
    return `${base}/${identity.username}/${identity.slug}`;
  }

  if (identity.teamSlug) {
    return `${base}/${identity.teamSlug}/${identity.slug}`;
  }

  if (identity.organizationSlug) {
    return `${base}/${identity.organizationSlug}/${identity.slug}`;
  }

  return null;
}

async function ensureInterviewEventType(params: {
  accessToken: string;
  durationMinutes: number;
}) {
  const desiredTitle =
    params.durationMinutes === 30
      ? CAL_INTERVIEW_EVENT_TYPE_TITLE
      : `Interview ${params.durationMinutes} min`;
  const desiredSlug =
    params.durationMinutes === 30
      ? CAL_INTERVIEW_EVENT_TYPE_SLUG
      : `interview-${params.durationMinutes}-min`;
  const envEventTypeId = parseCalEnvEventTypeId();

  const listUrl = new URL('/v2/event-types', CAL_COM_API_BASE_URL);
  listUrl.searchParams.set('limit', '100');

  const listResponse = await fetch(listUrl.toString(), {
    headers: withCalHeaders(params.accessToken),
  });

  if (!listResponse.ok) {
    const details = await listResponse.text();
    throw new Error(`Failed to list Cal event types (${listResponse.status}): ${details}`);
  }

  const listPayload = (await listResponse.json()) as unknown;
  const allEventTypeRecords = collectCalEventTypeRecords(listPayload);
  const profile = await fetchCalProfile(params.accessToken);

  const resolveIdentity = (record: Record<string, unknown>): CalEventTypeIdentity => {
    const parsed = parseEventTypeIdentity(record);

    const identity = {
      ...parsed,
      username: parsed.username ?? CAL_USERNAME_OVERRIDE ?? profile.username,
      teamSlug: parsed.teamSlug ?? CAL_TEAM_SLUG_OVERRIDE ?? profile.teamSlug,
      organizationSlug:
        parsed.organizationSlug ?? CAL_ORGANIZATION_SLUG_OVERRIDE ?? profile.organizationSlug,
    };

    return {
      ...identity,
      bookingUrl: buildCalBookingUrl(identity),
    };
  };

  if (envEventTypeId) {
    const directMatch = allEventTypeRecords.find((record) => parseEventTypeIdentity(record).id === envEventTypeId);
    if (directMatch) {
      return resolveIdentity(directMatch);
    }
  }

  const exactSlugMatch = allEventTypeRecords.find((record) => {
    const identity = parseEventTypeIdentity(record);
    const lengthMinutes = parseLengthMinutes(record);
    return identity.slug === desiredSlug && lengthMinutes === params.durationMinutes;
  });

  if (exactSlugMatch) {
    return resolveIdentity(exactSlugMatch);
  }

  const durationMatch = allEventTypeRecords.find((record) => parseLengthMinutes(record) === params.durationMinutes);
  if (durationMatch) {
    return resolveIdentity(durationMatch);
  }

  const createUrl = new URL('/v2/event-types', CAL_COM_API_BASE_URL).toString();
  const candidatePayloads: Array<Record<string, unknown>> = [
    {
      title: desiredTitle,
      slug: desiredSlug,
      lengthInMinutes: params.durationMinutes,
      description: 'Interview event type created by Headhunt scheduling panel.',
    },
    {
      title: desiredTitle,
      slug: desiredSlug,
      length: params.durationMinutes,
      description: 'Interview event type created by Headhunt scheduling panel.',
    },
  ];

  let lastCreateFailure = 'Unknown event type create failure.';

  for (const payload of candidatePayloads) {
    const response = await fetch(createUrl, {
      method: 'POST',
      headers: withCalHeaders(params.accessToken, true),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      lastCreateFailure = await response.text();
      continue;
    }

    const createPayload = (await response.json()) as unknown;
    const [firstRecord] = collectCalEventTypeRecords(createPayload);
    if (firstRecord) {
      return resolveIdentity(firstRecord);
    }

    const directRecord = asRecord(asRecord(createPayload)?.data);
    if (directRecord) {
      return resolveIdentity(directRecord);
    }
  }

  throw new Error(
    `Unable to ensure Cal event type for ${params.durationMinutes} minutes. Set CAL_INTERVIEW_EVENT_TYPE_ID or CAL_INTERVIEW_EVENT_TYPE_SLUG as a fallback. Last error: ${lastCreateFailure}`,
  );
}

function buildInterviewLinkMessage(params: {
  to: string;
  subject: string;
  candidateName: string;
  jobTitle: string;
  timezone: string;
  schedulingLink: string;
  ranges: SlotRange[];
  customMessage?: string;
}): string {
  const formattedRanges = params.ranges.map((range, index) => `${index + 1}. ${formatRange(range, params.timezone)}`);

  const bodyLines = [
    `Hi ${params.candidateName},`,
    '',
    `Thanks for applying for the ${params.jobTitle} role.`,
    'Please use the scheduling link below to pick your interview time:',
    params.schedulingLink,
    '',
    `Preferred windows from our side (${params.timezone}):`,
    ...formattedRanges,
    '',
    'If none of these windows work, reply with alternatives and we will adjust.',
    params.customMessage?.trim() ? '' : null,
    params.customMessage?.trim() ? params.customMessage.trim() : null,
    '',
    'Thanks,',
    'Headhunt Team',
  ].filter((line): line is string => line !== null);

  return [
    `To: ${params.to}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    `Subject: ${params.subject}`,
    '',
    ...bodyLines,
  ].join('\r\n');
}

async function sendCalLinkEmail(params: {
  candidateEmail: string;
  candidateName: string;
  candidateSourceThreadId: string | null;
  jobTitle: string;
  timezone: string;
  schedulingLink: string;
  ranges: SlotRange[];
  sendMode: 'send' | 'draft';
  customMessage?: string;
}) {
  const accessToken = await getGoogleAccessToken();
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const fallbackSubject = `Interview scheduling link: ${params.jobTitle}`;
  const subject = params.candidateSourceThreadId ? `Re: ${fallbackSubject}` : fallbackSubject;
  const rawMessage = buildInterviewLinkMessage({
    to: params.candidateEmail,
    subject,
    candidateName: params.candidateName,
    jobTitle: params.jobTitle,
    timezone: params.timezone,
    schedulingLink: params.schedulingLink,
    ranges: params.ranges,
    customMessage: params.customMessage,
  });

  const raw = toBase64Url(rawMessage);
  const gmail = google.gmail('v1');

  if (params.sendMode === 'send') {
    const sent = await gmail.users.messages.send({
      auth,
      userId: 'me',
      requestBody: {
        raw,
        ...(params.candidateSourceThreadId ? { threadId: params.candidateSourceThreadId } : {}),
      },
    });

    return {
      mode: 'send' as const,
      providerId: sent.data.id ?? null,
      providerThreadId: sent.data.threadId ?? params.candidateSourceThreadId,
      subject,
    };
  }

  const draft = await gmail.users.drafts.create({
    auth,
    userId: 'me',
    requestBody: {
      message: {
        raw,
        ...(params.candidateSourceThreadId ? { threadId: params.candidateSourceThreadId } : {}),
      },
    },
  });

  return {
    mode: 'draft' as const,
    providerId: draft.data.id ?? draft.data.message?.id ?? null,
    providerThreadId: draft.data.message?.threadId ?? params.candidateSourceThreadId,
    subject,
  };
}

export async function GET(request: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const actorUserId = session.user.sub;
  if (!actorUserId) {
    return NextResponse.json({ message: 'Unauthorized: missing user identity.' }, { status: 401 });
  }

  const parsedQuery = querySchema.safeParse({
    candidateId: request.nextUrl.searchParams.get('candidateId'),
    jobId: request.nextUrl.searchParams.get('jobId'),
    limit: request.nextUrl.searchParams.get('limit') ?? undefined,
  });

  if (!parsedQuery.success) {
    return NextResponse.json(
      {
        message: 'Invalid query parameters.',
        errors: parsedQuery.error.flatten(),
      },
      { status: 400 },
    );
  }

  const canView = await canViewCandidate(actorUserId, parsedQuery.data.candidateId);
  if (!canView) {
    return NextResponse.json({ message: 'Forbidden: candidate is not visible to this user.' }, { status: 403 });
  }

  const rows = await db
    .select()
    .from(founderSlotSelections)
    .where(
      and(
        eq(founderSlotSelections.candidateId, parsedQuery.data.candidateId),
        eq(founderSlotSelections.jobId, parsedQuery.data.jobId),
      ),
    )
    .orderBy(desc(founderSlotSelections.createdAt))
    .limit(parsedQuery.data.limit);

  return NextResponse.json({
    status: 'success',
    candidateId: parsedQuery.data.candidateId,
    jobId: parsedQuery.data.jobId,
    selections: rows,
  });
}

export async function POST(request: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const actorUserId = session.user.sub;
  if (!actorUserId) {
    return NextResponse.json({ message: 'Unauthorized: missing user identity.' }, { status: 401 });
  }

  const actorDisplayName = session.user.name ?? session.user.email ?? actorUserId;

  const payload = await request.json();
  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        message: 'Invalid slot selection payload.',
        errors: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const input = parsed.data;

  let normalizedRanges: SlotRange[];
  try {
    normalizedRanges = normalizeSlotRanges(input.ranges);
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Invalid slot ranges.',
      },
      { status: 400 },
    );
  }

  const [candidate] = await db
    .select({
      id: candidates.id,
      jobId: candidates.jobId,
      name: candidates.name,
      contactEmail: candidates.contactEmail,
      organizationId: candidates.organizationId,
      sourceEmailThreadId: candidates.sourceEmailThreadId,
    })
    .from(candidates)
    .where(eq(candidates.id, input.candidateId))
    .limit(1);

  if (!candidate) {
    return NextResponse.json({ message: `Candidate ${input.candidateId} not found.` }, { status: 404 });
  }

  const canView = await canViewCandidate(actorUserId, candidate.id);
  if (!canView) {
    return NextResponse.json({ message: 'Forbidden: candidate is not visible to this user.' }, { status: 403 });
  }

  if (candidate.jobId !== input.jobId) {
    return NextResponse.json(
      {
        message: `Candidate ${input.candidateId} does not belong to job ${input.jobId}.`,
      },
      { status: 400 },
    );
  }

  const [job] = await db.select({ id: jobs.id, title: jobs.title }).from(jobs).where(eq(jobs.id, input.jobId)).limit(1);
  if (!job) {
    return NextResponse.json({ message: `Job ${input.jobId} not found.` }, { status: 404 });
  }

  const organizationId = input.organizationId ?? candidate.organizationId ?? null;
  const updatedAt = new Date();

  try {
    if (input.action === 'save') {
      const [selection] = await db
        .insert(founderSlotSelections)
        .values({
          organizationId,
          candidateId: input.candidateId,
          jobId: input.jobId,
          actorUserId,
          timezone: input.timezone,
          durationMinutes: input.durationMinutes,
          selectedRanges: normalizedRanges,
          status: 'draft',
          sourceEmailThreadId: candidate.sourceEmailThreadId,
          updatedAt,
        })
        .returning();

      await db.insert(auditLogs).values({
        organizationId,
        actorType: 'user',
        actorId: actorUserId,
        actorDisplayName,
        action: 'interview.cal_ranges.saved',
        resourceType: 'candidate',
        resourceId: input.candidateId,
        metadata: {
          jobId: input.jobId,
          selectionId: selection.id,
          rangeCount: normalizedRanges.length,
          timezone: input.timezone,
          durationMinutes: input.durationMinutes,
        },
        result: 'success',
      });

      return NextResponse.json({
        status: 'success',
        mode: 'save',
        selection,
      });
    }

    const calAccessToken = await getAccessToken();
    const calEventType = await ensureInterviewEventType({
      accessToken: calAccessToken,
      durationMinutes: input.durationMinutes,
    });

    if (!calEventType.bookingUrl) {
      return NextResponse.json(
        {
          message:
            'Unable to derive a public Cal booking URL from the ensured event type. Set CAL_PUBLIC_USERNAME/CAL_PUBLIC_TEAM_SLUG or configure CAL_INTERVIEW_EVENT_TYPE_ID.',
        },
        { status: 400 },
      );
    }

    const emailResult = await sendCalLinkEmail({
      candidateEmail: candidate.contactEmail,
      candidateName: candidate.name,
      candidateSourceThreadId: candidate.sourceEmailThreadId ?? null,
      jobTitle: job.title,
      timezone: input.timezone,
      schedulingLink: calEventType.bookingUrl,
      ranges: normalizedRanges,
      sendMode: input.sendMode,
      customMessage: input.customMessage,
    });

    const [selection] = await db
      .insert(founderSlotSelections)
      .values({
        organizationId,
        candidateId: input.candidateId,
        jobId: input.jobId,
        actorUserId,
        timezone: input.timezone,
        durationMinutes: input.durationMinutes,
        selectedRanges: normalizedRanges,
        calEventTypeId: calEventType.id,
        calEventTypeSlug: calEventType.slug,
        calOwnerUsername: calEventType.username,
        calTeamSlug: calEventType.teamSlug,
        calOrganizationSlug: calEventType.organizationSlug,
        calBookingUrl: calEventType.bookingUrl,
        sourceEmailThreadId: candidate.sourceEmailThreadId,
        proposalProviderId: emailResult.providerId,
        proposalProviderThreadId: emailResult.providerThreadId,
        status: emailResult.mode === 'send' ? 'sent' : 'drafted',
        updatedAt,
      })
      .returning();

    await db.insert(auditLogs).values({
      organizationId,
      actorType: 'user',
      actorId: actorUserId,
      actorDisplayName,
      action: emailResult.mode === 'send' ? 'interview.cal_link.sent' : 'interview.cal_link.drafted',
      resourceType: 'candidate',
      resourceId: input.candidateId,
      metadata: {
        jobId: input.jobId,
        selectionId: selection.id,
        rangeCount: normalizedRanges.length,
        timezone: input.timezone,
        durationMinutes: input.durationMinutes,
        calEventTypeId: calEventType.id,
        calEventTypeSlug: calEventType.slug,
        calBookingUrl: calEventType.bookingUrl,
        providerId: emailResult.providerId,
        providerThreadId: emailResult.providerThreadId,
        sourceEmailThreadId: candidate.sourceEmailThreadId,
      },
      result: 'success',
    });

    return NextResponse.json({
      status: 'success',
      mode: 'save_and_send',
      selection,
      cal: {
        eventTypeId: calEventType.id,
        eventTypeSlug: calEventType.slug,
        username: calEventType.username,
        teamSlug: calEventType.teamSlug,
        organizationSlug: calEventType.organizationSlug,
        bookingUrl: calEventType.bookingUrl,
      },
      email: {
        mode: emailResult.mode,
        providerId: emailResult.providerId,
        providerThreadId: emailResult.providerThreadId,
        subject: emailResult.subject,
      },
    });
  } catch (error) {
    if (error instanceof TokenVaultError) {
      return NextResponse.json(
        {
          message: error.message,
          code: 'TOKEN_VAULT_AUTH_REQUIRED',
        },
        { status: 401 },
      );
    }

    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Unknown error while saving founder slot selection.',
      },
      { status: 500 },
    );
  }
}