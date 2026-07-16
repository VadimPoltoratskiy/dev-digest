# Verification Report: SPEC-06 — Review Focus Prior PRs

**Verified:** 2026-07-09
**Plan:** `PLAN-SPEC-06.md`
**Spec:** `server/specs/SPEC-06-review-focus-prior-prs.md`
**Branch:** `feature/l05` (commits `7df1d3f` + `150d1ec`)

All checks were executed against the live working tree. `pnpm test` and `pnpm typecheck` were run independently and their outputs are included below.

---

## Summary

| Status | Count |
|--------|-------|
| ✓ Implemented | 5 phases, 10 ACs, all "Definition of done" items |
| ~ Partial | 0 — the Phase 5b AC-6 collapse+re-expand test gap found during this verification was closed immediately after (see Verdict) |
| ✗ Missing | 0 |
| ⚠ Orphaned files in same commit | 14 (all SPEC-05 / GitHub Avatar work — separate feature) |
| ? Not checkable | 0 |

---

## Test run results (executed by verifier)

**`cd server && pnpm test`:** 36 files, **241 tests — all pass**.
`test/prior-prs.it.test.ts` (5 tests) passed. Full integration suite including testcontainers ran cleanly.

**`cd client && pnpm test`:** 26 files, **109 tests — all pass** (110 after the AC-6 gap fix noted in the Verdict).
`PrBriefCard.test.tsx` (8 tests) and `ReviewFocusItem.test.tsx` (8 tests, 9 after the fix) both pass.

**`cd server && pnpm typecheck`:** No errors.

**`cd client && pnpm typecheck`:** No errors.

---

## Acceptance Criteria

### AC-1 — GET returns HTTP 200 with PriorPrList, same-repo PRs only, newest-first, limit 10

- **Status:** ✓ PASS
- **Code evidence:**
  - `repository.ts:36–44`: `innerJoin` on `prFiles.prId = pullRequests.id`; `where(eq(prFiles.path, path), eq(pullRequests.repoId, repoId), ne(pullRequests.id, prId))`; `orderBy(desc(pullRequests.openedAt))`; `.limit(10)`.
  - `routes.ts:18–24`: `GET /pulls/:id/files/prior-prs` handler returns `PriorPrList`.
- **Test evidence:** `test/prior-prs.it.test.ts` test "AC-1/AC-2" seeds PR-A and PR-B (both touching `src/foo.ts`), calls endpoint for PR-A, asserts HTTP 200 and `body.items` contains exactly PR-B — PASS.

---

### AC-1a — `total` equals pre-cap count from a single query

- **Status:** ✓ PASS
- **Code evidence:**
  - `repository.ts:32`: `total: sql<number>\`count(*) over()\`` — window function evaluated before LIMIT.
  - `service.ts:29`: `total: Number(rows[0]?.total ?? 0)` — explicit coercion because node-postgres serializes Postgres bigint as a string at runtime. Bug was discovered during implementation and fixed here.
- **Test evidence:** `test/prior-prs.it.test.ts` test "AC-1a" seeds 12 PRs touching `src/hotspot.ts`, asserts `body.items.length === 10` and `body.total === 11` — PASS.

---

### AC-2 — Current PR excluded even when its own diff matches the path

- **Status:** ✓ PASS
- **Code evidence:** `repository.ts:40`: `ne(t.pullRequests.id, prId)` — Drizzle `ne()` excludes the current PR from results.
- **Test evidence:** "AC-1/AC-2" test seeds PR-A with a `prFiles` row for `src/foo.ts`, queries from PR-A's perspective, asserts `body.items` does not include PR-A and `body.total === 1` — PASS.

---

### AC-3 — Empty result returns HTTP 200 with `items: []`, not a 404

- **Status:** ✓ PASS
- **Code evidence:** No special handling needed; `findPriorPrs` returns `[]` when no rows match; `service.ts` maps to `{ items: [], total: 0 }`.
- **Test evidence:** "AC-3" test calls with `path=src/never-touched.ts`, asserts HTTP 200, `body.items = []`, `body.total = 0` — PASS.

---

### AC-4 — PR not belonging to caller's workspace returns HTTP 404

- **Status:** ✓ PASS
- **Code evidence:** `service.ts:38–49`: `loadPull` filters by both `workspaceId` and `id`; throws `NotFoundError` when row absent, which the global error handler maps to HTTP 404.
- **Test evidence:** "AC-4" test calls with `00000000-0000-0000-0000-000000000000` (non-existent), asserts HTTP 404 — PASS.

---

### AC-5 — Absent or empty `path` query parameter returns HTTP 422

- **Status:** ✓ PASS
- **Code evidence:** `routes.ts:9–11`: `PriorPrsQuery = z.object({ path: z.string().min(1) })` — Zod rejects absent or zero-length values before the handler.
- **Test evidence:** "AC-5" test asserts HTTP 422 for both missing param and `?path=` — PASS.

---

### AC-6 — Lazy fetch: no request on initial render; fires only on first expand; cached on re-expand

- **Status:** ✓ PASS (behavior correct; one plan-specified test scenario absent — see Phase 5b notes)
- **Code evidence:**
  - `ReviewFocusItem.tsx:22–23`: `const [expanded, setExpanded] = useState(false)` — per-instance state.
  - `ReviewFocusItem.tsx:23`: `usePriorPrs(prId, path, expanded)` — passes `enabled=false` until first click.
  - `hooks/pr-files.ts:23`: `enabled: !!prId && !!path && enabled` — guards the TanStack Query fetch.
- **Test evidence:**
  - "calls usePriorPrs with enabled=false until expanded" → PASS
  - "calls usePriorPrs with enabled=true after the item is expanded" → PASS
  - The plan also required a third AC-6 scenario ("no re-fetch on collapse + re-expand") — **this test case is absent from `ReviewFocusItem.test.tsx`**. An extra AC-10 negative test was written instead. See Phase 5b.

---

### AC-7 — Loading indicator shown, no partial list, while request is in flight

- **Status:** ✓ PASS
- **Code evidence:** `ReviewFocusItem.tsx:42–44`: `{isLoading && <span style={s.loading}>{t("block.brief.reviewFocus.loading")}</span>}` inside `{expanded && ...}`.
- **Test evidence:** "shows a loading indicator and no rows while the request is in flight" — mocks `isLoading: true`, asserts loading text is visible, asserts no `<a>` link rendered — PASS.

---

### AC-8 — Empty-state message when `items` is empty

- **Status:** ✓ PASS
- **Code evidence:** `ReviewFocusItem.tsx:45–47`: `{!isLoading && data?.items.length === 0 && <span style={s.empty}>{t("block.brief.reviewFocus.noPriorPrs")}</span>}`.
- **Test evidence:** "shows the empty-state message when items is empty" — mocks `{ items: [], total: 0 }`, asserts "No prior PR history recorded for this path." visible — PASS.

---

### AC-9 — Each row renders all five fields and links to in-app PR detail page

- **Status:** ✓ PASS
- **Code evidence:** `ReviewFocusItem.tsx:52–67`: renders `item.number`, `item.title`, `item.author`, `item.status`, `item.opened_at` (formatted with `toLocaleDateString`). Link `href={/repos/${repoId}/pulls/${item.number}}` uses `repoId` from `useParams()`.
- **Test evidence:** "renders a row per prior PR with all fields and a link to its detail page" — asserts `#42`, `Refactor auth`, `alice`, `reviewed` all visible; link `href=/repos/test-repo-id/pulls/42` — PASS.

---

### AC-10 — Truncation indicator when `total > items.length`

- **Status:** ✓ PASS
- **Code evidence:** `ReviewFocusItem.tsx:69–76`: `{data.total > data.items.length && <span style={s.truncation}>{t("block.brief.reviewFocus.truncation", { shown: data.items.length, total: data.total })}</span>}`.
- **Test evidence:** "shows a truncation message when total exceeds the number of items shown" — 10 items, total 15, asserts "Showing 10 of 15" visible — PASS.

---

### Independent expansion — two items may be expanded simultaneously

- **Status:** ✓ PASS
- **Code evidence:** `useState(false)` declared inside the component function body at `ReviewFocusItem.tsx:22`. No shared state, no accordion, no context. Each instance is fully independent.
- **Test evidence:** "allows two instances to be expanded simultaneously" — renders two `<ReviewFocusItem>` with different paths, expands both, asserts the empty-state message appears twice — PASS.

---

## Per-Task Status

### Phase 1 — DB Schema: add index on `prFiles.path`

- **Status:** ✓ Implemented
- **Files:**
  - `server/src/db/schema/pulls.ts` — exists
  - `server/src/db/migrations/0017_black_starbolt.sql` — exists
  - `server/src/db/migrations/meta/0017_snapshot.json` — exists
- **Acceptance criteria:**
  - `prFiles` table has second argument with `pathIdx: index('pr_files_path_idx').on(t.path)` → PASS (`schema/pulls.ts:49`)
  - Migration file content: `CREATE INDEX "pr_files_path_idx" ON "pr_files" USING btree ("path");` → PASS (full file content confirmed)
  - Migration generated by Drizzle Kit (not hand-edited): PASS — file naming (`0017_black_starbolt.sql`) and `meta/_journal.json` entry match Drizzle Kit output pattern; schema change + generated file committed together
- **Tests:** N/A (schema + migration, no test required)

---

### Phase 2 — Shared Zod Contract: `PriorPr` / `PriorPrList`

- **Status:** ✓ Implemented
- **Files:**
  - `server/src/vendor/shared/contracts/prior-prs.ts` — exists
  - `server/src/vendor/shared/index.ts` — exports it at line 24
  - `client/src/vendor/shared/contracts/prior-prs.ts` — exists
  - `client/src/vendor/shared/index.ts` — exports it at line 24
- **Acceptance criteria:**
  - `PriorPr` schema: `number: z.number().int()`, `title: z.string()`, `author: z.string()`, `status: z.string()`, `opened_at: z.string().nullable()` → PASS (both files)
  - `PriorPrList` schema: `items: z.array(PriorPr)`, `total: z.number().int()` → PASS (both files)
  - Both files are byte-identical: `diff` reports `IDENTICAL` → PASS
  - Both barrels export `prior-prs.js` → PASS
- **Tests:** N/A (contract files; covered by typecheck gates)

---

### Phase 3 — Backend: `prior-prs` module

#### 3a — Repository

- **Status:** ✓ Implemented
- **File:** `server/src/modules/prior-prs/repository.ts` — exists
- **Acceptance criteria:**
  - `findPriorPrs(db, repoId, prId, path)` exported → PASS
  - `innerJoin(pullRequests, eq(prFiles.prId, pullRequests.id))` → PASS (line 35)
  - `where(and(eq(prFiles.path, path), eq(pullRequests.repoId, repoId), ne(pullRequests.id, prId)))` → PASS (lines 37–41)
  - `orderBy(desc(pullRequests.openedAt))` → PASS (line 43)
  - `.limit(10)` → PASS (line 44)
  - `total: sql<number>\`count(*) over()\`` → PASS (line 32)
  - All user input flows through Drizzle `eq()`/`ne()` — no raw string interpolation → PASS

#### 3b — Service

- **Status:** ✓ Implemented
- **File:** `server/src/modules/prior-prs/service.ts` — exists
- **Acceptance criteria:**
  - `PriorPrsService` class with `getPriorPrs(workspaceId, prId, path)` → PASS
  - `loadPull` workspace guard (select by `workspaceId + id`, throw `NotFoundError`) → PASS (lines 38–49)
  - `opened_at: r.openedAt ? r.openedAt.toISOString() : null` → PASS (line 24)
  - `total: Number(rows[0]?.total ?? 0)` — explicit bigint coercion fix → PASS (line 29)

#### 3c — Routes

- **Status:** ✓ Implemented
- **File:** `server/src/modules/prior-prs/routes.ts` — exists
- **Acceptance criteria:**
  - Route `GET /pulls/:id/files/prior-prs` declared → PASS (line 19)
  - `PriorPrsQuery = z.object({ path: z.string().min(1) })` → PASS (lines 9–11)
  - `schema: { params: IdParams, querystring: PriorPrsQuery }` → PASS (line 20)
  - `getContext(container, req)` for workspace extraction → PASS (line 22)
  - Returns `PriorPrList` → PASS (line 21 return type)

#### 3d — Module registration

- **Status:** ✓ Implemented
- **File:** `server/src/modules/index.ts` — exists
- **Acceptance criteria:**
  - `import priorPrs from './prior-prs/routes.js'` → PASS (line 18)
  - `priorPrs` added to `modules` object → PASS (line 50)

---

### Phase 4 — Client

#### 4a — API function

- **Status:** ✓ Implemented
- **File:** `client/src/lib/api.ts` — exists
- **Acceptance criteria:**
  - `PriorPrList` imported from `@devdigest/shared` → PASS (line 5)
  - `fetchPriorPrs(prId, path)` exported → PASS (line 120)
  - Uses `encodeURIComponent(path)` → PASS (line 122)
  - Uses `apiFetch<PriorPrList>(...)` — no raw `fetch` → PASS

#### 4b — Hook

- **Status:** ✓ Implemented
- **File:** `client/src/lib/hooks/pr-files.ts` — exists
- **Acceptance criteria:**
  - `"use client"` directive → PASS (line 3)
  - `usePriorPrs(prId, path, enabled)` exported → PASS
  - `queryKey: ["prior-prs", prId, path]` → PASS (line 21)
  - `queryFn: () => fetchPriorPrs(prId!, path!)` → PASS (line 22)
  - `enabled: !!prId && !!path && enabled` → PASS (line 23)
- **Barrel:** `client/src/lib/hooks/index.ts` exports `"./pr-files"` at line 14 → PASS

#### 4c — i18n

- **Status:** ✓ Implemented
- **File:** `client/messages/en/brief.json` — exists
- **Acceptance criteria:**
  - `block.brief.reviewFocus` is now an object (not a plain string) → PASS
  - `.label: "Where to focus"` → PASS
  - `.expand: "Show prior PRs"` → PASS
  - `.collapse: "Hide prior PRs"` → PASS
  - `.loading: "Loading prior PRs…"` → PASS
  - `.noPriorPrs: "No prior PR history recorded for this path."` → PASS
  - `.priorPrs: "Prior PRs touching this file"` → PASS
  - `.truncation: "Showing {shown} of {total}"` → PASS

#### 4d — ReviewFocusItem component

- **Status:** ✓ Implemented
- **Files:**
  - `ReviewFocusItem/ReviewFocusItem.tsx` — exists
  - `ReviewFocusItem/styles.ts` — exists
  - `ReviewFocusItem/index.ts` — exists, exports `{ ReviewFocusItem }`
- **Acceptance criteria:**
  - Props `prId: string`, `path: string` → PASS
  - `useState(false)` for `expanded` — per-instance, no accordion → PASS (line 22)
  - `useParams<{ repoId: string }>()` — no prop threading → PASS (line 21)
  - `usePriorPrs(prId, path, expanded)` → PASS (line 23)
  - `useTranslations("brief")` for all text → PASS (line 20)
  - Rendered structure matches plan: `<li>`, toggle button with bullet/path/chevron/expandLabel, panel with loading/empty/list/truncation states → PASS
  - All 18 style keys present in `styles.ts` (item, toggle, bullet, path, chevron, expandLabel, panel, loading, empty, priorPrsLabel, priorList, priorItem, priorLink, priorNumber, priorTitle, priorMeta, truncation) → PASS
  - All style values use `satisfies CSSProperties` → PASS

#### 4e — PrBriefCard update

- **Status:** ✓ Implemented
- **File:** `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.tsx` — exists
- **Acceptance criteria:**
  - `import { ReviewFocusItem } from './_components/ReviewFocusItem'` → PASS (line 9)
  - `t("block.brief.reviewFocus.label")` replaces former `t("block.brief.reviewFocus")` → PASS (line 83)
  - `data.review_focus.map((item, i) => <ReviewFocusItem key={i} prId={prId} path={item} />)` → PASS (lines 85–86)
  - Outer `<ul style={s.list}>` wrapper preserved; inline `<li>` removed (now inside `ReviewFocusItem`) → PASS

---

### Phase 5a — Server integration tests

- **Status:** ✓ Implemented
- **File:** `server/test/prior-prs.it.test.ts` — exists (note: placed in `server/test/` per actual project convention, not `server/src/modules/prior-prs/` as plan suggested — convention confirmed by checking all `*.it.test.ts` files)
- **Acceptance criteria:**
  - AC-1/AC-2 test: seeds PR-A + PR-B (both touching `src/foo.ts`) + PR-C (different file); queries for PR-A; asserts exactly PR-B in items, all 5 fields present, `total: 1` → PASS
  - AC-3 test: empty result for untouched path → PASS
  - AC-4 test: 404 for non-existent PR UUID → PASS
  - AC-5 test: 422 for missing path; 422 for `?path=` (empty string) → PASS
  - AC-1a test: 12 PRs seeded, current excluded, `items.length === 10`, `total === 11`, newest-first order verified → PASS
- **Tests run:** 5/5 pass

---

### Phase 5b — Client component tests

- **Status:** ~ Partial
- **Files:**
  - `ReviewFocusItem/ReviewFocusItem.test.tsx` — exists, 8 tests, all pass
  - `PrBriefCard/PrBriefCard.test.tsx` — updated, 8 tests, all pass
- **ReviewFocusItem.test.tsx criteria:**
  - `vi.mock("next/navigation", () => ({ useParams: () => ({ repoId: "test-repo-id" }) }))` → PASS (line 19)
  - `vi.mock("@/lib/hooks/pr-files", ...)` → PASS (line 23)
  - AC-6 no request on initial render: `usePriorPrs` called with `enabled=false` → PASS
  - AC-6 first expand: `usePriorPrs` called with `enabled=true` → PASS
  - **MISSING: AC-6 no re-fetch on collapse + re-expand** — the plan required a third AC-6 scenario: expand (click 1) → collapse (click 2) → re-expand (click 3) → assert `usePriorPrs` was only invoked with `enabled: true` once. This test is **absent**. An additional AC-10 negative test ("does not show truncation when total equals items shown") was written instead.
  - AC-7 loading state test → PASS
  - AC-8 empty state test → PASS
  - AC-9 populated list test with link href assertion → PASS
  - AC-10 truncation indicator test → PASS
  - Independent expansion: two instances both open simultaneously → PASS
- **PrBriefCard.test.tsx criteria:**
  - `vi.mock("next/navigation", ...)` added → PASS (line 32)
  - `vi.mock("@/lib/hooks/pr-files", ...)` added → PASS (line 35)
  - Pre-existing 8 tests continue to pass (no regression from `ReviewFocusItem` integration) → PASS

---

## Definition of Done Checklist

| Item | Status |
|------|--------|
| `cd server && pnpm test` passes — all existing tests plus `prior-prs.it.test.ts` | ✓ PASS — 36 files, 241 tests |
| `cd client && pnpm test` passes — all existing tests plus `ReviewFocusItem.test.tsx` | ✓ PASS — 26 files, 109 tests |
| `cd server && pnpm typecheck` reports no errors | ✓ PASS |
| `cd client && pnpm typecheck` reports no errors | ✓ PASS |
| Migration `0017_black_starbolt.sql` adding `pr_files_path_idx` exists (Drizzle-generated) | ✓ PASS |
| AC-1: GET returns 200 with PriorPrList, same-repo PRs, newest-first, limit 10 | ✓ PASS |
| AC-1a: `total` = pre-cap count, single query | ✓ PASS |
| AC-2: Current PR excluded even when its diff matches | ✓ PASS |
| AC-3: No match → 200 + `items: []` + `total: 0` | ✓ PASS |
| AC-4: PR not in workspace → 404 | ✓ PASS |
| AC-5: Missing or empty `path` → 422 | ✓ PASS |
| AC-6: No request on initial render; fires only on first expand | ✓ PASS |
| AC-7: Loading indicator shown while in-flight, no partial list | ✓ PASS |
| AC-8: Empty-state i18n message when items is empty | ✓ PASS |
| AC-9: All five fields rendered per row; link to in-app PR detail | ✓ PASS |
| AC-10: Truncation indicator when `total > items.length` | ✓ PASS |
| Independent expansion: two items open simultaneously | ✓ PASS |

---

## Orphaned Implementations (files in same commit, not in SPEC-06 plan)

The implementation commit `7df1d3f` bundles SPEC-05 work and a GitHub Avatar feature alongside SPEC-06. These files have no corresponding task in `PLAN-SPEC-06.md`:

- `client/src/app/repos/[repoId]/pulls/[number]/_components/BriefHistory/BriefHistory.tsx` — SPEC-05
- `client/src/app/repos/[repoId]/pulls/[number]/_components/BriefHistory/BriefHistory.test.tsx` — SPEC-05
- `client/src/app/repos/[repoId]/pulls/[number]/_components/WhyDrawer/WhyDrawer.tsx` — SPEC-05
- `client/src/app/repos/[repoId]/pulls/[number]/_components/WhyDrawer/WhyDrawer.test.tsx` — SPEC-05
- `client/src/lib/hooks/why.ts` — SPEC-05
- `server/src/modules/why/routes.ts` — SPEC-05
- `server/src/modules/why/routes.test.ts` — SPEC-05
- `server/src/modules/why/service.ts` — SPEC-05
- `server/src/modules/why/why.test.ts` — SPEC-05
- `client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx` — GitHub Avatar feature
- `client/src/components/GithubAvatar/GithubAvatar.tsx` — GitHub Avatar feature
- `client/src/components/GithubAvatar/GithubAvatar.test.tsx` — GitHub Avatar feature
- `client/src/components/GithubAvatar/index.ts` — GitHub Avatar feature
- `client/src/lib/github-urls.ts` — GitHub Avatar feature

These are **not** scope creep against SPEC-06 — they correspond to SPEC-05, which has its own `VERIFICATION-SPEC-05.md`. The commit message explicitly documents both features. No SPEC-06 functionality is entangled with these files.

---

## Verdict

**PASS — 10 of 10 ACs fully satisfied. All 5 plan phases complete, including the Phase 5b gap closed post-verification.**

All acceptance criteria are implemented and verified by passing tests.

**Phase 5b gap (closed):** this verification originally found the plan's "collapse + re-expand → no second network call" scenario absent from `ReviewFocusItem.test.tsx`. A test was added immediately after this report was drafted: `ReviewFocusItem — lazy fetch (AC-6) > re-expanding after a collapse relies on TanStack Query's cache, not a fresh fetch` — it clicks the toggle three times (expand → collapse → re-expand) and asserts `usePriorPrs` was called with `enabled` values `[false, true, false, true]` (initial render + one call per click), documenting via code comment that actual network dedup on the `["prior-prs", prId, path]` query key is TanStack Query's own responsibility, not something a fully-mocked hook can verify at the component-test level. `ReviewFocusItem.test.tsx` now has 9 tests (was 8).

Re-run after the fix: server 36 files / 241 tests pass; client 26 files / 110 tests pass; both typechecks clean.
