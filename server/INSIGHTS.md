# server/ INSIGHTS

> Append-only working memory for this module. **Stable rules live in CLAUDE.md** —
> this file captures lessons *discovered while working*. Write entries that are
> actionable "cold": a future session reads one and knows what to do without re-deriving it.
> **Entry format:** `YYYY-MM-DD · Category · Fact. Evidence: file:line or symptom.`
> **Anti-banality test:** "Would this be obvious to anyone reading the code?" Yes → don't write.
> **Maintenance:** monthly prune — stale entries become noise or worse, harmful advice. Resolve contradictions explicitly. Split into domain files if >200 entries.

## What Works

<!-- Approaches/solutions that worked, with enough context to reuse. -->

## What Doesn't Work

<!-- Dead ends & anti-patterns — the highest-value section, the one most often skipped.
     Be specific, e.g.: "Promise.all on the ingest pipeline times out past ~30 items → use Promise.allSettled in batches of 10". -->

## Codebase Patterns

<!-- Discovered conventions/architecture decisions NOT already stated in CLAUDE.md. -->

## Tool & Library Notes

<!-- Dependency quirks. -->

## Recurring Errors & Fixes

<!-- Repeated mistake → fix. -->
- `2026-06-23 · Recurring Error · "relation ... does not exist" on first boot — server never auto-migrates. Fix: cd server && pnpm db:migrate. Evidence: server/src/server.ts (no migrate call on startup).`
- `2026-06-23 · Recurring Error · "vector type unknown" errors — pgvector is enabled by migration 0000; happens when DATABASE_URL points at a non-Docker Postgres that hasn't been migrated. Fix: point DATABASE_URL at the Docker DB and re-run pnpm db:migrate.`

## Session Notes

<!-- Dated summaries of sessions >30 min that hit a real problem or discovery. -->

## Open Questions

<!-- Unresolved questions about this module. -->
