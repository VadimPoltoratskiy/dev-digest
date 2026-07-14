# Plan: App Shell Fixes, Multi-Run Visual Fidelity, and Compose Review Feature

## Spec reference

- Parts A & B: planned directly from research findings in `/Users/vpolto/.claude/plans/lets-create-multi-agent-composed-karp.md` (no standalone spec; these are fixes to the already-specified SPEC-03 feature).
- Part C: `specs/SPEC-04-compose-review.md` — read in full; its acceptance criteria, service contracts, and resolved decisions are ground truth.

---

## Execution mode: multi-agent

**Recommended: multi-agent, 4 phases (Wave 1: Phases 1+2 in parallel; Wave 2: Phase 3; Wave 3: Phase 4).**

Rationale:
- Phase 1 (Part A structural fixes) and Phase 2 (Part B visual fidelity) touch almost entirely different files and have no interdependencies — run them in parallel.
- Phase 3 (Part C server contract + route + service) must precede Phase 4 because the client hook and drawer depend on the finalized `ComposeReviewBody`/`ComposeReviewResponse` Zod shape exported from the shared vendor contract.
- Phase 4 (Part C client) unblocks as soon as Phase 3 is complete; the drawer and hook implementer reads the finalized contract and runs.

**Wave execution order:**
1. **Wave 1 (parallel):** Implementer A runs Phase 1; Implementer B runs Phase 2.
2. **Wave 2 (sequential):** Implementer C runs Phase 3.
3. **Wave 3 (sequential):** Implementer D runs Phase 4.

---

## Goal

Restore the missing `AppShell` sidebar wrapper and fix a stale nav link on multi-run pages so the left nav renders correctly (Part A). Improve visual fidelity of the Multi-Agent Review results page by adding PR title end-to-end, repositioning aggregate stats to a top-right block, converting the score to a circular badge, and adding per-agent left-border color coding (Part B). Build the entirely new Compose Review feature — a drawer that lets users post a human-curated GitHub PR review (verdict + inline comments from AI findings) from the PR detail page (Part C).

---

## Modules affected

- `client/` — Part A: `multi-runs` page view components and `vendor/ui/nav.ts` + `components/app-shell/helpers.ts`. Part B: `MultiRunHeader`, `ColumnsView`, and their shared Zod contracts. Part C: new `ComposeReviewDrawer` component, mutation hook in `lib/hooks/reviews.ts`, `lib/api.ts`, `PrDetailHeader` wiring, and `messages/en/compose.json`.
- `server/` — Part B: `modules/multi-runs/repository.ts` + `service.ts` (add `pr_title`), both `vendor/shared/contracts/observability.ts` files. Part C: `modules/reviews/routes.ts` + `service.ts` (new endpoint + method), both `vendor/shared/contracts/review-api.ts` files.

No DB schema changes. No migrations required.

---

## Engineering Insights applied

- `client/vendor/shared/` is a **manual mirror** of `server/vendor/shared/` — both sides must be updated in the same logical commit. No tooling enforces the sync; TypeScript is the only check. All contract tasks list both files explicitly. _(client INSIGHTS 2026-06-25)_
- Adding a required (non-`.nullish()`) field to a shared Zod contract breaks every existing producer immediately with TS2741. `pr_title` and `omitted_count` use `.nullish()` or `.optional()` to avoid cascading errors in adapters and mocks that do not supply the field. _(server INSIGHTS 2026-06-25 recurring error)_
- `multi-runs` repository's `findMultiRunById` already `leftJoin`s `pullRequests` for `pr_number` — adding `prTitle` is a one-line select extension with zero new joins needed. _(confirmed: `server/src/modules/multi-runs/repository.ts:40-53`)_
- `replyToFinding` in `server/src/modules/reviews/service.ts:255-296` is the exact pattern to mirror for `composeReview`: resolve context → workspace scope check → `container.github()` catch → adapter call → error wrapping. Do not invent a new error-wrapping style.
- `client/src/vendor/ui/nav.ts` is app-specific nav data edited by every past feature (Skills Lab, project-context, etc.) — the "do not touch vendor" warning applies to generic UI primitives, not this file. Editing `nav.ts:43` is correct established practice.
- `SeverityBadge` in `@devdigest/ui` establishes the circular badge shape pattern (width/height, border-radius 50%, centered content) — use its CSS variable vocabulary for the score badge in `ColumnsView/styles.ts`. _(client INSIGHTS 2026-06-26)_

---

## Recommendations

- **Score badge styling:** Rather than importing `SeverityBadge` directly (which carries severity-color semantics), replicate its three structural style properties (`width: 40`, `height: 40`, `borderRadius: "50%"`, `display: "flex"`, `alignItems/justifyContent: "center"`) inline in `ColumnsView/styles.ts` using existing CSS variable tokens. Avoids coupling a score badge to the severity system while matching the established shape. Trade-off: slightly more inline style than a reused component, but semantically cleaner.
- **Out-of-diff comment handling (AC-11): pre-filter against the stored diff, not catch-422.** `server/src/modules/reviews/diff-loader.ts` (`loadDiff(container, repo, workspaceId, pull, repoRow)`) is already used elsewhere in this module and returns a `UnifiedDiff` (`server/src/vendor/shared/adapters.ts:185-187`) — `{ files: { path, additions, deletions, hunks: DiffHunk[] }[] }`, where each `DiffHunk` (`adapters.ts:175-180`) has `newStart`/`newLines`. Before calling `postReview`, resolve the diff once, then for each candidate comment check whether `finding.end_line` falls inside any hunk's `[newStart, newStart + newLines)` range for `finding.file`; findings that don't match are excluded from `comments[]` and counted in `omitted_count`. This is precise (no guessing from a GitHub 422 body), reuses an existing loader instead of inventing a retry loop, and lets `omitted_count` be populated correctly on the *first* successful `postReview` call — no retry logic needed at all. This directly satisfies the user's chosen decision (surface a real omission count) rather than the coarser "fail the whole review" fallback.

---

## Architecture decisions

- **`composeReview` method lives in `ReviewService`, not a new service** — the `reviews` module already owns PR-finding-GitHub-write concerns; `replyToFinding` is the established precedent. One new endpoint does not warrant a new module. _(onion-architecture SKILL decision tree: "new route/endpoint → existing module's routes.ts")_
- **`ComposeReviewBody`/`ComposeReviewResponse` Zod schemas live in `server/src/vendor/shared/contracts/review-api.ts`** — this file already owns all review-related request/response contracts (`FindingReplyBody`, `ReviewRunResponse`, etc.). Adding the new schemas here keeps the shared surface cohesive. Both vendor files must be updated in lockstep. _(onion-architecture SKILL: "shared Zod contract → vendor/shared/contracts/")_
- **`ComposeReviewDrawer` placed at `client/src/app/repos/[repoId]/pulls/[number]/_components/ComposeReviewDrawer/`** — used by exactly one route (the PR detail page); colocation rule applies. _(ui-architecture SKILL: "component used only by one route → app/<route>/_components/<Name>/")_
- **`usePostComposeReview` mutation hook placed in `client/src/lib/hooks/reviews.ts`** — this file already owns all PR-review-related mutations; the new hook is domain-adjacent. _(ui-architecture SKILL: "data-fetching/mutation hook → lib/hooks/<domain>.ts")_
- **`postComposeReview` fetch function placed in `client/src/lib/api.ts`** — all HTTP calls go through this single file; no inline `fetch` in components. _(ui-architecture SKILL anti-pattern: "Inline fetch in component body → CRITICAL violation")_
- **Workspace + PR scope guard for `finding_ids` at service layer** — per SPEC-04 untrusted inputs section: each `finding_id` must be verified server-side to belong to a finding scoped to the request's `workspaceId` and target PR before its content is passed to the GitHub API. This guard lives in `ReviewService.composeReview()`. _(security skill A01: always check ownership; deny-by-default)_
- **GitHub PAT resolved server-side only** — `container.github()` resolves from `~/.devdigest/secrets.json`; the token is never transmitted to the client. Matches the `replyToFinding` pattern and the secrets adapter invariant. _(SPEC-04 Non-functional — Security)_

---

## Tasks

### Phase 1: Part A — Structural fixes (client only)

*No server changes. No contract changes. Runs in parallel with Phase 2.*

- [ ] `client/src/app/multi-runs/[multiRunId]/_components/MultiRunResultsView/MultiRunResultsView.tsx` — import `AppShell` from `@/components/app-shell` and wrap the three render branches (loading, error, and normal) with `<AppShell crumb={[{ label: "Multi-Agent Review", href: "/multi-runs/configure" }]}>`. Replace the outer `<div style={s.page}>` in each branch with the AppShell wrapper (the existing page-level div style can be applied to an inner div). This keeps `page.tsx` as a server component (no conversion to `"use client"` needed).

  Reference the exact wrapping pattern from `client/src/app/repos/[repoId]/pulls/[number]/page.tsx:93-125`: all render branches (loading skeleton, error state, normal view) are wrapped in `<AppShell crumb={crumb}>` so the nav renders in every state.

- [ ] `client/src/app/multi-runs/configure/_components/ConfigureRunView/ConfigureRunView.tsx` — same treatment: import `AppShell` and wrap the root return with `<AppShell crumb={[{ label: "Multi-Agent Review", href: "/multi-runs/configure" }]}>`. Apply to all render branches (loading, error, normal).

- [ ] `client/src/vendor/ui/nav.ts:43` — change `href: "/multi-agent"` to `href: "/multi-runs/configure"`. The full item is `{ key: "multi-agent", label: "Multi-Agent Review", icon: "Workflow", href: "/multi-agent" }` — only the `href` value changes.

- [ ] `client/src/components/app-shell/helpers.ts:28` — change the active-match line from:
  ```typescript
  if (pathname.includes("/multi-agent")) return "multi-agent";
  ```
  to:
  ```typescript
  if (pathname.startsWith("/multi-runs")) return "multi-agent";
  ```
  The nav item key stays `"multi-agent"` (matches the key in `nav.ts`). The `startsWith("/multi-runs")` check must be placed before the `"/pulls"` check at line 32 to avoid the `/multi-runs/…/pulls/…` path shadowing it (though no such nested route exists today, defensive ordering is correct).

---

### Phase 2: Part B — Visual fidelity fixes (server + client)

*Can run in parallel with Phase 1. The server sub-tasks (B1-server) should be completed first within this phase before the B1-client sub-tasks, but B2/B3/B4 are purely client-side and can proceed immediately.*

**B1 — PR title end-to-end**

- [ ] `server/src/modules/multi-runs/repository.ts` — in `findMultiRunById` (lines 34-61), add `prTitle: t.pullRequests.title` to the `.select({...})` block. The `leftJoin` to `t.pullRequests` already exists. Update the TypeScript return-type annotation (`{ id: string; prId: string; prNumber: number | null; prTitle: string | null; ranAt: Date }`) and the returned object (`prTitle: row.prTitle ?? null`).

- [ ] `server/src/modules/multi-runs/service.ts` — in `getMultiRun` (around lines 112-132), add `pr_title: row.prTitle ?? null` to the returned DTO object, next to the existing `pr_number: row.prNumber ?? null` entry.

- [ ] `server/src/vendor/shared/contracts/observability.ts` — in the `MultiRunRecord` Zod schema (lines 169-179), add `pr_title: z.string().nullish()` next to `pr_number`. Use `.nullish()` (not `.nullable()`) — forward compat, matching the `pr_number` pattern (not all producers are guaranteed to supply it).

- [ ] `client/src/vendor/shared/contracts/observability.ts` — mirror the exact same `pr_title: z.string().nullish()` addition to `MultiRunRecord`. Manual mirror — keep in lockstep with the server vendor file.

- [ ] `client/src/app/multi-runs/[multiRunId]/_components/MultiRunHeader/MultiRunHeader.tsx` — add `prTitle: string | null | undefined` to `MultiRunHeaderProps`. Render a PR title line below (or as part of) the breadcrumb: when both `prNumber` and `prTitle` are available, render `#{prNumber} · {prTitle}` as a bold heading; when only `prNumber` is available, render `#{prNumber}` as before; when neither, render the existing `t("results.title")` fallback. Check `client/messages/en/multiRuns.json` for an existing key that accepts a `title` param — if none exists, add `"prTitle": "#{number} · {title}"` to the messages file for both the title display and i18n completeness.

- [ ] `client/src/app/multi-runs/[multiRunId]/_components/MultiRunResultsView/MultiRunResultsView.tsx` — pass `prTitle={multiRun.pr_title}` to `<MultiRunHeader />` (around line 139-148 in the existing JSX).

**B2 — Reposition aggregate stats to top-right**

- [ ] `client/src/app/multi-runs/[multiRunId]/_components/MultiRunHeader/MultiRunHeader.tsx` — split the current `summaryLine` block (lines 37-40, rendered as `<div style={s.summary}>{summaryLine}</div>`) into two visual blocks:
  1. Agent count / status text stays as a subtitle below the breadcrumb/title (use a simplified `t("results.summaryRunning", { count: agentCount })` or a new key for just the agent count label).
  2. Cost + duration stats become a right-aligned block — move them into a new `<div style={s.statsBlock}>` inside or alongside the existing `<div style={s.actions}>` in `s.topRow`, so they appear on the right side at the same vertical level as the title.
  
  No new data needed — `totalDurationMs`, `totalCostUsd`, and `agentCount` are already props. Update `MultiRunHeader/styles.ts` to add a `statsBlock` style (right-aligned, `display: "flex"`, small muted text, `gap: 8`, `fontSize: 12`, `color: "var(--text-muted)"`). Remove or repurpose the old `s.summary` style.

**B3 — Score badge → circular badge**

- [ ] `client/src/app/multi-runs/[multiRunId]/_components/ColumnsView/styles.ts` — restyle the `score` entry (currently lines 64-68: `fontSize: 22, fontWeight: 700, color: "var(--text-primary)"`) into a circular badge using existing CSS variable tokens:
  ```typescript
  score: {
    width: 40,
    height: 40,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 15,
    fontWeight: 700,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  ```
  No import changes needed in the component — `s.score` is already referenced in `ColumnsView.tsx:69`.

**B4 — Per-agent column left-border color coding**

- [ ] `client/src/app/multi-runs/[multiRunId]/_components/ColumnsView/ColumnsView.tsx` — add a fixed `AGENT_COLORS` constant array at the top of the file (5-6 distinct colors; use hardcoded hex values that are legible against `var(--bg-surface)` in dark mode, e.g. `["#6c8ebf", "#82b366", "#d6a520", "#ae4132", "#9c5caf", "#d98c3e"]`). Apply the color by index (`AGENT_COLORS[index % AGENT_COLORS.length]`) as `borderLeft: "3px solid ${color}"` on the column `<div>` using a style spread: `style={{ ...s.column, borderLeft: \`3px solid ${color}\` }}`. The `agents.map((agent, index) => ...)` signature needs the `index` parameter added.

---

### Phase 3: Part C — Server (shared contract + route + service)

*Must complete before Phase 4. The shared Zod contract step is the critical unblocking task.*

**C1 — Shared Zod contract (both vendor files)**

- [ ] `server/src/vendor/shared/contracts/review-api.ts` — append the following at the bottom of the file, after the existing `SmartDiffResponse` exports:
  ```typescript
  /** POST /pulls/:id/compose-review request body. */
  export const ComposeReviewBody = z.object({
    verdict: z.enum(['APPROVE', 'COMMENT', 'REQUEST_CHANGES']),
    body: z.string(),
    finding_ids: z.array(z.string()),
  });
  export type ComposeReviewBody = z.infer<typeof ComposeReviewBody>;

  /** POST /pulls/:id/compose-review response. */
  export const ComposeReviewResponse = z.object({
    github_review_id: z.string(),
    /** Number of selected findings whose file+line was outside the PR diff and omitted. */
    omitted_count: z.number().int().optional(),
  });
  export type ComposeReviewResponse = z.infer<typeof ComposeReviewResponse>;
  ```
  No changes to `vendor/shared/index.ts` needed — it already does `export * from './contracts/review-api.js'`.

- [ ] `client/src/vendor/shared/contracts/review-api.ts` — mirror the identical `ComposeReviewBody` and `ComposeReviewResponse` additions. Keep both vendor files in exact lockstep.

**C2 — Repository: findings scope-guard query**

- [ ] `server/src/modules/reviews/repository.ts` (or the appropriate sub-repo file if split) — add a new method `findFindingsByIdsForPr(workspaceId: string, prId: string, findingIds: string[]): Promise<FindingRow[]>`:
  - Guard: if `findingIds.length === 0`, return `[]` immediately (supports AC-15 — empty `finding_ids` is valid).
  - Join path: `findings` → `reviews` (via `findings.review_id = reviews.id`) → `agent_runs` (via `reviews.run_id = agent_runs.id`) → `pull_requests` (via `agent_runs.pr_id` or `reviews.pr_id`, whichever column exists — check the actual schema).
  - Filter: `finding.id IN (findingIds)` AND `pull_requests.id = prId` AND `pull_requests.workspace_id = workspaceId`.
  - Return the raw `FindingRow[]` for the service to process.
  
  First read the existing `findingContext()` method in the same file to understand the join pattern and mirror it for the batch version. Use Drizzle's `inArray` operator for the `findingIds` filter.

**C3 — Service: `composeReview` method**

- [ ] `server/src/modules/reviews/service.ts` — add `async composeReview(workspaceId: string, prId: string, body: ComposeReviewBody): Promise<ComposeReviewResponse>` following the exact shape of `replyToFinding` (lines 255-296):

  1. `const pull = await this.repo.getPull(workspaceId, prId)` — throw `NotFoundError('Pull request not found')` if null.
  2. `const repoRow = await this.repo.getRepo(pull.repoId)` — throw `NotFoundError('Repo not found')` if null.
  3. If `body.finding_ids.length > 0`:
     - Call `this.repo.findFindingsByIdsForPr(workspaceId, prId, body.finding_ids)`.
     - If `findings.length !== body.finding_ids.length`, throw `NotFoundError('One or more findings not found for this PR')` (prevents out-of-scope ID data leaks — SPEC-04 untrusted inputs + OWASP A01).
  4. `let gh: GitHubClient; try { gh = await this.container.github(); } catch { throw new AppError('github_unavailable', 'Connect a GitHub token to post a review.', 400); }`
  5. Map verdicts: `body.verdict` values (`APPROVE`, `COMMENT`, `REQUEST_CHANGES`) pass through directly to `GitHubReviewPayload.event` — they are already uppercase strings matching GitHub's API.
  6. If there are any resolved findings, load the PR's diff via `loadDiff(this.container, this.repo, workspaceId, pull, repoRow)` (`server/src/modules/reviews/diff-loader.ts`) once. For each resolved finding, determine whether `finding.endLine` falls inside any hunk's `[newStart, newStart + newLines)` range for a file matching `finding.file` in `diff.files`. Partition findings into `inDiff` and `outOfDiff`; `omitted_count = outOfDiff.length` (0 if none).
  7. Build inline comments array only from `inDiff` findings: `{ path: finding.file, line: finding.endLine, body: buildCommentBody(finding) }`. Extract `buildCommentBody` as a pure function in `server/src/modules/reviews/helpers.ts` (create file or add to existing): `` `**[${f.severity}] ${f.title}**\n\n${f.suggestion ?? f.rationale}` ``.
  8. `try { const result = await gh.postReview({ owner: repoRow.owner, name: repoRow.name }, pull.number, { body: body.body, event: body.verdict, comments }); return { github_review_id: result.id, omitted_count: outOfDiff.length || undefined }; } catch (err) { throw new AppError('github_review_failed', 'Failed to post the review to GitHub.', 400, { cause: String(err) }); }`

  This pre-filter means `postReview` is called only with comments GitHub is guaranteed to accept — no 422-driven retry loop is needed, and `omitted_count` is always accurate on the first successful call.

  Import `ComposeReviewBody`, `ComposeReviewResponse` from `'@devdigest/shared'`. Import `FindingRow` from `'../../db/rows.js'` if needed. Import `loadDiff` from `'./diff-loader.js'`.

**C4 — Route: `POST /pulls/:id/compose-review`**

- [ ] `server/src/modules/reviews/routes.ts` — add after the existing `/findings/:id/reply` handler (currently ending at line 194):
  ```typescript
  // ---- Compose a human-curated GitHub PR review --------------------------------
  app.post(
    '/pulls/:id/compose-review',
    { schema: { params: IdParams, body: ComposeReviewBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.composeReview(workspaceId, req.params.id, req.body);
    },
  );
  ```
  Add `ComposeReviewBody` to the import line from `'@devdigest/shared'` at line 3. No changes to `modules/index.ts` or `app.ts` — this route belongs to the existing `reviews` module plugin already registered.

---

### Phase 4: Part C — Client (API function + hook + drawer + wiring)

*Depends on Phase 3 (specifically C1). Start after Phase 3 is complete.*

**C5 — API function**

- [ ] `client/src/lib/api.ts` — add `postComposeReview` at the bottom of the reviews-related section:
  ```typescript
  export async function postComposeReview(
    prId: string,
    body: ComposeReviewBody,
  ): Promise<ComposeReviewResponse> {
    return api.post<ComposeReviewResponse>(`/pulls/${prId}/compose-review`, body);
  }
  ```
  Import `ComposeReviewBody` and `ComposeReviewResponse` from `'@devdigest/shared'`.

**C6 — Mutation hook**

- [ ] `client/src/lib/hooks/reviews.ts` — add `usePostComposeReview` at the bottom of the file:
  ```typescript
  export function usePostComposeReview(prId: string | null) {
    return useMutation<ComposeReviewResponse, Error, ComposeReviewBody>({
      mutationFn: (body) => postComposeReview(prId!, body),
    });
  }
  ```
  The hook does NOT call `notify.error` internally — error handling (distinguishing `github_unavailable` from `github_review_failed`) happens in the drawer's `onError` callback, following the `useReclassifyIntent` precedent (line 47). Import `ComposeReviewBody`, `ComposeReviewResponse` from `'@devdigest/shared'` and `postComposeReview` from `'../api'`.

**C7 — `ComposeReviewDrawer` component**

- [ ] Create directory `client/src/app/repos/[repoId]/pulls/[number]/_components/ComposeReviewDrawer/`.

- [ ] `client/src/app/repos/[repoId]/pulls/[number]/_components/ComposeReviewDrawer/index.ts` — barrel:
  ```typescript
  export { ComposeReviewDrawer } from './ComposeReviewDrawer';
  ```

- [ ] `client/src/app/repos/[repoId]/pulls/[number]/_components/ComposeReviewDrawer/ComposeReviewDrawer.tsx` — the main component. Model the slide-over pattern on `client/src/components/RunTraceDrawer/` (overlay + animated panel, Escape-key close via `useEffect`). Props:
  ```typescript
  interface ComposeReviewDrawerProps {
    prId: string;
    open: boolean;
    onClose: () => void;
    allFindings: FindingRecord[];
  }
  ```
  
  Internal state:
  - `verdict: 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES' | null` — starts `null` (AC-3: no pre-fill).
  - `body: string` — starts empty (AC-4).
  - `selectedIds: Set<string>` — re-initialized on each open via `useEffect([open])` to the set of findings where `accepted_at !== null && dismissed_at === null` (AC-5). Re-initialization ensures re-opening starts fresh (AC-14).
  - `postedReviewId: string | null` — success state.
  - `errorMsg: string | null` — error message to display.
  
  `usePostComposeReview(prId)` mutation; `useTranslations("compose.reviewDrawer")` for strings.
  
  Keyboard dismiss: `useEffect` that attaches a `keydown` listener for `Escape` when `open === true`, calls `onClose`, cleans up on `open` change or unmount. See `client/src/vendor/ui/kit/Dropdown.tsx` for the established pattern.
  
  Render structure:
  1. When `!open`, return `null` (no DOM).
  2. Overlay div + slide-over panel (right-anchored, fixed position).
  3. **Header row:** `t("title")` heading + `t("subtitle")` subheading + close button.
  4. **Verdict selector:** three toggle buttons labeled `t("verdicts.approve")`, `t("verdicts.comment")`, `t("verdicts.requestChanges")`. Clicking one sets `verdict`. Selected button has distinct visual state (border, background). Use `<Button>` from `@devdigest/ui` or plain `<button>` elements. No pre-selection (AC-3). "Post" button is disabled when `verdict === null`.
  5. **Review body:** `<label>{t("reviewBody")}</label>` + annotation `t("markdownEditable")` + `<textarea value={body} onChange={...} />`. Empty on open (AC-4).
  6. **Findings list:** render `allFindings` (sorted: pre-selected first). Each row: `<input type="checkbox" checked={selectedIds.has(f.id)} onChange={() => toggle(f.id)} />` + `f.title` + `f.file` label. Toggling calls `setSelectedIds` with the updated set (AC-6).
  7. **Inline comments counter:** `t("inlineComments")` label + `t("findingsCount", { count: selectedIds.size })` (ICU plural — AC-7). Updates immediately on toggle.
  8. **Footer:** `<Button onClick={onClose}>{t("cancel")}</Button>` + `<Button kind="primary" disabled={verdict === null || mutation.isPending} onClick={handlePost}>{mutation.isPending ? t("posting") : t("post")}</Button>` (AC-8).
  9. **Success state (AC-10, AC-11):** when `postedReviewId` is set, render success message and disable Post button:
     - If `mutation.data?.omitted_count > 0`: `t("postedWithOmissions", { id: postedReviewId, count: mutation.data.omitted_count })`.
     - Otherwise: `t("postedWithId", { id: postedReviewId })`.
  10. **Error state (AC-12, AC-13):** when `errorMsg` is set, display it above the footer; re-enable Post button.
  
  `handlePost`: call `mutation.mutate({ verdict: verdict!, body, finding_ids: [...selectedIds] }, { onSuccess: (data) => setPostedReviewId(data.github_review_id), onError: (err) => setErrorMsg(err.message.includes('github_unavailable') ? 'Connect a GitHub token in Settings → API Keys.' : err.message) })`.
  
  Add `"use client"` directive at the top.

**C8 — i18n: add `postedWithOmissions` key**

- [ ] `client/messages/en/compose.json` — add to `reviewDrawer` object:
  ```json
  "postedWithOmissions": "Review posted to GitHub · id {id} · {count} comment(s) skipped (out of diff)."
  ```
  All other strings already exist (`title`, `subtitle`, `inlineComments`, `cancel`, `post`, `posting`, `postedWithId`, `posted`, `verdictLabel`, `verdicts.*`, `reviewBody`, `markdownEditable`, `findingsCount`). No further i18n changes needed.

**C9 — Wire drawer into `PrDetailHeader` and `page.tsx`**

- [ ] `client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/PrDetailHeader.tsx` — make the following changes:
  1. Add `allFindings: FindingRecord[]` to `PrDetailHeaderProps` (the `allFindings` array is already computed in `page.tsx:73-75`).
  2. Add `const [composeOpen, setComposeOpen] = React.useState(false)` inside the component.
  3. Add `useTranslations("compose.reviewDrawer")` import and call (`const tCompose = useTranslations("compose.reviewDrawer")`).
  4. In `<div style={s.actions}>` (after `RunReviewDropdown`, around line 92-99), add:
     ```tsx
     {prId && (
       <Button kind="primary" size="sm" onClick={() => setComposeOpen(true)}>
         {tCompose("title")}
       </Button>
     )}
     ```
     (AC-1: button visible only when `prId` is resolved.)
  5. After the closing `</div>` of the main header div, render:
     ```tsx
     {prId && (
       <ComposeReviewDrawer
         prId={prId}
         open={composeOpen}
         onClose={() => setComposeOpen(false)}
         allFindings={allFindings}
       />
     )}
     ```
  6. Add imports: `ComposeReviewDrawer` from `./_components/../ComposeReviewDrawer` (adjust relative path), `FindingRecord` from `'@devdigest/shared'`, `useTranslations` from `'next-intl'`.

- [ ] `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` — pass `allFindings` to `<PrDetailHeader />`. The `allFindings` array is already computed at line 73-75 (`const allFindings: FindingRecord[] = React.useMemo(...)`). Add it as a prop: `allFindings={allFindings}` in the `<PrDetailHeader ... />` JSX (around line 126-135).

---

## Gotchas

- **No DB migration required** for any part. Part B adds `pr_title` to the DTO and Zod contract only — the `title` column already exists on `pull_requests` (confirmed: `server/src/db/schema/pulls.ts:16`). No schema file is touched.
- **`client/src/vendor/ui/nav.ts` and `client/src/vendor/shared/`** are different things. `nav.ts` is app-specific nav data that must be edited (Part A). `vendor/shared/` is the Zod contract mirror that must be updated in lockstep with `server/src/vendor/shared/` (Parts B and C) but is otherwise protected from modification.
- **Both vendor/shared contract files must be updated together** — for Part B: both `observability.ts` files; for Part C: both `review-api.ts` files. Forgetting one causes a TS mismatch caught only at typecheck time.
- **`pr_title` must be `.nullish()` not `.nullable()`** — the `listMultiRuns` path and any future producer of `MultiRunRecord` might not include the join (forward compat). Follow the `pr_number` pattern exactly.
- **Mirror `replyToFinding` exactly** — same `AppError('github_unavailable', ...)` code, same `AppError('github_review_failed', ...)` code, same message patterns. Do not invent new error codes or wrapping styles.
- **Workspace scope guard is mandatory** — `findFindingsByIdsForPr` must scope to `workspaceId` + `prId`. An attacker submitting foreign `finding_ids` must receive a 404, not another workspace's finding content passed into a GitHub API call (SPEC-04 untrusted inputs; OWASP A01 denial-by-default).
- **`selectedIds` must re-initialize on drawer open** — `useEffect` that fires when `open` transitions to `true`, re-computes the initial set from `allFindings`. This ensures re-opening starts fresh (AC-14) and picks up any finding actions (accept/dismiss) that happened after the first open.
- **`ComposeReviewDrawer` must be keyboard-dismissible** — `useEffect` listening for `Escape` key on `keydown`, active only when `open === true`, cleaned up on `open → false` or unmount. Required by SPEC-04 non-functional accessibility note. Reference `client/src/vendor/ui/kit/Dropdown.tsx` for the pattern.
- **`AppShell` must wrap all render branches** — loading, error, and normal branches inside `MultiRunResultsView.tsx` and `ConfigureRunView.tsx` must all be wrapped in `<AppShell>`. Not just the normal branch. Confirm by checking how `repos/[repoId]/pulls/[number]/page.tsx` handles all three branches.
- **`ComposeReviewBody` uses `.enum(['APPROVE', 'COMMENT', 'REQUEST_CHANGES'])`** — the verdict values are already uppercase per SPEC-04 service contracts; they pass through directly to `GitHubReviewPayload.event`. No remapping needed in the service.
- **`omitted_count` in `ComposeReviewResponse` is `.optional()`** — the server omits it when no comments were omitted (value `undefined` = 0 omissions), computed by pre-filtering against `loadDiff()`'s hunks before calling `postReview` (see C3 step 6-8) — not by parsing a GitHub 422 response. The client renders `postedWithOmissions` only when `data.omitted_count > 0`.

---

## Definition of done

- [ ] `cd client && pnpm test` passes (all existing tests green).
- [ ] `cd server && pnpm test` passes.
- [ ] `cd client && pnpm typecheck` reports no errors.
- [ ] `cd server && pnpm typecheck` reports no errors.
- [ ] Navigating to `/multi-runs/configure` renders the left sidebar (AppShell present in all render branches).
- [ ] Navigating to `/multi-runs/[id]` renders the left sidebar (AppShell present in all render branches).
- [ ] Clicking "Multi-Agent Review" in the sidebar navigates to `/multi-runs/configure` and the sidebar item is highlighted on both `/multi-runs/configure` and `/multi-runs/[id]` pages.
- [ ] Multi-run results page renders PR title below the breadcrumb when `pr_title` is available.
- [ ] Aggregate cost/duration stats appear in a right-aligned block in the header, not as a single string below the breadcrumb.
- [ ] Score renders as a circular badge, not plain bold text.
- [ ] Each agent column has a distinct left-border accent color.
- [ ] **AC-1** (SPEC-04): "Compose review" button is visible in the PR detail header action area next to "Run Review ▾" when `prId` is resolved; absent when `prId` is null.
- [ ] **AC-2** (SPEC-04): Clicking "Compose review" opens a drawer with heading "Compose Review" and subheading "Post a GitHub review as yourself (PAT)."
- [ ] **AC-3** (SPEC-04): Drawer shows three verdict options with none pre-selected; "Post review to GitHub" button is disabled until a verdict is chosen.
- [ ] **AC-5** (SPEC-04): On open, findings with `accepted_at` set and `dismissed_at` null are pre-checked; all others are unchecked.
- [ ] **AC-7** (SPEC-04): Inline comments counter updates immediately on finding checkbox toggle.
- [ ] **AC-8** (SPEC-04): Post button label changes to "Posting…" and is disabled during the pending request.
- [ ] **AC-10** (SPEC-04): On success, "Review posted to GitHub · id {id}." is displayed and re-submission is prevented.
- [ ] **AC-12** (SPEC-04): `github_unavailable` surfaces a message directing the user to Settings → API Keys.
- [ ] **AC-13** (SPEC-04): `github_review_failed` re-enables the Post button and shows a user-facing error message.
- [ ] **AC-14** (SPEC-04): Cancel closes the drawer; re-opening starts with fresh state (no retained verdict/body/checkbox changes).
- [ ] **AC-15** (SPEC-04): Posting with `finding_ids: []` (empty array) succeeds without warning.
- [ ] Server rejects `finding_ids` that do not belong to the request's workspace and PR with a 404, not a data leak.
