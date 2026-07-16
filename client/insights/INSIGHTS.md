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
- `2026-07-06 · Pattern · A widget shared by BOTH the Agent editor tabs and the Skill editor tabs (not just one feature) belongs in client/src/components/<Name>/, not colocated under one feature's _components/. Each feature then gets a thin wrapper (e.g. AgentEditor/_components/ContextTab, skills/_components/SkillDetailPanel/ContextTab.tsx) that only wires its own data hook + PATCH mutation into the shared presentational component. Evidence: client/src/components/ContextDocsEditor/, client/src/components/DocPreviewModal/.`
- `2026-07-06 · Context · Repo-scoped pages/tabs that have no repoId of their own (e.g. an agent has no repoId column) reuse useActiveRepo() from lib/repo-context.tsx (URL > localStorage > first repo) instead of prop-drilling a repo selector — same mechanism ConventionsView already established. Evidence: client/src/lib/repo-context.tsx, client/src/app/conventions/_components/ConventionsView/ConventionsView.tsx.`
- `2026-07-15 · Pattern · Dual-mode reuse of a self-fetching widget: FindingsCounter serves BOTH the PR-list row (fetch-on-open via prId) and the per-run timeline (findings already in memory). Add an optional findings?: FindingRecord[] prop; when provided, derive the severity summary locally (count undismissed by severity) and pass null to usePrReviews so the hook stays inert (rules-of-hooks preserved, no second fetch). Gate interactivity on hasAny && (!!prId || findingsProp !== undefined) so per-run mode with prId=null is still clickable. Evidence: client/src/components/FindingsCounter/FindingsCounter.tsx.`
- `2026-07-16 · Pattern · Derive stable filter facets from an UNFILTERED reuse of the same search hook, so filter pills can never drift from the data (a hardcoded pill list gave empty results). useCommunitySkillFacets() calls useSearchCommunitySkills(undefined, {}) and computes distinct non-'any' langs + distinct tags from the full catalog; TanStack Query dedupes it to a single request when no filter is active, and it only becomes a second request while a filter narrows the browse list (intended — filters must not shrink the facet set). No new endpoint/contract needed. Evidence: client/src/lib/hooks/skills.ts:useCommunitySkillFacets.`

## What Doesn't Work

<!-- Dead ends & anti-patterns — the highest-value section, the one most often skipped.
     Be specific about what broke and the fix that stuck. -->
- `2026-07-16 · Anti-pattern · A shared import/save panel that hardcodes a literal silently mis-tags callers. ImportPreviewPanel hardcoded source:"imported_url", and the Community tab reached it by prefilling the File tab — so community skills persisted as source:'imported_url', never 'community'. Fix: parametrize the shared panel with a source?: prop (default 'imported_url' for back-compat) and render it directly from each tab (community passes source="community" + initialDescription + initialType), instead of round-tripping through another tab's prefill state. Evidence: client/src/app/skills/_components/ImportDrawer/ImportDrawer.tsx.`

## Codebase Patterns

<!-- Discovered conventions/architecture decisions NOT already stated in CLAUDE.md. -->
- `2026-06-25 · Pattern · The Stat tile style (label + value block) is defined in RunTraceDrawer/styles.ts (s.stat / s.statLabel / s.statVal) and rendered by the Stat atom in atoms.tsx. Components outside that folder should replicate the 3 style objects inline rather than importing from the deep path. Evidence: client/src/components/RunCostBadge/RunCostBadge.tsx (stat variant).`
- `2026-06-25 · Pattern · client/src/vendor/shared/ is a manual mirror of server/src/vendor/shared/ — always update both when changing a Zod contract. No tooling enforces the sync; it's checked only by tsc. Evidence: contracts/trace.ts and contracts/platform.ts exist in both locations.`
- `2026-07-15 · Pattern · Per-run findings for the "Agent runs" timeline are derived client-side, NOT from RunSummary (which carries only findings_count/blockers, no severity split). FindingsTab builds a Map<run_id, FindingRecord[]> from the runs: ReviewRecord[] it already holds (key by ReviewRecord.run_id) and passes it as findingsByRun to RunHistory; RunHistory renders the per-row FindingsCounter only when findingsByRun && is truthy, so existing callers/tests that omit the prop don't mount it (and need no QueryClientProvider). Evidence: FindingsTab.tsx, RunHistory.tsx settled-row block.`

## Tool & Library Notes

<!-- Dependency quirks. -->
- `2026-06-23 · Tool Note · TanStack Query — QueryClientProvider is wired once in app/layout.tsx. Adding a second provider per-page silently breaks cache sharing across routes. Evidence: client/src/app/layout.tsx.`

## Recurring Errors & Fixes

<!-- Repeated mistake → fix. -->
- `2026-06-25 · Recurring Error · Test fixtures for RunSummary must include all required fields — after adding cost_usd to the contract, the RunHistory.test.tsx base factory was missing it, producing TS2719 "Two different types with this name exist". Fix: add cost_usd: null to the run() factory in RunHistory.test.tsx:17. Always update test fixtures when extending a shared contract type.`
- `2026-06-26 · Recurring Error · Indexing FindingsSummary with a Severity key (which includes INFO) causes TS7053 — FindingsSummary only has CRITICAL | WARNING | SUGGESTION. Fix: type the iteration array as (keyof FindingsSummary)[] and cast to Severity only at the SeverityBadge call site. Evidence: client/src/components/FindingsCounter/FindingsCounter.tsx:SEV_ORDER.`
- `2026-06-26 · Recurring Error · getByRole("button") in RTL fails with "multiple elements found" when both a role="button" div trigger AND a <button> close button are in the tree. Fix: open with getByRole("button") (only trigger exists), then getAllByRole("button") after open and index the last element for the close button. Evidence: client/src/components/FindingsCounter/FindingsCounter.test.tsx.`
- `2026-07-06 · Recurring Error · Adding a required (non-.nullish()) field to the Agent or Skill Zod contract — e.g. context_docs: z.array(z.string()).default([]) — breaks every test fixture typed as Agent/Skill with TS2741, since z.infer resolves .default() fields to non-optional in the output type. Fix: add the field to every hardcoded fixture object (AgentEditor.test.tsx, AgentCard.test.tsx). Same rule as server/insights/INSIGHTS.md's Zod-contract note, mirrored on the client vendor copy.`
- `2026-07-15 · Recurring Error · Rendering FindingsCounter inside a test (e.g. via RunHistory with findingsByRun) mounts usePrReviews even in inert per-run mode (findings prop set, hook arg null) → TanStack Query throws "No QueryClient set" with no provider. Fix: vi.mock("@/lib/hooks/reviews", () => ({ usePrReviews: () => ({ data: undefined, isLoading: false }) })) at the top of the test file instead of wrapping in a QueryClientProvider. Evidence: RunHistory.test.tsx.`
- `2026-07-15 · Correction · Supersedes the 2026-06-26 SEV_ORDER note above: Severity is now z.enum(['CRITICAL','WARNING','SUGGESTION']) with NO INFO member (vendor/shared/contracts/findings.ts:11), so indexing FindingsSummary by f.severity type-checks directly — the keyof-cast workaround is no longer needed for new code (e.g. acc[f.severity]++ in FindingsCounter derivedSummary).`

## Session Notes

<!-- Dated summaries of sessions >30 min that hit a real problem or discovery. -->

## Open Questions

<!-- Unresolved questions about this module. -->
