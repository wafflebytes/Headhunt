import { tool } from 'ai';
import { GaxiosError } from 'gaxios';
import { google } from 'googleapis';
import { z } from 'zod';
import { TokenVaultError } from '@auth0/ai/interrupts';

import { auth0 } from '@/lib/auth0';
import { getGoogleAccessToken, withCalendar } from '@/lib/auth0-ai';

type TimeRange = {
  start: Date;
  end: Date;
};

function toRange(startISO: string, endISO: string): TimeRange {
  return { start: new Date(startISO), end: new Date(endISO) };
}

function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function alignToSlotInterval(date: Date, slotIntervalMinutes: number): Date {
  const ms = date.getTime();
  const intervalMs = slotIntervalMinutes * 60_000;
  const aligned = Math.ceil(ms / intervalMs) * intervalMs;
  return new Date(aligned);
}

function getTimezoneAbbreviation(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'short',
    }).formatToParts(new Date());

    return parts.find((part) => part.type === 'timeZoneName')?.value || timezone;
  } catch {
    return timezone;
  }
}

function makeLabel(start: Date, end: Date, timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    });

    const tzLabel = getTimezoneAbbreviation(timezone);
    return `${formatter.format(start)} - ${formatter.format(end)} ${tzLabel}`;
  } catch {
    return `${start.toISOString()} - ${end.toISOString()}`;
  }
}

function getLocalDateISO(date: Date, timezone: string): string {
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

async function collectBusyRanges(params: {
  auth: any;
  timeMin: string;
  timeMax: string;
  calendarId: string;
}): Promise<TimeRange[]> {
  const calendar = google.calendar('v3');

  const allBusy: TimeRange[] = [];
  let pageToken: string | undefined;

  do {
    const response = await calendar.events.list({
      auth: params.auth,
      calendarId: params.calendarId,
      timeMin: params.timeMin,
      timeMax: params.timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      showDeleted: false,
      maxResults: 2500,
      pageToken,
    });

    const events = response.data.items ?? [];

    for (const event of events) {
      if (event.status === 'cancelled') continue;

      const start = event.start?.dateTime ?? event.start?.date;
      const end = event.end?.dateTime ?? event.end?.date;
      if (!start || !end) continue;

      allBusy.push(toRange(start, end));
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return allBusy.sort((a, b) => a.start.getTime() - b.start.getTime());
}

function computeAvailableSlotsAcrossDays(params: {
  windowStart: Date;
  windowEnd: Date;
  busyRanges: TimeRange[];
  durationMinutes: number;
  slotIntervalMinutes: number;
  timezone: string;
  targetDayCount: number;
  slotsPerDay: number;
  maxSlots: number;
}) {
  const slots: Array<{ startISO: string; endISO: string; displayLabel: string; dateISO: string }> = [];

  const slotsByDay = new Map<string, number>();

  let cursor = alignToSlotInterval(params.windowStart, params.slotIntervalMinutes);

  while (cursor < params.windowEnd && slots.length < params.maxSlots) {
    const slotEnd = addMinutes(cursor, params.durationMinutes);
    if (slotEnd > params.windowEnd) break;

    const candidateRange = { start: cursor, end: slotEnd };
    const blocked = params.busyRanges.some((busy) => overlaps(candidateRange, busy));

    if (!blocked) {
      const dateISO = getLocalDateISO(cursor, params.timezone);
      const countForDay = slotsByDay.get(dateISO) ?? 0;

      if (countForDay < params.slotsPerDay) {
        slots.push({
          startISO: cursor.toISOString(),
          endISO: slotEnd.toISOString(),
          displayLabel: makeLabel(cursor, slotEnd, params.timezone),
          dateISO,
        });

        slotsByDay.set(dateISO, countForDay + 1);
      }

      if (slotsByDay.size >= params.targetDayCount && slots.length >= params.maxSlots) {
        break;
      }
    }

    cursor = addMinutes(cursor, params.slotIntervalMinutes);
  }

  // Ensure ordering by date/time
  return slots.sort((a, b) => new Date(a.startISO).getTime() - new Date(b.startISO).getTime());
}

const calendarSlotsInputSchema = z.object({
  actorUserId: z.string().min(1).optional(),
  calendarId: z.string().min(1).default('primary'),
  windowStartISO: z.string().datetime().optional(),
  windowEndISO: z.string().datetime().optional(),
  timezone: z.string().default('America/Los_Angeles'),
  durationMinutes: z.number().int().min(15).max(180).default(30),
  slotIntervalMinutes: z.number().int().min(15).max(60).default(30),
  targetDayCount: z.number().int().min(1).max(7).default(3),
  slotsPerDay: z.number().int().min(1).max(6).default(2),
  maxSlots: z.number().int().min(1).max(18).default(6),
});

export const calendarSlotsTool = withCalendar(
  tool({
    description:
      'calendar.slots: Find available 30-minute slot suggestions from Google Calendar events (strict output, spans multiple days).',
    inputSchema: calendarSlotsInputSchema,
    execute: async (input) => {
      const actorUserId = input.actorUserId ?? (await auth0.getSession())?.user?.sub ?? null;
      if (!actorUserId) {
        return {
          check: 'calendar_slots',
          status: 'error',
          message: 'Unauthorized: missing actor identity for calendar.slots.',
        };
      }

      const now = new Date();
      const windowStart = input.windowStartISO ? new Date(input.windowStartISO) : now;
      const windowEnd = input.windowEndISO ? new Date(input.windowEndISO) : addMinutes(windowStart, 60 * 24 * 3);

      if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime()) || windowEnd <= windowStart) {
        return {
          check: 'calendar_slots',
          status: 'error',
          message: 'Invalid windowStartISO/windowEndISO; window end must be after start.',
        };
      }

      try {
        const accessToken = await getGoogleAccessToken();
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });

        const busyRanges = await collectBusyRanges({
          auth,
          calendarId: input.calendarId,
          timeMin: windowStart.toISOString(),
          timeMax: windowEnd.toISOString(),
        });

        const slots = computeAvailableSlotsAcrossDays({
          windowStart,
          windowEnd,
          busyRanges,
          durationMinutes: input.durationMinutes,
          slotIntervalMinutes: input.slotIntervalMinutes,
          timezone: input.timezone,
          targetDayCount: input.targetDayCount,
          slotsPerDay: input.slotsPerDay,
          maxSlots: input.maxSlots,
        });

        const daysCovered = Array.from(new Set(slots.map((slot) => slot.dateISO))).length;

        return {
          check: 'calendar_slots',
          status: 'success',
          calendarId: input.calendarId,
          windowStartISO: windowStart.toISOString(),
          windowEndISO: windowEnd.toISOString(),
          timezone: input.timezone,
          durationMinutes: input.durationMinutes,
          slotIntervalMinutes: input.slotIntervalMinutes,
          targetDayCount: input.targetDayCount,
          slotsPerDay: input.slotsPerDay,
          maxSlots: input.maxSlots,
          slotCount: slots.length,
          daysCovered,
          warning:
            daysCovered < input.targetDayCount
              ? `Only found slots covering ${daysCovered}/${input.targetDayCount} distinct day(s) within the requested window.`
              : null,
          slots,
        };
      } catch (error) {
        if (error instanceof GaxiosError && error.status === 401) {
          throw new TokenVaultError('Authorization required to access the Token Vault connection.');
        }

        if (error instanceof TokenVaultError) {
          throw error;
        }

        return {
          check: 'calendar_slots',
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error while computing calendar slots.',
        };
      }
    },
  }),
);
