import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const auth0SubjectRefreshTokens = pgTable(
  'auth0_subject_refresh_tokens',
  {
    userId: varchar('user_id', { length: 191 }).primaryKey(),
    refreshToken: text('refresh_token').notNull(),
    createdAt: timestamp('created_at')
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at')
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('auth0_subject_refresh_tokens_updated_at_idx').on(table.updatedAt)],
);
