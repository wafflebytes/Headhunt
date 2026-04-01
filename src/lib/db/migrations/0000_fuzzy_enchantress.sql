CREATE TABLE "documents" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"content" "bytea" NOT NULL,
	"file_name" varchar(300) NOT NULL,
	"file_type" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" varchar(191) NOT NULL,
	"user_email" varchar(191) NOT NULL,
	"shared_with" varchar(300)[]
);
--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"document_id" varchar(191),
	"content" text NOT NULL,
	"file_name" varchar(300) NOT NULL,
	"embedding" vector(768) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "embeddingIndex" ON "embeddings" USING hnsw ("embedding" vector_cosine_ops);