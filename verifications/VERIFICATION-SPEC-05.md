# Verification Report: SPEC-05 — Historical-ref WhyDrawer from BriefHistory

**Verified:** 2026-07-08
**Plan:** `PLAN-SPEC-05.md`
**Spec:** `server/specs/SPEC-05-why-historical-ref.md`
**Branch:** `feature/l05` (HEAD: `f50c89d`)

> **Note:** `pnpm test` and `pnpm typecheck` were not executed because the user declined to run test commands to conserve tokens. Type-safety observations are based on static code inspection only.

---

## Summary

| Status | Count |
|--------|-------|
| ✓ Implemented | 7 tasks, 8 ACs |
| ~ Partial | 1 task (Task 8), 1 AC (AC-6) |
| ✗ Missing | 0 |
| ⚠ i18n key defined but unused in JSX | 1 (`openBlame`) |
| ? Not checkable (tests/typecheck not run) | 2 |

---

## Acceptance Criteria

### AC-1 (backward compatibility — no `ref` uses `pull.headSha`)

- **Status:** ✓ PASS
- **Evidence:**
  - `service.ts:46`: `const effectiveRef = ref ?? pull.headSha` — when `ref` is absent, falls back to `pull.headSha`.
  - `why.test.ts:360–381`: describe block "backward compat — omitting ref uses pull.headSha (AC-1)" asserts `blame` and `log` are called with `MOCK_HEAD_SHA` when `getTimeline` is called with 4 arguments.
  - `routes.test.ts:107–113`: confirms `getTimeline` is called with `undefined` as 5th arg when no `ref` query param is supplied.

---

### AC-2 (ref-scoped blame/log)

- **Status:** ✓ PASS
- **Evidence:**
  - `service.ts:46–51`: `effectiveRef = ref ?? pull.headSha`; `runBlameAndLog` uses `effectiveRef` for both `blame()` and `log()`.
  - `why.test.ts:389–416`: describe block "ref-scoped blame/log (AC-2)" calls `getTimeline` with `HISTORICAL_SHA`, asserts `blame` and `log` are each called with that SHA and NOT with `MOCK_HEAD_SHA`.
  - `routes.test.ts:149–173`: HTTP GET with a valid 40-char SHA → HTTP 200, `getTimeline` called with SHA as 5th arg.

---

### AC-3 (fetch-and-retry for arbitrary ref)

- **Status:** ✓ PASS
- **Evidence:**
  - `service.ts:55–70`: single try/catch block — first failure triggers `fetchPullHead(repoRef, pull.number)` then retries `runBlameAndLog()`. The same `effectiveRef` is used in both the first attempt and the retry, so a historical SHA benefits from this path identically to `pull.headSha`.
  - `why.test.ts:422–439`: describe block "fetch-and-retry for historical ref (AC-3)" uses `gitThrowsOnce: true` and passes `HISTORICAL_SHA`; asserts `fetchPullHead` called once, `blame`/`log` each called twice, timeline has 1 event.

---

### AC-4 (graceful degradation for unreachable ref)

- **Status:** ✓ PASS
- **Evidence:**
  - `service.ts:64–69`: inner catch block calls `emptyTimeline(file, line, 'No history available for this line.')` — returns HTTP 200 with `blame: null, events: [], summary: <string>`, never HTTP 500.
  - `why.test.ts:257–268`: "degrades gracefully when fetchPullHead itself fails" — passes `gitThrowsOnce: true` + `fetchPullHeadThrows: true`; asserts `events: []`, `blame: null`.

---

### AC-5 (workspace-scope enforcement)

- **Status:** ✓ PASS
- **Evidence:**
  - `service.ts:121–127`: `loadPull` filters on both `workspaceId` and `prId`; throws `NotFoundError` if not found. This executes before any `ref` or git processing.
  - `why.test.ts:345–354`: asserts `NotFoundError` when `mockPr: null`.
  - `routes.test.ts:116–129`: HTTP 404 returned when service throws `NotFoundError`.

---

### AC-6 (file_refs rendered in BriefHistory)

- **Status:** ~ PARTIAL
- **Gaps found:**
  1. **GitHub blob link absent:** The spec requires "linking to the file at `entry.head_sha` on GitHub when `repoFullName` is available." `githubBlobUrl` is NOT imported in `BriefHistory.tsx` and the `MonoLink` has no `href` attribute. Root cause: the vendored `MonoLink` (at `client/src/vendor/ui/primitives/MonoLink.tsx:25–39`) renders an `<a>` when `href` is set and calls `e.stopPropagation()` in that anchor's click handler — the `onClick` prop is completely ignored in the anchor branch. The implementer chose to drop `href` to preserve `onClick` behavior. The plan's fallback instruction ("wrap in a `<button type="button">`") was not applied; instead `href` was dropped. This means right-click-to-open-in-new-tab is not available.
  2. **`openBlame` i18n key defined but not used as `title` on MonoLink:** `brief.json:24` contains `"openBlame": "Open blame history at this commit"`, but no `title` prop appears on the MonoLink in `BriefHistory.tsx`. The `MonoLink` interface also does not accept a `title` prop, so this would require either a wrapper element or a vendor change. Neither was done. The accessible tooltip described in the plan is absent.
- **What IS implemented:**
  - Each risk with `file_refs.length > 0` renders a `MonoLink` per path (lines 71–89 of `BriefHistory.tsx`).
  - The filter `{risk.file_refs.length > 0 && (...)}` correctly skips risks with empty `file_refs`.
  - `BriefHistory.test.tsx` AC-6 tests pass the behavior: expanding a row with `ENTRY_WITH_FILE_REFS` shows `"src/foo.ts"` in the document; expanding with `ENTRY_OLD` (no file_refs) does not.

---

### AC-7 (WhyDrawer trigger from BriefHistory)

- **Status:** ✓ PASS
- **Evidence:**
  - `BriefHistory.tsx:80–83`: MonoLink `onClick` calls `onOpenWhy({ file: path, ref: entry.head_sha })`.
  - `BriefHistory.tsx:103`: `const [openWhy, setOpenWhy] = useState<OpenWhyRef>(null)`.
  - `BriefHistory.tsx:118–127`: conditionally mounts `<WhyDrawer prId={prId} repoFullName={repoFullName} file={openWhy.file} line={1} gitRef={openWhy.ref} onClose={() => setOpenWhy(null)} />`.
  - `BriefHistory.test.tsx:176–202`: AC-7 test renders with `repoFullName="acme/payments-api"`, expands row, clicks `"src/foo.ts"`, asserts `why-drawer` testid is in document and `WhyDrawer` was called with `{ file: "src/foo.ts", gitRef: "ffff001", line: 1, prId: "pr-1" }`.
  - `BriefHistory.test.tsx:205–228`: onClose dismissal test — calls `onClose()` from the mock, asserts drawer disappears.

---

### AC-8 (ref validation)

- **Status:** ✓ PASS
- **Evidence:**
  - `routes.ts:23`: `ref: z.string().regex(/^[0-9a-f]{40}$/).optional()` — anchored regex, lowercase hex only, exactly 40 chars.
  - `routes.test.ts:175–182`: `ref=--upload-pack%3Devil` → HTTP 422.
  - `routes.test.ts:184–191`: `ref=abc123` → HTTP 422.
  - `routes.test.ts:193–200`: `ref=AABBCCDD1122334455667788990011223344AABB` → HTTP 422.
  - `routes.test.ts:149–173`: valid 40-char lowercase hex → HTTP 200.

---

### AC-9 (subtitle indicates historical scope)

- **Status:** ✓ PASS
- **Evidence:**
  - `WhyDrawer.tsx:77`: `subtitle={gitRef ? \`${file}:${line} @ ${gitRef.slice(0, 7)}\` : \`${file}:${line}\`}`.
  - `WhyDrawer.test.tsx:144–177`: describe block "gitRef subtitle (AC-9)":
    - With `gitRef="a1b2c3d4e5f60000000000000000000000000000"` → asserts `"src/foo.ts:1 @ a1b2c3d"` in document.
    - Without `gitRef` → asserts `"src/foo.ts:1"` in document and `@` not present.
    - `useWhyTimeline` called with `gitRef` as 4th argument.

---

## Per-Task Status

### Task 1: Server — extend WhyQuery Zod schema (`routes.ts`)

- **Status:** ✓ Implemented
- **File:** `server/src/modules/why/routes.ts` — exists
- **Criteria:**
  - `ref: z.string().regex(/^[0-9a-f]{40}$/).optional()` added after `line` field → PASS (`routes.ts:23`)
  - `ref` destructured alongside `file` and `line` → PASS (`routes.ts:36`)
  - `ref` forwarded as 5th arg to service → PASS (`routes.ts:37`)

---

### Task 2: Server — thread ref through WhyService (`service.ts`)

- **Status:** ✓ Implemented
- **File:** `server/src/modules/why/service.ts` — exists
- **Criteria:**
  - `ref?: string` as 5th parameter to `getTimeline` → PASS (`service.ts:32`)
  - `const effectiveRef = ref ?? pull.headSha` after `loadPull` → PASS (`service.ts:46`)
  - `runBlameAndLog` uses `effectiveRef` for both `blame()` and `log()` → PASS (`service.ts:50–51`)
  - All other logic (workspace guard, retry block, degrade paths, enrichment) unchanged → PASS (confirmed by inspection)

---

### Task 3: Server — extend tests

- **Status:** ✓ Implemented
- **Files:** `server/src/modules/why/why.test.ts`, `server/src/modules/why/routes.test.ts` — both exist
- **Criteria:**
  - `why.test.ts`: AC-2 describe block for ref-scoped blame/log → PASS (`why.test.ts:389–416`)
  - `why.test.ts`: AC-3 describe block for fetch-and-retry with caller-supplied ref → PASS (`why.test.ts:422–439`)
  - `why.test.ts`: AC-1 backward compat test (4-arg call uses headSha) → PASS (`why.test.ts:360–381`)
  - `routes.test.ts`: valid ref → HTTP 200 + 5th-arg call → PASS (`routes.test.ts:149–173`)
  - `routes.test.ts`: option-injection → HTTP 422 → PASS (`routes.test.ts:175–182`)
  - `routes.test.ts`: too-short ref → HTTP 422 → PASS (`routes.test.ts:184–191`)
  - `routes.test.ts`: uppercase hex → HTTP 422 → PASS (`routes.test.ts:193–200`)
- **Tests:** `why.test.ts`, `routes.test.ts` — both found. Not run per user direction.

---

### Task 4: Client — extend `fetchWhyTimeline` (`api.ts`)

- **Status:** ✓ Implemented
- **File:** `client/src/lib/api.ts` — exists
- **Criteria:**
  - `ref?: string` as 4th parameter → PASS (`api.ts:112`)
  - `if (ref) q.set('ref', ref)` before `api.get` call → PASS (`api.ts:114`)
  - No other changes to `api.ts` → PASS

---

### Task 5: Client — extend `useWhyTimeline` (`hooks/why.ts`)

- **Status:** ✓ Implemented
- **File:** `client/src/lib/hooks/why.ts` — exists
- **Criteria:**
  - `ref?: string` as 4th parameter → PASS (`why.ts:14`)
  - `queryKey` uses `...(ref ? [ref] : [])` spread-conditional → PASS (`why.ts:17`)
  - `ref` forwarded to `fetchWhyTimeline` → PASS (`why.ts:18`)
  - `enabled` guard `!!prId && !!file && line != null` unchanged → PASS (`why.ts:19`)

---

### Task 6: Client — extend WhyDrawer (`WhyDrawer.tsx`)

- **Status:** ✓ Implemented
- **File:** `client/src/app/repos/[repoId]/pulls/[number]/_components/WhyDrawer/WhyDrawer.tsx` — exists
- **Criteria:**
  - `gitRef?: string` in `WhyDrawerProps` with JSDoc comment → PASS (`WhyDrawer.tsx:19–20`)
  - `gitRef` destructured from props → PASS (`WhyDrawer.tsx:72`)
  - `gitRef` forwarded to `useWhyTimeline` as 4th arg → PASS (`WhyDrawer.tsx:74`)
  - Subtitle: `gitRef ? \`${file}:${line} @ ${gitRef.slice(0,7)}\` : \`${file}:${line}\`` → PASS (`WhyDrawer.tsx:77`)

---

### Task 7: Client — i18n new keys (`messages/en/brief.json`)

- **Status:** ✓ Implemented (keys exist; `openBlame` is unused in JSX — see below)
- **File:** `client/messages/en/brief.json` — exists
- **Criteria:**
  - `"fileRefs": "Files referenced"` inside `block.brief.history` → PASS (`brief.json:23`)
  - `"openBlame": "Open blame history at this commit"` → PASS (`brief.json:24`)
- **Warning:** `openBlame` is never referenced via `t("block.brief.history.openBlame")` in `BriefHistory.tsx`. The key exists but is dead i18n code. The `MonoLink` interface does not accept a `title` prop, so using this string as an accessible tooltip would require a wrapper element or vendor change — neither was done.

---

### Task 8: Client — extend BriefHistory (`BriefHistory.tsx`)

- **Status:** ~ Partial — all behavior criteria met; GitHub blob link dropped; title/openBlame absent; cleanup removed prId/repoFullName from Row props
- **File:** `client/src/app/repos/[repoId]/pulls/[number]/_components/BriefHistory/BriefHistory.tsx` — exists
- **Criteria:**
  - `MonoLink` added to `@devdigest/ui` import → PASS (`BriefHistory.tsx:5`)
  - `import { githubBlobUrl } from '…/lib/github-urls'` → FAIL (not present; see AC-6 analysis above)
  - `import { WhyDrawer } from '../WhyDrawer'` → PASS (`BriefHistory.tsx:8`)
  - `type OpenWhyRef = { file: string; ref: string } | null` → PASS (`BriefHistory.tsx:25`)
  - `Row` signature accepts `prId`, `repoFullName`, `onOpenWhy` → PARTIAL: `prId` and `repoFullName` were removed from `Row`'s props in post-implementation cleanup (they were dead once `href` was dropped); `onOpenWhy` is present. This is a documented deviation.
  - file_refs subsection renders MonoLink per non-empty file_refs → PASS (`BriefHistory.tsx:71–89`)
  - MonoLink carries `href={githubBlobUrl(...)}` → FAIL (href dropped; vendor limitation confirmed — `MonoLink` ignores `onClick` when `href` is set)
  - MonoLink `onClick` calls `onOpenWhy({ file: path, ref: entry.head_sha })` → PASS (`BriefHistory.tsx:82`)
  - MonoLink `title={t("block.brief.history.openBlame")}` → FAIL (`MonoLink` interface has no `title` prop; not wrapped in title-bearing element)
  - `BriefHistory` exported props include `repoFullName?: string | null` → PASS (`BriefHistory.tsx:100`)
  - `useState<OpenWhyRef>(null)` inside `BriefHistory` → PASS (`BriefHistory.tsx:103`)
  - `<Row>` usage forwards `onOpenWhy={setOpenWhy}` → PASS (`BriefHistory.tsx:116`); `prId` and `repoFullName` NOT forwarded to Row (removed in cleanup; these were never needed by Row once href was dropped)
  - `<WhyDrawer>` conditionally mounted with `gitRef={openWhy.ref}` → PASS (`BriefHistory.tsx:118–127`)
  - `repoFullName` threaded from `BriefHistory` props to `WhyDrawer` → PASS (`BriefHistory.tsx:121`)

**Cleanup deviation note:** The question about whether `repoFullName` is "still correctly threaded from PrBriefCard → BriefHistory → WhyDrawer" is confirmed: PrBriefCard passes it at line 137, BriefHistory receives it at line 100, BriefHistory passes it to WhyDrawer at line 121. The Row component no longer receives it, but Row no longer needs it since the href was dropped. No loose end exists for the WhyDrawer path.

---

### Task 9: Client — forward `repoFullName` from PrBriefCard (`PrBriefCard.tsx`)

- **Status:** ✓ Implemented
- **File:** `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.tsx` — exists
- **Criteria:**
  - `<BriefHistory prId={prId} repoFullName={repoFullName} />` → PASS (`PrBriefCard.tsx:137`)
  - No other changes → PASS

---

### Task 10: Client — extend tests

- **Status:** ✓ Implemented
- **Files:** `WhyDrawer.test.tsx`, `BriefHistory.test.tsx` — both exist
- **WhyDrawer.test.tsx criteria:**
  - AC-9 describe block: subtitle with `gitRef` → PASS (`WhyDrawer.test.tsx:144–166`)
  - AC-9 describe block: subtitle without `gitRef` (no `@`) → PASS (`WhyDrawer.test.tsx:156–166`)
  - `useWhyTimeline` called with `gitRef` as 4th arg → PASS (`WhyDrawer.test.tsx:168–177`)
- **BriefHistory.test.tsx criteria:**
  - `ENTRY_WITH_FILE_REFS` fixture (`head_sha: "ffff001"`, `file_refs: ["src/foo.ts"]`) → PASS (`BriefHistory.test.tsx:71–93`)
  - `renderHistory(prId = "pr-1", repoFullName?: string)` with `repoFullName` passed to `<BriefHistory>` → PASS (`BriefHistory.test.tsx:95–101`)
  - `vi.mock("../WhyDrawer", () => ({ WhyDrawer: vi.fn(() => <div data-testid="why-drawer" />) }))` → PASS (`BriefHistory.test.tsx:21–23`)
  - AC-6 describe block: expanding with `ENTRY_WITH_FILE_REFS` shows `"src/foo.ts"` → PASS (`BriefHistory.test.tsx:149–172`)
  - AC-6 describe block: `ENTRY_OLD` (no risks) shows no file paths → PASS (`BriefHistory.test.tsx:162–172`)
  - AC-7 describe block: click `"src/foo.ts"` → `why-drawer` in document, `WhyDrawer` called with `{ file, gitRef, line: 1, prId }` → PASS (`BriefHistory.test.tsx:176–202`)
  - AC-7 describe block: onClose dismisses drawer → PASS (`BriefHistory.test.tsx:205–228`)
- **Tests:** Not run per user direction.

---

## Specific Verification Points (from user request)

### gitRef naming consistency

**PASS.** The prop is named `gitRef` (not `ref`) throughout:
- `WhyDrawerProps` interface (`WhyDrawer.tsx:19`)
- `WhyDrawer` component destructuring and body (`WhyDrawer.tsx:72, 74, 77`)
- `BriefHistory.tsx` JSX mounting (`BriefHistory.tsx:124`)
- `WhyDrawer.test.tsx` render calls (`WhyDrawer.test.tsx:151, 174`)
- `BriefHistory.test.tsx` assertion (`BriefHistory.test.tsx:197`)

### Query key backward compatibility

**PASS.** `hooks/why.ts:17`: `queryKey: ["why-timeline", prId, file, line, ...(ref ? [ref] : [])]`. No raw `undefined` element is appended when `ref` is omitted — the spread produces an empty array in that case, preserving the 4-element key shape for existing callers.

### file_refs rendering only for non-empty arrays

**PASS.** `BriefHistory.tsx:71`: `{risk.file_refs.length > 0 && (...)}` — the MonoLink block is gated on a non-empty array. Empty `file_refs` render nothing. Clicking opens drawer with `line: 1` (`BriefHistory.tsx:123`).

### repoFullName threading after cleanup

**PASS.** Threading is intact: `PrBriefCard.tsx:137` → `BriefHistory.tsx:100` → `WhyDrawer.tsx:121`. The cleanup that removed `repoFullName` from `Row`'s props does not break this path because `Row` no longer needed it (the GitHub blob href was dropped from MonoLink). `WhyDrawer` still receives `repoFullName` correctly.

### DB schema / migration files

**PASS — no schema or migration changes.** Latest migration is `0016_nifty_invaders.sql` (pre-existing, from SPEC-03). No `0017_*.sql` or higher exists. `server/src/db/schema/` files are unmodified by this feature.

### Tests pass / Typecheck

**NOT VERIFIED** — user declined to run test commands. Based on static code inspection, the implementations are structurally correct and the test expectations match the component behavior.

---

## Orphaned Implementations (potential out-of-scope changes)

The full `git diff main...HEAD` includes many files unrelated to SPEC-05 (from SPEC-01 through SPEC-04, agent framework, onboarding, etc.). Those are all prior-lesson work and belong to earlier plan tasks. No new files outside the SPEC-05 scope were created as part of this implementation. The files explicitly listed in the plan's "Modules affected" section are all present and modified appropriately.

---

## Verdict

**GAPS FOUND — Overall: NEAR PASS with two documented deviations**

**8 of 9 ACs fully satisfied.** AC-6 is partial:
- Clickable affordance renders correctly and opens WhyDrawer — the core behavior is correct.
- GitHub blob link (right-click → open file at historical commit on GitHub) is absent. The vendored `MonoLink` ignores the `onClick` prop when `href` is set (confirmed in `vendor/ui/primitives/MonoLink.tsx:25–39`). The implementer chose to drop `href` rather than wrap MonoLink in a button as the plan's fallback suggested.
- The `openBlame` i18n key is defined but unused as a tooltip/title anywhere.

**All 10 plan tasks delivered.** Task 8 has two criterion misses:
1. `githubBlobUrl` import absent (GitHub blob link not implemented).
2. `title` attribute absent on MonoLink (interface doesn't support it; no wrapper added).

**What needs to be addressed before AC-6 is fully complete:**
1. To satisfy the "linking to the file on GitHub" requirement: wrap each `MonoLink` in a `<span>` or `<a>` that provides the GitHub link for right-click, since `MonoLink` cannot carry both `href` and a working `onClick`. Alternatively, use `MonoLink` with `href` only (no `onClick`) and add a separate small icon button for the WhyDrawer trigger — or update the vendor to support both behaviors.
2. To use the `openBlame` i18n key: add a `title` or `aria-label` attribute to the wrapping element around `MonoLink`.

All other requirements — `gitRef` naming, query key backward compat, workspace-scope guard, server validation, retry/degrade, subtitle format, and the full test suite structure — are correctly implemented.
