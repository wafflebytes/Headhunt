import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { nanoid } from '@/utils/nano-id';
import { organizations } from './organizations';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: varchar('id', { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    organizationId: varchar('organization_id', { length: 191 }).references(() => organizations.id, {
      onDelete: 'set null',
    }),
    actorType: varchar('actor_type', { length: 50 }).notNull(),
    actorId: varchar('actor_id', { length: 191 }).notNull(),
    actorDisplayName: varchar('actor_display_name', { length: 191 }).notNull(),
    action: varchar('action', { length: 191 }).notNull(),
    resourceType: varchar('resource_type', { length: 100 }).notNull(),
    resourceId: varchar('resource_id', { length: 191 }).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    result: varchar('result', { length: 30 }).notNull(),
    timestamp: timestamp('timestamp')
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('audit_logs_resource_idx').on(table.resourceType, table.resourceId, table.timestamp)],
);

export const auditLogSchema = createSelectSchema(auditLogs).extend({});

export type AuditLog = z.infer<typeof auditLogSchema>;
