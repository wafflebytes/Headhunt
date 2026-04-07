CREATE TABLE "user_workspaces" (
	"user_id" varchar(191) PRIMARY KEY NOT NULL,
	"organization_id" varchar(191),
	"role" varchar(50),
	"avatar_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_workspaces" ADD CONSTRAINT "user_workspaces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "user_workspaces_org_idx" ON "user_workspaces" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "user_workspaces_updated_at_idx" ON "user_workspaces" USING btree ("updated_at");
