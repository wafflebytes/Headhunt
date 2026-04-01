import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { nanoid } from '@/utils/nano-id';
import { jobs } from './jobs';
import { organizations } from './organizations';

export const candidates = pgTable(
  'candidates',
  {
    id: varchar('id', { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    organizationId: varchar('organization_id', { length: 191 }).references(() => organizations.id, {
      onDelete: 'set null',
    }),
    jobId: varchar('job_id', { length: 191 })
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 191 }).notNull(),
    contactEmail: varchar('contact_email', { length: 191 }).notNull(),
    stage: varchar('stage', { length: 50 }).notNull().default('applied'),
    summary: text('summary'),
    sourceEmailMessageId: varchar('source_email_message_id', { length: 191 }).notNull(),
    sourceEmailThreadId: varchar('source_email_thread_id', { length: 191 }),
    sourceEmailReceivedAt: timestamp('source_email_received_at'),
    createdAt: timestamp('created_at')
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at')
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('candidates_source_email_message_id_idx').on(table.sourceEmailMessageId),
    index('candidates_job_stage_idx').on(table.jobId, table.stage),
  ],
);

export const candidateSchema = createSelectSchema(candidates).extend({});

export type Candidate = z.infer<typeof candidateSchema>;
