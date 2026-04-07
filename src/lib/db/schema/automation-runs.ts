import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { nanoid } from '@/utils/nano-id';

export const AUTOMATION_RUN_STATUSES = [
  'pending',
  'running',
  'retrying',
  'paused_awaiting_reauth',
  'completed',
  'dead_letter',
  'cancelled',
] as const;
export const automationRunStatusSchema = z.enum(AUTOMATION_RUN_STATUSES);

export const automationRuns = pgTable(
  'automation_runs',
  {
    id: varchar('id', { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    handlerType: varchar('handler_type', { length: 120 }).notNull(),
    resourceType: varchar('resource_type', { length: 120 }).notNull(),
    resourceId: varchar('resource_id', { length: 191 }).notNull(),
    replayedFromRunId: varchar('replayed_from_run_id', { length: 191 }),
    idempotencyKey: varchar('idempotency_key', { length: 250 }).notNull(),
    status: varchar('status', { length: 50 }).notNull().default('pending'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    result: jsonb('result').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(8),
    nextAttemptAt: timestamp('next_attempt_at').notNull().default(sql`now()`),
    lastError: varchar('last_error', { length: 2000 }),
    lastErrorAt: timestamp('last_error_at'),
    startedAt: timestamp('started_at'),
    finishedAt: timestamp('finished_at'),
    createdAt: timestamp('created_at').notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at').notNull().default(sql`now()`),
  },
  (table) => [
    uniqueIndex('automation_runs_handler_idempotency_idx').on(table.handlerType, table.idempotencyKey),
    index('automation_runs_status_next_attempt_idx').on(table.status, table.nextAttemptAt),
    index('automation_runs_resource_idx').on(table.resourceType, table.resourceId),
  ],
);

export const automationRunSchema = createSelectSchema(automationRuns, {
  status: automationRunStatusSchema,
}).extend({});

export const automationRunInsertSchema = createInsertSchema(automationRuns, {
  status: automationRunStatusSchema,
})
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    payload: z.record(z.string(), z.unknown()),
    result: z.record(z.string(), z.unknown()).optional(),
  });

export type AutomationRun = z.infer<typeof automationRunSchema>;
export type AutomationRunInsert = z.infer<typeof automationRunInsertSchema>;
