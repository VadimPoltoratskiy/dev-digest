# Plan: Historical-ref WhyDrawer from BriefHistory (SPEC-05)

## Spec reference
`server/specs/SPEC-05-why-historical-ref.md` (Status: approved)

## Execution mode: single-agent
This is a small/medium feature touching two well-separated modules (server and client). There are no DB migrations, no new adapters, and no response-shape changes to shared Zod contracts. A single implementer running server changes first then client changes sequentially keeps the diff reviewable in one pass and avoids the coordination overhead that multi-agent mode would introduce for a scope this small.

## Goal
Extend `GET /pulls/:id/why` to accept an optional `ref` query parameter (a full 40-char lowercase hex SHA). When present, `WhyService` uses that SHA as the git revision for `blame()` and `log()` instead of the PR's current `pull.headSha`, and applies the existing fetch-and-retry mechanism if the SHA is not yet in the clone's object database. On the client, render `file_refs` in each expanded `BriefHistory` row as clickable `MonoLink` affordances that open a `WhyDrawer` scoped to the historical commit's SHA — giving reviewers a path from any past Brief entry to the blame history of its files at the time that Brief was generated.

## Modules affected
- `server/` — `modules/why/routes.ts` (add `ref` to `WhyQuery` Zod schema), `modules/why/service.ts` (thread `ref` through `getTimeline` + `runBlameAndLog`), both test files extended
- `client/` — `lib/api.ts` (optional `ref` param on `fetchWhyTimeline`), `lib/hooks/why.ts` (optional `ref` param on `useWhyTimeline`, query key extension), `WhyDrawer` component (optional `gitRef` prop + subtitle change), `BriefHistory` component (render `file_refs`, mount `WhyDrawer`), `PrBriefCard` (forward `repoFullName` to `BriefHistory`), `messages/en/brief.json` (2 new i18n keys), both test files extended

## Engineering Insights applied
- **Zod field additions must stay backward-compatible (server INSIGHTS 2026-06-25):** the new `ref` field uses `.optional()` so existing `GET /pulls/:id/why?file&line` callers are unaffected. Neither `server/src/vendor/shared/` nor `client/src/vendor/shared/` need updating — `WhyTimeline`/`WhyEvent` response shapes are unchanged.
- **Test fixture hygiene (client INSIGHTS 2026-07-06):** the `BriefHistory` test fixtures (`ENTRY_NEW`, `ENTRY_OLD`) use `file_refs: []`. A third fixture with non-empty `file_refs` is required to cover AC-6 without modifying existing fixtures.
- **Validation is schema-first (server CLAUDE.md):** `ref` goes in the `WhyQuery` Zod schema; Fastify's `fastify-type-provider-zod` validates and rejects with 422 automatically. Never hand-roll `z.parse()` in a route handler.
- **TanStack Query key backward compat (client CLAUDE.md):** adding `ref` to the query key must use `...(ref ? [ref] : [])` (spread-conditional) so the existing key `["why-timeline", prId, file, line]` is preserved for callers that omit `ref`. Appending a raw `undefined` element changes the key and would create a distinct cache entry.
- **No second `QueryClientProvider` (client INSIGHTS 2026-06-23):** the single provider in `app/layout.tsx` handles everything; no new provider is needed for the WhyDrawer mounted inside BriefHistory.

## Recommendations
- **`gitRef` instead of `ref` as the prop name on `WhyDrawerProps`:** `ref` is a reserved prop name in React (used internally by `React.forwardRef`). Using it in an interface compiled under React 19 / TypeScript strict mode produces unexpected collisions. Rename the new prop `gitRef?: string` throughout `WhyDrawerProps`, the `WhyDrawer` body, and all call sites. This has zero user-visible impact and avoids a subtle type-system trap. The implementer should apply this name consistently in Phase 4 and Phase 5.
- **Single WhyDrawer instance at the `BriefHistory` level (not one per `Row`):** the spec says "BriefHistory gains local state to track which `{file, ref}` is open in a conditionally-mounted WhyDrawer." A single `openWhy: { file: string; ref: string } | null` state at `BriefHistory` level (with a callback forwarded to `Row`) guarantees only one drawer is open at a time across all history entries — better UX and simpler z-index management than per-`Row` state.
- **`onClick` with `e.preventDefault()` on `MonoLink` for file_refs:** when `repoFullName` is available, each MonoLink carries a GitHub blob `href` (for right-click → open in new tab) AND an `onClick` that calls `e.preventDefault()` + `onOpenWhy({file, ref})`. This gives both affordances without navigating away on primary click — consistent with the MonoLink pattern in `PrBriefCard` but with a WhyDrawer trigger layered on.

## Architecture decisions
- **`effectiveRef` local variable in `getTimeline`:** `const effectiveRef = ref ?? pull.headSha` resolves the backward-compat vs. historical-ref paths in one line. The `runBlameAndLog` closure then uses `effectiveRef` for both `blame()` and `log()`. The existing `fetchPullHead(repoRef, pull.number)` retry stays unchanged — it fetches the PR's current head ref, which may bring in enough history to resolve the historical SHA; if not, the service degrades to `emptyTimeline` per AC-4. Per onion-architecture: all git interaction stays inside the service closure, never in the route handler.
- **Zod `z.string().regex(/^[0-9a-f]{40}$/).optional()` for `ref`:** anchored regex restricts to the only shape `BriefTimelineEntry.head_sha` ever takes, and prevents git-level option injection (values starting with `--`) — per AC-8 and the security skill's A05 command-injection guidance. Git option injection is the relevant risk here because simple-git's `.raw(args)` passes `ref` as an array element to `child_process.spawn` (no shell), but git itself would interpret a `--`-prefixed value as a flag.
- **No changes to `GitClient` adapter (`simple-git.ts`):** confirmed at lines 120–140 that `blame(repo, path, ref?)` and `log(repo, path?, ref?)` already accept optional `ref` and pass it before `--` in the args array. Zero adapter-layer changes needed.
- **`WhyDrawer` mounted at `BriefHistory` level (not inside each `Row`):** a single conditionally-rendered `WhyDrawer` instance below the entries list, controlled by `openWhy` state, is the same mounting pattern `PrBriefCard` uses for its `BriefHistory` sub-panel. Keeps state lifting minimal and avoids multiple simultaneous drawers.
- **`Row` receives `prId`, `repoFullName`, and `onOpenWhy` callback as new props:** `Row` is a module-private function inside `BriefHistory.tsx`. Passing these props does not change the public API of `BriefHistory`; only `BriefHistory`'s exported props interface changes (gains `repoFullName?: string | null`).

## Tasks

All tasks are sequential and intended for one implementer.

---

### Step 1 — Server: extend WhyQuery Zod schema

**File: `server/src/modules/why/routes.ts`**
- [ ] Add `ref: z.string().regex(/^[0-9a-f]{40}$/).optional()` as a third field inside the `WhyQuery` `z.object({...})` block, after the existing `line` field. Keep `file` and `line` unchanged.
- [ ] In the route handler destructuring, add `ref` alongside `file` and `line`: `const { file, line, ref } = req.query`.
- [ ] Forward `ref` as the fifth argument in the service call: `return service.getTimeline(workspaceId, req.params.id, file, line, ref)`.

---

### Step 2 — Server: thread ref through WhyService

**File: `server/src/modules/why/service.ts`**
- [ ] Add optional `ref?: string` as the fifth parameter to `getTimeline(workspaceId, prId, file, line, ref?)`.
- [ ] Immediately after the `loadPull` call resolves (line ~33), compute `const effectiveRef = ref ?? pull.headSha`.
- [ ] Rewrite the `runBlameAndLog` closure (currently lines 45–49) to use `effectiveRef` for both `blame()` and `log()` calls instead of the hardcoded `pull.headSha`:
  ```typescript
  const runBlameAndLog = () =>
    Promise.all([
      this.container.git.blame(repoRef, file, effectiveRef),
      this.container.git.log(repoRef, file, effectiveRef),
    ]);
  ```
- [ ] Leave all other logic unchanged: workspace guard, retry block (still calls `fetchPullHead(repoRef, pull.number)`), `emptyTimeline` degrade paths, enrichment loop, `blameLine` matching, and `summaryFor`.

---

### Step 3 — Server: extend tests

**File: `server/src/modules/why/why.test.ts`** — extend, do not remove existing tests

- [ ] Add a describe block for **AC-2 (ref-scoped blame/log):**
  - Test: call `service.getTimeline(MOCK_WORKSPACE_ID, MOCK_PR_ID, FILE, 1, 'aabbccdd1122334455667788990011223344aabb')` (a valid 40-char hex sha different from `MOCK_HEAD_SHA`). Assert that `container.git.blame` and `container.git.log` are each called with that sha as the third argument, not with `MOCK_HEAD_SHA`.

- [ ] Add a describe block for **AC-3 (fetch-and-retry for arbitrary ref):**
  - Test: build a container with `gitThrowsOnce: true`, supply a caller `ref`. Assert `fetchPullHead` is called once, `blame`/`log` are each called twice (fail, then succeed), and the returned timeline has non-empty events.

- [ ] Add a test for **AC-1 backward compat within the existing** `'blame + log walk'` describe block (or as its own minimal test): call `service.getTimeline` with four arguments (no `ref`). Assert `blame` and `log` are called with `MOCK_HEAD_SHA` as the third argument — confirming `effectiveRef` defaults to `pull.headSha`.

**File: `server/src/modules/why/routes.test.ts`** — extend, do not remove existing tests

- [ ] Add a test: `GET /pulls/:id/why?file=src%2Fa.ts&line=1&ref=aabbccdd1122334455667788990011223344aabb` → HTTP 200, `WhyService.prototype.getTimeline` called with the sha string as the fifth argument.
- [ ] Add a test: `ref=--upload-pack%3Devil` (option-injection attempt) → HTTP 422.
- [ ] Add a test: `ref=abc123` (too short, not 40 chars) → HTTP 422.
- [ ] Add a test: `ref=AABBCCDD1122334455667788990011223344AABB` (uppercase hex — regex requires lowercase) → HTTP 422.

---

### Step 4 — Client: extend fetchWhyTimeline

**File: `client/src/lib/api.ts`**
- [ ] Add optional `ref?: string` as the fourth parameter to `fetchWhyTimeline(prId, file, line, ref?)`.
- [ ] After building `const q = new URLSearchParams({ file, line: String(line) })`, add `if (ref) q.set('ref', ref)` before the `api.get` call.
- [ ] No other changes to `api.ts`.

---

### Step 5 — Client: extend useWhyTimeline

**File: `client/src/lib/hooks/why.ts`**
- [ ] Add optional `ref?: string` as the fourth parameter to `useWhyTimeline(prId, file, line, ref?)`.
- [ ] Change `queryKey` from `["why-timeline", prId, file, line]` to `["why-timeline", prId, file, line, ...(ref ? [ref] : [])]` — the spread-conditional preserves the existing key shape for callers that omit `ref`.
- [ ] Forward `ref` to `fetchWhyTimeline(prId!, file!, line!, ref)`.
- [ ] The `enabled` guard (`!!prId && !!file && line != null`) remains unchanged.

---

### Step 6 — Client: extend WhyDrawer

**File: `client/src/app/repos/[repoId]/pulls/[number]/_components/WhyDrawer/WhyDrawer.tsx`**
- [ ] Add `gitRef?: string` to `WhyDrawerProps` (after `line`, before `onClose`). Use `gitRef` — not `ref` — to avoid collision with React's reserved `ref` prop name. Add a JSDoc comment: `/** git revision SHA (not React's ref prop) */`.
- [ ] Destructure `gitRef` from the component's props.
- [ ] Forward `gitRef` to `useWhyTimeline(prId, file, line, gitRef)`.
- [ ] Change the `subtitle` prop on `<Drawer>`:
  ```tsx
  subtitle={gitRef ? `${file}:${line} @ ${gitRef.slice(0, 7)}` : `${file}:${line}`}
  ```
  When `gitRef` is absent, subtitle is unchanged from SPEC-04 (`${file}:${line}`). This satisfies AC-9.

---

### Step 7 — Client: i18n new keys

**File: `client/messages/en/brief.json`**
- [ ] Inside the existing `block.brief.history` object (currently has `label`, `show`, `hide`, `empty`), add two new keys — additive, no existing keys changed:
  ```json
  "fileRefs": "Files referenced",
  "openBlame": "Open blame history at this commit"
  ```

---

### Step 8 — Client: extend BriefHistory

**File: `client/src/app/repos/[repoId]/pulls/[number]/_components/BriefHistory/BriefHistory.tsx`**

- [ ] Add new imports at the top of the file:
  - `MonoLink` added to the existing `@devdigest/ui` import (alongside `Icon`)
  - `import { githubBlobUrl } from '../../../../../../../lib/github-urls'`
  - `import { WhyDrawer } from '../WhyDrawer'`

- [ ] Define a local type `type OpenWhyRef = { file: string; ref: string } | null` near the top of the file (after imports, before component definitions).

- [ ] Update the `Row` component signature to accept additional props: `prId: string`, `repoFullName?: string | null`, `onOpenWhy: (pair: { file: string; ref: string }) => void`. These props are purely internal to the module; the exported `BriefHistory` interface is what changes publicly.

- [ ] Inside `Row`'s expanded section (`{open && <div style={s.expanded}>...</div>}`), after the existing risks block (which renders `risk.title` and `risk.explanation`), add a `file_refs` subsection that iterates over `entry.brief.risks` and, for each risk whose `file_refs.length > 0`, renders:
  ```tsx
  <div style={s.sectionLabel}>{t("block.brief.history.fileRefs")}</div>
  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
    {risk.file_refs.map((path, j) => (
      <MonoLink
        key={j}
        href={repoFullName ? githubBlobUrl(repoFullName, entry.head_sha, path) : undefined}
        onClick={(e) => { e.preventDefault(); onOpenWhy({ file: path, ref: entry.head_sha }); }}
        title={t("block.brief.history.openBlame")}
      >
        {path}
      </MonoLink>
    ))}
  </div>
  ```
  If `MonoLink` does not accept an `onClick` prop in its current type definition, wrap the MonoLink in a `<button type="button">` that handles the click and keeps MonoLink as a display-only child — do not modify `vendor/ui/`.

- [ ] Update `BriefHistory`'s exported component props interface:
  ```typescript
  export function BriefHistory({ prId, repoFullName }: { prId: string; repoFullName?: string | null })
  ```

- [ ] Add `const [openWhy, setOpenWhy] = useState<OpenWhyRef>(null)` inside `BriefHistory`.

- [ ] Update the `<Row>` usage inside `BriefHistory` to forward the new props:
  ```tsx
  <Row
    key={entry.head_sha}
    entry={entry}
    prId={prId}
    repoFullName={repoFullName}
    onOpenWhy={setOpenWhy}
  />
  ```

- [ ] Conditionally mount `WhyDrawer` below the entries list, inside the outer `<div style={s.container}>`, using the `gitRef` prop name from Step 6:
  ```tsx
  {openWhy && (
    <WhyDrawer
      prId={prId}
      repoFullName={repoFullName}
      file={openWhy.file}
      line={1}
      gitRef={openWhy.ref}
      onClose={() => setOpenWhy(null)}
    />
  )}
  ```

---

### Step 9 — Client: forward repoFullName from PrBriefCard

**File: `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.tsx`**
- [ ] Locate the `<BriefHistory prId={prId} />` call (~line 137) inside `{historyOpen && ...}`.
- [ ] Change it to `<BriefHistory prId={prId} repoFullName={repoFullName} />`.
- [ ] No other changes. `repoFullName` is already a prop on `PrBriefCardProps`.

---

### Step 10 — Client: extend tests

**File: `client/src/app/repos/[repoId]/pulls/[number]/_components/WhyDrawer/WhyDrawer.test.tsx`** — extend, do not remove existing tests

- [ ] Add a describe block for **AC-9 (subtitle with `gitRef`):**
  - Test: render `<WhyDrawer ... gitRef="a1b2c3d4e5f60000000000000000000000000000" file="src/foo.ts" line={1} ...>`. Mock `useWhyTimeline` to return `{ data: undefined, isLoading: true }`. Assert `screen.getByText("src/foo.ts:1 @ a1b2c3d")` is in the document.
  - Test: render without `gitRef`. Assert `screen.getByText("src/foo.ts:1")` is in the document and the text `@` does not appear in the subtitle.

- [ ] Add a test: when `gitRef` is provided, `vi.mocked(useWhyTimeline)` is called with `gitRef` as the fourth argument. Use `expect(useWhyTimeline).toHaveBeenCalledWith("pr-1", "src/foo.ts", 1, "a1b2c3d4...")`.

**File: `client/src/app/repos/[repoId]/pulls/[number]/_components/BriefHistory/BriefHistory.test.tsx`** — extend, do not remove existing tests

- [ ] Add a fixture `ENTRY_WITH_FILE_REFS: BriefTimelineEntry` with `head_sha: "ffff001"` and `brief.risks: [{ kind: "security", title: "Test risk", explanation: "...", severity: "high", file_refs: ["src/foo.ts"] }]`.
- [ ] Update `renderHistory` helper signature to `renderHistory(prId = "pr-1", repoFullName?: string)` and pass `repoFullName` to `<BriefHistory>`.
- [ ] Add a `vi.mock` for `WhyDrawer` at the top (after the `useBriefHistory` mock): `vi.mock("../WhyDrawer", () => ({ WhyDrawer: vi.fn(() => <div data-testid="why-drawer" />) }))`. Import `WhyDrawer` from `"../WhyDrawer"` below the `vi.mock` calls for `vi.mocked()` access.
- [ ] Add a describe block for **AC-6 (file_refs render in expanded row):**
  - Test: mock `useBriefHistory` to return `ENTRY_WITH_FILE_REFS`. Expand the row. Assert `screen.getByText("src/foo.ts")` is in the document.
  - Test: mock `useBriefHistory` to return `ENTRY_OLD` (which has `risks: []`). Expand the row. Assert no MonoLink file paths are rendered (use `screen.queryByText("src/foo.ts")` → `null`).
- [ ] Add a describe block for **AC-7 (WhyDrawer opens on file_refs click):**
  - Test: render with `repoFullName="acme/payments-api"`, mock `useBriefHistory` to return `ENTRY_WITH_FILE_REFS`. Expand the row. Click `screen.getByText("src/foo.ts")`. Assert `screen.getByTestId("why-drawer")` is in the document. Assert `vi.mocked(WhyDrawer)` was called with props matching `{ file: "src/foo.ts", gitRef: "ffff001", line: 1, prId: "pr-1" }`.
  - Test: after opening the drawer, call the `onClose` callback captured from `vi.mocked(WhyDrawer).mock.calls[0][0].onClose()`. Assert `screen.queryByTestId("why-drawer")` returns `null`.

---

## Gotchas

- **No DB migration or schema changes.** `ref` is a purely request-time parameter; `db/schema/` and `db/migrations/` are untouched. Do not run `pnpm db:generate` or `pnpm db:migrate`.
- **No shared Zod contract changes.** `WhyTimeline`/`WhyEvent` response shapes are unchanged. Neither `server/src/vendor/shared/` nor `client/src/vendor/shared/` need updating.
- **Use `gitRef` not `ref` as the prop name throughout.** `ref` is a reserved prop name in React. Every occurrence in `WhyDrawerProps`, the `WhyDrawer` body, the `BriefHistory` JSX, and the test files must use `gitRef`. Confirm with `pnpm typecheck` in `client/`.
- **Query key backward compat:** do NOT write `["why-timeline", prId, file, line, ref]` — when `ref` is `undefined`, TanStack Query may serialize this as a key distinct from the 4-element array used by existing callers. Use `...(ref ? [ref] : [])` to conditionally spread.
- **`src/vendor/ui/` must not be modified.** If `MonoLink` does not accept `onClick`, wrap it in a `<button>` that handles the click. Do not fork or edit the vendored primitive.
- **Fetch-and-retry mechanism is unchanged.** When `ref` is a historical SHA, `fetchPullHead(repoRef, pull.number)` still fetches the PR's current head — this may bring in enough object graph history to resolve the historical SHA. If not, the service degrades to `emptyTimeline`. This is the correct behavior per AC-3/AC-4 and requires no code change to the retry block.
- **Run `pnpm typecheck` in both packages after Step 3 and Step 10.** `cd server && pnpm typecheck` after Step 3; `cd client && pnpm typecheck` after Step 10.

## Definition of done

- [ ] `pnpm test` passes in `server/` with no regressions — all new tests in Step 3 green
- [ ] `pnpm test` passes in `client/` with no regressions — all new tests in Step 10 green
- [ ] `pnpm typecheck` reports zero errors in both `server/` and `client/`
- [ ] **AC-1:** `GET /pulls/:id/why?file&line` (no `ref`) returns the same response as before; `blame()` and `log()` are called with `pull.headSha`
- [ ] **AC-2:** `GET /pulls/:id/why?file&line&ref=<40-char-lowercase-hex>` passes the `ref` to `blame()` and `log()` instead of `pull.headSha`
- [ ] **AC-3:** When the supplied `ref` is not in the clone's object database, the service performs one `fetchPullHead` + retry before degrading
- [ ] **AC-4:** If retry still fails, the route returns HTTP 200 with `{ blame: null, events: [], summary: <non-empty string> }` — not HTTP 500
- [ ] **AC-5:** `GET /pulls/:id/why` for a PR outside the caller's workspace returns HTTP 404 regardless of `ref` value
- [ ] **AC-6:** Expanding a `BriefHistory` row whose `risks` contain non-empty `file_refs` renders each file path as a clickable affordance inside the expanded section
- [ ] **AC-7:** Clicking a `file_refs` path in an expanded `BriefHistory` row opens `WhyDrawer` with `{ file: <path>, gitRef: <entry.head_sha>, line: 1 }`
- [ ] **AC-8:** `ref=--upload-pack%3Devil` → HTTP 422; `ref=abc123` → HTTP 422; `ref=AABB...` (uppercase) → HTTP 422; valid 40-char lowercase hex → HTTP 200
- [ ] **AC-9:** `WhyDrawer` opened with `gitRef` shows subtitle `${file}:${line} @ ${gitRef.slice(0, 7)}`; without `gitRef`, subtitle is `${file}:${line}` (unchanged from SPEC-04)
