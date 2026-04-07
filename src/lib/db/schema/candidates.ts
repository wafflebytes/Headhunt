import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { nanoid } from '@/utils/nano-id';
import { jobs } from './jobs';
import { organizations } from './organizations';

export const CANDIDATE_STAGES = [
  'applied',
  'reviewed',
  'interview_scheduled',
  'interviewed',
  'offer_sent',
  'hired',
  'rejected',
] as const;
export const candidateStageSchema = z.enum(CANDIDATE_STAGES);

export const candidateScoreBreakdownItemSchema = z.object({
  dimension: z.string().min(1),
  score: z.number().int().min(0).max(100),
  reasoning: z.string().min(1),
});

export const candidateQualificationCheckSchema = z.object({
  requirement: z.string().min(1),
  met: z.boolean(),
  evidence: z.string().min(1),
});

export const candidateWorkHistoryItemSchema = z.object({
  company: z.string().min(1),
  role: z.string().min(1),
  period: z.string().optional(),
});

export const candidates = pgTable(
  'candidates',
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
    name: varchar('name', { length: 191 }).notNull(),
    contactEmail: varchar('contact_email', { length: 191 }).notNull(),
    stage: varchar('stage', { length: 50 }).notNull().default('applied'),
    score: integer('score'),
    objectiveScore: integer('objective_score'),
    intelConfidence: integer('intel_confidence'),
    scoreBreakdown: jsonb('score_breakdown')
      .$type<Array<z.infer<typeof candidateScoreBreakdownItemSchema>>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    qualificationChecks: jsonb('qualification_checks')
      .$type<Array<z.infer<typeof candidateQualificationCheckSchema>>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    workHistory: jsonb('work_history')
      .$type<Array<z.infer<typeof candidateWorkHistoryItemSchema>>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    summary: text('summary'),
    sourceEmailMessageId: varchar('source_email_message_id', { length: 191 }).notNull(),
    sourceEmailThreadId: varchar('source_email_thread_id', { length: 191 }),
    sourceEmailReceivedAt: timestamp('source_email_received_at'),
    createdAt: timestamp('created_at')
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at')
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('candidates_source_email_message_id_idx').on(table.sourceEmailMessageId),
    index('candidates_job_stage_idx').on(table.jobId, table.stage),
    index('candidates_job_stage_score_idx').on(table.jobId, table.stage, table.score),
  ],
);

export const candidateSchema = createSelectSchema(candidates, {
  stage: candidateStageSchema,
  score: z.number().int().min(0).max(100).nullable(),
  objectiveScore: z.number().int().min(0).max(100).nullable(),
  intelConfidence: z.number().int().min(0).max(100).nullable(),
  scoreBreakdown: z.array(candidateScoreBreakdownItemSchema),
  qualificationChecks: z.array(candidateQualificationCheckSchema),
  workHistory: z.array(candidateWorkHistoryItemSchema),
}).extend({});

export const candidateInsertSchema = createInsertSchema(candidates, {
  stage: candidateStageSchema,
  score: z.number().int().min(0).max(100).nullable(),
  objectiveScore: z.number().int().min(0).max(100).nullable(),
  intelConfidence: z.number().int().min(0).max(100).nullable(),
  scoreBreakdown: z.array(candidateScoreBreakdownItemSchema),
  qualificationChecks: z.array(candidateQualificationCheckSchema),
  workHistory: z.array(candidateWorkHistoryItemSchema),
})
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    name: z.string().min(1),
    contactEmail: z.string().email(),
    sourceEmailMessageId: z.string().min(1),
  });

export const candidateUpdateSchema = candidateInsertSchema
  .partial()
  .extend({
    id: z.string().min(1),
  });

export type Candidate = z.infer<typeof candidateSchema>;
export type CandidateInsert = z.infer<typeof candidateInsertSchema>;
export type CandidateUpdate = z.infer<typeof candidateUpdateSchema>;
