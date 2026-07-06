CREATE TABLE "pr_blast_explanation" (
	"pr_id" uuid PRIMARY KEY NOT NULL,
	"explanation" text NOT NULL,
	"model" text NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_usd" double precision,
	"generated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pr_blast_explanation" ADD CONSTRAINT "pr_blast_explanation_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;