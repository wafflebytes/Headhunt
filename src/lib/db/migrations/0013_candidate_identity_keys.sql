CREATE TABLE "candidate_identity_keys" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"organization_id" varchar(191),
	"job_id" varchar(191) NOT NULL,
	"candidate_id" varchar(191) NOT NULL,
	"key_type" varchar(80) NOT NULL,
	"key_value" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidate_identity_keys" ADD CONSTRAINT "candidate_identity_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "candidate_identity_keys" ADD CONSTRAINT "candidate_identity_keys_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "candidate_identity_keys" ADD CONSTRAINT "candidate_identity_keys_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_identity_keys_type_value_job_idx" ON "candidate_identity_keys" USING btree ("key_type","key_value","job_id");
--> statement-breakpoint
CREATE INDEX "candidate_identity_keys_candidate_idx" ON "candidate_identity_keys" USING btree ("candidate_id");
--> statement-breakpoint
CREATE INDEX "candidate_identity_keys_job_type_idx" ON "candidate_identity_keys" USING btree ("job_id","key_type");
--> statement-breakpoint
CREATE INDEX "candidate_identity_keys_org_idx" ON "candidate_identity_keys" USING btree ("organization_id");
--> statement-breakpoint
INSERT INTO public.candidate_identity_keys (
	id,
	organization_id,
	job_id,
	candidate_id,
	key_type,
	key_value,
	metadata,
	first_seen_at,
	last_seen_at,
	created_at,
	updated_at
)
SELECT
	c.id || ':email',
	c.organization_id,
	c.job_id,
	c.id,
	'email_job',
	lower(c.contact_email),
	jsonb_build_object('source', 'migration_backfill'),
	COALESCE(c.source_email_received_at, c.created_at, now()),
	COALESCE(c.source_email_received_at, c.updated_at, now()),
	now(),
	now()
FROM public.candidates c
WHERE c.contact_email IS NOT NULL
ON CONFLICT (key_type, key_value, job_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO public.candidate_identity_keys (
	id,
	organization_id,
	job_id,
	candidate_id,
	key_type,
	key_value,
	metadata,
	first_seen_at,
	last_seen_at,
	created_at,
	updated_at
)
SELECT
	c.id || ':msg',
	c.organization_id,
	c.job_id,
	c.id,
	'gmail_message_id',
	c.source_email_message_id,
	jsonb_build_object('source', 'migration_backfill'),
	COALESCE(c.source_email_received_at, c.created_at, now()),
	COALESCE(c.source_email_received_at, c.updated_at, now()),
	now(),
	now()
FROM public.candidates c
WHERE c.source_email_message_id IS NOT NULL
ON CONFLICT (key_type, key_value, job_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO public.candidate_identity_keys (
	id,
	organization_id,
	job_id,
	candidate_id,
	key_type,
	key_value,
	metadata,
	first_seen_at,
	last_seen_at,
	created_at,
	updated_at
)
SELECT
	c.id || ':thread',
	c.organization_id,
	c.job_id,
	c.id,
	'gmail_thread_id',
	c.source_email_thread_id,
	jsonb_build_object('source', 'migration_backfill'),
	COALESCE(c.source_email_received_at, c.created_at, now()),
	COALESCE(c.source_email_received_at, c.updated_at, now()),
	now(),
	now()
FROM public.candidates c
WHERE c.source_email_thread_id IS NOT NULL
ON CONFLICT (key_type, key_value, job_id) DO NOTHING;
--> statement-breakpoint
ALTER TABLE public.candidate_identity_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS candidate_identity_keys_org_isolation ON public.candidate_identity_keys;
--> statement-breakpoint
CREATE POLICY candidate_identity_keys_org_isolation
ON public.candidate_identity_keys
FOR ALL
TO PUBLIC
USING (
  public.is_authenticated_request()
  AND organization_id IS NOT NULL
  AND organization_id = public.request_org_id()
)
WITH CHECK (
  public.is_authenticated_request()
  AND organization_id IS NOT NULL
  AND organization_id = public.request_org_id()
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.candidate_identity_keys TO service_role;
