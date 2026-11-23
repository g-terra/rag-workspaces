CREATE TYPE "public"."site_status" AS ENUM('queued', 'crawling', 'ready', 'failed');--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'web';--> statement-breakpoint
CREATE TABLE "sites" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"folder_id" text,
	"start_url" text NOT NULL,
	"scope" text NOT NULL,
	"exclude_paths" text[] DEFAULT '{}' NOT NULL,
	"max_pages" integer NOT NULL,
	"max_depth" integer NOT NULL,
	"status" "site_status" DEFAULT 'queued' NOT NULL,
	"pages_found" integer DEFAULT 0 NOT NULL,
	"pages_fetched" integer DEFAULT 0 NOT NULL,
	"pages_new" integer DEFAULT 0 NOT NULL,
	"pages_changed" integer DEFAULT 0 NOT NULL,
	"pages_unchanged" integer DEFAULT 0 NOT NULL,
	"pages_removed" integer DEFAULT 0 NOT NULL,
	"pages_failed" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"crawled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "documents_workspace_sha256_key";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "site_id" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sites_workspace_start_url_key" ON "sites" USING btree ("workspace_id","start_url");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_site_url_key" ON "documents" USING btree ("site_id","source_url");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_site_sha256_key" ON "documents" USING btree ("site_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_workspace_sha256_key" ON "documents" USING btree ("workspace_id","sha256") WHERE "documents"."site_id" is null;