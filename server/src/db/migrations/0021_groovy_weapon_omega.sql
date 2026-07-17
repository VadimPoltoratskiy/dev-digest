ALTER TABLE "repos" ADD COLUMN "pr_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "pr_sync_error" text;