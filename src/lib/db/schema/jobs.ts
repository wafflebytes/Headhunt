import { sql } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import type { StoredJdTemplate } from '@/lib/jd-template';
import { nanoid } from '@/utils/nano-id';
import { organizations } from './organizations';

export const JOB_STATUSES = ['draft', 'active', 'paused', 'closed'] as const;
export const jobStatusSchema = z.enum(JOB_STATUSES);

export const jobs = pgTable('jobs', {
  id: varchar('id', { length: 191 })
    .primaryKey()
    .$defaultFn(() => nanoid()),
  organizationId: varchar('organization_id', { length: 191 }).references(() => organizations.id, {
    onDelete: 'set null',
  }),
  title: text('title').notNull(),
  jdTemplate: jsonb('jd_template').$type<StoredJdTemplate>().notNull().default(sql`'{}'::jsonb`),
  status: varchar('status', { length: 50 }).notNull().default('active'),
  createdAt: timestamp('created_at')
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at')
    .notNull()
    .default(sql`now()`),
});

export const jobSchema = createSelectSchema(jobs, {
  status: jobStatusSchema,
}).extend({});

export const jobInsertSchema = createInsertSchema(jobs, {
  status: jobStatusSchema,
})
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    title: z.string().min(1),
  });

export const jobUpdateSchema = jobInsertSchema
  .partial()
  .extend({
    id: z.string().min(1),
  });

export type Job = z.infer<typeof jobSchema>;
export type JobInsert = z.infer<typeof jobInsertSchema>;
export type JobUpdate = z.infer<typeof jobUpdateSchema>;
