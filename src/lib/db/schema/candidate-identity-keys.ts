import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { nanoid } from '@/utils/nano-id';
import { candidates } from './candidates';
import { jobs } from './jobs';
import { organizations } from './organizations';

export const CANDIDATE_IDENTITY_KEY_TYPES = [
  'gmail_message_id',
  'gmail_thread_id',
  'email_job',
] as const;

export const candidateIdentityKeyTypeSchema = z.enum(CANDIDATE_IDENTITY_KEY_TYPES);

export const candidateIdentityKeys = pgTable(
  'candidate_identity_keys',
  {
    id: varchar('id', { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    organizationId: varchar('organization_id', { length: 191 }).references(() => organizations.id, {
      onDelete: 'set null',
    }),
    jobId: varchar('job_id', { length: 191 })
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    candidateId: varchar('candidate_id', { length: 191 })
      .notNull()
      .references(() => candidates.id, { onDelete: 'cascade' }),
    keyType: varchar('key_type', { length: 80 }).notNull(),
    keyValue: text('key_value').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    firstSeenAt: timestamp('first_seen_at')
      .notNull()
      .default(sql`now()`),
    lastSeenAt: timestamp('last_seen_at')
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
    uniqueIndex('candidate_identity_keys_type_value_job_idx').on(table.keyType, table.keyValue, table.jobId),
    index('candidate_identity_keys_candidate_idx').on(table.candidateId),
    index('candidate_identity_keys_job_type_idx').on(table.jobId, table.keyType),
    index('candidate_identity_keys_org_idx').on(table.organizationId),
  ],
);

export const candidateIdentityKeySchema = createSelectSchema(candidateIdentityKeys, {
  keyType: candidateIdentityKeyTypeSchema,
});

export const candidateIdentityKeyInsertSchema = createInsertSchema(candidateIdentityKeys, {
  keyType: candidateIdentityKeyTypeSchema,
})
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    keyValue: z.string().min(1),
  });

export type CandidateIdentityKey = z.infer<typeof candidateIdentityKeySchema>;
export type CandidateIdentityKeyInsert = z.infer<typeof candidateIdentityKeyInsertSchema>;
