import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { nanoid } from '@/utils/nano-id';
import { candidates } from './candidates';
import { jobs } from './jobs';
import { organizations } from './organizations';

export const offers = pgTable(
  'offers',
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
    status: varchar('status', { length: 50 }).notNull().default('draft'),
    draftContent: text('draft_content'),
    terms: jsonb('terms').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    initiatedBy: varchar('initiated_by', { length: 191 }),
    cibaAuthReqId: varchar('ciba_auth_req_id', { length: 191 }),
    cibaApprovedBy: varchar('ciba_approved_by', { length: 191 }),
    sentAt: timestamp('sent_at'),
    candidateResponse: varchar('candidate_response', { length: 50 }),
    createdAt: timestamp('created_at')
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at')
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('offers_status_idx').on(table.status), index('offers_candidate_idx').on(table.candidateId)],
);

export const offerSchema = createSelectSchema(offers).extend({});

export type Offer = z.infer<typeof offerSchema>;