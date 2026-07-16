# Verification Report: Smart Diff Findings-Badge Deep-Link

**Verified:** 2026-07-16
**Plan:** `client/specs/PLAN-01-smart-diff-finding-badge-deeplink.md`
**Spec:** `client/specs/SPEC-01-smart-diff-finding-badge-deeplink.md`

## Summary

| Status | Count |
|--------|-------|
| Implemented | 14 |
| Missing | 0 |
| Partial | 0 |
| No test found | 0 |
| Not checkable | 1 |

## Per-Task Status

### Task 1: Server contract — `SmartDiffFile` gains `finding_ids: z.array(z.string())`

- **Status:** Implemented
- **File:** `server/src/vendor/shared/contracts/brief.ts` — exists
- **Acceptance criteria:**
  - `finding_ids: z.array(z.string())` present (required, no `.optional()`) → PASS
    - Evidence: line 123 `finding_ids: z.array(z.string()),`
- **Tests:** N/A (contract file, no test requirement in plan)

---

### Task 2: Client contract mirror — `finding_ids: z.array(z.string()).optional().default([])`

- **Status:** Implemented
- **File:** `client/src/vendor/shared/contracts/brief.ts` — exists
- **Acceptance criteria:**
  - `finding_ids: z.array(z.string()).optional().default([])` present → PASS
    - Evidence: line 123 `finding_ids: z.array(z.string()).optional().default([]),`
- **Tests:** N/A

---

### Task 3: Server service — populate `finding_ids` in the per-file loop

- **Status:** Implemented
- **File:** `server/src/modules/smart-diff/service.ts` — exists
- **Acceptance criteria:**
  - `matchingFindings` named variable extracted → PASS
    - Evidence: line 37 `const matchingFindings = findings.filter((fd) => fd.file === f.path);`
  - `findingIds` computed as `matchingFindings.map((fd) => fd.id)` → PASS
    - Evidence: line 41 `const findingIds = matchingFindings.map((fd) => fd.id);`
  - `finding_ids: findingIds` added to pushed object → PASS
    - Evidence: line 48 `finding_ids: findingIds,`
- **Tests:** Server tests pass (489 tests across 57 files)

---

### Task 4: `FileCard.tsx` — new props, badge guard, onClick replacement, old scroll removed

- **Status:** Implemented
- **File:** `client/src/components/diff-viewer/FileCard/FileCard.tsx` — exists
- **Acceptance criteria:**
  - `findingIds?: string[]` added to props → PASS (line 48)
  - `onOpenFinding?: (id: string) => void` added to props → PASS (line 55)
  - Badge render condition `!!findingIds?.length` (not `findingLines`) → PASS (line 106)
  - Badge onClick: `e.stopPropagation(); onOpenFinding?.(findingIds[0]!)` → PASS (lines 112–113)
  - Old `requestAnimationFrame` + `scrollIntoView` removed → PASS (no trace of either in the file)
  - `findingLines` prop retained (backward compatibility) → PASS (line 46)
  - `aria-label` uses `findingIds.length` → PASS (line 110)
- **Tests:** `client/src/components/diff-viewer/FileCard/FileCard.test.tsx` — found (committed)

---

### Task 5: `SmartDiffViewer.tsx` — `onOpenFinding` and `findingIdsByPath` threaded through

- **Status:** Implemented
- **File:** `client/src/components/diff-viewer/SmartDiffViewer/SmartDiffViewer.tsx` — exists
- **Acceptance criteria:**
  - `onOpenFinding?: (id: string) => void` on `SmartDiffViewer` props → PASS (line 94)
  - `onOpenFinding` on `RoleGroup` props → PASS (line 33)
  - `findingIdsByPath: Map<string, string[]>` on `RoleGroup` props → PASS (line 31)
  - `findingIdsByPath` built with `f.finding_ids ?? []` → PASS (line 107–109)
  - `findingIds={findingIdsByPath.get(path)}` passed to `<FileCard>` → PASS (line 69)
  - `onOpenFinding={onOpenFinding}` passed to `<FileCard>` → PASS (line 73)
- **Tests:** `client/src/components/diff-viewer/SmartDiffViewer/SmartDiffViewer.test.tsx` — found, 4 tests passing

---

### Task 6: `DiffTab.tsx` — `onOpenFinding` prop added and forwarded to SmartDiffViewer

- **Status:** Implemented
- **File:** `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx` — exists
- **Acceptance criteria:**
  - `onOpenFinding?: (findingId: string) => void` in `DiffTabProps` → PASS (line 21)
  - `onOpenFinding={onOpenFinding}` passed to `<SmartDiffViewer>` → PASS (line 92)
- **Tests:** `DiffTab.test.tsx` — found, 4 tests passing

---

### Task 7: `page.tsx` — `findingTarget` state, handler, props wired to DiffTab and FindingsTab

- **Status:** Implemented
- **File:** `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` — exists
- **Acceptance criteria:**
  - `findingTarget` state: `React.useState<{ id: string; n: number } | null>(null)` → PASS (line 73)
  - Handler calls `setTab("findings")` then `setFindingTarget((p) => ({ id, n: (p?.n ?? 0) + 1 }))` → PASS (lines 74–77)
  - `onOpenFinding={handleOpenFinding}` passed to `<DiffTab>` → PASS (line 183)
  - `findingTarget={findingTarget}` passed to `<FindingsTab>` → PASS (line 161)
- **Tests:** Covered by `FindingsTab.test.tsx` integration test

---

### Task 8: `FindingsTab.tsx` — `findingTarget` prop, forwarded to each RunAccordion

- **Status:** Implemented
- **File:** `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx` — exists
- **Acceptance criteria:**
  - `findingTarget?: { id: string; n: number } | null` in `FindingsTabProps` → PASS (line 25)
  - `targetFindingId={findingTarget?.id ?? null}` to each `<ReviewRunAccordion>` → PASS (line 182)
  - `targetFindingNonce={findingTarget?.n ?? 0}` to each `<ReviewRunAccordion>` → PASS (line 183)
- **Tests:** `FindingsTab.test.tsx` — found, 2 tests passing

---

### Task 9: `ReviewRunAccordion.tsx` — new props, `ownsTargetFinding`, useEffect, `highlightedFindingId`

- **Status:** Implemented
- **File:** `client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx` — exists
- **Acceptance criteria:**
  - `targetFindingId?: string | null` default `null` → PASS (line 34)
  - `targetFindingNonce?: number` default `0` → PASS (line 35)
  - `ownsTargetFinding` computed outside effect → PASS (lines 65–66)
  - `useEffect` with deps `[ownsTargetFinding, targetFindingId, targetFindingNonce]` → PASS (line 78)
  - Effect calls `setOpen(true)` and `requestAnimationFrame(() => scrollIntoView)` → PASS (lines 69–75)
  - `CSS.escape(targetFindingId!)` used in selector → PASS (line 71)
  - `highlightedFindingId={ownsTargetFinding ? targetFindingId : null}` passed to `<FindingsPanel>` → PASS (line 176)
- **Tests:** Covered by `FindingsTab.test.tsx` integration test (scroll assertion uses `waitFor`)

---

### Task 10: `FindingsPanel.tsx` — `highlightedFindingId`, `transientHighlightId`, 2 s timer, `focused` fix

- **Status:** Implemented
- **File:** `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx` — exists
- **Acceptance criteria:**
  - `highlightedFindingId?: string | null` in props → PASS (line 28)
  - `transientHighlightId` state → PASS (line 36)
  - `useEffect([highlightedFindingId])`: sets transient ID, schedules `setTimeout(2000)`, returns `clearTimeout` → PASS (lines 40–44)
  - `focused={i === focusIdx || f.id === transientHighlightId}` → PASS (line 80)
- **Tests:** Covered indirectly via `FindingsTab.test.tsx`; no standalone test for transient highlight lifecycle (not required by plan)

---

### Task 11: `SmartDiffViewer.test.tsx` — fixtures updated, old scroll test replaced, empty-badge test added

- **Status:** Implemented
- **File:** `client/src/components/diff-viewer/SmartDiffViewer/SmartDiffViewer.test.tsx` — exists
- **Acceptance criteria:**
  - `finding_ids: ["finding-1"]` on core file fixture → PASS (line 36)
  - `finding_ids: []` on wiring and boilerplate fixtures → PASS (lines 43, 55)
  - Test asserts `onOpenFinding` called with `"finding-1"` → PASS (line 85)
  - Test asserts `scrollIntoView` NOT called → PASS (line 86)
  - Test "does not render findings badge when finding_ids is empty" present → PASS (line 89)
  - `Element.prototype.scrollIntoView = vi.fn()` guard in place → PASS (line 76)
- **Tests:** 4 tests, all passing

---

### Task 12: `FileCard.test.tsx` — new file, three tests

- **Status:** Implemented
- **File:** `client/src/components/diff-viewer/FileCard/FileCard.test.tsx` — exists (already committed)
- **Acceptance criteria:**
  - Test "does not render badge when findingIds is undefined" → PASS (line 26)
  - Test "does not render badge when findingIds is empty" → PASS (line 31)
  - Test "calls onOpenFinding with first id on badge click and does not call scrollIntoView" → PASS (line 36)
  - `NextIntlClientProvider` wrapper present → PASS
  - `Element.prototype.scrollIntoView = vi.fn()` mock present → PASS (line 37)
- **Tests:** 3 tests, all passing

---

### Task 13: `DiffTab.test.tsx` — fixtures updated, new badge-click test

- **Status:** Implemented
- **File:** `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.test.tsx` — exists
- **Acceptance criteria:**
  - `finding_ids: []` in base `smartDiffBase` fixture entries → PASS (lines 25, 32)
  - Test "calls onOpenFinding when findings badge is clicked" added → PASS (line 91)
  - Test uses `finding_ids: ['f1']` and asserts `onOpenFinding` called with `'f1'` → PASS (lines 106, 122)
  - `Element.prototype.scrollIntoView = vi.fn()` present → PASS (line 92)
- **Tests:** 4 tests, all passing

---

### Task 14: `FindingsTab.test.tsx` — new integration test for accordion-expand+scroll path

- **Status:** Implemented
- **File:** `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.test.tsx` — found (untracked new file)
- **Acceptance criteria:**
  - All required hooks mocked (usePrReviews, useCancelRun, usePrActiveRuns, usePrRuns, useDeleteRun, useDeleteReview, useFindingAction, useTurnFindingIntoEvalCase, useSmartDiff, useVerifyFinding, useRunEvents) → PASS
  - `Element.prototype.scrollIntoView = vi.fn()` in `beforeEach` → PASS (line 119)
  - Minimal `runs: ReviewRecord[]` fixture with one finding id `'f1'` → PASS (lines 70–86)
  - Test renders with `findingTarget={{ id: 'f1', n: 1 }}` → PASS (line 133)
  - Asserts accordion expanded (finding title visible) → PASS (line 142)
  - Asserts `scrollIntoView` called via `waitFor` → PASS (lines 145–147)
  - Second test: `findingTarget={null}`, asserts `scrollIntoView` NOT called → PASS (lines 150–173)
- **Tests:** 2 tests, all passing

---

## Definition of Done Verification

| AC | Status | Evidence |
|----|--------|----------|
| AC-1: Badge click sets `?tab=findings` | PASS | `handleOpenFinding` calls `setTab("findings")` in page.tsx line 75 |
| AC-2: Target finding card scrolled into view | PASS | `ReviewRunAccordion` useEffect calls `scrollIntoView`; `FindingsTab.test.tsx` asserts it |
| AC-3: Collapsed accordion expands before scroll | PASS | `setOpen(true)` called in same useEffect before `requestAnimationFrame` |
| AC-4: Repeated click re-triggers scroll | PASS | `(p?.n ?? 0) + 1` always increments nonce; useEffect dep includes `targetFindingNonce` |
| AC-5: No badge for empty `finding_ids` | PASS | Guard `!!findingIds?.length`; tested in FileCard.test.tsx and SmartDiffViewer.test.tsx |
| AC-6: Old in-diff scroll removed | PASS | No `requestAnimationFrame`/`scrollIntoView` in FileCard.tsx; `stopPropagation` prevents accordion open |
| AC-7: Missing `finding_ids` field coerces to `[]` | PASS | `.optional().default([])` on client Zod schema |
| AC-8: `finding_ids.length === finding_lines.length` | NOT CHECKABLE (edge case gap) | See note below |
| `pnpm tsc --noEmit` passes in server/ and client/ | PASS | Both TypeScript checks exit clean |
| `pnpm test` passes in server/ and client/ | PASS | 355 client tests, 489 server tests, 0 failures |

**AC-8 edge-case gap:** The service computes `findingLines` with `new Set()` deduplication (multiple findings on the same line collapse to one entry) but computes `findingIds` without deduplication (`matchingFindings.map(fd => fd.id)`). When two or more findings share a line, `finding_ids.length > finding_lines.length`, violating the "equal count" invariant stated in AC-8. The plan explicitly directs this implementation ("no deduplication needed"), so this is a design decision recorded in the plan, but no test covers the edge case and the spec's "parallel array" contract (`finding_ids[i]` corresponds to `finding_lines[i]`) cannot hold when lengths differ. This warrants a flag but is not a missing task — the plan was executed as written. AC-8 is NOT CHECKABLE for the multi-finding-same-line edge case via the existing tests.

---

## Orphaned Implementations (out-of-scope changes)

The following files are modified in the working tree but have no corresponding plan task. All appear to belong to a parallel "verify finding" feature developed in the same working-tree session:

| File | Out-of-scope reason |
|------|---------------------|
| `server/src/db/migrations/meta/_journal.json` | New migration 0021 added — plan states "No DB migration." Migration adds `verified_at`, `verification_verdict`, `verification_rationale` columns (verify feature, not finding_ids). |
| `server/src/db/schema/reviews.ts` | Added `verifiedAt`, `verificationVerdict`, `verificationRationale` to `findings` table — schema is a do-not-touch zone per CLAUDE.md; no plan task covers this |
| `client/src/components/FindingCard/FindingCard.tsx` | Added `onVerify`, `verifyPending` props and `capitalize` import — no plan task |
| `client/src/components/FindingCard/FindingCard.test.tsx` | Updated for verify feature — no plan task |
| `client/src/components/FindingCard/helpers.ts` | Likely added `capitalize` utility — no plan task |
| `client/src/components/FindingCard/styles.ts` | Verify UI styles — no plan task |
| `client/src/lib/hooks/reviews.ts` | Added `useVerifyFinding` hook — no plan task |
| `client/src/lib/api.ts` | Likely added verify endpoint call — no plan task |
| `client/src/lib/feature-models.ts` | No plan task |
| `client/src/vendor/shared/contracts/platform.ts` | No plan task |
| `client/src/vendor/shared/contracts/review-api.ts` | No plan task |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.test.tsx` | Updated to add `useVerifyFinding` mock and `verify_verdict/rationale/at` fixture fields — driven by verify feature, not this plan |
| `client/messages/en/prReview.json` | i18n additions — no plan task |
| `server/src/modules/reviews/helpers.ts` | No plan task |
| `server/src/modules/reviews/repository.ts` | No plan task |
| `server/src/modules/reviews/repository/review.repo.ts` | No plan task |
| `server/src/modules/reviews/routes.ts` | No plan task |
| `server/src/modules/reviews/service.ts` | No plan task |
| `server/src/modules/multi-runs/repository.ts` | No plan task |
| `server/src/modules/brief/brief.test.ts` | No plan task |
| `server/test/contracts.test.ts` | No plan task |
| `server/src/vendor/shared/contracts/platform.ts` | No plan task |
| `server/src/vendor/shared/contracts/review-api.ts` | No plan task |
| `reviewer-core/src/index.ts` | No plan task |
| `reviewer-core/src/prompt.ts` | No plan task |

The out-of-scope modifications do not break any plan requirement (all tests pass, TypeScript compiles), but the DB migration and schema change violate the plan's explicit "No DB migration" constraint and CLAUDE.md's "do not touch schema" rule. These changes belong to a different feature (finding verification) that was co-developed in the same working tree session.

---

## Verdict

**PASS — All 14 tasks implemented and all tests pass.**

One flag requires implementer acknowledgment before this phase can be considered fully closed:

1. **AC-8 edge case not tested:** When multiple findings share the same line, `finding_ids.length` will exceed `finding_lines.length` (deduplication mismatch). No test covers this edge case. The plan directed the non-deduplication approach, but the spec requires equal counts and a parallel-array relationship. Either add a test asserting the behavior is acceptable for the badge (which only uses `finding_ids[0]`), or deduplicate `findingIds` to restore the parallel-array contract.

2. **Out-of-scope DB migration and schema change present:** `server/src/db/schema/reviews.ts` and `server/src/db/migrations/meta/_journal.json` were modified for a separate verify-finding feature. These changes are unrelated to PLAN-01 but violate the plan's "No DB migration" statement and CLAUDE.md's schema do-not-touch zone. The implementer should confirm these changes belong to a separate tracked plan before merging.
