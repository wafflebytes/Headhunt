import { and, eq } from 'drizzle-orm';
import { tool } from 'ai';
import { z } from 'zod';
import { TokenVaultError } from '@auth0/ai/interrupts';

import { auth0 } from '@/lib/auth0';
import {
  CAL_BOOKINGS_API_VERSION,
  CAL_COM_API_BASE_URL,
  CAL_COM_SCOPES,
  CAL_COM_TOKEN_VAULT_CONNECTION,
  CAL_SLOTS_API_VERSION,
  getAccessToken,
  withCal,
} from '@/lib/auth0-ai';
import { db } from '@/lib/db';
import { applications } from '@/lib/db/schema/applications';
import { auditLogs } from '@/lib/db/schema/audit-logs';
import { candidates } from '@/lib/db/schema/candidates';
import { interviews } from '@/lib/db/schema/interviews';
import { jobs } from '@/lib/db/schema/jobs';
import { canViewCandidate } from '@/lib/fga/fga';

const scheduleInterviewWithCalInputSchema = z.object({
  candidateId: z.string().min(1),
  jobId: z.string().min(1),
  organizationId: z.string().optional(),
  actorUserId: z.string().min(1).optional(),
  eventTypeId: z.number().int().positive().optional(),
  eventTypeSlug: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  teamSlug: z.string().min(1).optional(),
  organizationSlug: z.string().min(1).optional(),
  selectedStartISO: z.string().datetime().optional(),
  windowStartISO: z.string().datetime().optional(),
  windowEndISO: z.string().datetime().optional(),
  durationMinutes: z.number().int().min(15).max(180).default(60),
  maxSuggestions: z.number().int().min(1).max(12).default(5),
  timezone: z.string().default('America/Los_Angeles'),
});

type CalSlot = {
  startISO: string;
  endISO: string;
};

const DEFAULT_CAL_MEETING_INTEGRATION = 'cal-video';

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

function normalizeWindow(params: {
  windowStartISO?: string;
  windowEndISO?: string;
}): { start: Date; end: Date } {
  const now = new Date();
  const start = params.windowStartISO ? new Date(params.windowStartISO) : now;
  const end = params.windowEndISO ? new Date(params.windowEndISO) : new Date(start.getTime() + 3 * 24 * 60 * 60 * 1000);

  return { start, end };
}

function getDefaultEventTypeId(): number | undefined {
  const raw = process.env.CAL_TEST_EVENT_TYPE_ID?.trim();
  if (!raw) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function buildSlotsUrl(params: {
  eventTypeId?: number;
  eventTypeSlug?: string;
  username?: string;
  teamSlug?: string;
  organizationSlug?: string;
  startISO: string;
  endISO: string;
  timezone: string;
}): URL {
  const url = new URL('/v2/slots', CAL_COM_API_BASE_URL);
  url.searchParams.set('start', params.startISO);
  url.searchParams.set('end', params.endISO);
  url.searchParams.set('timeZone', params.timezone);
  url.searchParams.set('format', 'range');

  if (typeof params.eventTypeId === 'number') {
    url.searchParams.set('eventTypeId', String(params.eventTypeId));
  } else if (params.eventTypeSlug) {
    url.searchParams.set('eventTypeSlug', params.eventTypeSlug);

    if (params.username) {
      url.searchParams.set('username', params.username);
    }

    if (params.teamSlug) {
      url.searchParams.set('teamSlug', params.teamSlug);
    }

    if (params.organizationSlug) {
      url.searchParams.set('organizationSlug', params.organizationSlug);
    }
  }

  return url;
}

function parseSlots(payload: unknown): CalSlot[] {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  const data = record && typeof record.data === 'object' && record.data ? (record.data as Record<string, unknown>) : null;

  if (!data) {
    return [];
  }

  const slots: CalSlot[] = [];

  for (const dateKey of Object.keys(data).sort()) {
    const daySlots = data[dateKey];
    if (!Array.isArray(daySlots)) {
      continue;
    }

    for (const slot of daySlots) {
      if (!slot || typeof slot !== 'object') {
        continue;
      }

      const slotRecord = slot as Record<string, unknown>;
      const startISO = toIso(slotRecord.start);
      const endISO = toIso(slotRecord.end);

      if (startISO && endISO) {
        slots.push({ startISO, endISO });
      }
    }
  }

  slots.sort((a, b) => new Date(a.startISO).getTime() - new Date(b.startISO).getTime());
  return slots;
}

function pickSlot(params: {
  slots: CalSlot[];
  selectedStartISO?: string;
}): CalSlot | null {
  if (params.slots.length === 0) {
    return null;
  }

  if (!params.selectedStartISO) {
    return params.slots[0];
  }

  const selectedMs = new Date(params.selectedStartISO).getTime();
  if (Number.isNaN(selectedMs)) {
    return null;
  }

  const matched = params.slots.find((slot) => {
    const slotMs = new Date(slot.startISO).getTime();
    return Math.abs(slotMs - selectedMs) <= 60_000;
  });

  return matched ?? null;
}

function extractCalBooking(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const data = record.data;

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }

  if (Array.isArray(data) && data.length > 0 && data[0] && typeof data[0] === 'object') {
    return data[0] as Record<string, unknown>;
  }

  return null;
}

function isAuthFailureStatus(status: number): boolean {
  return status === 401 || status === 403;
}

type CalRequestAuthMode = 'token_vault' | 'public';

export const scheduleInterviewWithCalTool = withCal(
  tool({
    description:
      'Create an interview booking using Cal.com API v2 from founder availability and persist interview state. Returns the Cal-generated booking/location link.',
    inputSchema: scheduleInterviewWithCalInputSchema,
    execute: async (input) => {
      const actorUserId = input.actorUserId ?? (await auth0.getSession())?.user?.sub ?? null;

      if (!actorUserId) {
        return {
          check: 'schedule_with_cal',
          status: 'error',
          message: 'Unauthorized: missing actor identity for Cal scheduling.',
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
          check: 'schedule_with_cal',
          status: 'error',
          message: `Candidate ${input.candidateId} not found.`,
        };
      }

      if (!candidate.contactEmail) {
        return {
          check: 'schedule_with_cal',
          status: 'error',
          message: 'Candidate is missing contact email required for booking creation.',
        };
      }

      const canView = await canViewCandidate(actorUserId, candidate.id);
      if (!canView) {
        return {
          check: 'schedule_with_cal',
          status: 'error',
          message: `Forbidden: no candidate visibility access for ${input.candidateId}.`,
        };
      }

      const [job] = await db.select({ id: jobs.id, title: jobs.title }).from(jobs).where(eq(jobs.id, input.jobId)).limit(1);
      if (!job) {
        return {
          check: 'schedule_with_cal',
          status: 'error',
          message: `Job ${input.jobId} not found.`,
        };
      }

      const defaultEventTypeId = getDefaultEventTypeId();
      const eventTypeId = input.eventTypeId ?? defaultEventTypeId;

      const hasEventTypeId = typeof eventTypeId === 'number';
      const hasSlugPath = Boolean(input.eventTypeSlug && (input.username || input.teamSlug));

      if (!hasEventTypeId && !hasSlugPath) {
        return {
          check: 'schedule_with_cal',
          status: 'error',
          message:
            'Missing Cal event type selector. Provide eventTypeId, or eventTypeSlug with username/teamSlug. You can also set CAL_TEST_EVENT_TYPE_ID in env for default testing.',
        };
      }

      const { start, end } = normalizeWindow({
        windowStartISO: input.windowStartISO,
        windowEndISO: input.windowEndISO,
      });

      if (end <= start) {
        return {
          check: 'schedule_with_cal',
          status: 'error',
          message: 'Invalid scheduling window: windowEndISO must be after windowStartISO.',
        };
      }

      try {
        let accessToken: string | null = null;
        let requestAuthMode: CalRequestAuthMode = 'token_vault';

        if (hasSlugPath) {
          try {
            accessToken = await getAccessToken();
          } catch (error) {
            if (error instanceof TokenVaultError) {
              // Public slug-based scheduling can still proceed without Token Vault bearer tokens.
              requestAuthMode = 'public';
            } else {
              throw error;
            }
          }
        } else {
          accessToken = await getAccessToken();
        }

        const withAuthModeHeaders = (
          mode: CalRequestAuthMode,
          apiVersion: string,
          includeJsonContentType = false,
        ) => {
          const headers: Record<string, string> = {
            'cal-api-version': apiVersion,
          };

          if (includeJsonContentType) {
            headers['Content-Type'] = 'application/json';
          }

          if (mode === 'token_vault' && accessToken) {
            headers.Authorization = `Bearer ${accessToken}`;
          }

          return headers;
        };

        const slotsUrl = buildSlotsUrl({
          eventTypeId,
          eventTypeSlug: input.eventTypeSlug,
          username: input.username,
          teamSlug: input.teamSlug,
          organizationSlug: input.organizationSlug,
          startISO: start.toISOString(),
          endISO: end.toISOString(),
          timezone: input.timezone,
        });

        let slotsResponse = await fetch(slotsUrl.toString(), {
          headers: withAuthModeHeaders(requestAuthMode, CAL_SLOTS_API_VERSION),
        });

        if (isAuthFailureStatus(slotsResponse.status) && requestAuthMode === 'token_vault' && hasSlugPath) {
          requestAuthMode = 'public';
          slotsResponse = await fetch(slotsUrl.toString(), {
            headers: withAuthModeHeaders(requestAuthMode, CAL_SLOTS_API_VERSION),
          });
        }

        if (isAuthFailureStatus(slotsResponse.status)) {
          throw new TokenVaultError(
            `Authorization required to access Cal slots (${CAL_COM_TOKEN_VAULT_CONNECTION}). Required scopes: ${CAL_COM_SCOPES.join(', ')}`,
          );
        }

        if (!slotsResponse.ok) {
          const details = await slotsResponse.text();
          return {
            check: 'schedule_with_cal',
            status: 'error',
            message: `Failed to fetch Cal availability (${slotsResponse.status}): ${details}`,
          };
        }

        const slotsPayload = (await slotsResponse.json()) as unknown;
        const allSlots = parseSlots(slotsPayload).slice(0, input.maxSuggestions);

        if (allSlots.length === 0) {
          return {
            check: 'schedule_with_cal',
            status: 'error',
            message: 'No available Cal slots found in the selected window.',
          };
        }

        const selectedSlot = pickSlot({
          slots: allSlots,
          selectedStartISO: input.selectedStartISO,
        });

        if (!selectedSlot) {
          return {
            check: 'schedule_with_cal',
            status: 'error',
            message:
              'selectedStartISO is stale or invalid for the current Cal availability window. Retry without selectedStartISO or choose one from returned slots.',
            slots: allSlots,
          };
        }

        let requestedMeetingIntegration = DEFAULT_CAL_MEETING_INTEGRATION;

        const bookingBody: Record<string, unknown> = {
          start: selectedSlot.startISO,
          attendee: {
            name: candidate.name,
            email: candidate.contactEmail,
            timeZone: input.timezone,
            language: 'en',
          },
          location: {
            type: 'integration',
            integration: requestedMeetingIntegration,
          },
          metadata: {
            source: 'headhunt-cal-proof',
            candidateId: input.candidateId,
            jobId: input.jobId,
          },
          lengthInMinutes: input.durationMinutes,
        };

        if (typeof eventTypeId === 'number') {
          bookingBody.eventTypeId = eventTypeId;
        } else if (input.eventTypeSlug) {
          bookingBody.eventTypeSlug = input.eventTypeSlug;
          if (input.username) {
            bookingBody.username = input.username;
          }
          if (input.teamSlug) {
            bookingBody.teamSlug = input.teamSlug;
          }
          if (input.organizationSlug) {
            bookingBody.organizationSlug = input.organizationSlug;
          }
        }

        const bookingsUrl = new URL('/v2/bookings', CAL_COM_API_BASE_URL).toString();

        const executeBookingRequest = async (body: Record<string, unknown>) => {
          let response = await fetch(bookingsUrl, {
            method: 'POST',
            headers: withAuthModeHeaders(requestAuthMode, CAL_BOOKINGS_API_VERSION, true),
            body: JSON.stringify(body),
          });

          if (isAuthFailureStatus(response.status) && requestAuthMode === 'token_vault' && hasSlugPath) {
            requestAuthMode = 'public';
            response = await fetch(bookingsUrl, {
              method: 'POST',
              headers: withAuthModeHeaders(requestAuthMode, CAL_BOOKINGS_API_VERSION, true),
              body: JSON.stringify(body),
            });
          }

          return response;
        };

        let bookingResponse = await executeBookingRequest(bookingBody);

        if (isAuthFailureStatus(bookingResponse.status)) {
          throw new TokenVaultError(
            `Authorization required to create Cal booking (${CAL_COM_TOKEN_VAULT_CONNECTION}). Required scopes: ${CAL_COM_SCOPES.join(', ')}`,
          );
        }

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
            bookingResponse = await executeBookingRequest(bookingBody);

            if (isAuthFailureStatus(bookingResponse.status)) {
              throw new TokenVaultError(
                `Authorization required to create Cal booking (${CAL_COM_TOKEN_VAULT_CONNECTION}). Required scopes: ${CAL_COM_SCOPES.join(', ')}`,
              );
            }

            if (!bookingResponse.ok) {
              details = await bookingResponse.text();
            }
          }

          if (!bookingResponse.ok) {
            const stillIntegrationNotSupported =
              /location with integration/i.test(details) || /booking location with integration/i.test(details);

            if (stillIntegrationNotSupported) {
              return {
                check: 'schedule_with_cal',
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
              bookingResponse = await executeBookingRequest(bookingBody);

              if (isAuthFailureStatus(bookingResponse.status)) {
                throw new TokenVaultError(
                  `Authorization required to create Cal booking (${CAL_COM_TOKEN_VAULT_CONNECTION}). Required scopes: ${CAL_COM_SCOPES.join(', ')}`,
                );
              }

              if (!bookingResponse.ok) {
                const retryDetails = await bookingResponse.text();
                return {
                  check: 'schedule_with_cal',
                  status: 'error',
                  message: `Failed to create Cal booking (${bookingResponse.status}): ${retryDetails}`,
                };
              }
            } else {
              return {
                check: 'schedule_with_cal',
                status: 'error',
                message: `Failed to create Cal booking (${bookingResponse.status}): ${details}`,
              };
            }
          }
        }

        const bookingPayload = (await bookingResponse.json()) as unknown;
        const booking = extractCalBooking(bookingPayload);

        const bookingUidRaw = booking?.uid;
        const bookingUid = typeof bookingUidRaw === 'string' && bookingUidRaw.trim() ? bookingUidRaw : null;

        const bookingStartISO = toIso(booking?.start) ?? selectedSlot.startISO;
        const bookingEndISO = toIso(booking?.end) ?? selectedSlot.endISO;
        const locationRaw = booking?.location;
        const meetingUrlRaw = booking?.meetingUrl;
        const location = typeof locationRaw === 'string' && locationRaw.trim() ? locationRaw : null;
        const meetingUrl = typeof meetingUrlRaw === 'string' && meetingUrlRaw.trim() ? meetingUrlRaw : null;
        const meetLink = location ?? meetingUrl;
        const derivedDurationMinutes = Math.max(
          1,
          Math.round((new Date(bookingEndISO).getTime() - new Date(bookingStartISO).getTime()) / 60000),
        );
        const finalDurationMinutes = Number.isFinite(derivedDurationMinutes)
          ? derivedDurationMinutes
          : input.durationMinutes;

        const updatedAt = new Date();
        const [interviewRow] = await db.transaction(async (tx) => {
          const [createdInterview] = await tx
            .insert(interviews)
            .values({
              organizationId: input.organizationId ?? candidate.organizationId ?? null,
              candidateId: input.candidateId,
              jobId: input.jobId,
              scheduledAt: new Date(bookingStartISO),
              durationMinutes: finalDurationMinutes,
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
            organizationId: input.organizationId ?? candidate.organizationId ?? null,
            actorType: 'agent',
            actorId: 'schedule_interview_with_cal',
            actorDisplayName: 'Liaison Agent (Cal)',
            action: 'interview.scheduled',
            resourceType: 'candidate',
            resourceId: input.candidateId,
            metadata: {
              actorUserId,
              jobId: input.jobId,
              provider: 'cal',
              authMode: requestAuthMode,
              bookingUid,
              location,
              selectedStartISO: bookingStartISO,
              selectedEndISO: bookingEndISO,
              eventTypeId: eventTypeId ?? null,
              eventTypeSlug: input.eventTypeSlug ?? null,
              username: input.username ?? null,
              teamSlug: input.teamSlug ?? null,
              organizationSlug: input.organizationSlug ?? null,
              meetingIntegration: requestedMeetingIntegration,
            },
            result: 'success',
          });

          return [createdInterview];
        });

        return {
          check: 'schedule_with_cal',
          status: 'success',
          mode: 'schedule',
          provider: 'cal',
          authMode: requestAuthMode,
          candidateId: input.candidateId,
          jobId: input.jobId,
          interviewId: interviewRow.id,
          durationMinutes: finalDurationMinutes,
          event: {
            bookingUid,
            startISO: bookingStartISO,
            endISO: bookingEndISO,
            location,
            meetLink,
            meetingIntegration: requestedMeetingIntegration,
          },
          slots: allSlots,
        };
      } catch (error) {
        if (error instanceof TokenVaultError) {
          throw error;
        }

        return {
          check: 'schedule_with_cal',
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error while scheduling with Cal.',
        };
      }
    },
  }),
);
