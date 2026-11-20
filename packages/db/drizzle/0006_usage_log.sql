CREATE TABLE "api_requests" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "api_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" text NOT NULL,
	"method" text NOT NULL,
	"route" text NOT NULL,
	"status_code" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"workspace_slug" text,
	"workspace_id" text,
	"caller_kind" "caller_kind",
	"caller_id" text,
	"question" text,
	"answer_id" text,
	"message_id" text,
	"model" text,
	"grounded" boolean,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"time_to_first_token_ms" integer,
	"cited_document_ids" text[]
);
--> statement-breakpoint
CREATE INDEX "api_requests_created_idx" ON "api_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "api_requests_workspace_created_idx" ON "api_requests" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "api_requests_caller_created_idx" ON "api_requests" USING btree ("caller_kind","caller_id","created_at");