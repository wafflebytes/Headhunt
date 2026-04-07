CREATE TABLE IF NOT EXISTS "auth0_subject_refresh_tokens" (
  "user_id" varchar(191) PRIMARY KEY NOT NULL,
  "refresh_token" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "auth0_subject_refresh_tokens_updated_at_idx" ON "auth0_subject_refresh_tokens" ("updated_at");
