CREATE TABLE "frontend_mock_snapshots" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"slug" varchar(120) NOT NULL,
	"version" varchar(80) NOT NULL,
	"organization_id" varchar(191),
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"seeded_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "frontend_mock_snapshots" ADD CONSTRAINT "frontend_mock_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "frontend_mock_snapshots_slug_version_idx" ON "frontend_mock_snapshots" USING btree ("slug","version");
--> statement-breakpoint
CREATE INDEX "frontend_mock_snapshots_org_idx" ON "frontend_mock_snapshots" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "frontend_mock_snapshots_seeded_at_idx" ON "frontend_mock_snapshots" USING btree ("seeded_at");
