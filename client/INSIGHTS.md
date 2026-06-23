# client/ INSIGHTS

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
     Be specific about what broke and the fix that stuck. -->

## Codebase Patterns

<!-- Discovered conventions/architecture decisions NOT already stated in CLAUDE.md. -->

## Tool & Library Notes

<!-- Dependency quirks. -->
- `2026-06-23 · Tool Note · TanStack Query — QueryClientProvider is wired once in app/layout.tsx. Adding a second provider per-page silently breaks cache sharing across routes. Evidence: client/src/app/layout.tsx.`

## Recurring Errors & Fixes

<!-- Repeated mistake → fix. -->

## Session Notes

<!-- Dated summaries of sessions >30 min that hit a real problem or discovery. -->

## Open Questions

<!-- Unresolved questions about this module. -->
