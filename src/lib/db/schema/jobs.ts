import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { nanoid } from '@/utils/nano-id';
import { organizations } from './organizations';

export const jobs = pgTable('jobs', {
  id: varchar('id', { length: 191 })
    .primaryKey()
    .$defaultFn(() => nanoid()),
  organizationId: varchar('organization_id', { length: 191 }).references(() => organizations.id, {
    onDelete: 'set null',
  }),
  title: text('title').notNull(),
  status: varchar('status', { length: 50 }).notNull().default('active'),
  createdAt: timestamp('created_at')
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at')
    .notNull()
    .default(sql`now()`),
});

export const jobSchema = createSelectSchema(jobs).extend({});

export type Job = z.infer<typeof jobSchema>;
