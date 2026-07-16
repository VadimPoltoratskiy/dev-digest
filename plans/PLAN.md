# Plan: Review Feedback Fixes — Batch (SPEC-06)

## Spec reference
`specs/SPEC-06-review-feedback-fixes.md`

## Execution mode: single-agent, sequential
One implementer executes all three concerns top-to-bottom. Concerns 2 and 1 are trivial
config/doc edits with no code dependencies. Concern 3 is the real work and has internal
ordering dependencies (move files before updating importers). No parallel phasing is
warranted for this scope.

## Goal
Fix three independent gaps: add a `workflow-retro` skill (Workflow catalog scope) so the
retro ledger process is reproducible and consistent; upgrade the spec-creator agent model
from `claude-sonnet-4-6` to `claude-opus-4-8` to match the quality gate already used by
the architecture-reviewer; and move `review_focus` out of the brief card into a standalone
"Read This First" block on the Overview tab so reviewers see the prioritized reading list
immediately after the brief, not buried inside it.

## Modules affected
- `.claude/` — skill catalog and agent definition files (Concerns 1 and 2; no package build, no tests)
- `client/` — `OverviewTab` component tree, `PrBriefCard` component, i18n messages, and tests (Concern 3 only)

## Engineering Insights applied
- **TanStack Query cache deduplication** (`client/insights/INSIGHTS.md`, 2026-06-23 Tool Note):
  `usePrBrief(prId)` called inside `ReadThisFirstCard` shares the same query key as the
  identical call already in `PrBriefCard` — one `QueryClientProvider` in `app/layout.tsx`
  means zero additional network requests. Calling the hook twice in the same render tree
  is the correct pattern; do not prop-drill `data` through `OverviewTab`.
- **Mock nested-component hooks at the test file boundary** (`client/insights/INSIGHTS.md`,
  2026-07-15 Recurring Error): `ReadThisFirstCard.test.tsx` must `vi.mock` both
  `@/lib/hooks/pr-files` (for `usePriorPrs`) and `next/navigation` (for `useParams`)
  even though those hooks live inside the child `ReviewFocusItem` — jsdom renders the
  full subtree and both hooks fire.
- **Brief fixture completeness** (`client/insights/INSIGHTS.md`, 2026-06-25 and 2026-07-06
  Recurring Errors): the `Brief` Zod type requires all five fields (`what`, `why`,
  `risk_level`, `risks`, `review_focus`); every test fixture typed as `Brief` must
  include all five to avoid `TS2741`. The `BRIEF_FIXTURE` in `PrBriefCard.test.tsx` keeps
  `review_focus: [...]` even after the assertion is removed.
- **Colocation nesting limit** (`ui-architecture` SKILL.md): sub-components nest inside
  `_components/<Parent>/_components/<SubName>/`, maximum two levels deep. `ReadThisFirstCard`
  is level 1 under `OverviewTab`; the moved `ReviewFocusItem` is level 2 under
  `ReadThisFirstCard`. This is the permitted maximum — do not add a third level.

## Recommendations
None — the spec is precise and complete; no architectural alternative improves on it.

## Architecture decisions
- **`ReadThisFirstCard` as a sub-component of `OverviewTab`** (`ui-architecture` SKILL.md):
  the component is used exclusively by `OverviewTab`, so it belongs at
  `OverviewTab/_components/ReadThisFirstCard/` (sub-component rule), not as a sibling of
  `OverviewTab` in the route's top-level `_components/`.
- **`ReviewFocusItem` follows its consumer** into `ReadThisFirstCard/_components/ReviewFocusItem/`.
  A cross-sibling import from `PrBriefCard/_components/` to `OverviewTab/_components/`
  would violate the colocation boundary and contradict AC-9 (brief card must have no
  reference to `review_focus` at all).
- **Duplicate `usePrBrief(prId)` call is intentional**: introducing a shared prop would
  thread data through `OverviewTab` just to avoid a hook call that costs nothing (cache
  hit). TanStack Query's deduplication makes this the idiomatic pattern in this codebase
  (confirmed by the INSIGHTS.md note above).

---

## Tasks

### Step A — Concern 2: spec-creator model upgrade (2 line edits, ~2 minutes)

These are the simplest changes; do them first to confirm the change and move on.

- [ ] **`.claude/agents/spec-creator.md`, line 20** — change `model: claude-sonnet-4-6`
  to `model: claude-opus-4-8`. No other line in this file changes.

- [ ] **`.claude/agents/README.md`, line 74** — change `**Model:** claude-sonnet-4-6`
  to `**Model:** claude-opus-4-8`. No other line in this file changes.

Spot-check: `grep -rn "claude-sonnet-4-6" .claude/agents/` must return zero matches.

---

### Step B — Concern 1: workflow-retro skill (2 files)

**B-1. Create the skill file**

- [ ] **Create `.claude/skills/workflow-retro/SKILL.md`** — new file. Pattern: the existing
  `.claude/skills/engineering-insights/SKILL.md` frontmatter block plus a numbered
  workflow checklist body.

  Required frontmatter (YAML block):
  ```yaml
  ---
  name: workflow-retro
  description: >
    Guides the developer through the per-branch retro process at merge or feature
    completion: collect git-diff statistics, run tests only for touched packages
    (record "—" for untouched ones), and append one ledger table row plus one prose
    section to docs/retros/ledger.md.
  allowed-tools: Read, Write, Edit, Bash
  ---
  ```

  Required body — a numbered checklist that covers all four steps from AC-2, shaped
  around the flowchart in the spec's Architecture section:

  1. **Collect branch diff statistics.** Run `git diff --stat main..<branch>` (substitute
     the actual branch name). Record: total files changed, total lines inserted, total
     lines deleted. These fill the `Files changed` and `+/- lines` columns.

  2. **Identify touched packages and run their tests.** Inspect the diff output for file
     paths that belong to `server/`, `client/`, `reviewer-core/`, or `e2e/`. For each
     **touched** package, run `pnpm test` inside that package directory and record the
     pass count and file count (e.g., "295 passed (33 files)"). For each **untouched**
     package, write `—` in its test column — do not run its tests. The row may be
     written once at least one package's test results are recorded.

  3. **Append one new row to the ledger table** in `docs/retros/ledger.md`. Columns in
     order: `Branch`, `Files changed`, `+/- lines`, `Server tests`, `Client tests`,
     `Key mechanism` (one-line summary of the core mechanism), `Notes`. Never overwrite
     or reformat existing rows.

  4. **Append one prose section below the table** (immediately after the last existing
     prose section). The section follows the structure of the existing
     `emdash/multi-agent-review-mbw10` entry in `docs/retros/ledger.md`:
     - An H2 heading with the branch name.
     - A feature-summary paragraph (what was added and what it enables).
     - A bold `**Key mechanism**` sub-section with file names and function names for the
       core technical approach.
     - A bold `**Gaps / follow-ups**` sub-section listing any known gaps or next steps,
       or "none blocking at time of writing" if there are none.
     Never overwrite or reformat existing prose sections.

**B-2. Add catalog row**

- [ ] **`.claude/skills/README.md`** — insert a new row in the catalog table under the
  Workflow scope (after the existing `dependency-checker` row). Exact format to match
  the adjacent rows:

  ```markdown
  | [workflow-retro](workflow-retro/SKILL.md) | Workflow | Per-branch retro: collect git-diff stats, run touched-package tests, append one ledger table row and one prose section to `docs/retros/ledger.md` |
  ```

---

### Step C — Concern 3: "Read This First" block (all sub-steps in order)

> Prerequisite: complete Steps A and B first (they touch different files; no technical
> dependency, but sequencing keeps the diff reviewable). Within Step C, the sub-steps
> below have ordering dependencies as marked.

**C-1. Add the i18n key** (no dependencies; do first inside C)

- [ ] **`client/messages/en/brief.json`** — add `"readThisFirst": "Read This First"` as a
  direct child of the `"block"` object (alongside `"intent"`, `"blast"`, `"risks"`,
  `"history"`, `"brief"`). This is an additive change; all existing keys remain. Result
  in context:
  ```json
  "block": {
    "intent": "Intent",
    "blast": "Blast radius",
    "risks": "Risks",
    "history": "PR history",
    "readThisFirst": "Read This First",
    "brief": { ... }
  }
  ```

**C-2. Move ReviewFocusItem to its new location** (do before C-3, C-4, C-5)

The component moves from:
```
client/src/app/repos/[repoId]/pulls/[number]/_components/
  PrBriefCard/_components/ReviewFocusItem/
```
to:
```
client/src/app/repos/[repoId]/pulls/[number]/_components/
  OverviewTab/_components/ReadThisFirstCard/_components/ReviewFocusItem/
```

Below, `OLD_BASE` = `..._components/PrBriefCard/_components/ReviewFocusItem/` and
`NEW_BASE` = `..._components/OverviewTab/_components/ReadThisFirstCard/_components/ReviewFocusItem/`.

- [ ] **Create `NEW_BASE/ReviewFocusItem.tsx`** — copy from `OLD_BASE`. File contents are
  unchanged; no import inside it references its own folder path.

- [ ] **Create `NEW_BASE/styles.ts`** — copy from `OLD_BASE`. Contents unchanged.

- [ ] **Create `NEW_BASE/index.ts`** — copy from `OLD_BASE`. Contents unchanged
  (`export { ReviewFocusItem } from "./ReviewFocusItem";`).

- [ ] **Create `NEW_BASE/ReviewFocusItem.test.tsx`** — copy from `OLD_BASE`, then update
  the `briefMessages` relative import. The depth increases from 10 `../` to 12 `../`:
  - **Remove:** `../../../../../../../../../../messages/en/brief.json`
  - **Replace with:** `../../../../../../../../../../../../messages/en/brief.json`

  Path derivation (new location → `client/` in 12 steps):
  `ReviewFocusItem/` → `_components/` (RTF's _components) → `ReadThisFirstCard/` →
  `_components/` (OT's _components) → `OverviewTab/` → `_components/` (route _components) →
  `[number]/` → `pulls/` → `[repoId]/` → `repos/` → `app/` → `src/` → `client/`
  All other imports (`@/lib/hooks/pr-files`, `next/navigation`, `./ReviewFocusItem`, etc.)
  are unchanged — they use absolute `@/` aliases or relative `./` imports that still resolve.

- [ ] **Delete the old location.** Remove all four files from `OLD_BASE`:
  `ReviewFocusItem.tsx`, `styles.ts`, `index.ts`, `ReviewFocusItem.test.tsx`.

- [ ] **Delete the now-empty folder** `PrBriefCard/_components/` (was only containing
  `ReviewFocusItem/`; no other sub-components remain per `ls` output).

**C-3. Create ReadThisFirstCard** (depends on C-2 for the ReviewFocusItem import)

- [ ] **Create `OverviewTab/_components/ReadThisFirstCard/ReadThisFirstCard.tsx`** — new
  component. Requirements:
  - `"use client"` directive at top.
  - Props: `{ prId: string }`.
  - Imports: `useTranslations` from `next-intl`; `SectionLabel` from `@devdigest/ui`;
    `usePrBrief` from `@/lib/hooks/brief`; `ReviewFocusItem` from
    `./_components/ReviewFocusItem`.
  - Logic: call `usePrBrief(prId)`. Guard: if `isLoading`, or `!data`, or
    `data.review_focus.length === 0` — return `null`. No fallback UI, no placeholder.
  - Rendered JSX: a `<section>` containing `<SectionLabel icon="BookOpen">` (or any
    relevant icon from `@devdigest/ui`) whose text is `t("block.readThisFirst")`, followed
    by a `<ul>` with `{data.review_focus.map((item, i) => (<ReviewFocusItem key={i} prId={prId} path={item} />))}`.
  - Inline style for the `<ul>` may reuse the same list style pattern as
    `PrBriefCard.tsx` line 84 (`style={s.list}`) — define a local `styles.ts` if needed,
    or use an inline style object directly.

- [ ] **Create `OverviewTab/_components/ReadThisFirstCard/index.ts`** — barrel:
  ```typescript
  export { ReadThisFirstCard } from "./ReadThisFirstCard";
  ```

- [ ] **Create `OverviewTab/_components/ReadThisFirstCard/styles.ts`** — only if the
  component needs any inline style constants for the wrapper or list. May be a minimal
  file with one `s.list` object, or omitted if no wrapper styles are needed.

**C-4. Wire ReadThisFirstCard into OverviewTab** (depends on C-3)

- [ ] **`OverviewTab/OverviewTab.tsx`**:
  - Add import: `import { ReadThisFirstCard } from "./_components/ReadThisFirstCard";`
  - After the `{prId && <PrBriefCard prId={prId} repoFullName={repoFullName} headSha={headSha} />}` line and **before** the `{prBody && <section>…</section>}` block, add:
    ```tsx
    {prId && <ReadThisFirstCard prId={prId} />}
    ```
  - The `prId &&` guard matches the same conditional pattern used for `IntentCard` and
    `PrBriefCard`; `ReadThisFirstCard` itself also guards on absent/loading brief data
    internally (AC-8), so this outer guard only handles the case where `prId` itself is
    absent. Both guards are required.

**C-5. Remove review_focus from PrBriefCard** (depends on C-2 to avoid a broken import)

- [ ] **`PrBriefCard/PrBriefCard.tsx`**:
  - Remove line 9: `import { ReviewFocusItem } from "./_components/ReviewFocusItem";`
  - Remove the entire review-focus block (currently lines 80–90):
    ```tsx
    {/* Review focus */}
    {data.review_focus.length > 0 && (
      <>
        <div style={s.sectionLabel}>{t("block.brief.reviewFocus.label")}</div>
        <ul style={s.list}>
          {data.review_focus.map((item, i) => (
            <ReviewFocusItem key={i} prId={prId} path={item} />
          ))}
        </ul>
      </>
    )}
    ```
  - No other changes. The `s.list` style constant in `PrBriefCard/styles.ts` will become
    unused; leave it as-is (removing it is low-risk but unnecessary and risks merge noise).

**C-6. Update PrBriefCard tests** (depends on C-5 — after removal the mocks become dead)

- [ ] **`PrBriefCard/PrBriefCard.test.tsx`**:
  - **Remove** the `vi.mock("next/navigation", ...)` block (currently lines 32–33).
    It was only needed because `ReviewFocusItem` calls `useParams`; `PrBriefCard` itself
    does not.
  - **Remove** the `vi.mock("@/lib/hooks/pr-files", ...)` block (currently lines 34–37).
    It was only needed because `ReviewFocusItem` calls `usePriorPrs`.
  - In the `"PrBriefCard — brief is loaded"` describe block, **remove** the two
    review_focus rendering assertions (currently lines 147–151 and 155–157):
    ```typescript
    // REMOVE:
    // review_focus items — the second one is unique, so getByText is safe.
    // The first ("src/middleware/rate.ts") also appears in file_refs, so use getAllByText.
    expect(screen.getAllByText("src/middleware/rate.ts").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("src/api/public/index.ts")).toBeInTheDocument();

    // REMOVE (the comment about "same text as review_focus item"):
    // The risk's file_ref must appear (same text as review_focus item — at least one).
    expect(screen.getAllByText("src/middleware/rate.ts").length).toBeGreaterThanOrEqual(2);
    ```
    **Replace** that last assertion with a simpler one that only checks the file_ref as
    rendered inside the risk card (one occurrence, not two):
    ```typescript
    // The risk's file_ref must still appear in the risk card.
    expect(screen.getByText("src/middleware/rate.ts")).toBeInTheDocument();
    ```
  - Keep the `BRIEF_FIXTURE` as-is with `review_focus: ["src/middleware/rate.ts", "src/api/public/index.ts"]` — the `Brief` type requires the field. The test simply no longer asserts its rendered output.
  - Keep all other tests (generate, regenerate, degraded banner, history toggle,
    backward-compat schema test) entirely unchanged.

**C-7. Add ReadThisFirstCard tests** (depends on C-3)

- [ ] **Create `OverviewTab/_components/ReadThisFirstCard/ReadThisFirstCard.test.tsx`** —
  new colocated test file.

  Mock setup (vi.mock calls are hoisted by Vitest, declare at top before component import):
  ```typescript
  vi.mock("@/lib/hooks/brief", () => ({
    usePrBrief: vi.fn(),
  }));
  vi.mock("@/lib/hooks/pr-files", () => ({
    usePriorPrs: vi.fn(() => ({ data: undefined, isLoading: false })),
  }));
  vi.mock("next/navigation", () => ({
    useParams: () => ({ repoId: "test-repo-id" }),
  }));
  ```

  Import `briefMessages` using the path relative to this file's directory (10 `../` to
  reach `client/`):
  ```typescript
  import briefMessages from "../../../../../../../../../../messages/en/brief.json";
  ```
  Path derivation: `ReadThisFirstCard/` → `_components/` (OT) → `OverviewTab/` →
  `_components/` (route) → `[number]/` → `pulls/` → `[repoId]/` → `repos/` → `app/` →
  `src/` → `client/` (10 steps).

  Wrap all renders in:
  ```tsx
  <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
    <ReadThisFirstCard prId="pr-1" />
  </NextIntlClientProvider>
  ```

  Minimal `Brief` fixture for the non-empty test (all 5 required fields):
  ```typescript
  const BRIEF_FIXTURE: Brief = {
    what: "Adds rate limiting.",
    why: "Prevents DoS.",
    risk_level: "low",
    risks: [],
    review_focus: ["src/a.ts", "src/b.ts"],
  };
  ```

  **Test case (a) — AC-12(a):** when `usePrBrief` returns `{ data: null, isLoading: false }`:
  - Assert the component renders nothing: `expect(document.body.textContent).toBe("")`
    or `expect(container.firstChild).toBeNull()`.
  - Cover `data: undefined` in the same test or a second it-block (same code path).

  **Test case (b) — AC-12(b):** when `usePrBrief` returns
  `{ data: { ...BRIEF_FIXTURE, review_focus: [] }, isLoading: false }`:
  - Assert no "Read This First" heading renders.
  - `expect(screen.queryByText("Read This First")).not.toBeInTheDocument()`

  **Test case (c) — AC-12(c):** when `usePrBrief` returns
  `{ data: BRIEF_FIXTURE, isLoading: false }` (two items in `review_focus`):
  - Assert the "Read This First" heading renders:
    `expect(screen.getByText("Read This First")).toBeInTheDocument()`
  - Assert exactly 2 toggle buttons (one per `ReviewFocusItem`):
    `expect(screen.getAllByRole("button")).toHaveLength(2)`

  **Optional test case (d) — AC-8 loading path:**
  when `usePrBrief` returns `{ data: undefined, isLoading: true }`:
  - Assert renders nothing (same code path as absent data).

---

## Gotchas

- **No server or Zod contract changes.** `review_focus` remains in `Brief` at
  `server/src/vendor/shared/contracts/brief.ts` and its client mirror. Do not touch
  either vendor file.
- **briefMessages relative import depth changes on move.** `ReviewFocusItem.test.tsx`
  increases from 10 `../` (old location) to 12 `../` (new location). Getting this wrong
  produces `ERR_MODULE_NOT_FOUND` at test runtime, not a TypeScript error — it will look
  like a Vitest resolution failure, not a type error.
- **Empty `_components/` folder.** After the move, `PrBriefCard/_components/` will be
  empty. Delete it; an empty `_components/` folder is misleading and may confuse future
  contributors into thinking there are sub-components hiding there.
- **Do not remove `s.list` from `PrBriefCard/styles.ts`.** The style becomes unused after
  the JSX block is removed. Leave it — TypeScript does not error on unused style objects,
  removing it risks spurious merge conflicts, and it does no harm.
- **`client/src/vendor/` is do-not-touch.** No changes needed or permitted there.
- **`block.brief.reviewFocus.*` sub-keys must remain.** They are consumed by `ReviewFocusItem`
  in its new location. Only `block.readThisFirst` is added; nothing is removed from
  `brief.json`.
- **The `prId` prop guard in `OverviewTab.tsx` is not sufficient on its own.** `prId`
  can be defined while `review_focus` is empty or the brief is loading. `ReadThisFirstCard`
  must perform its own internal guard (returns null when loading/absent/empty) to satisfy
  AC-8. Both guards are required.

---

## Definition of done

### Concern 2 — AC-4, AC-5
- [ ] `grep -n "claude-sonnet-4-6" .claude/agents/spec-creator.md` — zero matches.
- [ ] `grep -n "claude-sonnet-4-6" .claude/agents/README.md` — zero matches.
- [ ] Both files contain `claude-opus-4-8` in the model position.

### Concern 1 — AC-1, AC-2, AC-3
- [ ] `.claude/skills/workflow-retro/SKILL.md` exists with YAML frontmatter containing
  `name`, `description`, and `allowed-tools` fields (AC-1).
- [ ] Skill body contains a checklist directing: (a) git-diff statistics collection,
  (b) per-touched-package test runs with `—` for untouched packages, (c) one ledger
  table row appended, (d) one prose section appended (summary + mechanism + Gaps/follow-ups)
  — with an explicit "never overwrite existing rows" instruction (AC-2).
- [ ] `.claude/skills/README.md` has a new `workflow-retro` row under the Workflow scope
  with a linked name and a one-line description (AC-3).

### Concern 3 — AC-6 through AC-12
- [ ] `cd client && pnpm test` passes with zero failures (all existing and new tests green) (AC-12).
- [ ] `cd client && pnpm typecheck` (or `pnpm tsc --noEmit`) reports zero errors.
- [ ] `ReadThisFirstCard.tsx` exists at `OverviewTab/_components/ReadThisFirstCard/ReadThisFirstCard.tsx` (AC-6, AC-7).
- [ ] `ReviewFocusItem.tsx` no longer exists at `PrBriefCard/_components/ReviewFocusItem/ReviewFocusItem.tsx`; it exists at `OverviewTab/_components/ReadThisFirstCard/_components/ReviewFocusItem/ReviewFocusItem.tsx` (AC-9, AC-12).
- [ ] `PrBriefCard.tsx` contains no import of `ReviewFocusItem` and no reference to `data.review_focus` in its JSX (AC-9).
- [ ] `OverviewTab.tsx` renders `<ReadThisFirstCard prId={prId} />` between `<PrBriefCard .../>` and the description `<section>` (AC-6).
- [ ] `client/messages/en/brief.json` contains `"readThisFirst": "Read This First"` under `block` and all `block.brief.reviewFocus.*` keys remain unchanged (AC-11).
- [ ] `PrBriefCard.test.tsx` contains no assertions on `review_focus` item paths (`src/api/public/index.ts` is no longer asserted; `src/middleware/rate.ts` appears at most once as a risk file_ref assertion) (AC-12).
- [ ] `ReadThisFirstCard.test.tsx` exists colocated at `OverviewTab/_components/ReadThisFirstCard/` and passes tests for: no-render when brief null, no-render when `review_focus` empty, correct item count when `review_focus` non-empty (AC-12).
- [ ] `ReviewFocusItem.test.tsx` passes in its new location with the updated 12-`../` `briefMessages` import (AC-12, AC-10).
