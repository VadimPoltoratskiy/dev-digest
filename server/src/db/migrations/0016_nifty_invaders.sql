-- BriefTimeline: pr_brief moves from one-row-per-PR to one-row-per-(pr_id, head_sha)
-- so prior generations are retained as history instead of being overwritten.

-- 1. Drop the old single-column primary key (pr_id) — confirmed via
--    information_schema.table_constraints as "pr_brief_pkey".
ALTER TABLE "pr_brief" DROP CONSTRAINT "pr_brief_pkey";--> statement-breakpoint

-- 2. Add the new surrogate primary key.
ALTER TABLE "pr_brief" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint

-- 3. Add head_sha as nullable first so existing rows can be backfilled before
--    the NOT NULL constraint is applied.
ALTER TABLE "pr_brief" ADD COLUMN "head_sha" text;--> statement-breakpoint

-- 4. Backfill head_sha for pre-existing rows from the PR's current head SHA
--    (best-effort — this is the PR's head at migration time, not necessarily
--    the SHA the cached brief was originally generated against).
UPDATE "pr_brief" SET "head_sha" = "pull_requests"."head_sha"
FROM "pull_requests"
WHERE "pull_requests"."id" = "pr_brief"."pr_id" AND "pr_brief"."head_sha" IS NULL;--> statement-breakpoint

-- 5. Now safe to enforce NOT NULL.
ALTER TABLE "pr_brief" ALTER COLUMN "head_sha" SET NOT NULL;--> statement-breakpoint

-- 6. New conflict target for upserts + the ordered-history query index.
CREATE UNIQUE INDEX "pr_brief_pr_sha_uq" ON "pr_brief" USING btree ("pr_id","head_sha");--> statement-breakpoint
CREATE INDEX "pr_brief_pr_generated_idx" ON "pr_brief" USING btree ("pr_id","generated_at");
