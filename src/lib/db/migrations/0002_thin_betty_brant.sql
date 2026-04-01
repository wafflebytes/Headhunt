CREATE TABLE "interviews" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"organization_id" varchar(191),
	"candidate_id" varchar(191) NOT NULL,
	"job_id" varchar(191) NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"status" varchar(50) DEFAULT 'scheduled' NOT NULL,
	"google_calendar_event_id" varchar(191),
	"google_meet_link" text,
	"summary" text,
	"slack_message_ts" varchar(191),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"organization_id" varchar(191),
	"candidate_id" varchar(191) NOT NULL,
	"job_id" varchar(191) NOT NULL,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"draft_content" text,
	"terms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"initiated_by" varchar(191),
	"ciba_auth_req_id" varchar(191),
	"ciba_approved_by" varchar(191),
	"sent_at" timestamp,
	"candidate_response" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"organization_id" varchar(191),
	"type" varchar(100) NOT NULL,
	"name" varchar(191) NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "candidates_job_id_idx";--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "stage" varchar(50) DEFAULT 'applied' NOT NULL;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interviews_candidate_idx" ON "interviews" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "interviews_job_scheduled_at_idx" ON "interviews" USING btree ("job_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "offers_status_idx" ON "offers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "offers_candidate_idx" ON "offers" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "templates_organization_type_idx" ON "templates" USING btree ("organization_id","type");--> statement-breakpoint
CREATE INDEX "candidates_job_stage_idx" ON "candidates" USING btree ("job_id","stage");