# server/ INSIGHTS

> Append-only working memory for this module. **Stable rules live in CLAUDE.md** —
> this file captures lessons *discovered while working*. Write entries that are
> actionable "cold": a future session reads one and knows what to do without re-deriving it.
> **Entry format:** `YYYY-MM-DD · Category · Fact. Evidence: file:line or symptom.`
> **Anti-banality test:** "Would this be obvious to anyone reading the code?" Yes → don't write.
> **Maintenance:** monthly prune — stale entries become noise or worse, harmful advice. Resolve contradictions explicitly. Split into domain files if >200 entries.

## What Works

<!-- Approaches/solutions that worked, with enough context to reuse. -->
- `2026-06-25 · Pattern · Cost computed at read time from existing agent_runs columns — no migration needed. service.ts:listRuns post-maps cost_usd via container.priceBook.estimate(model, tokensIn, tokensOut); the repo mapper sets cost_usd: null as a placeholder the service overwrites. Evidence: server/src/modules/reviews/service.ts, server/src/modules/reviews/repository/run.repo.ts.`
- `2026-06-25 · Pattern · Aggregating a derived metric per PR in the list route: one IN-query over agent_runs (filtered by prIds + status='done'), then JS grouping into a Map<prId, sum>. Keeps it a single round-trip without a schema change. Evidence: server/src/modules/pulls/routes.ts (costByPr block).`

## What Doesn't Work

<!-- Dead ends & anti-patterns — the highest-value section, the one most often skipped.
     Be specific, e.g.: "Promise.all on the ingest pipeline times out past ~30 items → use Promise.allSettled in batches of 10". -->

## Codebase Patterns

<!-- Discovered conventions/architecture decisions NOT already stated in CLAUDE.md. -->
- `2026-06-25 · Pattern · repo layer cannot access PriceBook (only receives Db). Any computation that needs container goes in the service layer, which post-maps the repo results. Evidence: run.repo.ts returns cost_usd: null; ReviewService.listRuns overwrites it.`
- `2026-06-25 · Decision · RunStats.cost_usd uses .nullish() (not .nullable()) — persisted run_traces.trace documents written before cost tracking don't have the field. .nullish() lets Zod parse them without validation errors. RunSummary.cost_usd is .nullable() (required) because the service always populates it. Evidence: server/src/vendor/shared/contracts/trace.ts.`
- `2026-06-25 · Decision · PrMeta.total_cost_usd is .nullish() (optional) because the GitHub adapter's listPullRequests, the mock adapter, and the offline fallback in GET /pulls/:id all return PrMeta-shaped objects without cost data — only the list route populates it. Evidence: server/src/adapters/github/octokit.ts, server/src/adapters/mocks.ts.`

## Tool & Library Notes

<!-- Dependency quirks. -->

## Recurring Errors & Fixes

<!-- Repeated mistake → fix. -->
- `2026-06-25 · Recurring Error · OpenAI SDK's APIConnectionError ("Premature close" / ECONNRESET) was silently not retried by defaultIsRetryable in server/src/platform/resilience.ts — the function only checked HTTP status codes and plain Node codes, not the SDK error class name. Fix: add (err as {name?:string})?.name === 'APIConnectionError' as a retryable condition. Evidence: server/src/platform/resilience.ts:defaultIsRetryable.`
- `2026-06-23 · Recurring Error · "relation ... does not exist" on first boot — server never auto-migrates. Fix: cd server && pnpm db:migrate. Evidence: server/src/server.ts (no migrate call on startup).`
- `2026-06-23 · Recurring Error · "vector type unknown" errors — pgvector is enabled by migration 0000; happens when DATABASE_URL points at a non-Docker Postgres that hasn't been migrated. Fix: point DATABASE_URL at the Docker DB and re-run pnpm db:migrate.`
- `2026-06-25 · Recurring Error · Adding a required field to a Zod contract (e.g. PrMeta) immediately breaks every adapter and mock that returns that type — TypeScript catches it. Pattern: use .nullish() for fields only the API layer computes; use .nullable() only when all producers always supply the field. Evidence: TS2741 errors in octokit.ts and mocks.ts after total_cost_usd was first typed .nullable().`
- `2026-06-25 · Recurring Error · run.repo.ts returns RunSummary[] but can only set cost_usd: null — if cost_usd is required in the type, the mapper must include the null placeholder or the type check fails. Service overwrites it. Evidence: server/src/modules/reviews/repository/run.repo.ts:51.`

## Session Notes

<!-- Dated summaries of sessions >30 min that hit a real problem or discovery. -->

## Open Questions

<!-- Unresolved questions about this module. -->
