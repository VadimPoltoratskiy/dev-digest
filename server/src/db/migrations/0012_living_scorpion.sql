ALTER TABLE "pr_intent" ADD COLUMN "risk_areas" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "classifier_model" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "tokens_in" integer;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "tokens_out" integer;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "saved_tokens_estimate" integer;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "classified_at" timestamp with time zone;