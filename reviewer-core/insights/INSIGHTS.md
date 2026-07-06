# reviewer-core/ INSIGHTS

> Append-only working memory for this module. **Stable rules live in CLAUDE.md** —
> this file captures lessons *discovered while working*. Write entries that are
> actionable "cold": a future session reads one and knows what to do without re-deriving it.
> **Entry format:** `YYYY-MM-DD · Category · Fact. Evidence: file:line or symptom.`
> **Anti-banality test:** "Would this be obvious to anyone reading the code?" Yes → don't write.
> **Maintenance:** monthly prune — stale entries become noise or worse, harmful advice. Resolve contradictions explicitly. Split into domain files if >200 entries.

## What Works

<!-- Approaches/solutions that worked, with enough context to reuse. -->
- `2026-06-25 · Pattern · OpenRouter drops TCP connections with "Premature close" under load — all parallel agents can fail simultaneously with no HTTP status code. Wrap each SDK call in completeWithConnectionRetry() (2 retries, 500ms/1000ms backoff) separate from the schema-parse retry loop. Evidence: reviewer-core/src/llm/openrouter.ts:completeWithConnectionRetry.`

## What Doesn't Work

<!-- Dead ends & anti-patterns — the highest-value section, the one most often skipped.
     e.g. concrete prompt tweaks that regressed grounding, model quirks that broke structured output. -->

## Codebase Patterns

<!-- Discovered conventions/architecture decisions NOT already stated in CLAUDE.md. -->

## Tool & Library Notes

<!-- Dependency quirks — model/provider behaviors, JSON-repair edge cases, etc. -->
- `2026-06-25 · Tool Note · OpenAI SDK throws APIConnectionError (not a fetch Response) for TCP-level drops — it has no .status field, so HTTP-status-based retryable checks silently miss it. Always check (err as {name?:string})?.name === 'APIConnectionError' explicitly alongside ECONNRESET and "Premature close" message checks. Evidence: reviewer-core/src/llm/openrouter.ts:completeWithConnectionRetry.`

## Recurring Errors & Fixes

<!-- Repeated mistake → fix. -->

## Session Notes

<!-- Dated summaries of sessions >30 min that hit a real problem or discovery. -->

## Open Questions

<!-- Unresolved questions about this module. -->
