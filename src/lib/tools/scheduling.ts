import { and, desc, eq, inArray } from 'drizzle-orm';
import { tool } from 'ai';
import { GaxiosError } from 'gaxios';
import { gmail_v1, google } from 'googleapis';
import { z } from 'zod';
import { TokenVaultError } from '@auth0/ai/interrupts';

import { auth0 } from '@/lib/auth0';
import {
  CAL_BOOKINGS_API_VERSION,
  CAL_COM_API_BASE_URL,
  CAL_SLOTS_API_VERSION,
  getGoogleAccessToken,
  withCalendar,
  withGmailRead,
  withGmailWrite,
} from '@/lib/auth0-ai';
import { db } from '@/lib/db';
import { applications } from '@/lib/db/schema/applications';
import { auditLogs } from '@/lib/db/schema/audit-logs';
import { candidates } from '@/lib/db/schema/candidates';
import { interviews } from '@/lib/db/schema/interviews';
import { jobs } from '@/lib/db/schema/jobs';
import { canViewCandidate } from '@/lib/fga/fga';

type TimeRange = {
  start: Date;
  end: Date;
};

const scheduleInterviewSlotsInputSchema = z.object({
  candidateId: z.string().min(1),
  jobId: z.string().min(1),
  organizationId: z.string().optional(),
  actorUserId: z.string().min(1).optional(),
  windowStartISO: z.string().datetime().optional(),
  windowEndISO: z.string().datetime().optional(),
  durationMinutes: z.number().int().min(15).max(180).default(60),
  slotIntervalMinutes: z.number().int().min(15).max(60).default(30),
  maxSuggestions: z.number().int().min(1).max(15).default(5),
  selectedStartISO: z.string().datetime().optional(),
  timezone: z.string().default('UTC'),
});

const parseCandidateAvailabilityInputSchema = z.object({
  availabilityText: z.string().min(1),
  candidateId: z.string().min(1).optional(),
  organizationId: z.string().optional(),
  actorUserId: z.string().min(1).optional(),
  referenceDateISO: z.string().datetime().optional(),
  timezone: z.string().default('UTC'),
});

const sendInterviewConfirmationInputSchema = z.object({
  interviewId: z.string().min(1).optional(),
  candidateId: z.string().min(1),
  jobId: z.string().min(1),
  organizationId: z.string().optional(),
  actorUserId: z.string().min(1).optional(),
  subject: z.string().min(1).optional(),
  customMessage: z.string().min(1).optional(),
  sendMode: z.enum(['draft', 'send']).default('draft'),
  timezone: z.string().default('UTC'),
});

const sendInterviewProposalInputSchema = z.object({
  candidateId: z.string().min(1),
  jobId: z.string().min(1),
  organizationId: z.string().optional(),
  actorUserId: z.string().min(1).optional(),
  subject: z.string().min(1).optional(),
  customMessage: z.string().min(1).optional(),
  schedulingLink: z.string().url().optional(),
  proposedTimes: z.array(z.string().min(1)).min(1).max(6).optional(),
  useCalendarAvailability: z.boolean().default(true),
  replyOnApplicationThread: z.boolean().default(true),
  windowStartISO: z.string().datetime().optional(),
  windowEndISO: z.string().datetime().optional(),
  durationMinutes: z.number().int().min(15).max(180).default(60),
  slotIntervalMinutes: z.number().int().min(15).max(60).default(30),
  maxSuggestions: z.number().int().min(1).max(6).default(3),
  sendMode: z.enum(['draft', 'send']).default('draft'),
  timezone: z.string().default('America/Los_Angeles'),
});

const analyzeCandidateSchedulingReplyInputSchema = z.object({
  candidateId: z.string().min(1),
  jobId: z.string().min(1).optional(),
  organizationId: z.string().optional(),
  actorUserId: z.string().min(1).optional(),
  timezone: z.string().default('America/Los_Angeles'),
  threadId: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
  lookbackDays: z.number().int().min(1).max(30).default(14),
  maxResults: z.number().int().min(1).max(25).default(10),
});

const runFinalScheduleFlowInputSchema = z.object({
  candidateId: z.string().min(1),
  jobId: z.string().min(1),
  organizationId: z.string().optional(),
  actorUserId: z.string().min(1).optional(),
  action: z.enum(['auto', 'request_candidate_windows', 'book_from_reply']).default('auto'),
  sendMode: z.enum(['draft', 'send']).default('send'),
  timezone: z.string().default('America/Los_Angeles'),
  durationMinutes: z.number().int().min(15).max(180).default(30),
  preferredWeekdays: z.array(z.string().min(2).max(16)).max(7).optional(),
  targetDayCount: z.number().int().min(1).max(7).default(3),
  slotsPerDay: z.number().int().min(1).max(6).default(1),
  maxSlotsToEmail: z.number().int().min(1).max(12).default(3),
  lookbackDays: z.number().int().min(1).max(30).default(14),
  maxResults: z.number().int().min(1).max(25).default(10),
  threadId: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
  eventTypeSlug: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  teamSlug: z.string().min(1).optional(),
  organizationSlug: z.string().min(1).optional(),
  windowStartISO: z.string().min(1).optional(),
  windowEndISO: z.string().min(1).optional(),
  customMessage: z.string().min(1).max(2000).optional(),
});

type ProposalSlotOption = {
  option: number;
  startISO: string;
  endISO: string;
  displayLabel: string;
};

const WEEKDAY_NAME_TO_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const WEEKDAY_ALIASES: Record<string, string> = {
  sun: 'sunday',
  sunday: 'sunday',
  mon: 'monday',
  monday: 'monday',
  tue: 'tuesday',
  tues: 'tuesday',
  tuesday: 'tuesday',
  wed: 'wednesday',
  weds: 'wednesday',
  wednesday: 'wednesday',
  thu: 'thursday',
  thur: 'thursday',
  thurs: 'thursday',
  thursday: 'thursday',
  fri: 'friday',
  friday: 'friday',
  sat: 'saturday',
  saturday: 'saturday',
};

const TIMEZONE_ALIASES: Record<string, string> = {
  PT: 'America/Los_Angeles',
  PST: 'America/Los_Angeles',
  PDT: 'America/Los_Angeles',
  MT: 'America/Denver',
  MST: 'America/Denver',
  MDT: 'America/Denver',
  CT: 'America/Chicago',
  CST: 'America/Chicago',
  CDT: 'America/Chicago',
  ET: 'America/New_York',
  EST: 'America/New_York',
  EDT: 'America/New_York',
  UTC: 'UTC',
};

type ParsedAvailabilityWindow = {
  weekday: string;
  dateISO: string;
  startTimeLocal: string;
  endTimeLocal: string;
  startMinutes: number;
  endMinutes: number;
  timezone: string;
  source: string;
};

function normalizeWeekday(value: string): string | null {
  const key = value.trim().toLowerCase();
  return WEEKDAY_ALIASES[key] ?? null;
}

function normalizeTimezone(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return 'UTC';
  }

  return TIMEZONE_ALIASES[normalized.toUpperCase()] ?? normalized;
}

function toMinutes(params: {
  hourText: string;
  minuteText?: string;
  meridiem: 'am' | 'pm';
}): number | null {
  const hour = Number.parseInt(params.hourText, 10);
  const minute = params.minuteText ? Number.parseInt(params.minuteText, 10) : 0;

  if (!Number.isInteger(hour) || hour < 1 || hour > 12) {
    return null;
  }

  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }

  const normalizedHour = params.meridiem === 'am' ? hour % 12 : (hour % 12) + 12;
  return normalizedHour * 60 + minute;
}

function formatMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(minutes, 24 * 60 - 1));
  const hours24 = Math.floor(clamped / 60);
  const mins = clamped % 60;
  const meridiem = hours24 >= 12 ? 'PM' : 'AM';
  const hour12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hour12.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')} ${meridiem}`;
}

function nextWeekdayDateISO(weekday: string, referenceDate: Date): string {
  const weekdayIndex = WEEKDAY_NAME_TO_INDEX[weekday];
  const base = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()));
  const currentIndex = base.getUTCDay();
  const deltaDays = (weekdayIndex - currentIndex + 7) % 7;
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
}

function parseAvailabilityWindows(params: {
  availabilityText: string;
  defaultTimezone: string;
  referenceDate: Date;
}): { windows: ParsedAvailabilityWindow[]; detectedTimezone: string } {
  const windows: ParsedAvailabilityWindow[] = [];
  const pattern =
    /\b(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday|s)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)\b[^\n\r\d]{0,12}(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*(PT|PST|PDT|MT|MST|MDT|CT|CST|CDT|ET|EST|EDT|UTC))?/gi;

  let detectedTimezone = normalizeTimezone(params.defaultTimezone);
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(params.availabilityText)) !== null) {
    const weekday = normalizeWeekday(match[1] ?? '');
    if (!weekday) {
      continue;
    }

    const startMeridiemRaw = (match[4] ?? '').toLowerCase();
    const endMeridiemRaw = (match[7] ?? '').toLowerCase();
    const resolvedEndMeridiem: 'am' | 'pm' = endMeridiemRaw === 'am' ? 'am' : 'pm';
    const resolvedStartMeridiem: 'am' | 'pm' = startMeridiemRaw === 'am' || startMeridiemRaw === 'pm' ? (startMeridiemRaw as 'am' | 'pm') : resolvedEndMeridiem;

    const startMinutes = toMinutes({
      hourText: match[2] ?? '',
      minuteText: match[3] ?? undefined,
      meridiem: resolvedStartMeridiem,
    });
    const endMinutes = toMinutes({
      hourText: match[5] ?? '',
      minuteText: match[6] ?? undefined,
      meridiem: resolvedEndMeridiem,
    });

    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
      continue;
    }

    const timezoneText = match[8] ?? '';
    const timezone = timezoneText ? normalizeTimezone(timezoneText) : detectedTimezone;
    detectedTimezone = timezone;

    const source = match[0]?.trim() ?? '';
    windows.push({
      weekday,
      dateISO: nextWeekdayDateISO(weekday, params.referenceDate),
      startTimeLocal: formatMinutes(startMinutes),
      endTimeLocal: formatMinutes(endMinutes),
      startMinutes,
      endMinutes,
      timezone,
      source,
    });
  }

  return {
    windows,
    detectedTimezone,
  };
}

function toRange(startISO: string, endISO: string): TimeRange {
  const start = new Date(startISO);
  const end = new Date(endISO);
  return { start, end };
}

function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function alignToSlotInterval(date: Date, slotIntervalMinutes: number): Date {
  const intervalMs = Math.max(1, slotIntervalMinutes) * 60_000;
  const alignedMs = Math.ceil(date.getTime() / intervalMs) * intervalMs;
  return new Date(alignedMs);
}

function makeLabel(start: Date, end: Date, timezone: string): string {
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
}

function isAuthorizationError(error: unknown): boolean {
  if (!(error instanceof GaxiosError)) {
    return false;
  }

  return error.status === 401 || error.status === 403;
}

function isInsufficientScopeError(error: unknown): boolean {
  if (!(error instanceof GaxiosError)) {
    return false;
  }

  const message = `${error.message ?? ''}`.toLowerCase();
  return (
    message.includes('insufficient authentication scopes') ||
    message.includes('insufficientpermissions') ||
    message.includes('insufficient permissions')
  );
}

function isGoogleIdentityMismatchError(error: unknown): error is TokenVaultError {
  return (
    error instanceof TokenVaultError &&
    typeof error.message === 'string' &&
    error.message.includes('does not match your signed-in account')
  );
}

function isGoogleVerificationError(error: unknown): error is TokenVaultError {
  return (
    error instanceof TokenVaultError &&
    typeof error.message === 'string' &&
    error.message.includes('Unable to verify the connected Google account')
  );
}

function isMissingRefreshTokenError(error: unknown): error is TokenVaultError {
  return (
    error instanceof TokenVaultError &&
    typeof error.message === 'string' &&
    /missing refresh token|refresh token not found|refresh token flow.*federated connection.*failed|offline access|cannot read properties of undefined \(reading ['\"]access_token['\"]\)|invalid_request.*access_token|not supported jwt type in subject token/i.test(
      error.message,
    )
  );
}

async function collectBusyRanges(params: {
  auth: any;
  timeMin: string;
  timeMax: string;
  calendarIds: string[];
}): Promise<TimeRange[]> {
  const calendar = google.calendar('v3');
  const allBusy: TimeRange[] = [];

  // Use events.list to derive busy windows so scheduling works with the same
  // Calendar scope profile already validated by connection diagnostics.
  for (const calendarId of params.calendarIds) {
    let pageToken: string | undefined;

    do {
      const eventsResponse = await calendar.events.list({
        auth: params.auth,
        calendarId,
        timeMin: params.timeMin,
        timeMax: params.timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        showDeleted: false,
        maxResults: 2500,
        pageToken,
      });

      const events = eventsResponse.data.items ?? [];

      for (const event of events) {
        if (event.status === 'cancelled') {
          continue;
        }

        const start = event.start?.dateTime ?? event.start?.date;
        const end = event.end?.dateTime ?? event.end?.date;

        if (!start || !end) {
          continue;
        }

        allBusy.push(toRange(start, end));
      }

      pageToken = eventsResponse.data.nextPageToken ?? undefined;
    } while (pageToken);
    }

  return allBusy.sort((a, b) => a.start.getTime() - b.start.getTime());
}

function computeAvailableSlots(params: {
  windowStart: Date;
  windowEnd: Date;
  busyRanges: TimeRange[];
  durationMinutes: number;
  slotIntervalMinutes: number;
  maxSuggestions: number;
  timezone: string;
}) {
  const slots: Array<{ startISO: string; endISO: string; displayLabel: string }> = [];

  let cursor = alignToSlotInterval(params.windowStart, params.slotIntervalMinutes);

  while (cursor < params.windowEnd && slots.length < params.maxSuggestions) {
    const slotEnd = addMinutes(cursor, params.durationMinutes);
    if (slotEnd > params.windowEnd) {
      break;
    }

    const candidateRange = { start: cursor, end: slotEnd };
    const blocked = params.busyRanges.some((busy) => overlaps(candidateRange, busy));

    if (!blocked) {
      slots.push({
        startISO: cursor.toISOString(),
        endISO: slotEnd.toISOString(),
        displayLabel: makeLabel(cursor, slotEnd, params.timezone),
      });
    }

    cursor = addMinutes(cursor, params.slotIntervalMinutes);
  }

  return slots;
}

function buildProposalResponse(params: {
  input: z.infer<typeof scheduleInterviewSlotsInputSchema>;
  slots: Array<{ startISO: string; endISO: string; displayLabel: string }>;
  candidateId: string;
  jobId: string;
  recovery?: {
    reason: string;
    message: string;
    requestedSelectedStartISO?: string;
  };
}) {
  return {
    check: 'schedule_interview_slots' as const,
    status: 'success' as const,
    mode: 'propose' as const,
    candidateId: params.candidateId,
    jobId: params.jobId,
    durationMinutes: params.input.durationMinutes,
    slots: params.slots,
    recommendedSlotIndex: params.slots.length > 0 ? 0 : -1,
    recovery: params.recovery,
  };
}

function toBase64Url(value: string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function getTimezoneAbbreviation(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'short',
    }).formatToParts(new Date());

    const label = parts.find((part) => part.type === 'timeZoneName')?.value;
    return label || timezone;
  } catch {
    return timezone;
  }
}

function defaultInterviewProposalTimes(timezone: string): string[] {
  const tzLabel = getTimezoneAbbreviation(timezone);
  return [
    `Tuesday 11:00 AM ${tzLabel}`,
    `Wednesday 2:00 PM ${tzLabel}`,
    `Thursday 10:30 AM ${tzLabel}`,
  ];
}

function isIsoDateTimeString(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (!/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    return false;
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed);
}

function normalizeManualProposalTimes(params: {
  proposedTimes: string[];
  durationMinutes: number;
  timezone: string;
}): {
  proposedTimes: string[];
  slotOptions: ProposalSlotOption[];
  normalizedFromIso: boolean;
} {
  const normalizedInput = params.proposedTimes.map((time) => time.trim()).filter(Boolean).slice(0, 6);

  const allIso = normalizedInput.length > 0 && normalizedInput.every((time) => isIsoDateTimeString(time));
  if (!allIso) {
    return {
      proposedTimes: normalizedInput,
      slotOptions: [],
      normalizedFromIso: false,
    };
  }

  const slotOptions = normalizedInput.map((time, index) => {
    const start = new Date(time);
    const end = addMinutes(start, params.durationMinutes);

    return {
      option: index + 1,
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      displayLabel: makeLabel(start, end, params.timezone),
    };
  });

  return {
    proposedTimes: slotOptions.map((slot) => slot.displayLabel),
    slotOptions,
    normalizedFromIso: true,
  };
}

function buildInterviewProposalMessage(params: {
  to: string;
  subject: string;
  candidateName: string;
  jobTitle: string;
  proposedTimes: string[];
  timezone: string;
  schedulingLink?: string;
  customMessage?: string;
}): string {
  const hasProposedTimes = params.proposedTimes.length > 0;
  const hasSchedulingLink = Boolean(params.schedulingLink?.trim());

  const bodyLines = [
    `Hi ${params.candidateName},`,
    '',
    `Thanks for applying for the ${params.jobTitle} role.`,
    hasProposedTimes ? `I would like to schedule a first interview. Here are a few options (${params.timezone}):` : null,
    ...(hasProposedTimes ? params.proposedTimes.map((time, index) => `${index + 1}. ${time}`) : []),
    hasSchedulingLink ? '' : null,
    hasSchedulingLink ? `Scheduling link: ${params.schedulingLink!.trim()}` : null,
    '',
    hasProposedTimes
      ? 'Please reply with the option number that works best for you, or share alternate windows.'
      : hasSchedulingLink
        ? 'Please use the scheduling link above to pick a suitable time.'
        : 'Please reply with your preferred interview windows.',
    params.customMessage?.trim() ? '' : null,
    params.customMessage?.trim() ? params.customMessage.trim() : null,
    '',
    'Thanks,',
    'Headhunt Team',
  ].filter((line): line is string => line !== null);

  const lines = [
    `To: ${params.to}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    `Subject: ${params.subject}`,
    '',
    ...bodyLines,
  ];

  return lines.join('\r\n');
}

function buildInterviewConfirmationMessage(params: {
  to: string;
  subject: string;
  candidateName: string;
  jobTitle: string;
  slotLabel: string;
  meetLink: string | null;
  calendarLink: string | null;
  customMessage?: string;
}): string {
  const bodyLines = [
    `Hi ${params.candidateName},`,
    '',
    `This confirms your interview for the ${params.jobTitle} role.`,
    `When: ${params.slotLabel}`,
    params.meetLink ? `Google Meet: ${params.meetLink}` : 'Google Meet: we will share the join link shortly.',
    params.calendarLink ? `Calendar event: ${params.calendarLink}` : null,
    params.customMessage?.trim() ? '' : null,
    params.customMessage?.trim() ? params.customMessage.trim() : null,
    '',
    'Thanks,',
    'Headhunt Team',
  ].filter((line): line is string => line !== null);

  const lines = [
    `To: ${params.to}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    `Subject: ${params.subject}`,
    '',
    ...bodyLines,
  ];

  return lines.join('\r\n');
}

function compactText(value: string, limit = 4000): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, limit);
}

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

function extractEmailAddress(value: string | null | undefined): string | null {
  if (!value) return null;

  const firstEmail = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  return firstEmail ? firstEmail.trim().toLowerCase() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeProposalSlotOptions(value: unknown): ProposalSlotOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: ProposalSlotOption[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;

    const optionRaw = Number(record.option);
    const startISO = asString(record.startISO);
    const endISO = asString(record.endISO);
    const displayLabel = asString(record.displayLabel);

    if (!Number.isInteger(optionRaw) || optionRaw < 1) continue;
    if (!startISO || !endISO || !displayLabel) continue;

    normalized.push({
      option: optionRaw,
      startISO,
      endISO,
      displayLabel,
    });
  }

  return normalized.sort((a, b) => a.option - b.option);
}

function toProposalSlotOptions(
  slots: Array<{ startISO: string; endISO: string; displayLabel: string }>,
): ProposalSlotOption[] {
  return slots.map((slot, index) => ({
    option: index + 1,
    startISO: slot.startISO,
    endISO: slot.endISO,
    displayLabel: slot.displayLabel,
  }));
}

async function loadLatestProposalContext(candidateId: string) {
  const [latestLog] = await db
    .select({
      action: auditLogs.action,
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

  const metadata = asRecord(latestLog.metadata) ?? {};
  const slotOptions = normalizeProposalSlotOptions(metadata.slotOptions);
  const proposedTimes = Array.isArray(metadata.proposedTimes)
    ? metadata.proposedTimes
        .map((value) => asString(value))
        .filter((value): value is string => Boolean(value))
    : [];

  return {
    action: latestLog.action,
    timestamp: latestLog.timestamp?.toISOString() ?? null,
    providerThreadId: asString(metadata.providerThreadId) ?? null,
    subject: asString(metadata.subject) ?? null,
    proposedTimes,
    slotOptions,
  };
}

type CandidateReplyMessage = {
  messageId: string;
  threadId: string | null;
  from: string | null;
  subject: string | null;
  receivedAt: string | null;
  snippet: string;
  body: string;
};

function toCandidateReplyMessage(detail: gmail_v1.Schema$Message): CandidateReplyMessage {
  const payload = detail.payload;
  const from = getHeader(payload, 'From');
  const subject = getHeader(payload, 'Subject');
  const body = compactText(extractPlainTextPart(payload), 8000);

  return {
    messageId: detail.id ?? '',
    threadId: detail.threadId ?? null,
    from,
    subject,
    receivedAt: detail.internalDate ? new Date(Number(detail.internalDate)).toISOString() : null,
    snippet: compactText(detail.snippet ?? '', 600),
    body,
  };
}

async function fetchLatestCandidateReply(params: {
  auth: any;
  candidateEmail: string;
  threadId?: string;
  query?: string;
  lookbackDays: number;
  maxResults: number;
}): Promise<CandidateReplyMessage | null> {
  const gmail = google.gmail('v1');

  if (params.threadId) {
    const thread = await gmail.users.threads.get({
      auth: params.auth,
      userId: 'me',
      id: params.threadId,
      format: 'full',
    });

    const messages = [...(thread.data.messages ?? [])].sort((a, b) => {
      const aTime = Number(a.internalDate ?? 0);
      const bTime = Number(b.internalDate ?? 0);
      return bTime - aTime;
    });

    for (const message of messages) {
      const from = getHeader(message.payload, 'From');
      const fromEmail = extractEmailAddress(from);
      if (fromEmail !== params.candidateEmail) {
        continue;
      }

      return toCandidateReplyMessage(message);
    }
  }

  const query =
    params.query?.trim() || `from:${params.candidateEmail} newer_than:${params.lookbackDays}d`;
  const listed = await gmail.users.messages.list({
    auth: params.auth,
    userId: 'me',
    q: query,
    maxResults: params.maxResults,
  });

  const messages = listed.data.messages ?? [];

  for (const message of messages) {
    if (!message.id) {
      continue;
    }

    const detail = await gmail.users.messages.get({
      auth: params.auth,
      userId: 'me',
      id: message.id,
      format: 'full',
    });

    const from = getHeader(detail.data.payload, 'From');
    const fromEmail = extractEmailAddress(from);
    if (fromEmail !== params.candidateEmail) {
      continue;
    }

    return toCandidateReplyMessage(detail.data);
  }

  return null;
}

function detectSelectedOptionFromReply(text: string, maxOption: number): number | null {
  if (maxOption <= 0) return null;

  const lower = text.toLowerCase();
  const directOption = lower.match(/(?:option|slot)\s*#?\s*(\d{1,2})/i);
  if (directOption) {
    const option = Number.parseInt(directOption[1] ?? '', 10);
    if (Number.isInteger(option) && option >= 1 && option <= maxOption) {
      return option;
    }
  }

  const ordinalOption = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:option|slot)\b/i);
  if (ordinalOption) {
    const option = Number.parseInt(ordinalOption[1] ?? '', 10);
    if (Number.isInteger(option) && option >= 1 && option <= maxOption) {
      return option;
    }
  }

  const bareOption = lower.match(/\b(\d{1,2})\b[^\n]{0,40}\b(work|works|good|fine|okay|ok|confirm|confirmed)\b/i);
  if (bareOption) {
    const option = Number.parseInt(bareOption[1] ?? '', 10);
    if (Number.isInteger(option) && option >= 1 && option <= maxOption) {
      return option;
    }
  }

  return null;
}

function getLocalDateAndMinutes(iso: string, timezone: string) {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const year = Number.parseInt(parts.find((part) => part.type === 'year')?.value ?? '', 10);
  const month = Number.parseInt(parts.find((part) => part.type === 'month')?.value ?? '', 10);
  const day = Number.parseInt(parts.find((part) => part.type === 'day')?.value ?? '', 10);
  const hour = Number.parseInt(parts.find((part) => part.type === 'hour')?.value ?? '', 10);
  const minute = Number.parseInt(parts.find((part) => part.type === 'minute')?.value ?? '', 10);

  const safeYear = Number.isFinite(year) ? year : 1970;
  const safeMonth = Number.isFinite(month) ? month : 1;
  const safeDay = Number.isFinite(day) ? day : 1;
  const safeHour = Number.isFinite(hour) ? hour : 0;
  const safeMinute = Number.isFinite(minute) ? minute : 0;

  return {
    dateISO: `${safeYear.toString().padStart(4, '0')}-${safeMonth
      .toString()
      .padStart(2, '0')}-${safeDay.toString().padStart(2, '0')}`,
    minutes: safeHour * 60 + safeMinute,
  };
}

function findSlotMatchingAvailability(params: {
  slotOptions: ProposalSlotOption[];
  windows: ParsedAvailabilityWindow[];
  defaultTimezone: string;
}): ProposalSlotOption | null {
  for (const slot of params.slotOptions) {
    const timezone = params.windows[0]?.timezone ?? params.defaultTimezone;
    const local = getLocalDateAndMinutes(slot.startISO, timezone);

    const matchingWindow = params.windows.find((window) => {
      if (window.dateISO !== local.dateISO) {
        return false;
      }

      return local.minutes >= window.startMinutes && local.minutes < window.endMinutes;
    });

    if (matchingWindow) {
      return slot;
    }
  }

  return null;
}

type CalPublicSlot = {
  startISO: string;
  endISO: string;
};

const DEFAULT_CAL_EVENT_TYPE_SLUG = process.env.CAL_INTERVIEW_EVENT_TYPE_SLUG?.trim() || '30min';
const DEFAULT_CAL_USERNAME = process.env.CAL_PUBLIC_USERNAME?.trim() || null;
const DEFAULT_CAL_TEAM_SLUG = process.env.CAL_PUBLIC_TEAM_SLUG?.trim() || null;
const DEFAULT_CAL_ORGANIZATION_SLUG = process.env.CAL_PUBLIC_ORGANIZATION_SLUG?.trim() || null;
const DEFAULT_CAL_MEETING_INTEGRATION = process.env.CAL_BOOKING_MEETING_INTEGRATION?.trim() || 'google-meet';

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

function buildCalPublicSlotsUrl(params: {
  eventTypeSlug: string;
  username?: string | null;
  teamSlug?: string | null;
  organizationSlug?: string | null;
  startISO: string;
  endISO: string;
  timezone: string;
}): URL {
  const url = new URL('/v2/slots', CAL_COM_API_BASE_URL);
  url.searchParams.set('eventTypeSlug', params.eventTypeSlug);
  url.searchParams.set('start', params.startISO);
  url.searchParams.set('end', params.endISO);
  url.searchParams.set('timeZone', params.timezone);
  url.searchParams.set('format', 'range');

  if (params.username) {
    url.searchParams.set('username', params.username);
  }

  if (params.teamSlug) {
    url.searchParams.set('teamSlug', params.teamSlug);
  }

  if (params.organizationSlug) {
    url.searchParams.set('organizationSlug', params.organizationSlug);
  }

  return url;
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

      slots.push({
        startISO,
        endISO,
      });
    }
  }

  return slots.sort((a, b) => new Date(a.startISO).getTime() - new Date(b.startISO).getTime());
}

function extractCalBooking(payload: unknown): Record<string, unknown> | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }

  if (Array.isArray(root.data)) {
    const [first] = root.data;
    return asRecord(first);
  }

  return asRecord(root.data);
}

function deriveCalWindowBounds(params: {
  windows: ParsedAvailabilityWindow[];
  windowStartISO?: string;
  windowEndISO?: string;
}): { start: Date; end: Date } {
  if (params.windowStartISO && params.windowEndISO) {
    return {
      start: new Date(params.windowStartISO),
      end: new Date(params.windowEndISO),
    };
  }

  const parsedDates = params.windows
    .map((window) => new Date(`${window.dateISO}T00:00:00.000Z`))
    .filter((value) => !Number.isNaN(value.getTime()));

  if (parsedDates.length === 0) {
    const now = new Date();
    return {
      start: now,
      end: addMinutes(now, 60 * 24 * 7),
    };
  }

  const sorted = parsedDates.sort((a, b) => a.getTime() - b.getTime());
  const minDate = sorted[0];
  const maxDate = sorted[sorted.length - 1];

  return {
    start: new Date(minDate.getTime() - 24 * 60 * 60 * 1000),
    end: new Date(maxDate.getTime() + 2 * 24 * 60 * 60 * 1000),
  };
}

function pickFirstOverlappingCalSlot(params: {
  slots: CalPublicSlot[];
  windows: ParsedAvailabilityWindow[];
  timezone: string;
}): CalPublicSlot | null {
  for (const slot of params.slots) {
    const localStart = getLocalDateAndMinutes(slot.startISO, params.timezone);
    const localEnd = getLocalDateAndMinutes(slot.endISO, params.timezone);

    if (localStart.dateISO !== localEnd.dateISO) {
      continue;
    }

    const matchedWindow = params.windows.find((window) => {
      if (window.dateISO !== localStart.dateISO) {
        return false;
      }

      return localStart.minutes >= window.startMinutes && localEnd.minutes <= window.endMinutes;
    });

    if (matchedWindow) {
      return slot;
    }
  }

  return null;
}

function resolveRequestWindowBounds(params: {
  windowStartISO?: string;
  windowEndISO?: string;
}): { start: Date; end: Date } {
  const start = params.windowStartISO ? new Date(params.windowStartISO) : new Date();
  const end = params.windowEndISO ? new Date(params.windowEndISO) : addMinutes(start, 60 * 24 * 7);

  return { start, end };
}

function normalizePreferredWeekdays(values: string[] | undefined): string[] {
  if (!values || values.length === 0) {
    return [];
  }

  const dedupe = new Set<string>();
  for (const rawValue of values) {
    for (const token of rawValue.split(',')) {
      const normalized = normalizeWeekday(token);
      if (normalized) {
        dedupe.add(normalized);
      }
    }
  }

  return Array.from(dedupe);
}

function getLocalWeekday(iso: string, timezone: string): string {
  const raw = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: timezone,
  })
    .format(new Date(iso))
    .toLowerCase();

  return normalizeWeekday(raw) ?? raw;
}

function selectCalSlotsForCandidateRequest(params: {
  slots: CalPublicSlot[];
  timezone: string;
  preferredWeekdays: string[];
  targetDayCount: number;
  slotsPerDay: number;
  maxSlotsToEmail: number;
}): ProposalSlotOption[] {
  const preferredDays = normalizePreferredWeekdays(params.preferredWeekdays);
  const preferredSet = new Set(preferredDays);

  const filteredByDay =
    preferredSet.size === 0
      ? params.slots
      : params.slots.filter((slot) => preferredSet.has(getLocalWeekday(slot.startISO, params.timezone)));

  if (filteredByDay.length === 0) {
    return [];
  }

  const slotsByDate = new Map<string, CalPublicSlot[]>();
  for (const slot of filteredByDay) {
    const dateISO = getLocalDateAndMinutes(slot.startISO, params.timezone).dateISO;
    const existing = slotsByDate.get(dateISO) ?? [];
    existing.push(slot);
    slotsByDate.set(dateISO, existing);
  }

  const selectedDateKeys = Array.from(slotsByDate.keys()).sort().slice(0, params.targetDayCount);
  const selectedSlots: CalPublicSlot[] = [];

  for (const dateKey of selectedDateKeys) {
    const daySlots = (slotsByDate.get(dateKey) ?? []).slice(0, params.slotsPerDay);
    selectedSlots.push(...daySlots);
    if (selectedSlots.length >= params.maxSlotsToEmail) {
      break;
    }
  }

  return selectedSlots.slice(0, params.maxSlotsToEmail).map((slot, index) => ({
    option: index + 1,
    startISO: slot.startISO,
    endISO: slot.endISO,
    displayLabel: makeLabel(new Date(slot.startISO), new Date(slot.endISO), params.timezone),
  }));
}

function findRequestSlotMatchingWeekdayIntent(params: {
  replyText: string;
  slotOptions: ProposalSlotOption[];
  timezone: string;
}): ProposalSlotOption | null {
  const lower = params.replyText.toLowerCase();
  const mentionedDays = new Set<string>();

  for (const [alias, canonical] of Object.entries(WEEKDAY_ALIASES)) {
    const pattern = new RegExp(`\\b${alias}\\b`, 'i');
    if (pattern.test(lower)) {
      mentionedDays.add(canonical);
    }
  }

  if (mentionedDays.size === 0) {
    return null;
  }

  const matched = params.slotOptions.filter((slot) =>
    mentionedDays.has(getLocalWeekday(slot.startISO, params.timezone)),
  );

  return matched[0] ?? null;
}

type CalSlotsFetchResult =
  | {
      status: 'success';
      slots: CalPublicSlot[];
    }
  | {
      status: 'error';
      message: string;
    };

async function fetchCalPublicSlotsForWindow(params: {
  eventTypeSlug: string;
  username?: string | null;
  teamSlug?: string | null;
  organizationSlug?: string | null;
  startISO: string;
  endISO: string;
  timezone: string;
}): Promise<CalSlotsFetchResult> {
  const slotsUrl = buildCalPublicSlotsUrl({
    eventTypeSlug: params.eventTypeSlug,
    username: params.username,
    teamSlug: params.teamSlug,
    organizationSlug: params.organizationSlug,
    startISO: params.startISO,
    endISO: params.endISO,
    timezone: params.timezone,
  });

  const response = await fetch(slotsUrl.toString(), {
    headers: {
      'cal-api-version': CAL_SLOTS_API_VERSION,
    },
  });

  if (!response.ok) {
    const details = await response.text();
    return {
      status: 'error',
      message: `Failed to fetch Cal slots (${response.status}): ${details}`,
    };
  }

  const payload = (await response.json()) as unknown;
  return {
    status: 'success',
    slots: parseCalPublicSlots(payload),
  };
}

function buildCandidateAvailabilityRequestMessage(params: {
  to: string;
  subject: string;
  candidateName: string;
  jobTitle: string;
  timezone: string;
  durationMinutes: number;
  eventTypeSlug: string;
  slotOptions: ProposalSlotOption[];
  customMessage?: string;
}): string {
  const phrasedOptions = params.slotOptions
    .slice(0, 3)
    .map((slot) => `option ${slot.option} (${slot.displayLabel})`);

  const optionsSentence =
    phrasedOptions.length === 0
      ? ''
      : phrasedOptions.length === 1
        ? phrasedOptions[0]
        : phrasedOptions.length === 2
          ? `${phrasedOptions[0]} or ${phrasedOptions[1]}`
          : `${phrasedOptions.slice(0, -1).join(', ')}, or ${phrasedOptions[phrasedOptions.length - 1]}`;

  const bodyLines = [
    `Hi ${params.candidateName},`,
    '',
    `Thanks for applying for the ${params.jobTitle} role.`,
    `I checked my live Cal.com availability for a ${params.durationMinutes}-minute ${params.eventTypeSlug} session in ${params.timezone}.`,
    optionsSentence ? `I can do ${optionsSentence}.` : null,
    'Please reply with the option number that works best for you, or share an alternate window and I will adjust.',
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

async function loadLatestAvailabilityRequestContext(candidateId: string) {
  const [latestLog] = await db
    .select({
      action: auditLogs.action,
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

  const metadata = asRecord(latestLog.metadata) ?? {};

  return {
    action: latestLog.action,
    timestampISO: latestLog.timestamp?.toISOString() ?? null,
    providerId: asString(metadata.providerId) ?? null,
    providerThreadId: asString(metadata.providerThreadId) ?? null,
    threadId: asString(metadata.threadId) ?? null,
    subject: asString(metadata.subject) ?? null,
    slotOptions: normalizeProposalSlotOptions(metadata.slotOptions),
    preferredWeekdays:
      Array.isArray(metadata.preferredWeekdays)
        ? metadata.preferredWeekdays
            .map((value) => asString(value))
            .filter((value): value is string => Boolean(value))
        : [],
    eventTypeSlug: asString(metadata.eventTypeSlug) ?? null,
    username: asString(metadata.username) ?? null,
    teamSlug: asString(metadata.teamSlug) ?? null,
    organizationSlug: asString(metadata.organizationSlug) ?? null,
  };
}

export const scheduleInterviewSlotsTool = withCalendar(
  tool({
    description:
      'Propose interview slots from Google Calendar availability and optionally schedule the selected slot with persisted interview + stage updates.',
    inputSchema: scheduleInterviewSlotsInputSchema,
    execute: async (input) => {
      const actorUserId = input.actorUserId ?? (await auth0.getSession())?.user?.sub ?? null;

      if (!actorUserId) {
        return {
          check: 'schedule_interview_slots',
          status: 'error',
          message: 'Unauthorized: missing actor identity for scheduling.',
        };
      }

      const [candidate] = await db
        .select({
          id: candidates.id,
          name: candidates.name,
          contactEmail: candidates.contactEmail,
          organizationId: candidates.organizationId,
          jobId: candidates.jobId,
        })
        .from(candidates)
        .where(eq(candidates.id, input.candidateId))
        .limit(1);

      if (!candidate) {
        return {
          check: 'schedule_interview_slots',
          status: 'error',
          message: `Candidate ${input.candidateId} not found.`,
        };
      }

      const canView = await canViewCandidate(actorUserId, candidate.id);
      if (!canView) {
        return {
          check: 'schedule_interview_slots',
          status: 'error',
          message: `Forbidden: no candidate visibility access for ${input.candidateId}. Use a candidate created under your current session (for example from run_intake_e2e).`,
        };
      }

      const [job] = await db.select({ id: jobs.id, title: jobs.title }).from(jobs).where(eq(jobs.id, input.jobId)).limit(1);
      if (!job) {
        return {
          check: 'schedule_interview_slots',
          status: 'error',
          message: `Job ${input.jobId} not found.`,
        };
      }

      const now = new Date();
      const windowStart = input.windowStartISO ? new Date(input.windowStartISO) : now;
      const windowEnd = input.windowEndISO ? new Date(input.windowEndISO) : addMinutes(windowStart, 60 * 24 * 7);

      if (windowEnd <= windowStart) {
        return {
          check: 'schedule_interview_slots',
          status: 'error',
          message: 'Invalid scheduling window: windowEndISO must be after windowStartISO.',
        };
      }

      try {
        const accessToken = await getGoogleAccessToken();
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });

        const busyRanges = await collectBusyRanges({
          auth,
          timeMin: windowStart.toISOString(),
          timeMax: windowEnd.toISOString(),
          calendarIds: ['primary'],
        });

        const slots = computeAvailableSlots({
          windowStart,
          windowEnd,
          busyRanges,
          durationMinutes: input.durationMinutes,
          slotIntervalMinutes: input.slotIntervalMinutes,
          maxSuggestions: input.maxSuggestions,
          timezone: input.timezone,
        });

        if (!input.selectedStartISO) {
          await db.insert(auditLogs).values({
            organizationId: input.organizationId ?? candidate.organizationId ?? null,
            actorType: 'agent',
            actorId: 'schedule_interview_slots',
            actorDisplayName: 'Liaison Agent',
            action: 'interview.slots.proposed',
            resourceType: 'candidate',
            resourceId: input.candidateId,
            metadata: {
              actorUserId,
              jobId: input.jobId,
              durationMinutes: input.durationMinutes,
              slotCount: slots.length,
              windowStartISO: windowStart.toISOString(),
              windowEndISO: windowEnd.toISOString(),
            },
            result: 'success',
          });

          return buildProposalResponse({
            input,
            slots,
            candidateId: input.candidateId,
            jobId: input.jobId,
          });
        }

        const normalizedSelectedStartISO = new Date(input.selectedStartISO).toISOString();
        const selectedStartMs = new Date(normalizedSelectedStartISO).getTime();
        const matchedSlot = slots.find((slot) => {
          const slotStartMs = new Date(slot.startISO).getTime();

          // Allow small second-level drift between propose and confirm calls.
          return Math.abs(slotStartMs - selectedStartMs) <= 60_000;
        });

        if (!matchedSlot) {
          if (slots.length === 0) {
            return {
              check: 'schedule_interview_slots',
              status: 'error',
              message:
                'Selected slot is stale or unavailable, and no alternate slots are currently available. Expand windowStartISO/windowEndISO and retry.',
            };
          }

          return buildProposalResponse({
            input,
            slots,
            candidateId: input.candidateId,
            jobId: input.jobId,
            recovery: {
              reason: 'stale_selected_start_iso',
              message:
                'The requested selectedStartISO is stale or unavailable. Returning a fresh slot proposal list; choose one selectedStartISO to confirm scheduling.',
              requestedSelectedStartISO: normalizedSelectedStartISO,
            },
          });
        }

        const selectedStart = new Date(matchedSlot.startISO);
        const selectedEnd = addMinutes(selectedStart, input.durationMinutes);
        const selectedRange = { start: selectedStart, end: selectedEnd };
        const blocked = busyRanges.some((busy) => overlaps(selectedRange, busy));

        if (blocked) {
          return {
            check: 'schedule_interview_slots',
            status: 'error',
            message: 'Selected slot conflicts with existing calendar events. Request fresh slot proposals.',
          };
        }

        const calendar = google.calendar('v3');
        const event = await calendar.events.insert({
          auth,
          calendarId: 'primary',
          conferenceDataVersion: 1,
          requestBody: {
            summary: `Interview: ${candidate.name} - ${job.title}`,
            description: `Headhunt interview scheduling for ${job.title}`,
            start: { dateTime: selectedStart.toISOString() },
            end: { dateTime: selectedEnd.toISOString() },
            attendees: [{ email: candidate.contactEmail }],
            conferenceData: {
              createRequest: {
                requestId: `headhunt-${Date.now()}`,
                conferenceSolutionKey: { type: 'hangoutsMeet' },
              },
            },
          },
        });

        const eventId = event.data.id ?? null;
        const meetLink = event.data.hangoutLink ?? event.data.conferenceData?.entryPoints?.[0]?.uri ?? null;
        const updatedAt = new Date();

        const [interviewRow] = await db.transaction(async (tx: typeof db) => {
          const [createdInterview] = await tx
            .insert(interviews)
            .values({
              organizationId: input.organizationId ?? candidate.organizationId ?? null,
              candidateId: input.candidateId,
              jobId: input.jobId,
              scheduledAt: selectedStart,
              durationMinutes: input.durationMinutes,
              status: 'scheduled',
              googleCalendarEventId: eventId,
              googleMeetLink: meetLink,
              summary: `Interview scheduled for ${candidate.name}`,
            })
            .returning();

          await tx
            .update(candidates)
            .set({
              stage: 'interview_scheduled',
              updatedAt,
            })
            .where(eq(candidates.id, input.candidateId));

          await tx
            .update(applications)
            .set({
              stage: 'interview_scheduled',
              updatedAt,
            })
            .where(and(eq(applications.candidateId, input.candidateId), eq(applications.jobId, input.jobId)));

          await tx.insert(auditLogs).values({
            organizationId: input.organizationId ?? candidate.organizationId ?? null,
            actorType: 'agent',
            actorId: 'schedule_interview_slots',
            actorDisplayName: 'Liaison Agent',
            action: 'interview.scheduled',
            resourceType: 'candidate',
            resourceId: input.candidateId,
            metadata: {
              actorUserId,
              jobId: input.jobId,
              interviewId: createdInterview.id,
              scheduledAt: selectedStart.toISOString(),
              durationMinutes: input.durationMinutes,
              googleCalendarEventId: eventId,
              googleMeetLink: meetLink,
            },
            result: 'success',
          });

          return [createdInterview];
        });

        return {
          check: 'schedule_interview_slots',
          status: 'success',
          mode: 'schedule',
          candidateId: input.candidateId,
          jobId: input.jobId,
          interviewId: interviewRow.id,
          stage: 'interview_scheduled',
          event: {
            id: eventId,
            htmlLink: event.data.htmlLink ?? null,
            meetLink,
            startISO: selectedStart.toISOString(),
            endISO: selectedEnd.toISOString(),
            displayLabel: makeLabel(selectedStart, selectedEnd, input.timezone),
          },
          slots,
        };
      } catch (error) {
        if (isGoogleIdentityMismatchError(error) || isGoogleVerificationError(error)) {
          return {
            check: 'schedule_interview_slots',
            status: 'error',
            message: error.message,
          };
        }

        if (isMissingRefreshTokenError(error)) {
          return {
            check: 'schedule_interview_slots',
            status: 'error',
            message:
              'Google connection is missing a refresh token/offline access. Reconnect Google and grant offline access, then rerun scheduling.',
          };
        }

        if (isInsufficientScopeError(error)) {
          return {
            check: 'schedule_interview_slots',
            status: 'error',
            message:
              'Google Calendar scope is missing or not granted. Run run_connection_diagnostics, then authorize_connections_step:google and ensure calendar.events + userinfo.email are granted.',
          };
        }

        if (error instanceof TokenVaultError) {
          throw error;
        }

        if (isAuthorizationError(error)) {
          throw new TokenVaultError('Authorization required to access Google Calendar scheduling operations.');
        }

        return {
          check: 'schedule_interview_slots',
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error while scheduling interview slots.',
        };
      }
    },
  }),
);

export const sendInterviewProposalTool = withGmailWrite(
  tool({
    description:
      'Send or draft a founder-proposed interview options email before scheduling is finalized.',
    inputSchema: sendInterviewProposalInputSchema,
    execute: async (input) => {
      const actorUserId = input.actorUserId ?? (await auth0.getSession())?.user?.sub ?? null;

      if (!actorUserId) {
        return {
          check: 'send_interview_proposal',
          status: 'error',
          message: 'Unauthorized: missing actor identity for interview proposal.',
        };
      }

      const [candidate] = await db
        .select({
          id: candidates.id,
          name: candidates.name,
          contactEmail: candidates.contactEmail,
          organizationId: candidates.organizationId,
          sourceEmailThreadId: candidates.sourceEmailThreadId,
        })
        .from(candidates)
        .where(eq(candidates.id, input.candidateId))
        .limit(1);

      if (!candidate) {
        return {
          check: 'send_interview_proposal',
          status: 'error',
          message: `Candidate ${input.candidateId} not found.`,
        };
      }

      const canView = await canViewCandidate(actorUserId, candidate.id);
      if (!canView) {
        return {
          check: 'send_interview_proposal',
          status: 'error',
          message: `Forbidden: no candidate visibility access for ${input.candidateId}.`,
        };
      }

      const [job] = await db.select({ id: jobs.id, title: jobs.title }).from(jobs).where(eq(jobs.id, input.jobId)).limit(1);
      if (!job) {
        return {
          check: 'send_interview_proposal',
          status: 'error',
          message: `Job ${input.jobId} not found.`,
        };
      }

      const fallbackSubject = input.subject?.trim() || `Interview Availability: ${job.title}`;
      const applicationThreadId = input.replyOnApplicationThread ? candidate.sourceEmailThreadId ?? null : null;
      const subject = applicationThreadId && !/^re\s*:/i.test(fallbackSubject) ? `Re: ${fallbackSubject}` : fallbackSubject;

      try {
        const accessToken = await getGoogleAccessToken();
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });

        let slotOptions: ProposalSlotOption[] = [];
        let proposedTimes: string[] = [];
        let generatedFromCalendar = false;
        let normalizedManualIsoProposalTimes = false;

        if (input.proposedTimes && input.proposedTimes.length > 0) {
          const normalizedManual = normalizeManualProposalTimes({
            proposedTimes: input.proposedTimes,
            durationMinutes: input.durationMinutes,
            timezone: input.timezone,
          });

          proposedTimes = normalizedManual.proposedTimes;
          slotOptions = normalizedManual.slotOptions;
          normalizedManualIsoProposalTimes = normalizedManual.normalizedFromIso;
        } else if (input.useCalendarAvailability) {
          const now = new Date();
          const windowStart = input.windowStartISO ? new Date(input.windowStartISO) : now;
          const windowEnd = input.windowEndISO
            ? new Date(input.windowEndISO)
            : addMinutes(windowStart, 60 * 24 * 7);

          if (windowEnd <= windowStart) {
            return {
              check: 'send_interview_proposal',
              status: 'error',
              message:
                'Invalid proposal window: windowEndISO must be after windowStartISO when useCalendarAvailability is true.',
            };
          }

          const busyRanges = await collectBusyRanges({
            auth,
            timeMin: windowStart.toISOString(),
            timeMax: windowEnd.toISOString(),
            calendarIds: ['primary'],
          });

          const slots = computeAvailableSlots({
            windowStart,
            windowEnd,
            busyRanges,
            durationMinutes: input.durationMinutes,
            slotIntervalMinutes: input.slotIntervalMinutes,
            maxSuggestions: input.maxSuggestions,
            timezone: input.timezone,
          });

          slotOptions = toProposalSlotOptions(slots);
          proposedTimes = slotOptions.map((slot) => slot.displayLabel);
          generatedFromCalendar = true;
        } else {
          proposedTimes = defaultInterviewProposalTimes(input.timezone);
        }

        proposedTimes = proposedTimes.map((time) => time.trim()).filter(Boolean).slice(0, 6);

        const linkOnly = proposedTimes.length === 0 && Boolean(input.schedulingLink?.trim());

        if (proposedTimes.length === 0 && !linkOnly) {
          return {
            check: 'send_interview_proposal',
            status: 'error',
            message:
              'No free slots were found in the selected window. Expand windowStartISO/windowEndISO or provide proposedTimes manually.',
          };
        }

        const gmail = google.gmail('v1');
        const rawMessage = buildInterviewProposalMessage({
          to: candidate.contactEmail,
          subject,
          candidateName: candidate.name,
          jobTitle: job.title,
          proposedTimes,
          timezone: input.timezone,
          schedulingLink: input.schedulingLink,
          customMessage: input.customMessage,
        });
        const raw = toBase64Url(rawMessage);

        const mode = input.sendMode;
        let providerId: string | null = null;
        let providerThreadId: string | null = null;

        if (mode === 'send') {
          const sent = await gmail.users.messages.send({
            auth,
            userId: 'me',
            requestBody: {
              raw,
              ...(applicationThreadId ? { threadId: applicationThreadId } : {}),
            },
          });
          providerId = sent.data.id ?? null;
          providerThreadId = sent.data.threadId ?? applicationThreadId;
        } else {
          const draft = await gmail.users.drafts.create({
            auth,
            userId: 'me',
            requestBody: {
              message: {
                raw,
                ...(applicationThreadId ? { threadId: applicationThreadId } : {}),
              },
            },
          });
          providerId = draft.data.id ?? draft.data.message?.id ?? null;
          providerThreadId = draft.data.message?.threadId ?? applicationThreadId;
        }

        await db.insert(auditLogs).values({
          organizationId: input.organizationId ?? candidate.organizationId ?? null,
          actorType: 'agent',
          actorId: 'send_interview_proposal',
          actorDisplayName: 'Liaison Agent',
          action: mode === 'send' ? 'interview.proposal.sent' : 'interview.proposal.drafted',
          resourceType: 'candidate',
          resourceId: input.candidateId,
          metadata: {
            actorUserId,
            jobId: input.jobId,
            mode,
            providerId,
            providerThreadId,
            applicationThreadId,
            to: candidate.contactEmail,
            subject,
            generatedFromCalendar,
            linkOnly,
            normalizedManualIsoProposalTimes,
            useCalendarAvailability: input.useCalendarAvailability,
            replyOnApplicationThread: input.replyOnApplicationThread,
            schedulingLink: input.schedulingLink ?? null,
            proposedTimes,
            slotOptions,
            timezone: input.timezone,
          },
          result: 'success',
        });

        const selectedStartISO = slotOptions[0]?.startISO ?? null;

        return {
          check: 'send_interview_proposal',
          status: 'success',
          mode,
          candidateId: input.candidateId,
          jobId: input.jobId,
          selectedStartISO,
          proposal: {
            providerId,
            providerThreadId,
            applicationThreadId,
            replyOnApplicationThread: input.replyOnApplicationThread,
            to: candidate.contactEmail,
            subject,
            generatedFromCalendar,
            linkOnly,
            normalizedManualIsoProposalTimes,
            schedulingLink: input.schedulingLink ?? null,
            proposedTimes,
            slotOptions,
            selectedStartISO,
            timezone: input.timezone,
          },
        };
      } catch (error) {
        if (isGoogleIdentityMismatchError(error) || isGoogleVerificationError(error)) {
          return {
            check: 'send_interview_proposal',
            status: 'error',
            message: error.message,
          };
        }

        if (isMissingRefreshTokenError(error)) {
          return {
            check: 'send_interview_proposal',
            status: 'error',
            message:
              'Google connection is missing a refresh token/offline access. Reconnect Google and grant offline access, then rerun interview proposal.',
          };
        }

        if (isInsufficientScopeError(error)) {
          return {
            check: 'send_interview_proposal',
            status: 'error',
            message:
              'Google scopes are missing or not granted. Run run_connection_diagnostics, then authorize_connections_step:google and ensure gmail.compose + calendar.events + userinfo.email are granted.',
          };
        }

        if (error instanceof TokenVaultError) {
          throw error;
        }

        if (isAuthorizationError(error)) {
          throw new TokenVaultError('Authorization required to access Gmail interview proposal operations.');
        }

        return {
          check: 'send_interview_proposal',
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error while sending interview proposal.',
        };
      }
    },
  }),
);

export const analyzeCandidateSchedulingReplyTool = withGmailRead(
  tool({
    description:
      'Analyze the latest candidate scheduling reply from Gmail, parse availability automatically, and recommend selectedStartISO for founder confirmation.',
    inputSchema: analyzeCandidateSchedulingReplyInputSchema,
    execute: async (input) => {
      const actorUserId = input.actorUserId ?? (await auth0.getSession())?.user?.sub ?? null;

      if (!actorUserId) {
        return {
          check: 'analyze_candidate_scheduling_reply',
          status: 'error',
          message: 'Unauthorized: missing actor identity for scheduling reply analysis.',
        };
      }

      const [candidate] = await db
        .select({
          id: candidates.id,
          name: candidates.name,
          contactEmail: candidates.contactEmail,
          organizationId: candidates.organizationId,
          jobId: candidates.jobId,
          sourceEmailThreadId: candidates.sourceEmailThreadId,
        })
        .from(candidates)
        .where(eq(candidates.id, input.candidateId))
        .limit(1);

      if (!candidate) {
        return {
          check: 'analyze_candidate_scheduling_reply',
          status: 'error',
          message: `Candidate ${input.candidateId} not found.`,
        };
      }

      const canView = await canViewCandidate(actorUserId, candidate.id);
      if (!canView) {
        return {
          check: 'analyze_candidate_scheduling_reply',
          status: 'error',
          message: `Forbidden: no candidate visibility access for ${input.candidateId}.`,
        };
      }

      const resolvedJobId = input.jobId ?? candidate.jobId;
      const [job] = await db.select({ id: jobs.id, title: jobs.title }).from(jobs).where(eq(jobs.id, resolvedJobId)).limit(1);
      if (!job) {
        return {
          check: 'analyze_candidate_scheduling_reply',
          status: 'error',
          message: `Job ${resolvedJobId} not found.`,
        };
      }

      const proposalContext = await loadLatestProposalContext(input.candidateId);

      try {
        const accessToken = await getGoogleAccessToken();
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });

        const candidateEmail = candidate.contactEmail.trim().toLowerCase();
        const reply = await fetchLatestCandidateReply({
          auth,
          candidateEmail,
          threadId: input.threadId ?? proposalContext?.providerThreadId ?? candidate.sourceEmailThreadId ?? undefined,
          query: input.query,
          lookbackDays: input.lookbackDays,
          maxResults: input.maxResults,
        });

        if (!reply) {
          return {
            check: 'analyze_candidate_scheduling_reply',
            status: 'error',
            message:
              'No recent candidate reply found. Ask the candidate to reply to the proposal email, then rerun this tool.',
          };
        }

        const replyText = [reply.subject ?? '', reply.body || reply.snippet].filter(Boolean).join('\n').trim();
        const referenceDate = reply.receivedAt ? new Date(reply.receivedAt) : new Date();
        const parsed = parseAvailabilityWindows({
          availabilityText: replyText,
          defaultTimezone: input.timezone,
          referenceDate,
        });

        const selectedOption = detectSelectedOptionFromReply(
          replyText,
          proposalContext?.slotOptions.length ?? 0,
        );
        const optionMatchedSlot = selectedOption
          ? proposalContext?.slotOptions.find((slot) => slot.option === selectedOption) ?? null
          : null;
        const windowMatchedSlot =
          !optionMatchedSlot && proposalContext?.slotOptions.length
            ? findSlotMatchingAvailability({
                slotOptions: proposalContext.slotOptions,
                windows: parsed.windows,
                defaultTimezone: input.timezone,
              })
            : null;

        const recommendedSlot = optionMatchedSlot ?? windowMatchedSlot;
        const selectedStartISO = recommendedSlot?.startISO ?? null;
        const selectedEndISO = recommendedSlot?.endISO ?? null;
        const candidateConfirmed = /\b(work|works|good|fine|okay|ok|confirm|confirmed|sounds\s+good)\b/i.test(
          replyText,
        );

        await db.insert(auditLogs).values({
          organizationId: input.organizationId ?? candidate.organizationId ?? null,
          actorType: 'agent',
          actorId: 'analyze_candidate_scheduling_reply',
          actorDisplayName: 'Liaison Agent',
          action: 'interview.reply.analyzed',
          resourceType: 'candidate',
          resourceId: input.candidateId,
          metadata: {
            actorUserId,
            jobId: resolvedJobId,
            messageId: reply.messageId,
            threadId: reply.threadId,
            selectedOption,
            selectedStartISO,
            parsedWindowCount: parsed.windows.length,
            proposalThreadId: proposalContext?.providerThreadId ?? null,
          },
          result: 'success',
        });

        return {
          check: 'analyze_candidate_scheduling_reply',
          status: 'success',
          candidateId: input.candidateId,
          jobId: resolvedJobId,
          selectedStartISO,
          selectedEndISO,
          selectedOption,
          candidateConfirmed,
          reply: {
            messageId: reply.messageId,
            threadId: reply.threadId,
            from: reply.from,
            subject: reply.subject,
            receivedAt: reply.receivedAt,
            snippet: reply.snippet,
            bodyExcerpt: compactText(reply.body, 500),
          },
          proposalContext: {
            threadId: proposalContext?.providerThreadId ?? null,
            subject: proposalContext?.subject ?? null,
            proposedTimes: proposalContext?.proposedTimes ?? [],
            slotOptions: proposalContext?.slotOptions ?? [],
          },
          parsedAvailability: {
            detectedTimezone: parsed.detectedTimezone,
            windows: parsed.windows,
          },
          recommendation: selectedStartISO
            ? `Candidate reply mapped to a proposal slot. Confirm by calling schedule_interview_slots with selectedStartISO ${selectedStartISO}.`
            : 'No definitive slot could be mapped from the candidate reply. Ask candidate to reply with an option number or explicit time.',
        };
      } catch (error) {
        if (isGoogleIdentityMismatchError(error) || isGoogleVerificationError(error)) {
          return {
            check: 'analyze_candidate_scheduling_reply',
            status: 'error',
            message: error.message,
          };
        }

        if (isMissingRefreshTokenError(error)) {
          return {
            check: 'analyze_candidate_scheduling_reply',
            status: 'error',
            message:
              'Google connection is missing a refresh token/offline access. Reconnect Google and grant offline access, then rerun reply analysis.',
          };
        }

        if (isInsufficientScopeError(error)) {
          return {
            check: 'analyze_candidate_scheduling_reply',
            status: 'error',
            message:
              'Google scopes are missing or not granted. Run run_connection_diagnostics, then authorize_connections_step:google and ensure gmail.readonly + userinfo.email are granted.',
          };
        }

        if (error instanceof TokenVaultError) {
          throw error;
        }

        if (isAuthorizationError(error)) {
          throw new TokenVaultError('Authorization required to analyze candidate Gmail replies.');
        }

        return {
          check: 'analyze_candidate_scheduling_reply',
          status: 'error',
          message:
            error instanceof Error ? error.message : 'Unknown error while analyzing candidate scheduling reply.',
        };
      }
    },
  }),
);

export const sendInterviewConfirmationTool = withGmailWrite(
  tool({
    description:
      'Send or draft a candidate interview confirmation email using the scheduled interview details and update stage/audit state. For Cal-managed bookings, this tool skips sending because Cal already sends invite emails.',
    inputSchema: sendInterviewConfirmationInputSchema,
    execute: async (input) => {
      const actorUserId = input.actorUserId ?? (await auth0.getSession())?.user?.sub ?? null;

      if (!actorUserId) {
        return {
          check: 'send_interview_confirmation',
          status: 'error',
          message: 'Unauthorized: missing actor identity for interview confirmation.',
        };
      }

      const [candidate] = await db
        .select({
          id: candidates.id,
          name: candidates.name,
          contactEmail: candidates.contactEmail,
          organizationId: candidates.organizationId,
        })
        .from(candidates)
        .where(eq(candidates.id, input.candidateId))
        .limit(1);

      if (!candidate) {
        return {
          check: 'send_interview_confirmation',
          status: 'error',
          message: `Candidate ${input.candidateId} not found.`,
        };
      }

      const canView = await canViewCandidate(actorUserId, candidate.id);
      if (!canView) {
        return {
          check: 'send_interview_confirmation',
          status: 'error',
          message: `Forbidden: no candidate visibility access for ${input.candidateId}.`,
        };
      }

      const [job] = await db.select({ id: jobs.id, title: jobs.title }).from(jobs).where(eq(jobs.id, input.jobId)).limit(1);
      if (!job) {
        return {
          check: 'send_interview_confirmation',
          status: 'error',
          message: `Job ${input.jobId} not found.`,
        };
      }

      const [interviewRow] = await db
        .select({
          id: interviews.id,
          scheduledAt: interviews.scheduledAt,
          durationMinutes: interviews.durationMinutes,
          googleMeetLink: interviews.googleMeetLink,
          googleCalendarEventId: interviews.googleCalendarEventId,
          status: interviews.status,
        })
        .from(interviews)
        .where(
          and(
            eq(interviews.candidateId, input.candidateId),
            eq(interviews.jobId, input.jobId),
            input.interviewId ? eq(interviews.id, input.interviewId) : eq(interviews.status, 'scheduled'),
          ),
        )
        .orderBy(desc(interviews.scheduledAt))
        .limit(1);

      if (!interviewRow) {
        return {
          check: 'send_interview_confirmation',
          status: 'error',
          message:
            input.interviewId
              ? `Interview ${input.interviewId} not found for the given candidate/job.`
              : 'No scheduled interview found for this candidate/job.',
        };
      }

      const scheduledStart = interviewRow.scheduledAt;
      const scheduledEnd = addMinutes(scheduledStart, interviewRow.durationMinutes);
      const slotLabel = makeLabel(scheduledStart, scheduledEnd, input.timezone);
      const subject = input.subject?.trim() || `Interview Confirmation: ${job.title}`;
      const isCalManagedBooking =
        typeof interviewRow.googleCalendarEventId === 'string' &&
        interviewRow.googleCalendarEventId.startsWith('cal:');

      if (isCalManagedBooking) {
        await db.insert(auditLogs).values({
          organizationId: input.organizationId ?? candidate.organizationId ?? null,
          actorType: 'agent',
          actorId: 'send_interview_confirmation',
          actorDisplayName: 'Liaison Agent',
          action: 'interview.confirmation.skipped',
          resourceType: 'candidate',
          resourceId: input.candidateId,
          metadata: {
            actorUserId,
            jobId: input.jobId,
            interviewId: interviewRow.id,
            reason: 'cal_managed_booking',
            to: candidate.contactEmail,
            subject,
            scheduledAt: scheduledStart.toISOString(),
          },
          result: 'success',
        });

        return {
          check: 'send_interview_confirmation',
          status: 'success',
          mode: 'skipped',
          reason: 'cal_managed_booking',
          message:
            'Skipped founder confirmation email because this interview is Cal-managed and Cal already sends booking emails.',
          candidateId: input.candidateId,
          jobId: input.jobId,
          interviewId: interviewRow.id,
          stage: 'interview_scheduled',
          confirmation: {
            providerId: null,
            providerThreadId: null,
            to: candidate.contactEmail,
            subject,
            slotLabel,
            meetLink: interviewRow.googleMeetLink,
          },
        };
      }

      try {
        const accessToken = await getGoogleAccessToken();
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });

        const gmail = google.gmail('v1');
        const rawMessage = buildInterviewConfirmationMessage({
          to: candidate.contactEmail,
          subject,
          candidateName: candidate.name,
          jobTitle: job.title,
          slotLabel,
          meetLink: interviewRow.googleMeetLink,
          calendarLink: interviewRow.googleCalendarEventId
            ? `https://calendar.google.com/calendar/u/0/r/eventedit/${interviewRow.googleCalendarEventId}`
            : null,
          customMessage: input.customMessage,
        });
        const raw = toBase64Url(rawMessage);

        const mode = input.sendMode;
        let providerId: string | null = null;
        let providerThreadId: string | null = null;

        if (mode === 'send') {
          const sent = await gmail.users.messages.send({
            auth,
            userId: 'me',
            requestBody: { raw },
          });
          providerId = sent.data.id ?? null;
          providerThreadId = sent.data.threadId ?? null;
        } else {
          const draft = await gmail.users.drafts.create({
            auth,
            userId: 'me',
            requestBody: { message: { raw } },
          });
          providerId = draft.data.id ?? draft.data.message?.id ?? null;
          providerThreadId = draft.data.message?.threadId ?? null;
        }

        const updatedAt = new Date();

        await db.transaction(async (tx: typeof db) => {
          await tx
            .update(candidates)
            .set({
              stage: 'interview_scheduled',
              updatedAt,
            })
            .where(eq(candidates.id, input.candidateId));

          await tx
            .update(applications)
            .set({
              stage: 'interview_scheduled',
              updatedAt,
            })
            .where(and(eq(applications.candidateId, input.candidateId), eq(applications.jobId, input.jobId)));

          await tx.insert(auditLogs).values({
            organizationId: input.organizationId ?? candidate.organizationId ?? null,
            actorType: 'agent',
            actorId: 'send_interview_confirmation',
            actorDisplayName: 'Liaison Agent',
            action: mode === 'send' ? 'interview.confirmation.sent' : 'interview.confirmation.drafted',
            resourceType: 'candidate',
            resourceId: input.candidateId,
            metadata: {
              actorUserId,
              jobId: input.jobId,
              interviewId: interviewRow.id,
              mode,
              providerId,
              providerThreadId,
              to: candidate.contactEmail,
              subject,
              scheduledAt: scheduledStart.toISOString(),
            },
            result: 'success',
          });
        });

        return {
          check: 'send_interview_confirmation',
          status: 'success',
          mode,
          candidateId: input.candidateId,
          jobId: input.jobId,
          interviewId: interviewRow.id,
          stage: 'interview_scheduled',
          confirmation: {
            providerId,
            providerThreadId,
            to: candidate.contactEmail,
            subject,
            slotLabel,
            meetLink: interviewRow.googleMeetLink,
          },
        };
      } catch (error) {
        if (isGoogleIdentityMismatchError(error) || isGoogleVerificationError(error)) {
          return {
            check: 'send_interview_confirmation',
            status: 'error',
            message: error.message,
          };
        }

        if (isMissingRefreshTokenError(error)) {
          return {
            check: 'send_interview_confirmation',
            status: 'error',
            message:
              'Google connection is missing a refresh token/offline access. Reconnect Google and grant offline access, then rerun interview confirmation.',
          };
        }

        if (isInsufficientScopeError(error)) {
          return {
            check: 'send_interview_confirmation',
            status: 'error',
            message:
              'Google Gmail scope is missing or not granted. Run run_connection_diagnostics, then authorize_connections_step:google and ensure gmail.compose + userinfo.email are granted.',
          };
        }

        if (error instanceof TokenVaultError) {
          throw error;
        }

        if (isAuthorizationError(error)) {
          throw new TokenVaultError('Authorization required to access Gmail interview confirmation operations.');
        }

        return {
          check: 'send_interview_confirmation',
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error while sending interview confirmation.',
        };
      }
    },
  }),
);

export const runFinalScheduleFlowTool = withGmailWrite(
  tool({
    description:
      'Final scheduling flow: fetch Cal free slots, email candidate concrete options on the application thread, then after candidate reply book the accepted/overlapping slot.',
    inputSchema: runFinalScheduleFlowInputSchema,
    execute: async (input) => {
      const actorUserId = input.actorUserId ?? (await auth0.getSession())?.user?.sub ?? null;

      if (!actorUserId) {
        return {
          check: 'run_final_schedule_flow',
          status: 'error',
          message: 'Unauthorized: missing actor identity for final scheduling flow.',
        };
      }

      const [candidate] = await db
        .select({
          id: candidates.id,
          name: candidates.name,
          contactEmail: candidates.contactEmail,
          organizationId: candidates.organizationId,
          jobId: candidates.jobId,
          sourceEmailThreadId: candidates.sourceEmailThreadId,
        })
        .from(candidates)
        .where(eq(candidates.id, input.candidateId))
        .limit(1);

      if (!candidate) {
        return {
          check: 'run_final_schedule_flow',
          status: 'error',
          message: `Candidate ${input.candidateId} not found.`,
        };
      }

      const canView = await canViewCandidate(actorUserId, candidate.id);
      if (!canView) {
        return {
          check: 'run_final_schedule_flow',
          status: 'error',
          message: `Forbidden: no candidate visibility access for ${input.candidateId}.`,
        };
      }

      if (!candidate.contactEmail?.trim()) {
        return {
          check: 'run_final_schedule_flow',
          status: 'error',
          message: `Candidate ${input.candidateId} is missing contact email.`,
        };
      }

      const [job] = await db.select({ id: jobs.id, title: jobs.title }).from(jobs).where(eq(jobs.id, input.jobId)).limit(1);
      if (!job) {
        return {
          check: 'run_final_schedule_flow',
          status: 'error',
          message: `Job ${input.jobId} not found.`,
        };
      }

      const organizationId = input.organizationId ?? candidate.organizationId ?? null;
      const requestContext = await loadLatestAvailabilityRequestContext(input.candidateId);
      const applicationThreadId =
        input.threadId ?? requestContext?.providerThreadId ?? requestContext?.threadId ?? candidate.sourceEmailThreadId ?? null;

      const calTarget = {
        eventTypeSlug: input.eventTypeSlug ?? requestContext?.eventTypeSlug ?? DEFAULT_CAL_EVENT_TYPE_SLUG,
        username: input.username ?? requestContext?.username ?? DEFAULT_CAL_USERNAME,
        teamSlug: input.teamSlug ?? requestContext?.teamSlug ?? DEFAULT_CAL_TEAM_SLUG,
        organizationSlug:
          input.organizationSlug ?? requestContext?.organizationSlug ?? DEFAULT_CAL_ORGANIZATION_SLUG,
      };

      if (!calTarget.username && !calTarget.teamSlug && !calTarget.organizationSlug) {
        return {
          check: 'run_final_schedule_flow',
          status: 'error',
          message:
            'Missing Cal target identity. Provide username, teamSlug, or organizationSlug (or set CAL_PUBLIC_USERNAME / CAL_PUBLIC_TEAM_SLUG env).',
        };
      }

      const requestWindow = resolveRequestWindowBounds({
        windowStartISO: input.windowStartISO,
        windowEndISO: input.windowEndISO,
      });

      const resolvedAction = input.action ?? 'auto';
      const resolvedSendMode = input.sendMode ?? 'send';
      const resolvedTimezone = input.timezone ?? 'America/Los_Angeles';
      const resolvedDurationMinutes = Number.isInteger(input.durationMinutes) ? input.durationMinutes : 30;
      const resolvedTargetDayCount = Number.isInteger(input.targetDayCount)
        ? Math.min(3, Math.max(1, input.targetDayCount))
        : 3;
      // Keep candidate outreach intentionally concise: one slot per day, max three options.
      const resolvedSlotsPerDay = 1;
      const resolvedMaxSlotsToEmail = 3;
      const resolvedLookbackDays = Number.isInteger(input.lookbackDays) ? input.lookbackDays : 14;
      const resolvedMaxResults = Number.isInteger(input.maxResults) ? input.maxResults : 10;

      if (
        Number.isNaN(requestWindow.start.getTime()) ||
        Number.isNaN(requestWindow.end.getTime()) ||
        requestWindow.end <= requestWindow.start
      ) {
        return {
          check: 'run_final_schedule_flow',
          status: 'error',
          message: 'Invalid Cal availability window: provide valid windowStartISO/windowEndISO and ensure end is after start.',
        };
      }

      const preferredWeekdays = normalizePreferredWeekdays(input.preferredWeekdays);

      const sendAvailabilityRequest = async () => {
        const fetchedSlots = await fetchCalPublicSlotsForWindow({
          eventTypeSlug: calTarget.eventTypeSlug,
          username: calTarget.username,
          teamSlug: calTarget.teamSlug,
          organizationSlug: calTarget.organizationSlug,
          startISO: requestWindow.start.toISOString(),
          endISO: requestWindow.end.toISOString(),
          timezone: resolvedTimezone,
        });

        if (fetchedSlots.status === 'error') {
          return fetchedSlots;
        }

        if (fetchedSlots.slots.length === 0) {
          return {
            status: 'error' as const,
            message: 'No Cal availability slots found in the selected window.',
          };
        }

        const slotsForRequest =
          preferredWeekdays.length === 0
            ? fetchedSlots.slots
            : fetchedSlots.slots.filter((slot) =>
                preferredWeekdays.includes(getLocalWeekday(slot.startISO, resolvedTimezone)),
              );

        if (preferredWeekdays.length > 0 && slotsForRequest.length === 0) {
          return {
            status: 'error' as const,
            message: `No Cal availability found on preferred days (${preferredWeekdays.join(', ')}) in the selected window.`,
          };
        }

        const requestSlotOptions = selectCalSlotsForCandidateRequest({
          slots: slotsForRequest,
          timezone: resolvedTimezone,
          preferredWeekdays,
          targetDayCount: resolvedTargetDayCount,
          slotsPerDay: resolvedSlotsPerDay,
          maxSlotsToEmail: resolvedMaxSlotsToEmail,
        });

        if (requestSlotOptions.length === 0) {
          return {
            status: 'error' as const,
            message:
              'Unable to derive requestable Cal slots from the selected window. Expand the window or relax preferred weekdays.',
          };
        }

        const accessToken = await getGoogleAccessToken();
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });

        const fallbackSubject = `Interview availability request: ${job.title}`;
        const subject = applicationThreadId && !/^re\s*:/i.test(fallbackSubject) ? `Re: ${fallbackSubject}` : fallbackSubject;

        const rawMessage = buildCandidateAvailabilityRequestMessage({
          to: candidate.contactEmail,
          subject,
          candidateName: candidate.name,
          jobTitle: job.title,
          timezone: resolvedTimezone,
          durationMinutes: resolvedDurationMinutes,
          eventTypeSlug: calTarget.eventTypeSlug,
          slotOptions: requestSlotOptions,
          customMessage: input.customMessage,
        });
        const raw = toBase64Url(rawMessage);

        const gmail = google.gmail('v1');
        let providerId: string | null = null;
        let providerThreadId: string | null = null;

        if (resolvedSendMode === 'send') {
          const sent = await gmail.users.messages.send({
            auth,
            userId: 'me',
            requestBody: {
              raw,
              ...(applicationThreadId ? { threadId: applicationThreadId } : {}),
            },
          });

          providerId = sent.data.id ?? null;
          providerThreadId = sent.data.threadId ?? applicationThreadId;
        } else {
          const draft = await gmail.users.drafts.create({
            auth,
            userId: 'me',
            requestBody: {
              message: {
                raw,
                ...(applicationThreadId ? { threadId: applicationThreadId } : {}),
              },
            },
          });

          providerId = draft.data.id ?? draft.data.message?.id ?? null;
          providerThreadId = draft.data.message?.threadId ?? applicationThreadId;
        }

        await db.insert(auditLogs).values({
          organizationId,
          actorType: 'agent',
          actorId: 'run_final_schedule_flow',
          actorDisplayName: 'Liaison Agent',
          action:
            resolvedSendMode === 'send'
              ? 'interview.availability.request.sent'
              : 'interview.availability.request.drafted',
          resourceType: 'candidate',
          resourceId: input.candidateId,
          metadata: {
            actorUserId,
            jobId: input.jobId,
            providerId,
            providerThreadId,
            threadId: applicationThreadId,
            to: candidate.contactEmail,
            subject,
            timezone: resolvedTimezone,
            durationMinutes: resolvedDurationMinutes,
            preferredWeekdays,
            windowStartISO: requestWindow.start.toISOString(),
            windowEndISO: requestWindow.end.toISOString(),
            eventTypeSlug: calTarget.eventTypeSlug,
            username: calTarget.username,
            teamSlug: calTarget.teamSlug,
            organizationSlug: calTarget.organizationSlug,
            slotOptions: requestSlotOptions,
          },
          result: 'success',
        });

        return {
          status: 'success' as const,
          providerId,
          providerThreadId,
          threadId: providerThreadId ?? applicationThreadId,
          subject,
          slotOptions: requestSlotOptions,
          windowStartISO: requestWindow.start.toISOString(),
          windowEndISO: requestWindow.end.toISOString(),
        };
      };

      const shouldTryBooking = resolvedAction === 'book_from_reply' || resolvedAction === 'auto';

      if (!shouldTryBooking) {
        const requestResult = await sendAvailabilityRequest();
        if (requestResult.status === 'error') {
          return {
            check: 'run_final_schedule_flow',
            status: 'error',
            message: requestResult.message,
          };
        }

        return {
          check: 'run_final_schedule_flow',
          status: 'success',
          mode: resolvedSendMode === 'send' ? 'request_sent' : 'request_drafted',
          candidateId: input.candidateId,
          jobId: input.jobId,
          candidateEmail: candidate.contactEmail,
          threadId: requestResult.threadId,
          request: {
            providerId: requestResult.providerId,
            providerThreadId: requestResult.providerThreadId,
            subject: requestResult.subject,
            sendMode: resolvedSendMode,
            slotOptions: requestResult.slotOptions,
            windowStartISO: requestResult.windowStartISO,
            windowEndISO: requestResult.windowEndISO,
          },
          nextStep:
            'Ask the candidate to reply with option number(s) that work, then rerun run_final_schedule_flow with action auto or book_from_reply.',
        };
      }

      const accessToken = await getGoogleAccessToken();
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });

      const reply = await fetchLatestCandidateReply({
        auth,
        candidateEmail: candidate.contactEmail.trim().toLowerCase(),
        threadId: applicationThreadId ?? undefined,
        query: input.query,
        lookbackDays: resolvedLookbackDays,
        maxResults: resolvedMaxResults,
      });

      const replyIsSameAsLatestRequest = Boolean(
        reply?.messageId && requestContext?.providerId && reply.messageId === requestContext.providerId,
      );

      if (!reply || replyIsSameAsLatestRequest) {
        if (resolvedAction === 'book_from_reply') {
          return {
            check: 'run_final_schedule_flow',
            status: 'error',
            message:
              'No candidate reply with availability was found yet. Ask the candidate to reply on the thread, then rerun book_from_reply.',
          };
        }

        if (requestContext) {
          return {
            check: 'run_final_schedule_flow',
            status: 'success',
            mode: 'waiting_for_candidate_reply',
            candidateId: input.candidateId,
            jobId: input.jobId,
            candidateEmail: candidate.contactEmail,
            threadId: applicationThreadId,
            request: {
              providerId: requestContext.providerId,
              providerThreadId: requestContext.providerThreadId,
              subject: requestContext.subject,
              slotOptions: requestContext.slotOptions,
            },
            nextStep: 'Waiting for candidate reply with option number(s) on the same thread.',
          };
        }

        const requestResult = await sendAvailabilityRequest();
        if (requestResult.status === 'error') {
          return {
            check: 'run_final_schedule_flow',
            status: 'error',
            message: requestResult.message,
          };
        }

        return {
          check: 'run_final_schedule_flow',
          status: 'success',
          mode: resolvedSendMode === 'send' ? 'request_sent' : 'request_drafted',
          candidateId: input.candidateId,
          jobId: input.jobId,
          candidateEmail: candidate.contactEmail,
          threadId: requestResult.threadId,
          request: {
            providerId: requestResult.providerId,
            providerThreadId: requestResult.providerThreadId,
            subject: requestResult.subject,
            sendMode: resolvedSendMode,
            slotOptions: requestResult.slotOptions,
            windowStartISO: requestResult.windowStartISO,
            windowEndISO: requestResult.windowEndISO,
          },
          nextStep:
            'Candidate slot options were sent. Once they reply with selected option(s), rerun run_final_schedule_flow with action auto or book_from_reply.',
        };
      }

      if (resolvedAction === 'auto' && requestContext?.timestampISO && reply.receivedAt) {
        const requestMs = new Date(requestContext.timestampISO).getTime();
        const replyMs = new Date(reply.receivedAt).getTime();
        const hasNewerReply = Number.isFinite(requestMs) && Number.isFinite(replyMs) && replyMs > requestMs;

        if (!hasNewerReply) {
          return {
            check: 'run_final_schedule_flow',
            status: 'success',
            mode: 'waiting_for_candidate_reply',
            candidateId: input.candidateId,
            jobId: input.jobId,
            candidateEmail: candidate.contactEmail,
            threadId: applicationThreadId,
            request: {
              providerId: requestContext.providerId,
              providerThreadId: requestContext.providerThreadId,
              subject: requestContext.subject,
              slotOptions: requestContext.slotOptions,
            },
            nextStep: 'Waiting for a newer candidate reply that includes availability windows.',
          };
        }
      }

      const replyText = [reply.subject ?? '', reply.body || reply.snippet].filter(Boolean).join('\n').trim();
      const selectedOption = detectSelectedOptionFromReply(
        replyText,
        requestContext?.slotOptions.length ?? 0,
      );
      const optionMatchedSlot = selectedOption
        ? requestContext?.slotOptions.find((slot) => slot.option === selectedOption) ?? null
        : null;
      const weekdayMatchedSlot =
        !optionMatchedSlot && (requestContext?.slotOptions.length ?? 0) > 0
          ? findRequestSlotMatchingWeekdayIntent({
              replyText,
              slotOptions: requestContext?.slotOptions ?? [],
              timezone: resolvedTimezone,
            })
          : null;
      const requestMatchedSlot = optionMatchedSlot ?? weekdayMatchedSlot;

      const referenceDate = reply.receivedAt ? new Date(reply.receivedAt) : new Date();
      const parsedAvailability = parseAvailabilityWindows({
        availabilityText: replyText,
        defaultTimezone: resolvedTimezone,
        referenceDate,
      });

      if (!requestMatchedSlot && parsedAvailability.windows.length === 0) {
        return {
          check: 'run_final_schedule_flow',
          status: 'error',
          message:
            'Candidate reply did not include a detectable option number or parseable window. Ask them to reply with an option number or weekday + time range (for example "Tuesday 2-5 PM PT").',
          reply: {
            messageId: reply.messageId,
            threadId: reply.threadId,
            receivedAt: reply.receivedAt,
            snippet: reply.snippet,
          },
        };
      }

      const calWindow = requestMatchedSlot
        ? {
            start: input.windowStartISO
              ? new Date(input.windowStartISO)
              : new Date(new Date(requestMatchedSlot.startISO).getTime() - 24 * 60 * 60 * 1000),
            end: input.windowEndISO
              ? new Date(input.windowEndISO)
              : new Date(new Date(requestMatchedSlot.endISO).getTime() + 2 * 24 * 60 * 60 * 1000),
          }
        : deriveCalWindowBounds({
            windows: parsedAvailability.windows,
            windowStartISO: input.windowStartISO,
            windowEndISO: input.windowEndISO,
          });

      if (
        Number.isNaN(calWindow.start.getTime()) ||
        Number.isNaN(calWindow.end.getTime()) ||
        calWindow.end <= calWindow.start
      ) {
        return {
          check: 'run_final_schedule_flow',
          status: 'error',
          message: 'Invalid Cal availability window: provide valid windowStartISO/windowEndISO and ensure end is after start.',
        };
      }

      const fetchedBookingSlots = await fetchCalPublicSlotsForWindow({
        eventTypeSlug: calTarget.eventTypeSlug,
        username: calTarget.username,
        teamSlug: calTarget.teamSlug,
        organizationSlug: calTarget.organizationSlug,
        startISO: calWindow.start.toISOString(),
        endISO: calWindow.end.toISOString(),
        timezone: resolvedTimezone,
      });

      if (fetchedBookingSlots.status === 'error') {
        return {
          check: 'run_final_schedule_flow',
          status: 'error',
          message: fetchedBookingSlots.message,
        };
      }

      const allSlots = fetchedBookingSlots.slots;

      if (allSlots.length === 0) {
        return {
          check: 'run_final_schedule_flow',
          status: 'error',
          message: 'No Cal availability slots found in the selected window.',
        };
      }

      const requestMatchedCalSlot = requestMatchedSlot
        ? allSlots.find((slot) => {
            const slotStartMs = new Date(slot.startISO).getTime();
            const requestedStartMs = new Date(requestMatchedSlot.startISO).getTime();
            return Math.abs(slotStartMs - requestedStartMs) <= 60_000;
          }) ?? null
        : null;

      const overlapTimezone = parsedAvailability.detectedTimezone || resolvedTimezone;
      const overlapMatchedSlot =
        parsedAvailability.windows.length > 0
          ? pickFirstOverlappingCalSlot({
              slots: allSlots,
              windows: parsedAvailability.windows,
              timezone: overlapTimezone,
            })
          : null;

      const matchedSlot = requestMatchedCalSlot ?? overlapMatchedSlot;

      if (!matchedSlot) {
        return {
          check: 'run_final_schedule_flow',
          status: 'error',
          message: requestMatchedSlot
            ? 'Candidate-selected slot is no longer free on Cal. Ask candidate to choose another option.'
            : 'No overlap found between candidate-requested windows and current Cal availability. Ask the candidate for alternate times or expand your Cal availability window.',
          parsedAvailability: {
            detectedTimezone: parsedAvailability.detectedTimezone,
            windows: parsedAvailability.windows,
          },
        };
      }

      const matchedBy = requestMatchedCalSlot
        ? optionMatchedSlot
          ? 'candidate_option'
          : 'weekday_intent'
        : 'window_overlap';

      const bookingMetadata: Record<string, string> = {
        source: 'run_final_schedule_flow',
        candidateId: input.candidateId,
        jobId: input.jobId,
      };

      if (applicationThreadId) {
        bookingMetadata.threadId = applicationThreadId;
      }

      if (reply.messageId) {
        bookingMetadata.replyMessageId = reply.messageId;
      }

      if (typeof selectedOption === 'number' && Number.isInteger(selectedOption)) {
        bookingMetadata.selectedOption = String(selectedOption);
      }

      let requestedMeetingIntegration = DEFAULT_CAL_MEETING_INTEGRATION;

      const bookingBody: Record<string, unknown> = {
        start: matchedSlot.startISO,
        attendee: {
          name: candidate.name,
          email: candidate.contactEmail,
          timeZone: resolvedTimezone,
          language: 'en',
        },
        location: {
          type: 'integration',
          integration: requestedMeetingIntegration,
        },
        metadata: bookingMetadata,
        lengthInMinutes: resolvedDurationMinutes,
        eventTypeSlug: calTarget.eventTypeSlug,
      };

      if (calTarget.username) {
        bookingBody.username = calTarget.username;
      }

      if (calTarget.teamSlug) {
        bookingBody.teamSlug = calTarget.teamSlug;
      }

      if (calTarget.organizationSlug) {
        bookingBody.organizationSlug = calTarget.organizationSlug;
      }

      const bookingsUrl = new URL('/v2/bookings', CAL_COM_API_BASE_URL).toString();

      const bookingHeaders = {
        'cal-api-version': CAL_BOOKINGS_API_VERSION,
        'Content-Type': 'application/json',
      };

      const executeBooking = async (body: Record<string, unknown>) =>
        fetch(bookingsUrl, {
          method: 'POST',
          headers: bookingHeaders,
          body: JSON.stringify(body),
        });

      let bookingResponse = await executeBooking(bookingBody);

      if (!bookingResponse.ok) {
        let details = await bookingResponse.text();
        const integrationNotSupported = /location with integration/i.test(details) || /booking location with integration/i.test(details);
        const canFallbackToCalVideo =
          requestedMeetingIntegration !== 'cal-video' && /google-meet/i.test(details) && /cal-video/i.test(details);

        if (integrationNotSupported && canFallbackToCalVideo) {
          requestedMeetingIntegration = 'cal-video';
          bookingBody.location = {
            type: 'integration',
            integration: requestedMeetingIntegration,
          };
          bookingResponse = await executeBooking(bookingBody);

          if (!bookingResponse.ok) {
            details = await bookingResponse.text();
          }
        }

        if (!bookingResponse.ok) {
          const stillIntegrationNotSupported =
            /location with integration/i.test(details) || /booking location with integration/i.test(details);

          if (stillIntegrationNotSupported) {
            return {
              check: 'run_final_schedule_flow',
              status: 'error',
              message:
                `Cal event type does not support ${requestedMeetingIntegration} for booking location. ` +
                `Raw Cal error: ${details}`,
            };
          }

          const shouldRetryWithoutLength =
            bookingResponse.status === 400 &&
            typeof bookingBody.lengthInMinutes === 'number' &&
            /lengthinminutes/i.test(details) &&
            /remove|can't specify|cannot specify/i.test(details);

          if (shouldRetryWithoutLength) {
            delete bookingBody.lengthInMinutes;
            bookingResponse = await executeBooking(bookingBody);
          } else {
            return {
              check: 'run_final_schedule_flow',
              status: 'error',
              message: `Failed to create Cal booking (${bookingResponse.status}): ${details}`,
            };
          }
        }
      }

      if (!bookingResponse.ok) {
        const retryDetails = await bookingResponse.text();
        return {
          check: 'run_final_schedule_flow',
          status: 'error',
          message: `Failed to create Cal booking (${bookingResponse.status}): ${retryDetails}`,
        };
      }

      const bookingPayload = (await bookingResponse.json()) as unknown;
      const booking = extractCalBooking(bookingPayload);
      const bookingUid = asString(booking?.uid) ?? null;
      const startISO = toIso(booking?.start) ?? matchedSlot.startISO;
      const endISO = toIso(booking?.end) ?? matchedSlot.endISO;
      const location = asString(booking?.location) ?? null;
      const meetingUrl = asString(booking?.meetingUrl) ?? null;
      const meetLink = location ?? meetingUrl;
      const calculatedDuration = Math.max(1, Math.round((new Date(endISO).getTime() - new Date(startISO).getTime()) / 60000));
      const durationMinutes = Number.isFinite(calculatedDuration) ? calculatedDuration : resolvedDurationMinutes;
      const updatedAt = new Date();

      const [interviewRow] = await db.transaction(async (tx: typeof db) => {
        const [createdInterview] = await tx
          .insert(interviews)
          .values({
            organizationId,
            candidateId: input.candidateId,
            jobId: input.jobId,
            scheduledAt: new Date(startISO),
            durationMinutes,
            status: 'scheduled',
            googleCalendarEventId: bookingUid ? `cal:${bookingUid}` : null,
            googleMeetLink: meetLink,
            summary: `Cal booking scheduled for ${candidate.name}`,
          })
          .returning();

        await tx
          .update(candidates)
          .set({
            stage: 'interview_scheduled',
            updatedAt,
          })
          .where(eq(candidates.id, input.candidateId));

        await tx
          .update(applications)
          .set({
            stage: 'interview_scheduled',
            updatedAt,
          })
          .where(and(eq(applications.candidateId, input.candidateId), eq(applications.jobId, input.jobId)));

        await tx.insert(auditLogs).values({
          organizationId,
          actorType: 'agent',
          actorId: 'run_final_schedule_flow',
          actorDisplayName: 'Liaison Agent',
          action: 'interview.reply.analyzed',
          resourceType: 'candidate',
          resourceId: input.candidateId,
          metadata: {
            actorUserId,
            jobId: input.jobId,
            messageId: reply.messageId,
            threadId: reply.threadId,
            selectedOption,
            selectedStartISO: matchedSlot.startISO,
            parsedWindowCount: parsedAvailability.windows.length,
            source: 'run_final_schedule_flow',
          },
          result: 'success',
        });

        await tx.insert(auditLogs).values({
          organizationId,
          actorType: 'agent',
          actorId: 'run_final_schedule_flow',
          actorDisplayName: 'Liaison Agent',
          action: 'interview.scheduled',
          resourceType: 'candidate',
          resourceId: input.candidateId,
          metadata: {
            actorUserId,
            jobId: input.jobId,
            provider: 'cal',
            bookingUid,
            selectedStartISO: startISO,
            selectedEndISO: endISO,
            eventTypeSlug: calTarget.eventTypeSlug,
            username: calTarget.username,
            teamSlug: calTarget.teamSlug,
            organizationSlug: calTarget.organizationSlug,
            threadId: applicationThreadId,
            replyMessageId: reply.messageId,
            interviewId: createdInterview.id,
            selectedOption,
            matchedBy,
            meetingIntegration: requestedMeetingIntegration,
          },
          result: 'success',
        });

        return [createdInterview];
      });

      return {
        check: 'run_final_schedule_flow',
        status: 'success',
        mode: 'scheduled',
        candidateId: input.candidateId,
        jobId: input.jobId,
        interviewId: interviewRow.id,
        stage: 'interview_scheduled',
        threadId: applicationThreadId,
        reply: {
          messageId: reply.messageId,
          threadId: reply.threadId,
          subject: reply.subject,
          receivedAt: reply.receivedAt,
          snippet: reply.snippet,
        },
        parsedAvailability: {
          detectedTimezone: parsedAvailability.detectedTimezone,
          windows: parsedAvailability.windows,
        },
        selectedOption,
        matchedBy,
        overlap: {
          startISO,
          endISO,
          displayLabel: makeLabel(new Date(startISO), new Date(endISO), resolvedTimezone),
        },
        cal: {
          eventTypeSlug: calTarget.eventTypeSlug,
          username: calTarget.username,
          teamSlug: calTarget.teamSlug,
          organizationSlug: calTarget.organizationSlug,
        },
        event: {
          bookingUid,
          startISO,
          endISO,
          location,
          meetLink,
          meetingIntegration: requestedMeetingIntegration,
        },
      };
    },
  }),
);

export const parseCandidateAvailabilityTool = tool({
  description:
    'Parse candidate availability text (for example "Tuesday 2-5 PM PT") into structured scheduling windows.',
  inputSchema: parseCandidateAvailabilityInputSchema,
  execute: async (input) => {
    const actorUserId = input.actorUserId ?? (await auth0.getSession())?.user?.sub ?? null;

    if (!actorUserId) {
      return {
        check: 'parse_candidate_availability',
        status: 'error',
        message: 'Unauthorized: missing actor identity for availability parsing.',
      };
    }

    let candidateOrganizationId: string | null = null;

    if (input.candidateId) {
      const [candidate] = await db
        .select({ id: candidates.id, organizationId: candidates.organizationId })
        .from(candidates)
        .where(eq(candidates.id, input.candidateId))
        .limit(1);

      if (!candidate) {
        return {
          check: 'parse_candidate_availability',
          status: 'error',
          message: `Candidate ${input.candidateId} not found.`,
        };
      }

      candidateOrganizationId = candidate.organizationId ?? null;

      const canView = await canViewCandidate(actorUserId, input.candidateId);
      if (!canView) {
        return {
          check: 'parse_candidate_availability',
          status: 'error',
          message: `Forbidden: no candidate visibility access for ${input.candidateId}.`,
        };
      }
    }

    const referenceDate = input.referenceDateISO ? new Date(input.referenceDateISO) : new Date();
    const parsed = parseAvailabilityWindows({
      availabilityText: input.availabilityText,
      defaultTimezone: input.timezone,
      referenceDate,
    });

    if (parsed.windows.length === 0) {
      return {
        check: 'parse_candidate_availability',
        status: 'error',
        message:
          'Could not parse availability windows from the provided text. Include weekday plus start-end time (for example "Tuesday 2-5 PM PT").',
      };
    }

    await db.insert(auditLogs).values({
      organizationId: input.organizationId ?? candidateOrganizationId ?? null,
      actorType: 'agent',
      actorId: 'parse_candidate_availability',
      actorDisplayName: 'Liaison Agent',
      action: 'interview.availability.parsed',
      resourceType: input.candidateId ? 'candidate' : 'availability',
      resourceId: input.candidateId ?? actorUserId,
      metadata: {
        actorUserId,
        candidateId: input.candidateId ?? null,
        parsedWindowCount: parsed.windows.length,
        detectedTimezone: parsed.detectedTimezone,
      },
      result: 'success',
    });

    return {
      check: 'parse_candidate_availability',
      status: 'success',
      candidateId: input.candidateId ?? null,
      detectedTimezone: parsed.detectedTimezone,
      windows: parsed.windows,
    };
  },
});
