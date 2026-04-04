CREATE TABLE "automation_runs" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"handler_type" varchar(120) NOT NULL,
	"resource_type" varchar(120) NOT NULL,
	"resource_id" varchar(191) NOT NULL,
	"idempotency_key" varchar(250) NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"last_error" varchar(2000),
	"last_error_at" timestamp,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_handler_idempotency_idx" ON "automation_runs" USING btree ("handler_type","idempotency_key");
--> statement-breakpoint
CREATE INDEX "automation_runs_status_next_attempt_idx" ON "automation_runs" USING btree ("status","next_attempt_at");
--> statement-breakpoint
CREATE INDEX "automation_runs_resource_idx" ON "automation_runs" USING btree ("resource_type","resource_id");
