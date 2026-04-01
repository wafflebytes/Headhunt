import { sql } from 'drizzle-orm';
import { index, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { nanoid } from '@/utils/nano-id';
import { candidates } from './candidates';
import { jobs } from './jobs';

export const APPLICATION_STAGES = [
  'applied',
  'reviewed',
  'interview_scheduled',
  'interviewed',
  'offer_sent',
  'hired',
  'rejected',
] as const;
export const APPLICATION_STATUSES = ['active', 'inactive', 'archived'] as const;
export const applicationStageSchema = z.enum(APPLICATION_STAGES);
export const applicationStatusSchema = z.enum(APPLICATION_STATUSES);

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

export const applicationSchema = createSelectSchema(applications, {
  stage: applicationStageSchema,
  status: applicationStatusSchema,
}).extend({});

export const applicationInsertSchema = createInsertSchema(applications, {
  stage: applicationStageSchema,
  status: applicationStatusSchema,
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const applicationUpdateSchema = applicationInsertSchema
  .partial()
  .extend({
    id: z.string().min(1),
  });

export type Application = z.infer<typeof applicationSchema>;
export type ApplicationInsert = z.infer<typeof applicationInsertSchema>;
export type ApplicationUpdate = z.infer<typeof applicationUpdateSchema>;
