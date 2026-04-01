import { sql } from 'drizzle-orm';
import { index, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { nanoid } from '@/utils/nano-id';
import { candidates } from './candidates';
import { jobs } from './jobs';

export const applications = pgTable(
  'applications',
  {
    id: varchar('id', { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    candidateId: varchar('candidate_id', { length: 191 })
      .notNull()
      .references(() => candidates.id, { onDelete: 'cascade' }),
    jobId: varchar('job_id', { length: 191 })
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    stage: varchar('stage', { length: 50 }).notNull().default('applied'),
    status: varchar('status', { length: 50 }).notNull().default('active'),
    createdAt: timestamp('created_at')
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at')
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('applications_candidate_job_idx').on(table.candidateId, table.jobId),
    index('applications_job_stage_idx').on(table.jobId, table.stage),
  ],
);

export const applicationSchema = createSelectSchema(applications).extend({});

export type Application = z.infer<typeof applicationSchema>;
