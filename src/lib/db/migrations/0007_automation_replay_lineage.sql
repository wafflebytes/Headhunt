ALTER TABLE "automation_runs" ADD COLUMN "replayed_from_run_id" varchar(191);
--> statement-breakpoint
CREATE INDEX "automation_runs_replayed_from_idx" ON "automation_runs" USING btree ("replayed_from_run_id");
