# client/ INSIGHTS

> Append-only working memory for this module. **Stable rules live in CLAUDE.md** —
> this file captures lessons *discovered while working*. Write entries that are
> actionable "cold": a future session reads one and knows what to do without re-deriving it.
> **Entry format:** `YYYY-MM-DD · Category · Fact. Evidence: file:line or symptom.`
> **Anti-banality test:** "Would this be obvious to anyone reading the code?" Yes → don't write.
> **Maintenance:** monthly prune — stale entries become noise or worse, harmful advice. Resolve contradictions explicitly. Split into domain files if >200 entries.

## What Works

<!-- Approaches/solutions that worked, with enough context to reuse. -->
- `2026-06-25 · Pattern · New shared components live in client/src/components/<Name>/<Name>.tsx + index.ts re-export. Follows the same folder+barrel convention as app-shell, diff-viewer, etc. Evidence: client/src/components/RunCostBadge/.`
- `2026-06-25 · Pattern · PR list grid is controlled by two constants that must change together: GRID (CSS grid-template-columns string) and COLUMN_KEYS (i18n key array). Adding a column requires updating both plus the i18n messages file and the PRRow cell order. Evidence: client/src/app/repos/[repoId]/pulls/constants.ts.`
- `2026-06-26 · Pattern · Lazy-fetch-on-open popover: pass prId to a TanStack Query hook conditionally — usePrReviews(open ? prId : null). The hook's enabled: !!prId guard fires no request until the popover opens. Free lazy loading with no extra state. Evidence: client/src/components/FindingsCounter/FindingsCounter.tsx.`
- `2026-06-26 · Pattern · Click-outside popover: useRef on the container div + document.addEventListener("mousedown", handler) inside a useEffect that depends on open. The effect only attaches while open=true and cleans up on close or unmount. Same pattern as vendor/ui/kit/Dropdown.tsx. Evidence: client/src/components/FindingsCounter/FindingsCounter.tsx.`
- `2026-06-26 · Pattern · SeverityBadge accepts count and compact props: <SeverityBadge severity="CRITICAL" count={2} compact /> renders the icon + tabular number without the full label. Ideal for the PR list findings counter. Evidence: client/src/vendor/ui/primitives/Badge.tsx:SeverityBadge.`

## What Doesn't Work

<!-- Dead ends & anti-patterns — the highest-value section, the one most often skipped.
     Be specific about what broke and the fix that stuck. -->

## Codebase Patterns

<!-- Discovered conventions/architecture decisions NOT already stated in CLAUDE.md. -->
- `2026-06-25 · Pattern · The Stat tile style (label + value block) is defined in RunTraceDrawer/styles.ts (s.stat / s.statLabel / s.statVal) and rendered by the Stat atom in atoms.tsx. Components outside that folder should replicate the 3 style objects inline rather than importing from the deep path. Evidence: client/src/components/RunCostBadge/RunCostBadge.tsx (stat variant).`
- `2026-06-25 · Pattern · client/src/vendor/shared/ is a manual mirror of server/src/vendor/shared/ — always update both when changing a Zod contract. No tooling enforces the sync; it's checked only by tsc. Evidence: contracts/trace.ts and contracts/platform.ts exist in both locations.`

## Tool & Library Notes

<!-- Dependency quirks. -->
- `2026-06-23 · Tool Note · TanStack Query — QueryClientProvider is wired once in app/layout.tsx. Adding a second provider per-page silently breaks cache sharing across routes. Evidence: client/src/app/layout.tsx.`

## Recurring Errors & Fixes

<!-- Repeated mistake → fix. -->
- `2026-06-25 · Recurring Error · Test fixtures for RunSummary must include all required fields — after adding cost_usd to the contract, the RunHistory.test.tsx base factory was missing it, producing TS2719 "Two different types with this name exist". Fix: add cost_usd: null to the run() factory in RunHistory.test.tsx:17. Always update test fixtures when extending a shared contract type.`
- `2026-06-26 · Recurring Error · Indexing FindingsSummary with a Severity key (which includes INFO) causes TS7053 — FindingsSummary only has CRITICAL | WARNING | SUGGESTION. Fix: type the iteration array as (keyof FindingsSummary)[] and cast to Severity only at the SeverityBadge call site. Evidence: client/src/components/FindingsCounter/FindingsCounter.tsx:SEV_ORDER.`
- `2026-06-26 · Recurring Error · getByRole("button") in RTL fails with "multiple elements found" when both a role="button" div trigger AND a <button> close button are in the tree. Fix: open with getByRole("button") (only trigger exists), then getAllByRole("button") after open and index the last element for the close button. Evidence: client/src/components/FindingsCounter/FindingsCounter.test.tsx.`

## Session Notes

<!-- Dated summaries of sessions >30 min that hit a real problem or discovery. -->

## Open Questions

<!-- Unresolved questions about this module. -->
