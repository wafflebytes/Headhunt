import { and, eq } from 'drizzle-orm';
import { tool } from 'ai';
import { GaxiosError } from 'gaxios';
import { google } from 'googleapis';
import { z } from 'zod';
import { TokenVaultError } from '@auth0/ai/interrupts';

import { auth0 } from '@/lib/auth0';
import { getGoogleAccessToken, withCalendar } from '@/lib/auth0-ai';
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
    /missing refresh token|refresh token not found|offline access/i.test(error.message)
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

  let cursor = new Date(params.windowStart);

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

          return {
            check: 'schedule_interview_slots',
            status: 'success',
            mode: 'propose',
            candidateId: input.candidateId,
            jobId: input.jobId,
            durationMinutes: input.durationMinutes,
            slots,
            recommendedSlotIndex: slots.length > 0 ? 0 : -1,
          };
        }

        const selectedStart = new Date(input.selectedStartISO);
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
