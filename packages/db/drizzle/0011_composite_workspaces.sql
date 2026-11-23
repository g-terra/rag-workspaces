CREATE TYPE "public"."workspace_kind" AS ENUM('standard', 'composite');--> statement-breakpoint
CREATE TABLE "composite_sources" (
	"composite_id" text NOT NULL,
	"source_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "composite_sources_composite_id_source_id_pk" PRIMARY KEY("composite_id","source_id")
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "kind" "workspace_kind" DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "composite_sources" ADD CONSTRAINT "composite_sources_composite_id_workspaces_id_fk" FOREIGN KEY ("composite_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composite_sources" ADD CONSTRAINT "composite_sources_source_id_workspaces_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "composite_sources_source_idx" ON "composite_sources" USING btree ("source_id");