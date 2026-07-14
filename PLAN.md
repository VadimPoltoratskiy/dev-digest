# Plan: Wire FindingCard Actions in TabsView + Correct Stale INSIGHTS Note

## Spec reference

SPEC-03 (Multi-Agent Review) governs this feature. The fix is planned directly from the pre-implementation audit described in the task; no new spec is produced. SPEC-03 defines the goals and acceptance criteria; this plan only describes HOW to fix the identified functional gap.

## Execution mode: single-agent

The change touches two component files (`TabsView.tsx`, `MultiRunResultsView.tsx`), one test file (`TabsView.test.tsx`), and one doc file (`server/insights/INSIGHTS.md`). All four changes are sequential with no meaningful independent work — single implementer, top to bottom.

## Goal

`FindingCard` components rendered inside `TabsView` currently receive no `onAction`, `onCreateEvalCase`, `pending`, `evalCasePending`, `repoFullName`, or `headSha` props, making Accept/Dismiss/Reply buttons non-functional and file:line GitHub links absent. Wire the missing props by calling `useFindingAction`, `useTurnFindingIntoEvalCase`, `useActiveRepo`, and `usePullDetail` directly inside `TabsView`, mirroring the self-contained `FindingsPanel` pattern. Also correct a stale INSIGHTS entry in `server/insights/INSIGHTS.md` that describes an obsolete time-window-join aggregation design.

## Modules affected

- `client/` — `TabsView.tsx` (add hooks + wire `FindingCard` props); `MultiRunResultsView.tsx` (pass two new required props to `TabsView`); `TabsView.test.tsx` (mock setup, render-helper update, two new test cases)
- `server/` — `server/insights/INSIGHTS.md` only (correct stale note; no code changes)

## Engineering Insights applied

- **client/INSIGHTS.md (2026-07-06):** "Repo-scoped pages/tabs that have no repoId of their own reuse `useActiveRepo()` from `lib/repo-context.tsx` instead of prop-drilling a repo selector." This directly supports calling `useActiveRepo()` inside `TabsView` rather than threading `repoFullName` down from `MultiRunResultsView`.
- **server/INSIGHTS.md (2026-06-26 entry):** The entry describing "no direct FK from multi_agent_runs to reviews — aggregate via ranAt time-window join" predates the shipped `agent_runs.multi_agent_run_id` FK and is now actively misleading. It must be corrected so future sessions don't derive a wrong join strategy.

## Recommendations

None. The approach in the task brief is correct and matches the codebase's established `FindingsPanel` pattern. No alternative yields a meaningfully different outcome.

## Architecture decisions

**Wire inside `TabsView`, not lifted into `MultiRunResultsView`.**

`TabsView` already owns the `FindingCard` loop and is the natural owner of the mutation wiring. The directly analogous component `FindingsPanel` is self-contained — it calls `useFindingAction` and `useTurnFindingIntoEvalCase` directly without threading from its parent. Lifting the hooks to `MultiRunResultsView` and threading them as props would:

1. Violate self-containment without a concrete benefit (`MultiRunResultsView` currently has no use for `headSha` or mutation states).
2. Inflate `MultiRunResultsView`'s concern (it orchestrates layout, streaming, and drawer state — not finding actions).
3. Contradict the INSIGHTS guidance about calling `useActiveRepo()` at the point of use.

`onViewTrace` IS threaded as a prop because it opens a **drawer whose state is managed by `MultiRunResultsView`** — a parent-owned side effect. Finding mutations are component-local side effects; they belong in `TabsView`.

**Two new required props on `TabsViewProps`: `prId: string` and `multiRunId: string`.**

- `prId` is passed to `action.mutate({ ..., prId })` so the shared hook's built-in `onSuccess` invalidates `["reviews", prId]`.
- `multiRunId` is used in the call-site `onSuccess` to additionally invalidate `["multi-run-findings", multiRunId]`.

Both are non-optional. `MultiRunResultsView` has both values in scope when the normal render path is reached (the loading/error guards return early before the `<TabsView />` render).

**Cache invalidation via `.mutate(vars, { onSuccess })`.**

The shared `useFindingAction` hook only knows about `["reviews", prId]` and `["pr-comments", prId]`. The `["multi-run-findings", multiRunId]` invalidation is wired as the second argument to `action.mutate(...)`:

```tsx
action.mutate(
  { findingId: f.id, action: act, reply, prId },
  {
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["multi-run-findings", multiRunId] }),
  },
)
```

TanStack Query fires both the hook-level and call-site `onSuccess` callbacks. The shared hook is NOT modified.

**Test mock strategy — `vi.mock` + `QueryClientProvider`.**

`TabsView` will call `useQueryClient()` directly (to obtain `qc` for the `onSuccess` callback). `QueryClientProvider` must therefore be present in the test render tree. Additionally, mock `useFindingAction`, `useTurnFindingIntoEvalCase`, `useActiveRepo`, and `usePullDetail` via `vi.mock` — identical to the strategy in `FindingsPanel.test.tsx`. Use `vi.hoisted` to create a stable `mockActionMutate` spy that can be inspected in assertions.

## Tasks

### 1. Update `TabsView.tsx` — add hooks and wire `FindingCard` props

File: `client/src/app/multi-runs/[multiRunId]/_components/TabsView/TabsView.tsx`

- Add `prId: string` and `multiRunId: string` to `TabsViewProps`.
- Add the following imports:
  - `useQueryClient` from `@tanstack/react-query`
  - `useFindingAction` from `@/lib/hooks/reviews`
  - `useTurnFindingIntoEvalCase` from `@/lib/hooks/agents-eval`
  - `useActiveRepo` from `@/lib/repo-context`
  - `usePullDetail` from `@/lib/hooks/core`
- Inside the component body, call all six hooks **unconditionally before the `if (agents.length === 0) return null` guard** (React rules of hooks require this):
  ```tsx
  const qc = useQueryClient();
  const action = useFindingAction();
  const createEvalCase = useTurnFindingIntoEvalCase();
  const { activeRepo } = useActiveRepo();
  const { data: pr } = usePullDetail(prId);
  ```
  The existing `React.useMemo` for `findingsForActive` and the guard itself remain in their current positions; only the new hook calls go above the guard.
- Replace the bare `FindingCard` render (current lines 126-128):
  ```tsx
  {findingsForActive.map((f) => (
    <FindingCard key={f.id} f={f} defaultExpanded={false} />
  ))}
  ```
  with the fully-wired version:
  ```tsx
  {findingsForActive.map((f) => (
    <FindingCard
      key={f.id}
      f={f}
      defaultExpanded={false}
      pending={action.isPending}
      evalCasePending={createEvalCase.isPending}
      repoFullName={activeRepo?.full_name}
      headSha={pr?.head_sha}
      onAction={(act, reply) =>
        action.mutate(
          { findingId: f.id, action: act, reply, prId },
          {
            onSuccess: () =>
              qc.invalidateQueries({ queryKey: ["multi-run-findings", multiRunId] }),
          },
        )
      }
      onCreateEvalCase={(kind, name) =>
        createEvalCase.mutate({ findingId: f.id, kind, name })
      }
    />
  ))}
  ```

### 2. Update `MultiRunResultsView.tsx` — pass the two new props to `TabsView`

File: `client/src/app/multi-runs/[multiRunId]/_components/MultiRunResultsView/MultiRunResultsView.tsx`

- In the `<TabsView ... />` JSX (currently around line 159), add `prId={multiRun.pr_id}` and `multiRunId={multiRunId}`. Both values are in scope and non-null at that point in the render path. `multiRunId` is the component's own prop; `multiRun.pr_id` is on the already-loaded `multiRun` record.

### 3. Update `TabsView.test.tsx` — mocks, render helper, and new test cases

File: `client/src/app/multi-runs/[multiRunId]/_components/TabsView/TabsView.test.tsx`

**Imports to add:**
```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
```

**Mock setup — add before the `TabsView` import** (Vitest hoists `vi.mock` calls automatically, but place them near the top as a convention). Use `vi.hoisted` to get a stable spy reference:

```tsx
const { mockActionMutate } = vi.hoisted(() => ({
  mockActionMutate: vi.fn(),
}));

vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: mockActionMutate, isPending: false }),
}));

vi.mock("@/lib/hooks/agents-eval", () => ({
  useTurnFindingIntoEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/test-repo" } }),
}));

vi.mock("@/lib/hooks/core", () => ({
  usePullDetail: () => ({ data: { head_sha: "sha-abc123" } }),
}));
```

**`afterEach` update:** call `mockActionMutate.mockClear()` alongside `cleanup`.

**`renderTabsView` helper update:**
- Add `prId?: string` and `multiRunId?: string` to the props type (defaults: `"pr-test"` and `"mr-test"`).
- Wrap the render with `<QueryClientProvider client={new QueryClient()}>` as the outermost wrapper (outside `NextIntlClientProvider`).
- Pass `prId` and `multiRunId` through to `<TabsView />`.

**New test cases (add inside the existing `describe("TabsView", ...)` block):**

```tsx
it("wires onAction: clicking Accept on an expanded card calls action.mutate with findingId, action, prId, and local onSuccess", () => {
  renderTabsView({});

  // Expand the first finding card
  fireEvent.click(screen.getByText("SQL injection in Alpha").closest("div")!);

  // Click Accept
  fireEvent.click(screen.getByText("Accept"));

  expect(mockActionMutate).toHaveBeenCalledWith(
    expect.objectContaining({
      findingId: "f-alpha",
      action: "accept",
      prId: "pr-test",
    }),
    expect.objectContaining({ onSuccess: expect.any(Function) }),
  );
});

it("FindingCard file:line renders as a link when repoFullName and headSha are available", () => {
  renderTabsView({});

  // useActiveRepo returns { full_name: "acme/test-repo" }
  // usePullDetail returns { head_sha: "sha-abc123" }
  // FindingCard builds a githubBlobUrl and MonoLink renders it as <a href=...>
  const links = screen.getAllByRole("link");
  expect(links.some((l) => l.getAttribute("href")?.includes("acme/test-repo"))).toBe(true);
});
```

### 4. Correct stale note in `server/insights/INSIGHTS.md`

File: `server/insights/INSIGHTS.md`

Replace the stale entry (currently at line 31 in the `## Codebase Patterns` section):

```
- `2026-06-26 · Context · reviews.runId links to agent_runs.id (individual per-agent runs), NOT to multi_agent_runs.id. There is no direct FK from multi_agent_runs to reviews. To aggregate findings across a multi-agent batch, collect all agent_runs.id where ranAt is within the batch window, then join reviews on runId. Evidence: server/src/db/schema/reviews.ts, server/src/db/schema/runs.ts.`
```

With the corrected entry:

```
- `2026-07-14 · Context · agent_runs has a direct FK multi_agent_run_id → multi_agent_runs.id (null for single-agent runs; set null on multi-run delete). To aggregate findings for a multi-run, join reviews on agent_runs.id WHERE agent_runs.multi_agent_run_id = $multiRunId — no time-window join needed. Evidence: server/src/db/schema/runs.ts:40-49.`
```

## Gotchas

- **Hooks before early return:** React's rules of hooks require all hook calls to be unconditional. The current `if (agents.length === 0) return null` guard is on line 26. Move the five new hook calls and `useQueryClient()` above that guard; the guard and `useMemo` remain in place below.
- **Do not modify `useFindingAction` or `useTurnFindingIntoEvalCase`** — they are shared hooks used by the single-agent PR page. All multi-run-specific cache invalidation goes in the call-site `onSuccess` option, not in the hook itself.
- **Do not modify `client/src/vendor/`** — vendored UI primitives; untouched by this plan.
- **No DB schema changes, no Zod contract changes** — the fix is entirely in the client render layer.
- **No migration steps** — this plan does not touch the server schema.

## Definition of done

- [ ] `cd client && pnpm tsc --noEmit` reports no errors
- [ ] `cd client && pnpm test` passes — all existing `TabsView` tests still pass, plus the two new test cases are green
- [ ] Clicking Accept or Dismiss on a `FindingCard` in `TabsView` (tabs mode) calls `action.mutate` with the correct `findingId`, `action`, and `prId`, and includes an `onSuccess` option that invalidates `["multi-run-findings", multiRunId]`
- [ ] `FindingCard` in `TabsView` receives non-null `repoFullName` and `headSha` (sourced from `useActiveRepo` and `usePullDetail`), enabling the file:line GitHub link
- [ ] `FindingCard` in `TabsView` receives `pending` and `evalCasePending` so buttons disable during in-flight mutations
- [ ] Stale note in `server/insights/INSIGHTS.md` is replaced with the corrected FK-based description
