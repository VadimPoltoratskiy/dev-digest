# Verification Report: Eval Commands Documentation + Named CI Tier Split

**Verified:** 2026-07-16
**Plan:** `PLAN-SPEC-07.md`
**Spec:** `specs/SPEC-07-eval-docs-and-ci-split.md`

## Summary

| Status | Count |
|--------|-------|
| ✓ Implemented | 7 |
| ✗ Missing | 1 |
| ~ Partial | 3 |
| No test found | N/A (CI config changes, no unit tests expected) |
| ? Not checkable | 1 |

## Per-Task Status

---

### AC-1: Four eval commands in AGENTS.md ## Commands block

- **Status:** ✓ Implemented
- **File:** `AGENTS.md` lines 29–32 — exists
- **Acceptance criteria:**
  - `cd evals && pnpm eval:quality` line present → PASS
    - Evidence: `29:cd evals && pnpm eval:quality  # static SKILL.md gate (no model)`
  - `cd evals && pnpm eval:skills` line present → PASS
    - Evidence: `30:cd evals && pnpm eval:skills   # skill content-tier evals`
  - `cd evals && pnpm eval:agents` line present → PASS
    - Evidence: `31:cd evals && pnpm eval:agents   # subagent tool-tier evals`
  - `cd evals && pnpm eval:workflow` line present → PASS
    - Evidence: `32:cd evals && pnpm eval:workflow # live-harness workflow-tier evals`
- **Minor deviation from plan:** Comment text differs slightly (e.g., "static SKILL.md gate (no model)" vs plan's "static SKILL.md gate, no model"; "skill content-tier evals" vs "skill content-tier"). Not a criterion failure — the commands are correct.

---

### AC-2: Trigger-to-tier table in AGENTS.md ## Read when

- **Status:** ~ Partial
- **File:** `AGENTS.md` lines 55–64 — exists
- **Acceptance criteria:**
  - Table present mapping change categories to eval tiers → PASS
    - Evidence: 4-row table at lines 57–62
  - Skill change → `eval:skills` → PASS
  - Agent change → `eval:agents` → PASS
  - CLAUDE.md / agent .md / `evals/workflow/**` / `evals/src/**` → `eval:workflow` → PASS (row 3 present)
  - No-written-evals → visible SKIP, not failure → PASS
    - Evidence: line 64 "A changed artifact with no written evals is a visible SKIP, not a failure."
- **Deviations from plan:**
  1. Table has 2 columns (Changed file, Run) instead of 3 (the plan specified a "Notes" column with per-row skip notes). The skip note is present but as a sentence after the table, not in a Notes column.
  2. Run column shows `pnpm eval:skills` / `pnpm eval:agents` etc. without the `cd evals &&` prefix that the plan specified and the Commands block above uses.
  3. Row 3 writes "any agent" instead of "any `.claude/agents/*.md`" — see AC-3.

---

### AC-3: Table rows match ci-detect.mjs exactly

- **Status:** ~ Partial (drift on row 3)
- **File:** `AGENTS.md` lines 59–62 vs `evals/scripts/ci-detect.mjs`
- **Acceptance criteria:**
  - Row 1 matches `.claude/skills/<name>/**` and `evals/skills/<name>/**` → PASS
    - Evidence: ci-detect.mjs lines 86–88: `/^\.claude\/skills\/([^/]+)\//` and `/^evals\/skills\/([^/]+)\//`; AGENTS.md row 1 matches exactly.
  - Row 2 matches `.claude/agents/<name>.md` and `evals/agents/<name>/**` → PASS
    - Evidence: ci-detect.mjs lines 90–92: `/^\.claude\/agents\/([^/]+)\.md$/` and `/^evals\/agents\/([^/]+)\//`; AGENTS.md row 2 matches exactly.
  - Row 3 matches ci-detect.mjs lines 103–109 → PARTIAL/DRIFT
    - ci-detect.mjs line 107 fires on `/^\.claude\/agents\/.+\.md$/` (only `.claude/agents/*.md` files, NOT `evals/agents/**`)
    - AGENTS.md row 3 says "any agent" — this is ambiguous and could be interpreted as including `evals/agents/**` files, which would be incorrect. The plan required "any `.claude/agents/*.md`" (explicit path pattern).
    - **This is a documentation drift risk**: a contributor reading "any agent" may incorrectly run `pnpm eval:workflow` after editing `evals/agents/**` files, when in fact the detector only triggers the workflow tier for `.claude/agents/*.md` changes.
  - Row 4 (quality static gate) → PASS
- **Evidence (drift):**
  - Plan Step 2 cross-check required: "Row 3 patterns mirror lines 103–109 (`f === "CLAUDE.md"`, `f === ".claude/CLAUDE.md"`, `/^\.claude\/agents\/.+\.md$/`, `/^evals\/workflow\//`, `/^evals\/src\//`)"
  - Actual AGENTS.md row 3: `` `CLAUDE.md`, `.claude/CLAUDE.md`, any agent, `evals/workflow/**`, `evals/src/**` ``
  - "any agent" does not precisely encode `/^\.claude\/agents\/.+\.md$/`

---

### AC-4: evals/README.md pointer retained in AGENTS.md

- **Status:** ✓ Implemented
- **File:** `AGENTS.md` line 64 — exists
- **Acceptance criteria:**
  - Pointer to `evals/README.md` present → PASS
    - Evidence: "Deep dive: read `evals/README.md`."
- **Minor deviation:** Phrasing differs ("Deep dive: read `evals/README.md`" vs plan's "→ Full CI and tier reference: `evals/README.md`"). Semantic requirement met.

---

### AC-5: Three named tier workflow files exist

- **Status:** ✓ Implemented
- **Files:**
  - `.github/workflows/eval-skills.yml` — EXISTS (untracked in git; working-tree new file)
  - `.github/workflows/eval-agents.yml` — EXISTS (untracked in git; working-tree new file)
  - `.github/workflows/eval-workflow.yml` — EXISTS (untracked in git; working-tree new file)
- **Acceptance criteria:**
  - Each file has `on: workflow_call:` → PASS
    - Evidence: all three files confirmed to have `workflow_call` trigger
  - Each file is a reusable workflow recognizable by name → PASS

---

### AC-6: Orchestrator evals.yml retains detect job and calls three tier files as reusable workflows

- **Status:** ✓ Implemented
- **File:** `.github/workflows/evals.yml` — exists
- **Acceptance criteria:**
  - `detect` job present with `outputs: skills / agents / run_workflow` → PASS
    - Evidence: evals.yml lines 53–79
  - Three caller jobs use `uses: ./.github/workflows/eval-*.yml` → PASS
    - Evidence: lines 111, 120, 129
  - Each caller passes detection output via `with:` → PASS
    - Evidence: lines 112–113, 121–122, 130–131
  - Each caller uses `secrets: inherit` → PASS
    - Evidence: lines 114, 123, 132

---

### AC-7: Same on.pull_request.paths trigger set as before

- **Status:** ✓ PASS (per amended spec — see note below)
- **File:** `.github/workflows/evals.yml` lines 35–46
- **Acceptance criteria:**
  - Source coverage preserved (`evals/**`, `.claude/**`, `CLAUDE.md`), same tiers dispatched as before the split → PASS
- **Amendment (2026-07-16, decided with the user):** the original non-goal "no change to CI trigger paths" was re-scoped. The three tier files ARE now added to `on.pull_request.paths`, **additively**:
    ```yaml
    paths:
      - 'evals/**'
      - '.claude/**'
      - 'CLAUDE.md'
      - '.github/workflows/evals.yml'
      - '.github/workflows/eval-skills.yml'   # self-reference (intended)
      - '.github/workflows/eval-agents.yml'   # self-reference (intended)
      - '.github/workflows/eval-workflow.yml' # self-reference (intended)
    ```
  - Rationale: these are *self-references* to the newly-split CI files, mirroring the pre-existing self-reference to `evals.yml`. The non-goal's real intent was to avoid *narrowing* source coverage; adding self-references is additive and does not narrow anything. Reusable workflows (`on: workflow_call`) never self-trigger — without these paths, a PR editing only a tier file would escape eval CI entirely and a broken tier file could merge unnoticed.
  - The set of eval *tiers* dispatched for any given source change is unchanged (detection logic in `ci-detect.mjs` is untouched), so AC-7's core guarantee holds. The spec's Non-goals section was amended to record this (`specs/SPEC-07-eval-docs-and-ci-split.md`).

---

### AC-8: Serialized needs chain preserved

- **Status:** ✓ Implemented
- **File:** `.github/workflows/evals.yml`
- **Acceptance criteria:**
  - `skills` needs `detect` → PASS (line 109)
  - `agents` needs `[detect, skills]` → PASS (line 118)
  - `workflow` needs `[detect, agents]` → PASS (line 127)
  - `if: always() &&` guards on agents and workflow → PASS (lines 119, 128)

---

### AC-9: continue-on-error lives inside tier files, NOT on caller jobs

- **Status:** ✓ Implemented
- **Acceptance criteria:**
  - `eval-agents.yml` `agents` job has `continue-on-error: true` → PASS
    - Evidence: eval-agents.yml line 30
  - `eval-workflow.yml` `workflow` job has `continue-on-error: true` → PASS
    - Evidence: eval-workflow.yml line 29
  - `eval-skills.yml` has NO `continue-on-error` → PASS
    - Evidence: grep returned NOT FOUND
  - `evals.yml` caller jobs `agents` and `workflow` have NO `continue-on-error` → PASS
    - Evidence: grep found only comment-line references, no actual flag on caller jobs

---

### AC-10: strategy.fail-fast: false in eval-skills.yml skills job

- **Status:** ✓ Implemented
- **File:** `.github/workflows/eval-skills.yml` line 33
- **Acceptance criteria:**
  - `strategy.fail-fast: false` present → PASS
    - Evidence: `33:      fail-fast: false`

---

### AC-11: quality job in evals.yml unchanged (no continue-on-error; runs typecheck + eval:quality)

- **Status:** ✓ Implemented
- **File:** `.github/workflows/evals.yml` lines 81–105
- **Acceptance criteria:**
  - `pnpm typecheck` step present → PASS (line 103)
  - `pnpm eval:quality` step present → PASS (line 105)
  - No `continue-on-error` on quality job → PASS

---

### AC-12: Same models, env vars, and behavior as before the split

- **Status:** ~ Partial
- **Acceptance criteria:**
  - `EVAL_MODEL: google/gemini-2.5-flash` in each tier file env → PASS
    - Evidence: confirmed in eval-skills.yml line 21, eval-agents.yml line 22, eval-workflow.yml line 21
  - `EVAL_JUDGE_MODEL: google/gemini-2.5-flash` in each tier file env → PASS
  - `EVAL_BACKEND: openrouter` in each tier file env → PASS
  - `EVAL_MODEL: google/gemini-2.5-flash` in orchestrator top-level env → FAIL
    - Evidence: `git diff HEAD .github/workflows/evals.yml` shows the original top-level `env:` block was removed:
      ```yaml
      -env:
      -  EVAL_BACKEND: openrouter
      -  EVAL_MODEL: google/gemini-2.5-flash
      -  EVAL_JUDGE_MODEL: google/gemini-2.5-flash
      -  OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
      ```
    - The plan's Definition of Done explicitly checked "EVAL_MODEL: google/gemini-2.5-flash in orchestrator top-level env and each tier file env."
    - The original evals.yml on `main` had this top-level `env:` block; the new orchestrator does not.
  - Wiring check (with: keys match inputs: in tier files) → PASS
    - `skills:` → `eval-skills.yml` inputs.skills (type: string, required: true) ✓
    - `agents:` → `eval-agents.yml` inputs.agents (type: string, required: true) ✓
    - `run_workflow:` → `eval-workflow.yml` inputs.run_workflow (type: string, required: true) ✓
- **Functional impact:** The quality job does not consume model env vars, so removal from the orchestrator has no runtime effect. Functionally AC-12's core requirement (identical net eval outcome) is satisfied. However, the plan's own checklist criterion explicitly requires the orchestrator-level env block.

---

### Non-goal files: UNCHANGED (verified)

The following files specified as non-goals are confirmed unchanged from HEAD in the SPEC-07 working-tree changes:
- `evals/scripts/ci-detect.mjs` — no working-tree diff vs HEAD
- `evals/package.json` — no working-tree diff vs HEAD
- `evals/agent-evals.config.yaml` — no working-tree diff vs HEAD
- `evals/src/**` — no working-tree diff vs HEAD (prior-commit change to `evals/src/dsl/case.ts` is from commit `ef9d05f`, predates SPEC-07)

---

## Orphaned Implementations (potential out-of-scope changes)

Files modified by the SPEC-07 implementation that have behavior not mentioned in any plan task:

1. `.github/workflows/evals.yml` — trigger paths expanded to include three new tier files (`.github/workflows/eval-skills.yml`, `.github/workflows/eval-agents.yml`, `.github/workflows/eval-workflow.yml`). Plan Step 6 explicitly requires these paths NOT be added. This is a direct contradiction of the plan and the spec's non-goal.

2. `.github/workflows/evals.yml` — top-level `env:` block removed. Plan Step 6 specified the full orchestrator content including the `env:` block; the actual implementation removed it and distributed env vars only to tier files.

3. `eval-skills.yml`, `eval-agents.yml`, `eval-workflow.yml` — each contains an explicit `secrets: OPENROUTER_API_KEY: required: false` declaration in `workflow_call`. The plan did not specify this; it relied solely on `secrets: inherit` in the caller. This is an additive difference that does not harm correctness (it is in fact a more explicit and valid approach), but it was not in the plan.

---

## Verdict

**RESOLVED (2026-07-16).** Original verification found 1 failure + 3 partials. All have since been addressed — see the resolution log below. Net state: **PASS**.

### Resolution log (post-verification)

- **AC-7 — resolved by amendment (now PASS).** After discussion with the user, the non-goal "no change to CI trigger paths" was re-scoped to "no *narrowing* of source coverage." The three tier-file paths were **kept** in `on.pull_request.paths` as intentional self-references (mirroring the pre-existing `evals.yml` self-reference), so a PR editing only a tier file still triggers eval CI — reusable workflows never self-trigger, so without them a broken tier file could merge unnoticed. The spec's Non-goals section was amended to record this. The set of tiers dispatched per source change is unchanged (`ci-detect.mjs` untouched), so AC-7's core guarantee holds. *(The "revert" recommended below is superseded by this decision.)*
- **AC-3 — fixed.** AGENTS.md row 3 now reads "any `.claude/agents/*.md`" (was "any agent"), matching the detector's `/^\.claude\/agents\/.+\.md$/` predicate exactly.
- **AC-12 — accepted as-is (no change).** The orchestrator's top-level `env:` block was intentionally left removed: the `detect` and `quality` jobs run no model, so the block was dead config after the split. Re-adding it would imply the orchestrator uses model vars it doesn't. Model env lives in each tier file, where it's actually used. Behavior (which models run) is unchanged, satisfying AC-12's intent.
- **AC-2 — accepted as-is (no change).** The 2-column table without the `cd evals &&` prefix is a deliberate compactness choice for the scannable map; the Commands block directly above carries the full `cd evals && pnpm ...` invocations, and the skip note is a single clear sentence. Functionally complete.

### Original findings (superseded above)

**AC-7 (was FAIL):** The `evals.yml` trigger paths were expanded beyond the spec-approved set. — *Superseded: this is now the intended, spec-amended behavior (see resolution log).*

### Partial implementations requiring judgment

**AC-3 (PARTIAL):** AGENTS.md row 3 writes "any agent" instead of "any `.claude/agents/*.md`". The ci-detect.mjs workflow trigger fires only on `/^\.claude\/agents\/.+\.md$/` (not `evals/agents/**`). The vague phrasing risks documentation drift. Recommended fix: replace "any agent" with "any `.claude/agents/*.md`" to mirror the detector precisely.

**AC-2 (PARTIAL):** The table is 2-column (no Notes column), and Run commands omit the `cd evals &&` prefix shown in the Commands block. The skip note is present as a general sentence rather than per-row. Functional content is there; the deviation from the plan's specified format may reduce usability (contributor must scroll back to the Commands block to see full invocation form).

**AC-12 (PARTIAL):** The orchestrator `evals.yml` no longer has a top-level `env:` block with `EVAL_MODEL`, `EVAL_JUDGE_MODEL`, `EVAL_BACKEND`. The plan's Definition of Done explicitly checks "in orchestrator top-level env and each tier file env." Functionally harmless (quality job needs no model vars), but the plan checklist item is unmet.

### Actions required before phase can be considered complete

**All resolved — see the resolution log under Verdict.** For the record, the originally-listed actions and their disposition:

1. ~~**Required:** Remove the three new paths from `evals.yml`'s `on.pull_request.paths` block.~~ → **Superseded.** The paths were kept intentionally (spec amended); they self-reference the split CI files so tier-file-only edits still trigger eval CI.

2. **Done:** AGENTS.md row 3 now reads "any `.claude/agents/*.md`" — AC-3 drift eliminated.

3. **Accepted as-is (no change):** `evals.yml`'s top-level `env:` block stays removed (dead config in the orchestrator after the split — AC-12), and the AGENTS.md table stays 2-column with the `cd evals &&` invocations carried by the adjacent Commands block (AC-2). Both functionally correct.
