import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { nanoid } from '@/utils/nano-id';
import { organizations } from './organizations';

export const frontendMockSnapshots = pgTable(
  'frontend_mock_snapshots',
  {
    id: varchar('id', { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    slug: varchar('slug', { length: 120 }).notNull(),
    version: varchar('version', { length: 80 }).notNull(),
    organizationId: varchar('organization_id', { length: 191 }).references(() => organizations.id, {
      onDelete: 'set null',
    }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    seededAt: timestamp('seeded_at')
      .notNull()
      .default(sql`now()`),
    createdAt: timestamp('created_at')
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at')
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('frontend_mock_snapshots_slug_version_idx').on(table.slug, table.version),
    index('frontend_mock_snapshots_org_idx').on(table.organizationId),
    index('frontend_mock_snapshots_seeded_at_idx').on(table.seededAt),
  ],
);

export const frontendMockSnapshotSchema = createSelectSchema(frontendMockSnapshots).extend({});

export const frontendMockSnapshotInsertSchema = createInsertSchema(frontendMockSnapshots)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    slug: z.string().min(1),
    version: z.string().min(1),
  });

export type FrontendMockSnapshot = z.infer<typeof frontendMockSnapshotSchema>;
export type FrontendMockSnapshotInsert = z.infer<typeof frontendMockSnapshotInsertSchema>;
