import { tool } from 'ai';
import { GaxiosError } from 'gaxios';
import { google } from 'googleapis';
import { z } from 'zod';
import { TokenVaultError } from '@auth0/ai/interrupts';

import { auth0 } from '@/lib/auth0';
import { getGoogleAccessToken, withCalendar } from '@/lib/auth0-ai';

function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function formatWhen(startISO: string, endISO: string, timezone: string): string {
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

const calendarEventsInputSchema = z.object({
  calendarId: z.string().min(1).default('primary'),
  timeMinISO: z.string().datetime(),
  timeMaxISO: z.string().datetime(),
  timezone: z.string().default('America/Los_Angeles'),
  maxResults: z.number().int().min(1).max(250).default(50),
  q: z.string().min(1).max(300).optional(),
  singleEvents: z.boolean().default(true),
});

export const calendarEventsTool = withCalendar(
  tool({
    description:
      'calendar.events: List Google Calendar events in a time window with strict, readable output (ISO timestamps + display label).',
    inputSchema: calendarEventsInputSchema,
    execute: async (input) => {
      const actorUserId = (await auth0.getSession())?.user?.sub ?? null;
      if (!actorUserId) {
        return {
          check: 'calendar_events',
          status: 'error',
          message: 'Unauthorized: missing actor identity for calendar.events.',
        };
      }

      try {
        const accessToken = await getGoogleAccessToken();
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });

        const calendar = google.calendar('v3');
        const response = await calendar.events.list({
          auth,
          calendarId: input.calendarId,
          timeMin: input.timeMinISO,
          timeMax: input.timeMaxISO,
          singleEvents: input.singleEvents,
          orderBy: input.singleEvents ? 'startTime' : undefined,
          maxResults: input.maxResults,
          q: input.q,
          showDeleted: false,
        });

        const items = response.data.items ?? [];

        const events = items
          .filter((event) => event.status !== 'cancelled')
          .map((event) => {
            const startRaw = event.start?.dateTime ?? event.start?.date ?? null;
            const endRaw = event.end?.dateTime ?? event.end?.date ?? null;
            const startISO = toIso(startRaw);
            const endISO = toIso(endRaw);

            if (!startISO || !endISO) {
              return null;
            }

            const isAllDay = Boolean(event.start?.date && !event.start?.dateTime);

            return {
              id: event.id ?? null,
              summary: event.summary ?? '(no title)',
              startISO,
              endISO,
              when: formatWhen(startISO, endISO, input.timezone),
              isAllDay,
              location: event.location ?? null,
              status: event.status ?? null,
              htmlLink: event.htmlLink ?? null,
              attendees:
                (event.attendees ?? []).map((attendee) => ({
                  email: attendee.email ?? null,
                  displayName: attendee.displayName ?? null,
                  responseStatus: attendee.responseStatus ?? null,
                })) ?? [],
            };
          })
          .filter((event): event is NonNullable<typeof event> => Boolean(event));

        return {
          check: 'calendar_events',
          status: 'success',
          calendarId: input.calendarId,
          timeMinISO: input.timeMinISO,
          timeMaxISO: input.timeMaxISO,
          timezone: input.timezone,
          eventsCount: events.length,
          events,
        };
      } catch (error) {
        if (error instanceof GaxiosError && error.status === 401) {
          throw new TokenVaultError('Authorization required to access the Token Vault connection.');
        }

        if (error instanceof TokenVaultError) {
          throw error;
        }

        return {
          check: 'calendar_events',
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error while listing calendar events.',
        };
      }
    },
  }),
);
