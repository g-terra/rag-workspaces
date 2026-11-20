CREATE TYPE "public"."document_status" AS ENUM('queued', 'transcribing', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('pdf', 'docx', 'txt', 'md');--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"title" text NOT NULL,
	"file_name" text NOT NULL,
	"type" "document_type" NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"storage_path" text NOT NULL,
	"status" "document_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"passage_count" integer,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_workspace_sha256_key" ON "documents" USING btree ("workspace_id","sha256");--> statement-breakpoint
CREATE INDEX "documents_workspace_status_idx" ON "documents" USING btree ("workspace_id","status");