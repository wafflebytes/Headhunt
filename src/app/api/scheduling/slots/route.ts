import { NextRequest, NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { auth0 } from '@/lib/auth0';
import { CAL_COM_API_BASE_URL, CAL_SLOTS_API_VERSION } from '@/lib/auth0-ai';
import { db } from '@/lib/db';
import { candidates } from '@/lib/db/schema/candidates';
import { jobs } from '@/lib/db/schema/jobs';
import { canViewCandidate } from '@/lib/fga/fga';
import { calendarSlotsTool } from '@/lib/tools/calendar-slots';

const DEFAULT_TIMEZONE = 'America/Los_Angeles';
const DEFAULT_DURATION_MINUTES = 30;

const requestSchema = z.object({
  candidateId: z.string().min(1),
  jobId: z.string().min(1),
  provider: z.enum(['google', 'cal']),
  timezone: z.string().min(1).optional().default(DEFAULT_TIMEZONE),
  durationMinutes: z.number().int().min(15).max(180).optional().default(DEFAULT_DURATION_MINUTES),
});

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-') || 'job'
  );
}

function extractSuffixFromJobSlug(value: string): string | null {
  const normalized = value.trim();
  const parts = normalized.split('-').filter(Boolean);
  const suffix = parts.at(-1) ?? '';
  if (suffix.length !== 6) {
    return null;
  }

  if (!/^[a-z0-9]{6}$/i.test(suffix)) {
    return null;
  }

  return suffix;
}

async function resolveJobId(jobIdOrSlug: string): Promise<string | null> {
  const normalized = jobIdOrSlug.trim();
  if (!normalized) return null;

  const [direct] = await db.select({ id: jobs.id, title: jobs.title }).from(jobs).where(eq(jobs.id, normalized)).limit(1);
  if (direct?.id) {
    return direct.id;
  }

  const suffix = extractSuffixFromJobSlug(normalized);
  if (!suffix) {
    return null;
  }

  const candidates = await db
    .select({ id: jobs.id, title: jobs.title })
    .from(jobs)
    .where(sql`right(${jobs.id}, 6) = ${suffix}`)
    .limit(10);

  if (candidates.length === 0) {
    return null;
  }

  const exact = candidates.find((row: { id: string; title: string }) => `${slugify(row.title)}-${row.id.slice(-6)}` === normalized);
  if (exact?.id) {
    return exact.id;
  }

  if (candidates.length === 1) {
    return candidates[0]?.id ?? null;
  }

  return null;
}

type CalPublicSlot = { startISO: string; endISO: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function toIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function parseCalPublicSlots(payload: unknown): CalPublicSlot[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data);

  if (!data) {
    return [];
  }

  const slots: CalPublicSlot[] = [];

  for (const dayKey of Object.keys(data).sort()) {
    const daySlots = data[dayKey];
    if (!Array.isArray(daySlots)) {
      continue;
    }

    for (const rawSlot of daySlots) {
      const slot = asRecord(rawSlot);
      if (!slot) {
        continue;
      }

      const startISO = toIso(slot.start);
      const endISO = toIso(slot.end);

      if (!startISO || !endISO) {
        continue;
      }

      slots.push({ startISO, endISO });
    }
  }

  return slots.sort((a, b) => new Date(a.startISO).getTime() - new Date(b.startISO).getTime());
}

function getLocalDateISO(dateISO: string, timezone: string): string {
  const date = new Date(dateISO);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function formatSlotLabel(startISO: string, endISO: string, timezone: string): string {
  const start = new Date(startISO);
  const end = new Date(endISO);

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

function selectSlotsAcrossDays(params: {
  slots: Array<{ startISO: string; endISO: string }>;
  timezone: string;
  targetDayCount: number;
  slotsPerDay: number;
  maxSlots: number;
}) {
  const byDay = new Map<string, Array<{ startISO: string; endISO: string }>>();

  for (const slot of params.slots) {
    const dayKey = getLocalDateISO(slot.startISO, params.timezone);
    const existing = byDay.get(dayKey) ?? [];
    if (existing.length < params.slotsPerDay) {
      existing.push(slot);
      byDay.set(dayKey, existing);
    }
  }

  const selectedDays = Array.from(byDay.keys()).sort().slice(0, params.targetDayCount);
  const selected: Array<{ startISO: string; endISO: string }> = [];

  for (const dayKey of selectedDays) {
    selected.push(...(byDay.get(dayKey) ?? []));
    if (selected.length >= params.maxSlots) {
      break;
    }
  }

  return selected.slice(0, params.maxSlots);
}

export async function POST(req: NextRequest) {
  const session = await auth0.getSession();
  const actorUserId = session?.user?.sub ?? null;

  if (!actorUserId) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  let parsedBody: z.infer<typeof requestSchema>;
  try {
    parsedBody = requestSchema.parse(await req.json());
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Invalid request body.' },
      { status: 400 },
    );
  }

  const [candidate] = await db
    .select({
      id: candidates.id,
      jobId: candidates.jobId,
    })
    .from(candidates)
    .where(eq(candidates.id, parsedBody.candidateId))
    .limit(1);

  if (!candidate) {
    return NextResponse.json({ message: `Candidate ${parsedBody.candidateId} not found.` }, { status: 404 });
  }

  const canView = await canViewCandidate(actorUserId, parsedBody.candidateId);
  if (!canView) {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }

  const resolvedJobId = (await resolveJobId(parsedBody.jobId)) ?? candidate.jobId;
  if (!resolvedJobId) {
    return NextResponse.json({ message: `Job ${parsedBody.jobId} not found.` }, { status: 404 });
  }

  const [job] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, resolvedJobId)).limit(1);
  if (!job) {
    return NextResponse.json({ message: `Job ${parsedBody.jobId} not found.` }, { status: 404 });
  }

  const now = new Date();
  const windowStartISO = now.toISOString();
  const windowEndISO = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();

  if (parsedBody.provider === 'google') {
    const execute = calendarSlotsTool.execute;
    if (!execute) {
      return NextResponse.json(
        { check: 'calendar_slots', status: 'error', message: 'calendarSlotsTool is not executable.' },
        { status: 500 },
      );
    }

    const result = await execute(
      {
        actorUserId,
        calendarId: 'primary',
        windowStartISO,
        windowEndISO,
        timezone: parsedBody.timezone,
        durationMinutes: parsedBody.durationMinutes,
        slotIntervalMinutes: 30,
        targetDayCount: 3,
        slotsPerDay: 2,
        maxSlots: 6,
      },
      {} as any,
    );

    return NextResponse.json(result);
  }

  const eventTypeSlug = process.env.CAL_INTERVIEW_EVENT_TYPE_SLUG?.trim() || '30min';
  const username = process.env.CAL_PUBLIC_USERNAME?.trim() || null;
  const teamSlug = process.env.CAL_PUBLIC_TEAM_SLUG?.trim() || null;
  const organizationSlug = process.env.CAL_PUBLIC_ORGANIZATION_SLUG?.trim() || null;

  if (!username && !teamSlug && !organizationSlug) {
    return NextResponse.json(
      {
        check: 'cal_slots',
        status: 'error',
        message:
          'Missing Cal public identity. Set CAL_PUBLIC_USERNAME or CAL_PUBLIC_TEAM_SLUG or CAL_PUBLIC_ORGANIZATION_SLUG.',
      },
      { status: 400 },
    );
  }

  const url = new URL('/v2/slots', CAL_COM_API_BASE_URL);
  url.searchParams.set('eventTypeSlug', eventTypeSlug);
  url.searchParams.set('start', windowStartISO);
  url.searchParams.set('end', windowEndISO);
  url.searchParams.set('timeZone', parsedBody.timezone);
  url.searchParams.set('format', 'range');

  if (username) url.searchParams.set('username', username);
  if (teamSlug) url.searchParams.set('teamSlug', teamSlug);
  if (organizationSlug) url.searchParams.set('organizationSlug', organizationSlug);

  const response = await fetch(url.toString(), {
    headers: {
      'cal-api-version': CAL_SLOTS_API_VERSION,
    },
  });

  if (!response.ok) {
    const details = await response.text();
    return NextResponse.json(
      {
        check: 'cal_slots',
        status: 'error',
        message: `Failed to fetch Cal slots (${response.status}): ${details}`,
      },
      { status: 500 },
    );
  }

  const payload = (await response.json()) as unknown;
  const allSlots = parseCalPublicSlots(payload);

  const selected = selectSlotsAcrossDays({
    slots: allSlots,
    timezone: parsedBody.timezone,
    targetDayCount: 3,
    slotsPerDay: 2,
    maxSlots: 6,
  });

  const slots = selected.map((slot) => ({
    startISO: slot.startISO,
    endISO: slot.endISO,
    dateISO: getLocalDateISO(slot.startISO, parsedBody.timezone),
    displayLabel: formatSlotLabel(slot.startISO, slot.endISO, parsedBody.timezone),
  }));

  return NextResponse.json({
    check: 'cal_slots',
    status: 'success',
    provider: 'cal',
    windowStartISO,
    windowEndISO,
    timezone: parsedBody.timezone,
    durationMinutes: parsedBody.durationMinutes,
    slotCount: slots.length,
    daysCovered: Array.from(new Set(slots.map((slot) => slot.dateISO))).length,
    slots,
  });
}
