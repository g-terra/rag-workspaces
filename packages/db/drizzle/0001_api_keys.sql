CREATE TYPE "public"."workspace_role" AS ENUM('reader', 'editor');--> statement-breakpoint
CREATE TABLE "api_key_workspaces" (
	"api_key_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	CONSTRAINT "api_key_workspaces_api_key_id_workspace_id_pk" PRIMARY KEY("api_key_id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"role" "workspace_role" NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_key_workspaces" ADD CONSTRAINT "api_key_workspaces_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_workspaces" ADD CONSTRAINT "api_key_workspaces_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_key_workspaces_workspace_idx" ON "api_key_workspaces" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_secret_hash_key" ON "api_keys" USING btree ("secret_hash");