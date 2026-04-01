import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { nanoid } from '@/utils/nano-id';
import { candidates } from './candidates';
import { jobs } from './jobs';
import { organizations } from './organizations';

export const interviews = pgTable(
  'interviews',
  {
    id: varchar('id', { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    organizationId: varchar('organization_id', { length: 191 }).references(() => organizations.id, {
      onDelete: 'set null',
    }),
    candidateId: varchar('candidate_id', { length: 191 })
      .notNull()
      .references(() => candidates.id, { onDelete: 'cascade' }),
    jobId: varchar('job_id', { length: 191 })
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    scheduledAt: timestamp('scheduled_at').notNull(),
    durationMinutes: integer('duration_minutes').notNull().default(60),
    status: varchar('status', { length: 50 }).notNull().default('scheduled'),
    googleCalendarEventId: varchar('google_calendar_event_id', { length: 191 }),
    googleMeetLink: text('google_meet_link'),
    summary: text('summary'),
    slackMessageTs: varchar('slack_message_ts', { length: 191 }),
    createdAt: timestamp('created_at')
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at')
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('interviews_candidate_idx').on(table.candidateId),
    index('interviews_job_scheduled_at_idx').on(table.jobId, table.scheduledAt),
  ],
);

export const interviewSchema = createSelectSchema(interviews).extend({});

export type Interview = z.infer<typeof interviewSchema>;