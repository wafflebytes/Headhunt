import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { nanoid } from '@/utils/nano-id';
import { organizations } from './organizations';

export const AUDIT_ACTOR_TYPES = ['agent', 'user', 'system'] as const;
export const AUDIT_RESULTS = ['success', 'pending', 'denied', 'error'] as const;
export const auditActorTypeSchema = z.enum(AUDIT_ACTOR_TYPES);
export const auditResultSchema = z.enum(AUDIT_RESULTS);

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

export const auditLogSchema = createSelectSchema(auditLogs, {
  actorType: auditActorTypeSchema,
  result: auditResultSchema,
}).extend({});

export const auditLogInsertSchema = createInsertSchema(auditLogs, {
  actorType: auditActorTypeSchema,
  result: auditResultSchema,
})
  .omit({
    id: true,
    timestamp: true,
  })
  .extend({
    actorId: z.string().min(1),
    actorDisplayName: z.string().min(1),
    action: z.string().min(1),
    resourceType: z.string().min(1),
    resourceId: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()),
  });

export type AuditLog = z.infer<typeof auditLogSchema>;
export type AuditLogInsert = z.infer<typeof auditLogInsertSchema>;
