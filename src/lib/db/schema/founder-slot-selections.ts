import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { nanoid } from '@/utils/nano-id';
import { candidates } from './candidates';
import { jobs } from './jobs';
import { organizations } from './organizations';

export const FOUNDER_SLOT_SELECTION_STATUSES = ['draft', 'link_ready', 'sent', 'drafted'] as const;
export const founderSlotSelectionStatusSchema = z.enum(FOUNDER_SLOT_SELECTION_STATUSES);

export const founderSlotRangeSchema = z.object({
  startISO: z.string().datetime(),
  endISO: z.string().datetime(),
});

export const founderSlotSelections = pgTable(
  'founder_slot_selections',
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
    actorUserId: varchar('actor_user_id', { length: 191 }).notNull(),
    timezone: varchar('timezone', { length: 100 }).notNull().default('UTC'),
    durationMinutes: integer('duration_minutes').notNull().default(30),
    selectedRanges: jsonb('selected_ranges')
      .$type<Array<z.infer<typeof founderSlotRangeSchema>>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    calEventTypeId: integer('cal_event_type_id'),
    calEventTypeSlug: varchar('cal_event_type_slug', { length: 191 }),
    calOwnerUsername: varchar('cal_owner_username', { length: 191 }),
    calTeamSlug: varchar('cal_team_slug', { length: 191 }),
    calOrganizationSlug: varchar('cal_organization_slug', { length: 191 }),
    calBookingUrl: text('cal_booking_url'),
    sourceEmailThreadId: varchar('source_email_thread_id', { length: 191 }),
    proposalProviderId: varchar('proposal_provider_id', { length: 191 }),
    proposalProviderThreadId: varchar('proposal_provider_thread_id', { length: 191 }),
    status: varchar('status', { length: 50 }).notNull().default('draft'),
    createdAt: timestamp('created_at')
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at')
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('founder_slot_selections_candidate_job_idx').on(table.candidateId, table.jobId),
    index('founder_slot_selections_created_at_idx').on(table.createdAt),
  ],
);

export const founderSlotSelectionSchema = createSelectSchema(founderSlotSelections, {
  selectedRanges: z.array(founderSlotRangeSchema),
  status: founderSlotSelectionStatusSchema,
}).extend({});

export const founderSlotSelectionInsertSchema = createInsertSchema(founderSlotSelections, {
  selectedRanges: z.array(founderSlotRangeSchema),
  status: founderSlotSelectionStatusSchema,
})
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    selectedRanges: z.array(founderSlotRangeSchema).min(1),
  });

export const founderSlotSelectionUpdateSchema = founderSlotSelectionInsertSchema
  .partial()
  .extend({
    id: z.string().min(1),
  });

export type FounderSlotSelection = z.infer<typeof founderSlotSelectionSchema>;
export type FounderSlotSelectionInsert = z.infer<typeof founderSlotSelectionInsertSchema>;
export type FounderSlotSelectionUpdate = z.infer<typeof founderSlotSelectionUpdateSchema>;