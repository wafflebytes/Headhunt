import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { nanoid } from '@/utils/nano-id';
import { organizations } from './organizations';

export const TEMPLATE_TYPES = ['interview_invitation', 'offer_letter', 'rejection', 'follow_up'] as const;
export const templateTypeSchema = z.enum(TEMPLATE_TYPES);

export const templates = pgTable(
  'templates',
  {
    id: varchar('id', { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    organizationId: varchar('organization_id', { length: 191 }).references(() => organizations.id, {
      onDelete: 'set null',
    }),
    type: varchar('type', { length: 100 }).notNull(),
    name: varchar('name', { length: 191 }).notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    variables: jsonb('variables').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at')
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at')
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('templates_organization_type_idx').on(table.organizationId, table.type)],
);

export const templateSchema = createSelectSchema(templates, {
  type: templateTypeSchema,
}).extend({});

export const templateInsertSchema = createInsertSchema(templates, {
  type: templateTypeSchema,
})
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    name: z.string().min(1),
    subject: z.string().min(1),
    body: z.string().min(1),
    variables: z.array(z.string()),
  });

export const templateUpdateSchema = templateInsertSchema
  .partial()
  .extend({
    id: z.string().min(1),
  });

export type Template = z.infer<typeof templateSchema>;
export type TemplateInsert = z.infer<typeof templateInsertSchema>;
export type TemplateUpdate = z.infer<typeof templateUpdateSchema>;