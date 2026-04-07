import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { organizations } from './organizations';

export const userWorkspaces = pgTable(
  'user_workspaces',
  {
    userId: varchar('user_id', { length: 191 }).primaryKey(),
    organizationId: varchar('organization_id', { length: 191 }).references(() => organizations.id, {
      onDelete: 'set null',
    }),
    role: varchar('role', { length: 50 }),
    avatarUrl: text('avatar_url'),
    createdAt: timestamp('created_at')
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at')
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('user_workspaces_org_idx').on(table.organizationId),
    index('user_workspaces_updated_at_idx').on(table.updatedAt),
  ],
);

export const userWorkspaceSchema = createSelectSchema(userWorkspaces).extend({});

export const userWorkspaceInsertSchema = createInsertSchema(userWorkspaces)
  .omit({
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    userId: z.string().min(1),
  });

export type UserWorkspace = z.infer<typeof userWorkspaceSchema>;
export type UserWorkspaceInsert = z.infer<typeof userWorkspaceInsertSchema>;
