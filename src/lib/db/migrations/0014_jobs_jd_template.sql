ALTER TABLE "jobs"
ADD COLUMN IF NOT EXISTS "jd_template" jsonb DEFAULT '{}'::jsonb NOT NULL;
