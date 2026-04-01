CREATE TABLE "applications" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"candidate_id" varchar(191) NOT NULL,
	"job_id" varchar(191) NOT NULL,
	"stage" varchar(50) DEFAULT 'applied' NOT NULL,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"organization_id" varchar(191),
	"actor_type" varchar(50) NOT NULL,
	"actor_id" varchar(191) NOT NULL,
	"actor_display_name" varchar(191) NOT NULL,
	"action" varchar(191) NOT NULL,
	"resource_type" varchar(100) NOT NULL,
	"resource_id" varchar(191) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" varchar(30) NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"organization_id" varchar(191),
	"job_id" varchar(191) NOT NULL,
	"name" varchar(191) NOT NULL,
	"contact_email" varchar(191) NOT NULL,
	"summary" text,
	"source_email_message_id" varchar(191) NOT NULL,
	"source_email_thread_id" varchar(191),
	"source_email_received_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"organization_id" varchar(191),
	"title" text NOT NULL,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_candidate_job_idx" ON "applications" USING btree ("candidate_id","job_id");--> statement-breakpoint
CREATE INDEX "applications_job_stage_idx" ON "applications" USING btree ("job_id","stage");--> statement-breakpoint
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs" USING btree ("resource_type","resource_id","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "candidates_source_email_message_id_idx" ON "candidates" USING btree ("source_email_message_id");--> statement-breakpoint
CREATE INDEX "candidates_job_id_idx" ON "candidates" USING btree ("job_id");