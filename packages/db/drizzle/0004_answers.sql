CREATE TYPE "public"."answer_status" AS ENUM('complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."caller_kind" AS ENUM('user', 'key');--> statement-breakpoint
CREATE TYPE "public"."feedback_rating" AS ENUM('up', 'down');--> statement-breakpoint
CREATE TABLE "answers" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"asked_by_kind" "caller_kind" NOT NULL,
	"asked_by" text NOT NULL,
	"question" text NOT NULL,
	"text" text,
	"status" "answer_status" NOT NULL,
	"grounded" boolean NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text,
	"model" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"latency_ms" integer NOT NULL,
	"time_to_first_token_ms" integer,
	"error" text,
	"request_id" text,
	"feedback_rating" "feedback_rating",
	"feedback_comment" text,
	"feedback_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "answers_workspace_created_idx" ON "answers" USING btree ("workspace_id","created_at");