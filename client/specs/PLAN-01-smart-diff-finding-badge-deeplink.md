# Plan: Smart Diff Findings-Badge Deep-Link

## Spec reference
`client/specs/SPEC-01-smart-diff-finding-badge-deeplink.md`

## Execution mode: single-agent
User chose single-agent mode (one implementer, sequential). All tasks below form a linear implementation sequence — the component prop chain must be built bottom-up (contract → service → FileCard → SmartDiffViewer → DiffTab → page.tsx → FindingsTab → ReviewRunAccordion → FindingsPanel), then tests at the end.

## Goal
Add `finding_ids: string[]` to the `SmartDiffFile` contract, then wire the "N findings" badge in the Smart Diff file header so that clicking it navigates the reviewer directly to the first matching finding card in the Findings tab (switching the tab, expanding the containing run accordion if collapsed, scrolling the card into view, and applying a transient focused highlight) — replacing the previous in-diff scroll behavior entirely.

## Modules affected
- `server/` — `vendor/shared/contracts/brief.ts` (additive Zod field); `modules/smart-diff/service.ts` (collect finding IDs alongside finding lines, no DB change)
- `client/` — `vendor/shared/contracts/brief.ts` (mirrored additive field, optional-with-default); `components/diff-viewer/FileCard/FileCard.tsx`, `SmartDiffViewer/SmartDiffViewer.tsx`; `app/repos/[repoId]/pulls/[number]/page.tsx`, `_components/DiffTab/DiffTab.tsx`, `_components/FindingsTab/FindingsTab.tsx`, `_components/ReviewRunAccordion/ReviewRunAccordion.tsx`, `_components/FindingsPanel/FindingsPanel.tsx`; tests for all modified components

## Engineering Insights applied
- **Dual-vendor sync** — `client/insights/INSIGHTS.md`: "client/src/vendor/shared/ is a manual mirror of server/src/vendor/shared/ — always update both when changing a Zod contract." Both contract files are updated in Tasks 1 and 2 in the same pass; `pnpm tsc --noEmit` in both packages catches any drift.
- **Nonce re-trigger pattern** — `client/insights/INSIGHTS.md`: the existing `FindingsTab.tsx:69-72` nonce pattern (`p.n + 1`) drives repeated-click re-fire (AC-4). The same pattern is reused in `page.tsx` for `findingTarget`.
- **jsdom scrollIntoView guard** — `client/insights/INSIGHTS.md`: `scrollIntoView` does not exist in jsdom; all tests that trigger a badge click must mock `Element.prototype.scrollIntoView = vi.fn()` before rendering.
- **Server contract optionality** — `server/insights/INSIGHTS.md`: "Use .nullish() for list-only derived fields" pattern does NOT apply here. `finding_ids` is always computed by `SmartDiffService.buildForPull` (the only producer); the server declares it required (`z.array(z.string())`). The client mirror is `.optional().default([])` solely for AC-7 backward compatibility.
- **Zod required-field breakage** — `server/insights/INSIGHTS.md`: adding a required field breaks all producers that don't supply it. The server has a single producer path (`SmartDiffService`) that will be updated in the same task; no adapter or mock returns `SmartDiffFile` directly, so no secondary TypeScript breakage is expected.
- **Test fixture updates** — `client/insights/INSIGHTS.md`: "Always update test fixtures when extending a shared contract type." All test files that create `SmartDiffFile` fixtures need `finding_ids` added (Tasks 11–14).

## Recommendations
None. The spec's `Architecture & workflows` section exactly matches the existing codebase patterns (nonce, useEffect, data-finding-id anchor, target/nonce state), so no architectural substitution is needed.

## Architecture decisions

**Server: required field, client: optional-with-default** — The server Zod schema uses `z.array(z.string())` (required) because `SmartDiffService` is the single code path that builds every `SmartDiffFile`; requiring it here provides a compile-time regression guard. The client mirror uses `.optional().default([])` so that an old server response that omits `finding_ids` coerces to `[]` without a parse error, satisfying AC-7. Per Zod skill `type-input-vs-output`: `z.infer<typeof SmartDiffFile>` on the client produces `finding_ids: string[]` (non-optional) thanks to `.default([])`, so callers need no optional-chain on the field.

**In-diff scroll removed entirely** — Per AC-6 and spec goal, the old `requestAnimationFrame` + `lineAnchorId` scroll in `FileCard.tsx:106-113` is deleted. The badge onClick becomes a single `onOpenFinding?.(findingIds[0]!)` call. The `findingLines` prop is retained on `FileCard` (no removal) to avoid a breaking API change, but it is no longer used to render the badge.

**Badge render guard switches to `!!findingIds?.length`** — The previous guard `!!findingLines?.length` is replaced by `!!findingIds?.length`. When `findingIds` is undefined (plain `DiffViewer` context, which never passes this prop) or an empty array (no active non-dismissed findings), no badge is rendered. This satisfies AC-5 and AC-7 simultaneously.

**Cross-tab navigation via local state, not URL** — Per spec service contracts: "The PR detail page coordinates badge-click navigation through local state — not through a URL parameter or a new API." `findingTarget: { id: string; n: number } | null` lives in `React.useState` in `page.tsx`. `setTab("findings")` updates the URL separately (existing `setParam` helper). These two updates are independent calls inside the same callback.

**Accordion expand + scroll in `ReviewRunAccordion.useEffect`** — The existing run-accordion useEffect pattern (lines 47–53 in `ReviewRunAccordion.tsx`) already handles "expand when targeted, scroll into view." The finding-target variant reuses the same useEffect structure with `[ownsTargetFinding, targetFindingId, targetFindingNonce]` deps. `ownsTargetFinding` is a derived boolean (`review.findings.some(f => f.id === targetFindingId)`), computed outside the effect to avoid an unstable object dep. The scroll targets `[data-finding-id="<id>"]` using `CSS.escape(id)` per spec Untrusted Inputs section.

**Transient highlight routed through `FindingsPanel`** — `FindingCard` already has a `focused` prop that drives the visual ring (`s.card(!!focused, …)`). Rather than adding a second prop to `FindingCard`, a `highlightedFindingId?: string | null` prop is added to `FindingsPanel`. `FindingsPanel` manages a `transientHighlightId` state (set on prop change, cleared after 2 s via `setTimeout`). The `focused` expression becomes `i === focusIdx || f.id === transientHighlightId`. This keeps `FindingCard` unchanged and colocates the highlight lifecycle with the existing j/k keyboard navigation state. Per ui-architecture skill: `FindingCard` is a shared component; changes to it ripple everywhere it is used, so adding the lifecycle in the enclosing panel is safer.

**`CSS.escape` for the attribute selector** — UUIDs contain only `[0-9a-f\-]` characters, so no actual escaping occurs at runtime. It is used explicitly because the spec's Untrusted Inputs section requires it. `CSS.escape` is available in all modern browsers and in jsdom ≥ 16 (the project's jsdom is configured via Vitest and is modern). No polyfill is needed.

## Tasks

### Contract + service

- [ ] **`server/src/vendor/shared/contracts/brief.ts`** — in the `SmartDiffFile` Zod object, add `finding_ids: z.array(z.string())` immediately after the `finding_lines` field. No `.optional()` — the service always populates it. Export type is automatically extended via `z.infer`.

- [ ] **`client/src/vendor/shared/contracts/brief.ts`** — mirror the server change: add `finding_ids: z.array(z.string()).optional().default([])` after `finding_lines` in `SmartDiffFile`. The `.optional()` allows old server responses that omit the field to parse without error; `.default([])` ensures `z.infer<typeof SmartDiffFile>` shows `finding_ids: string[]` (non-optional) so callers need no null-check. Both vendor files must be committed together.

- [ ] **`server/src/modules/smart-diff/service.ts`** — inside the `for (const f of files)` loop, extract the inline filter into a named variable `matchingFindings` (used for both `finding_lines` and `finding_ids`): `const matchingFindings = findings.filter((fd) => fd.file === f.path);`. Compute `findingLines` from `matchingFindings` as before (deduplicated via `Set`, sorted). Compute `findingIds` as `matchingFindings.map((fd) => fd.id)` (no deduplication needed — one DB finding row → one ID). Add `finding_ids: findingIds` to the pushed `SmartDiffFile` object.

### Client — component prop chain

- [ ] **`client/src/components/diff-viewer/FileCard/FileCard.tsx`** — three changes:
  1. Add `findingIds?: string[]` and `onOpenFinding?: (id: string) => void` to the props interface (after `findingLines`).
  2. Change badge render condition from `!!findingLines?.length` to `!!findingIds?.length` — badge no longer renders when `findingIds` is absent or empty.
  3. Replace the entire badge `onClick` body with: `e.stopPropagation(); onOpenFinding?.(findingIds![0]!);` — remove the `if (!open) setOpen(true)` and the `requestAnimationFrame` + `scrollIntoView` call entirely (AC-6). The badge `aria-label` and count label (`{findingIds.length} finding…`) use `findingIds.length` instead of `findingLines.length`. Keep the `findingLines` prop in the interface (no removal).

- [ ] **`client/src/components/diff-viewer/SmartDiffViewer/SmartDiffViewer.tsx`** — four changes:
  1. Add `onOpenFinding?: (id: string) => void` to both `SmartDiffViewer` props and `RoleGroup` props.
  2. Add `findingIdsByPath: Map<string, string[]>` to `RoleGroup` props.
  3. In `SmartDiffViewer`, build `findingIdsByPath` alongside `findingLinesByPath`: `const findingIdsByPath = new Map(smartDiff.groups.flatMap((g) => g.files.map((f) => [f.path, f.finding_ids ?? []] as const)));`. Pass both maps and `onOpenFinding` to `RoleGroup`.
  4. In `RoleGroup`, pass `findingIds={findingIdsByPath.get(path)}` and `onOpenFinding={onOpenFinding}` to every `<FileCard>`.

- [ ] **`client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx`** — add `onOpenFinding?: (findingId: string) => void` to `DiffTabProps`; pass it as `onOpenFinding={onOpenFinding}` to the `<SmartDiffViewer>` JSX (the `<DiffViewer>` fallback does not receive it — no badge in plain diff per non-goal #2).

- [ ] **`client/src/app/repos/[repoId]/pulls/[number]/page.tsx`** — three changes:
  1. Add state: `const [findingTarget, setFindingTarget] = React.useState<{ id: string; n: number } | null>(null);`
  2. Define handler (plain function, no useCallback required): when called with `(id: string)`, calls `setTab("findings")` then `setFindingTarget(p => ({ id, n: (p?.n ?? 0) + 1 }))`.
  3. Pass `onOpenFinding={handler}` to `<DiffTab>` and `findingTarget={findingTarget}` to `<FindingsTab>`.

- [ ] **`client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx`** — two changes:
  1. Add `findingTarget?: { id: string; n: number } | null` to `FindingsTabProps`.
  2. In `runs.map`, pass `targetFindingId={findingTarget?.id ?? null}` and `targetFindingNonce={findingTarget?.n ?? 0}` to every `<ReviewRunAccordion>`.

- [ ] **`client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx`** — three changes:
  1. Add `targetFindingId?: string | null` (default `null`) and `targetFindingNonce?: number` (default `0`) to the props and the destructuring defaults.
  2. Compute outside the effect: `const ownsTargetFinding = !!targetFindingId && review.findings.some((f) => f.id === targetFindingId);`
  3. Add a `useEffect` with deps `[ownsTargetFinding, targetFindingId, targetFindingNonce]`: when `ownsTargetFinding` is true, call `setOpen(true)` and then `requestAnimationFrame(() => { const escaped = CSS.escape(targetFindingId!); document.querySelector('[data-finding-id="' + escaped + '"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); });`.
  4. Pass `highlightedFindingId={ownsTargetFinding ? targetFindingId : null}` to `<FindingsPanel>`.

- [ ] **`client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx`** — three changes:
  1. Add `highlightedFindingId?: string | null` to props.
  2. Add state: `const [transientHighlightId, setTransientHighlightId] = React.useState<string | null>(null);`
  3. Add `useEffect([highlightedFindingId])`: when `highlightedFindingId` is non-null, set `transientHighlightId` to it, schedule `setTimeout(() => setTransientHighlightId(null), 2000)`, and return a cleanup that clears the timeout. (Return the `clearTimeout` handle from the effect cleanup.)
  4. Change `focused={i === focusIdx}` to `focused={i === focusIdx || f.id === transientHighlightId}` in the `FindingCard` render.

### Tests

- [ ] **`client/src/components/diff-viewer/SmartDiffViewer/SmartDiffViewer.test.tsx`** — update existing tests:
  - Add `finding_ids: ["finding-1"]` to the core file fixture entry; add `finding_ids: []` to wiring and boilerplate file entries (required by the updated `SmartDiffFile` type on the server; `.optional().default([])` on the client means the fixture can also omit it, but being explicit is preferable).
  - Replace the existing "shows a findings badge and scrolls to the flagged line on click" test: render with `onOpenFinding={vi.fn()}`, click the badge, assert `onOpenFinding` was called with `"finding-1"`, and assert `scrollIntoView` was NOT called (the in-diff scroll is gone). Keep the `Element.prototype.scrollIntoView = vi.fn()` setup so the test does not throw if scrollIntoView is somehow invoked.
  - Add test: "does not render findings badge when finding_ids is empty" — use the wiring file fixture (finding_ids: []) and assert no badge button is in the document.

- [ ] **`client/src/components/diff-viewer/FileCard/FileCard.test.tsx`** (create new) — three tests using `NextIntlClientProvider` with shell messages:
  1. "does not render badge when findingIds is undefined" — render `<FileCard file={…} />` with no findingIds; assert no button with role=button and name matching /finding/ is in the document.
  2. "does not render badge when findingIds is empty" — pass `findingIds={[]}`.
  3. "calls onOpenFinding with first id on badge click and does not call scrollIntoView" — mock `Element.prototype.scrollIntoView = vi.fn()`; render with `findingIds={["id1"]}` and `onOpenFinding={vi.fn()}`; click badge; assert `onOpenFinding` called with `"id1"` and `scrollIntoView` not called.

- [ ] **`client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.test.tsx`** — two changes:
  - Update the existing `smartDiff` fixture to add `finding_ids: []` to all `SmartDiffFile` entries (fixes TS compile after contract update).
  - Add test: "calls onOpenFinding when findings badge is clicked" — update the mock smartDiff for the core file to include `finding_ids: ['f1']` and `finding_lines: [1]`; pass `onOpenFinding={vi.fn()}`; mock `Element.prototype.scrollIntoView = vi.fn()`; click the findings badge; assert `onOpenFinding` was called with `'f1'`.

- [ ] **`client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.test.tsx`** (create new) — integration test for badge→accordion-expand→scroll path:
  - Mock `usePrReviews`, `useCancelRun`, `usePrActiveRuns`, `usePrRuns`, `useDeleteRun`, `useDeleteReview`, `useFindingAction`, `useTurnFindingIntoEvalCase`, `useSmartDiff` (no QueryClientProvider needed when hooks are fully mocked).
  - Mock `Element.prototype.scrollIntoView = vi.fn()`.
  - Build a minimal `runs: ReviewRecord[]` fixture with one run containing one finding with `id: 'f1'`.
  - Render `<FindingsTab … runs={runs} findingTarget={{ id: 'f1', n: 1 }} …/>`.
  - Assert the accordion is expanded (finding title is visible in the DOM).
  - Assert `scrollIntoView` was called (via `waitFor` to account for `requestAnimationFrame`).
  - Add a second test: render without `findingTarget` (or with `null`) and assert no scroll fires.

## Gotchas
- **No DB migration.** `finding_ids` is computed in the service layer from already-fetched finding rows. No new column, no schema change, no `pnpm db:generate` / `pnpm db:migrate` needed.
- **Both vendor contracts must stay in sync.** `client/src/vendor/shared/contracts/brief.ts` is a manual mirror. Update it in the same commit as `server/src/vendor/shared/contracts/brief.ts`. `pnpm tsc --noEmit` in client will catch drift.
- **`findingLines` prop remains on `FileCard`** — it is no longer used by badge logic but must not be removed (backward-compatible API). Any existing callers that pass it continue to compile.
- **`requestAnimationFrame` in jsdom tests** — jsdom implements `requestAnimationFrame` via `setTimeout(fn, 0)`. Use `waitFor` from RTL (or `vi.runAllTimers()` with `vi.useFakeTimers()`) to flush it before asserting `scrollIntoView`. The existing SmartDiffViewer test uses `waitFor`, which is the correct pattern to reuse.
- **`CSS.escape` in tests** — available in jsdom ≥ 16 (Vitest's default). If a test environment error occurs, add `vi.stubGlobal('CSS', { escape: (s: string) => s })` before the test.
- **`setTimeout` cleanup in `FindingsPanel.useEffect`** — the effect sets a 2 s timeout for `transientHighlightId` clearance. The cleanup function must call `clearTimeout(handle)` to avoid state updates on unmounted components in tests.
- **AC-4 nonce guarantee** — `findingTarget.n` is always incremented by `(p?.n ?? 0) + 1` in `page.tsx`, even if the same badge is clicked twice. The `ReviewRunAccordion` effect fires because `targetFindingNonce` changed, even when `targetFindingId` is identical to the previous value.

## Definition of done
- [ ] `pnpm tsc --noEmit` reports no errors in `server/` and `client/`
- [ ] `pnpm test` passes in `server/` and `client/`
- [ ] AC-1: Clicking the "N findings" badge on a Smart Diff file header sets `?tab=findings` in the URL
- [ ] AC-2: The finding card whose `data-finding-id` matches `finding_ids[0]` for that file is scrolled into view after the tab switch
- [ ] AC-3: A collapsed run accordion that contains the target finding expands automatically before the scroll
- [ ] AC-4: Clicking the same badge a second time (Findings tab already active) re-triggers the scroll
- [ ] AC-5: No badge is rendered for a file whose `finding_ids` is `[]`
- [ ] AC-6: Badge click does not open the file diff accordion and does not invoke `scrollIntoView` on any diff-line anchor
- [ ] AC-7: A `SmartDiffFile` response that omits `finding_ids` parses successfully on the client (field coerces to `[]`); no badge rendered — verified by unit test
- [ ] AC-8: For each file in the API response, `finding_ids.length === finding_lines.length` (verified by inspecting the service output against a seeded PR with known findings)
