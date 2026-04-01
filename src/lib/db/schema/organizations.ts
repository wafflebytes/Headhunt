import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { nanoid } from '@/utils/nano-id';

export const organizations = pgTable('organizations', {
  id: varchar('id', { length: 191 })
    .primaryKey()
    .$defaultFn(() => nanoid()),
  name: text('name').notNull(),
  createdAt: timestamp('created_at')
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at')
    .notNull()
    .default(sql`now()`),
});

export const organizationSchema = createSelectSchema(organizations).extend({});

export const organizationInsertSchema = createInsertSchema(organizations)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    name: z.string().min(1),
  });

export const organizationUpdateSchema = organizationInsertSchema
  .partial()
  .extend({
    id: z.string().min(1),
  });

export type Organization = z.infer<typeof organizationSchema>;
export type OrganizationInsert = z.infer<typeof organizationInsertSchema>;
export type OrganizationUpdate = z.infer<typeof organizationUpdateSchema>;
