ALTER TABLE "candidates" ADD COLUMN "score" integer;
ALTER TABLE "candidates" ADD COLUMN "intel_confidence" integer;
ALTER TABLE "candidates" ADD COLUMN "score_breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "candidates" ADD COLUMN "qualification_checks" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "candidates" ADD COLUMN "work_history" jsonb DEFAULT '[]'::jsonb NOT NULL;
CREATE INDEX "candidates_job_stage_score_idx" ON "candidates" USING btree ("job_id","stage","score");
