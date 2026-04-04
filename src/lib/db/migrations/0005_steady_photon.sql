CREATE TABLE "founder_slot_selections" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"organization_id" varchar(191),
	"candidate_id" varchar(191) NOT NULL,
	"job_id" varchar(191) NOT NULL,
	"actor_user_id" varchar(191) NOT NULL,
	"timezone" varchar(100) DEFAULT 'UTC' NOT NULL,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"selected_ranges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cal_event_type_id" integer,
	"cal_event_type_slug" varchar(191),
	"cal_owner_username" varchar(191),
	"cal_team_slug" varchar(191),
	"cal_organization_slug" varchar(191),
	"cal_booking_url" text,
	"source_email_thread_id" varchar(191),
	"proposal_provider_id" varchar(191),
	"proposal_provider_thread_id" varchar(191),
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "founder_slot_selections" ADD CONSTRAINT "founder_slot_selections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "founder_slot_selections" ADD CONSTRAINT "founder_slot_selections_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "founder_slot_selections" ADD CONSTRAINT "founder_slot_selections_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "founder_slot_selections_candidate_job_idx" ON "founder_slot_selections" USING btree ("candidate_id","job_id");
--> statement-breakpoint
CREATE INDEX "founder_slot_selections_created_at_idx" ON "founder_slot_selections" USING btree ("created_at");
