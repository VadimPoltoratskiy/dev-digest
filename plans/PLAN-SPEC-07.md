# Plan: Eval Commands Documentation + Named CI Tier Split

## Spec reference
`specs/SPEC-07-eval-docs-and-ci-split.md` (status: approved)

## Execution mode: single-agent
Single-agent, sequential. Both concerns are small, sequential changes: Change 1
(AGENTS.md edits) must be complete before Change 2 is verified against it.
No parallelism is possible or needed.

## Goal
Two independent documentation/CI-structure gaps are closed.
First: the root project map (`AGENTS.md` / `CLAUDE.md`) currently exposes no eval
commands and no trigger→tier mapping, forcing contributors to read the full evals
README before knowing which eval to run after a skill or agent change.
Second: the three eval CI tiers are invisible by file name — they are buried in a
single dynamic workflow (`evals.yml`) and cannot be discovered by scanning
`.github/workflows/`. The fix surfaces the four `pnpm eval:*` commands plus a
compact trigger→tier table in the map, and splits each tier into its own named
reusable workflow file while preserving CI behavior exactly.

## Modules affected
- Root `AGENTS.md` (symlinked as `CLAUDE.md`) — `## Commands` block and `## Read
  when` section; editing `AGENTS.md` covers both because `CLAUDE.md` is a symlink.
- `.github/workflows/evals.yml` — rewritten as an orchestrator that calls three
  named reusable workflows instead of inlining the tier jobs.
- `.github/workflows/eval-skills.yml` — new reusable workflow (created).
- `.github/workflows/eval-agents.yml` — new reusable workflow (created).
- `.github/workflows/eval-workflow.yml` — new reusable workflow (created).

## Engineering Insights applied
- No `evals/insights/INSIGHTS.md` exists (the `evals/` package has no insights
  file); none of server/client/reviewer-core/e2e INSIGHTS.md files are relevant
  because this task writes no application code.
- House style (from sibling `.github/workflows/client.yml`,
  `server-unit.yml`, `server-integration.yml`): one-sentence descriptive comment
  block at the top of each file before `name:`; `permissions: contents: read` on
  every workflow; `pnpm/action-setup@v4` + `actions/setup-node@v4` with `cache: pnpm`
  and `cache-dependency-path: evals/pnpm-lock.yaml`; `pnpm install --frozen-lockfile`
  as the install step.
- The existing evals.yml design-rationale comment (serialization/throttling/
  continue-on-error/fail-fast reasoning, lines 1–28) must be preserved in the
  orchestrator; each tier file gets only a one-line "called by evals.yml" header.

## Recommendations
- **Branch-protection check-name drift:** GitHub reports matrix jobs from a
  reusable workflow under a compound check name
  (`evals / skills / skill evals (typescript-expert)`) rather than the current flat
  name (`evals / skill evals (typescript-expert)`). If branch protection rules
  reference the current names, they will need updating after the split.
  This is an accepted trade-off of the reusable-workflow approach. Note in the
  Gotchas and flag to the team before merging.

## Architecture decisions

**`continue-on-error: true` belongs inside each tier file, not on the caller job**
(GitHub Actions constraint). A caller job with `uses:` cannot reliably set
`continue-on-error`; the declared-in-caller form does not reliably suppress
required-status failures for matrix jobs inside the called workflow. The correct
wiring: the job inside `eval-agents.yml` and `eval-workflow.yml` carries
`continue-on-error: true`. When every job inside a reusable workflow succeeds or
is marked continue-on-error, the overall reusable workflow conclusion is "success",
so the caller job in `evals.yml` sees success and the PR required-status is
unaffected.

**OPENROUTER_API_KEY flows via `secrets: inherit` + is re-referenced inside each
tier file.** Reusable workflows do NOT inherit the caller's top-level `env:` block;
secrets must travel through `secrets: inherit` (no explicit list needed when using
inherit) and then be referenced inside the called file as
`${{ secrets.OPENROUTER_API_KEY }}`. The `EVAL_BACKEND`, `EVAL_MODEL`, and
`EVAL_JUDGE_MODEL` vars are not secrets, so they are duplicated verbatim into each
tier file's `env:` block.

**Caller job IDs in `evals.yml` retain the existing names `skills`, `agents`,
`workflow`.** These names determine the GitHub check-run prefix shown in PR
statuses. Changing them would alter check names and could break any branch-
protection rules that reference those names by string.

**The `quality` and `detect` jobs in `evals.yml` are unchanged.** They are not
extracted to reusable workflows because they have no parallel-callee use case and
extracting them adds complexity without benefit.

**CI changes are explicitly approved by the user's instruction.** The normal
"do-not-touch" note on `.github/workflows/` (AGENTS.md) is overridden here.

---

## Tasks

### Step 1 — Edit `AGENTS.md`: add the four eval commands to the `## Commands` block

**File:** `/AGENTS.md` (root), lines 17–29 (the `## Commands` fenced block)

Append four lines inside the fenced block, immediately after the existing last
command (`cd e2e && ./scripts/e2e.sh`), before the closing triple-backtick:

```sh
cd evals && pnpm eval:quality  # static SKILL.md gate, no model
cd evals && pnpm eval:skills   # skill content-tier
cd evals && pnpm eval:agents   # subagent tool-tier
cd evals && pnpm eval:workflow # live-harness workflow-tier
```

The resulting Commands block must read (complete block for implementer reference):

```sh
./scripts/dev.sh          # full stack: Postgres + API + web
docker compose up -d      # Postgres only
cd server && pnpm dev     # API :3001
cd client && pnpm dev     # web :3000
cd server && pnpm db:migrate   # apply migrations (NOT auto on boot)
cd server && pnpm db:seed      # idempotent demo data
cd server && pnpm test    # unit + integration
cd client && pnpm test    # vitest + jsdom
cd reviewer-core && pnpm test  # hermetic units
cd e2e && ./scripts/e2e.sh     # hermetic browser e2e
cd evals && pnpm eval:quality  # static SKILL.md gate, no model
cd evals && pnpm eval:skills   # skill content-tier
cd evals && pnpm eval:agents   # subagent tool-tier
cd evals && pnpm eval:workflow # live-harness workflow-tier
```

**Satisfies:** AC-1

---

### Step 2 — Edit `AGENTS.md`: replace the single evals pointer in `## Read when` with a trigger→tier table

**File:** `/AGENTS.md` (root), `## Read when` section (currently lines 45–53)

Replace the single line:
```
- Touching the evals harness or its CI gating → read `evals/README.md`
```

With the following block (a bullet leading into a compact table, then the README
pointer as a sub-line beneath the table):

```markdown
- Touching evals or CI eval artifacts — which eval to run locally:

  | Changed path | Run | Notes |
  |---|---|---|
  | `.claude/skills/<name>/**` or `evals/skills/<name>/**` | `cd evals && pnpm eval:skills` | content tier for that skill; no written evals → skip |
  | `.claude/agents/<name>.md` or `evals/agents/<name>/**` | `cd evals && pnpm eval:agents` | tool tier for that agent; no written evals → skip |
  | `CLAUDE.md`, `.claude/CLAUDE.md`, any `.claude/agents/*.md`, `evals/workflow/**`, `evals/src/**` | `cd evals && pnpm eval:workflow` | live harness tier |
  | any `.claude/**` or `evals/**` change | `cd evals && pnpm eval:quality` | static gate, no model — always runs in CI |

  → Full CI and tier reference: `evals/README.md`
```

All other lines in `## Read when` remain untouched. The existing
`## Cross-cutting gotchas` note about `google/gemini-2.5-flash` / `continue-on-error`
(line ~37 in the current file) is unchanged.

**Cross-check (required before committing):** Verify the four table rows match
`evals/scripts/ci-detect.mjs` exactly:
- Row 1 patterns mirror lines 86–88 (`/^\.claude\/skills\/([^/]+)\//` and
  `/^evals\/skills\/([^/]+)\//`)
- Row 2 patterns mirror lines 90–92 (`/^\.claude\/agents\/([^/]+)\.md$/` and
  `/^evals\/agents\/([^/]+)\//`)
- Row 3 paths mirror lines 103–109 (`f === "CLAUDE.md"`,
  `f === ".claude/CLAUDE.md"`, `/^\.claude\/agents\/.+\.md$/`,
  `/^evals\/workflow\//`, `/^evals\/src\//`)
- Row 4 is the static-gate rule that always fires for any change under the
  evals trigger paths.

**Satisfies:** AC-2, AC-3, AC-4

---

### Step 3 — Create `.github/workflows/eval-skills.yml`

**File:** `.github/workflows/eval-skills.yml` (new)

Full content:

```yaml
# Called by evals.yml — skills content-tier eval, one matrix job per changed skill.
name: eval-skills

on:
  workflow_call:
    inputs:
      skills:
        description: 'JSON array of skill names to evaluate'
        required: true
        type: string

permissions:
  contents: read

env:
  EVAL_BACKEND: openrouter
  EVAL_MODEL: google/gemini-2.5-flash
  EVAL_JUDGE_MODEL: google/gemini-2.5-flash
  OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}

jobs:
  skills:
    name: skill evals (${{ matrix.skill }})
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: evals
    strategy:
      fail-fast: false
      matrix:
        skill: ${{ fromJSON(inputs.skills) }}
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: evals/pnpm-lock.yaml

      - run: pnpm install --frozen-lockfile

      - run: pnpm vitest run "skills/${{ matrix.skill }}"
```

**Implementation notes:**
- `strategy.fail-fast: false` is mandatory (AC-10): one failing skill must not
  cancel sibling matrix jobs.
- `OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}` is the correct way to
  reference the secret after it arrives via `secrets: inherit` in the caller.
- No `continue-on-error` — skills failures ARE required-status blocking (AC-9).

**Satisfies:** AC-5, AC-10

---

### Step 4 — Create `.github/workflows/eval-agents.yml`

**File:** `.github/workflows/eval-agents.yml` (new)

Full content:

```yaml
# Called by evals.yml — agent tool-tier eval, one matrix job per changed agent.
# Informational only (continue-on-error: true): tool-tier dispatch/activation checks
# are documented as indicative on non-Anthropic models (see evals/README.md).
name: eval-agents

on:
  workflow_call:
    inputs:
      agents:
        description: 'JSON array of agent names to evaluate'
        required: true
        type: string

permissions:
  contents: read

env:
  EVAL_BACKEND: openrouter
  EVAL_MODEL: google/gemini-2.5-flash
  EVAL_JUDGE_MODEL: google/gemini-2.5-flash
  OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}

jobs:
  agents:
    name: agent evals (${{ matrix.agent }})
    runs-on: ubuntu-latest
    continue-on-error: true
    defaults:
      run:
        working-directory: evals
    strategy:
      max-parallel: 1
      matrix:
        agent: ${{ fromJSON(inputs.agents) }}
    env:
      OPENROUTER_BASE_URL: http://localhost:4000
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: evals/pnpm-lock.yaml

      - run: pnpm install --frozen-lockfile

      - run: docker compose -f proxy/docker-compose.yml up -d

      - run: pnpm proxy:wait

      - run: pnpm vitest run "agents/${{ matrix.agent }}"

      - if: failure()
        run: docker compose -f proxy/docker-compose.yml logs --tail 100

      - if: always()
        run: docker compose -f proxy/docker-compose.yml down
```

**Implementation notes:**
- `continue-on-error: true` MUST live on the job here (inside the reusable file),
  NOT on the caller job in `evals.yml`. This is the reliable wiring pattern for
  GitHub Actions reusable workflows. When this job marks itself continue-on-error,
  the reusable workflow's overall conclusion becomes "success" even on failure, so
  the PR required-status is unaffected.
- `max-parallel: 1` preserves serialization within the agents tier: concurrent
  OpenRouter calls under one API key can degrade to truncated single-turn output
  (documented in evals/README.md).
- `OPENROUTER_BASE_URL: http://localhost:4000` is a job-level env override — it
  must NOT be in the file-level `env:` block or it would override for all jobs.
- The LiteLLM proxy steps (`proxy up → proxy:wait → vitest → logs on failure →
  proxy down`) are copied verbatim from the current evals.yml agents job.

**Satisfies:** AC-5, AC-9

---

### Step 5 — Create `.github/workflows/eval-workflow.yml`

**File:** `.github/workflows/eval-workflow.yml` (new)

Full content:

```yaml
# Called by evals.yml — live-harness workflow-tier eval.
# Informational only (continue-on-error: true): tool-tier dispatch/activation checks
# are documented as indicative on non-Anthropic models (see evals/README.md).
name: eval-workflow

on:
  workflow_call:
    inputs:
      run_workflow:
        description: 'Whether to run the workflow tier ("true" / "false")'
        required: true
        type: string

permissions:
  contents: read

env:
  EVAL_BACKEND: openrouter
  EVAL_MODEL: google/gemini-2.5-flash
  EVAL_JUDGE_MODEL: google/gemini-2.5-flash
  OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}

jobs:
  workflow:
    name: workflow evals
    runs-on: ubuntu-latest
    continue-on-error: true
    defaults:
      run:
        working-directory: evals
    env:
      OPENROUTER_BASE_URL: http://localhost:4000
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: evals/pnpm-lock.yaml

      - run: pnpm install --frozen-lockfile

      - run: docker compose -f proxy/docker-compose.yml up -d

      - run: pnpm proxy:wait

      - run: pnpm eval:workflow

      - if: failure()
        run: docker compose -f proxy/docker-compose.yml logs --tail 100

      - if: always()
        run: docker compose -f proxy/docker-compose.yml down
```

**Implementation notes:**
- Same `continue-on-error: true` placement reasoning as `eval-agents.yml` (Step 4).
- The `run_workflow` input is declared `type: string` because `ci-detect.mjs` emits
  it as the string `"true"` or `"false"` via `String(runWorkflow)`. The caller's
  `if:` guard checks `== 'true'` (string comparison).
- The workflow tier has no matrix; it just runs `pnpm eval:workflow` once.
- Proxy up/wait/logs/down steps are copied verbatim from the current evals.yml
  workflow job.

**Satisfies:** AC-5, AC-9

---

### Step 6 — Rewrite `.github/workflows/evals.yml` as the orchestrator

**File:** `.github/workflows/evals.yml` (rewrite in place)

Full content:

```yaml
# evals suite — the harness eval package (@devdigest/evals).
#
# Only runs when the harness/artifacts change. `detect` maps changed files to exactly which
# tiers need to run (see evals/scripts/ci-detect.mjs): a changed skill → its content-tier eval,
# a changed agent → its tool-tier eval, CLAUDE.md/agent/engine changes → the workflow tier.
#
# `quality` (static gate, no model) and `skills` (content tier) are required. `agents` and
# `workflow` (tool tiers) run on google/gemini-2.5-flash via OpenRouter — the only one of the
# three models the package's own README benchmarked as reliably driving subagent dispatch — but
# stay informational (continue-on-error) since tool-tier dispatch/activation checks are documented
# as flaky/indicative on non-Anthropic models (see evals/README.md). The judge's JSON extraction
# (src/scoring/llm-judge.ts) is bracket-depth-aware with a one-shot retry and an explicit
# max_tokens ceiling (EVAL_MAX_OUTPUT_TOKENS) so a cheap judge model's malformed or truncated
# output doesn't fail the case; the workflow tier's positive `activation` assertion is soft (warns,
# doesn't fail) on non-Anthropic models per the same README caveat.
#
# architecture-reviewer is currently excluded from the `agents` job (see excluded_agents in
# evals/agent-evals.config.yaml) — its tool-tier eval was flaky enough on the cheap CI model to not
# be worth gating merges on. It still runs locally via `pnpm vitest run agents/architecture-reviewer`.
#
# `skills` → `agents` → `workflow` are chained via `needs` (not run in parallel off `detect`), so
# they queue instead of racing each other — evals/README.md documents that concurrent OpenRouter
# calls under one API key can get throttled and degrade responses to truncated single-turn output.
# Each still gates on its own `if` (via `always()`, so an upstream skip/failure doesn't skip it).
#
# `skills` runs `fail-fast: false` — one flaky/broken skill case must not cancel every other
# skill's matrix job mid-run (GitHub's default fail-fast did exactly this once, cancelling an
# already-passing sibling job before it could report success).
name: evals

on:
  pull_request:
    paths:
      - 'evals/**'
      - '.claude/**'
      - 'CLAUDE.md'
      - '.github/workflows/evals.yml'

permissions:
  contents: read

concurrency:
  group: evals-${{ github.ref }}
  cancel-in-progress: true

env:
  EVAL_BACKEND: openrouter
  EVAL_MODEL: google/gemini-2.5-flash
  EVAL_JUDGE_MODEL: google/gemini-2.5-flash
  OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}

jobs:
  detect:
    name: detect changes
    runs-on: ubuntu-latest
    outputs:
      skills: ${{ steps.detect.outputs.skills }}
      agents: ${{ steps.detect.outputs.agents }}
      run_workflow: ${{ steps.detect.outputs.run_workflow }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Compute changed files
        id: changed
        run: |
          {
            echo 'files<<EOF'
            git diff --name-only "${{ github.event.pull_request.base.sha }}" "${{ github.event.pull_request.head.sha }}"
            echo 'EOF'
          } >> "$GITHUB_OUTPUT"

      - name: Map changes to eval tiers
        id: detect
        working-directory: evals
        env:
          CHANGED_FILES: ${{ steps.changed.outputs.files }}
        run: node scripts/ci-detect.mjs

  quality:
    name: static gate + typecheck
    needs: detect
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: evals
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: evals/pnpm-lock.yaml

      - run: pnpm install --frozen-lockfile

      - run: pnpm typecheck

      - run: pnpm eval:quality

  skills:
    name: skills tier
    needs: detect
    if: needs.detect.outputs.skills != '[]'
    uses: ./.github/workflows/eval-skills.yml
    with:
      skills: ${{ needs.detect.outputs.skills }}
    secrets: inherit

  agents:
    name: agents tier
    needs: [detect, skills]
    if: always() && needs.detect.outputs.agents != '[]'
    uses: ./.github/workflows/eval-agents.yml
    with:
      agents: ${{ needs.detect.outputs.agents }}
    secrets: inherit

  workflow:
    name: workflow tier
    needs: [detect, agents]
    if: always() && needs.detect.outputs.run_workflow == 'true'
    uses: ./.github/workflows/eval-workflow.yml
    with:
      run_workflow: ${{ needs.detect.outputs.run_workflow }}
    secrets: inherit
```

**Implementation notes:**

- The design-rationale comment block (lines 1–28 in the original file) is preserved
  verbatim in the new orchestrator header.
- The `detect` and `quality` jobs are copied verbatim; nothing in those jobs changes.
- The three inline tier jobs (`skills`, `agents`, `workflow`) are replaced with three
  caller jobs using `uses:`. Job IDs are kept as `skills`, `agents`, `workflow` to
  preserve any branch-protection check-name references.
- `secrets: inherit` on each caller job — no explicit secret list needed; this passes
  all repo secrets (including `OPENROUTER_API_KEY`) to the reusable workflow.
- The caller jobs do NOT set `continue-on-error`. That flag belongs inside each
  reusable tier file (see Steps 4 and 5).
- The `needs` chain `detect → skills → agents → workflow` is preserved for
  serialization (prevents OpenRouter throttling from concurrent calls).
- The `if: always() && ...` guards on `agents` and `workflow` caller jobs preserve
  the behavior where an upstream skip/failure in `skills` does not cause `agents` to
  be skipped when it has agents to run.
- Trigger paths are **unchanged** from the current file (`evals/**`, `.claude/**`,
  `CLAUDE.md`, `.github/workflows/evals.yml`). The new tier files at
  `.github/workflows/eval-*.yml` are NOT in the trigger paths; changes to them alone
  will not re-run evals. This is an accepted trade-off per the spec's non-goals
  ("no change to CI trigger paths").

**Satisfies:** AC-6, AC-7, AC-8, AC-9, AC-11, AC-12

---

### Step 7 — Verification

Run all of the following after the edits in Steps 1–6 are saved:

**7a. YAML parse all four workflow files**
```sh
python3 -c "
import yaml, sys
files = [
    '.github/workflows/evals.yml',
    '.github/workflows/eval-skills.yml',
    '.github/workflows/eval-agents.yml',
    '.github/workflows/eval-workflow.yml',
]
for f in files:
    with open(f) as fh:
        doc = yaml.safe_load(fh)
    print(f'OK: {f}')
print('All YAML files parse without error.')
"
```

**7b. Wiring check — caller `with:` keys must match each reusable file's `inputs:`**

Manually confirm (or script) these three mappings:
- `evals.yml` job `skills` → `with: skills:` → `eval-skills.yml` has `inputs.skills` (type: string, required: true)
- `evals.yml` job `agents` → `with: agents:` → `eval-agents.yml` has `inputs.agents` (type: string, required: true)
- `evals.yml` job `workflow` → `with: run_workflow:` → `eval-workflow.yml` has `inputs.run_workflow` (type: string, required: true)

**7c. Docs-vs-detector cross-check**

Open `AGENTS.md` and `evals/scripts/ci-detect.mjs` side by side. Confirm:
1. Table row 1 paths match `ci-detect.mjs` lines 86–88 (skill patterns)
2. Table row 2 paths match `ci-detect.mjs` lines 90–92 (agent patterns)
3. Table row 3 paths match `ci-detect.mjs` lines 103–109 (workflow trigger conditions)
4. The README pointer `evals/README.md` is present beneath the table

**7d. Evals smoke test**
```sh
cd evals && pnpm typecheck && pnpm eval:quality
```
Both commands must exit 0. `pnpm typecheck` checks TypeScript correctness of the
evals source; `pnpm eval:quality` runs the model-free SKILL.md static gate (no
OpenRouter key needed).

**7e. Manual workflow file checklist**

- `eval-skills.yml`: has `strategy.fail-fast: false`; NO `continue-on-error`; uses
  `fromJSON(inputs.skills)` for matrix; `OPENROUTER_API_KEY` referenced from secrets.
- `eval-agents.yml`: has `continue-on-error: true` on the `agents` job; has
  `max-parallel: 1`; `OPENROUTER_BASE_URL: http://localhost:4000` is a job-level env;
  proxy up/wait/vitest/logs/down steps all present.
- `eval-workflow.yml`: has `continue-on-error: true` on the `workflow` job;
  `OPENROUTER_BASE_URL: http://localhost:4000` is a job-level env; proxy steps and
  `pnpm eval:workflow` all present.
- `evals.yml`: detect and quality jobs unchanged; three caller jobs with `uses:`,
  `with:`, `secrets: inherit`; `if: always() && ...` on agents and workflow callers;
  trigger paths unchanged.

---

## Gotchas

- **`AGENTS.md` is a symlink target.** `CLAUDE.md → AGENTS.md`. Edit only `AGENTS.md`;
  no separate edit to `CLAUDE.md` is needed or safe.

- **`.github/workflows/` is a do-not-touch zone** per `AGENTS.md` ("changes need
  explicit approval"). Approval for this plan is given by the user's explicit
  instruction that produced it.

- **Branch-protection required-status check names will change.** The current check
  name for skills matrix jobs is `evals / skill evals (typescript-expert)`.
  After the split it becomes `evals / skills / skill evals (typescript-expert)`
  (GitHub prepends the caller's workflow name and job name). Any branch protection
  rule that references the old name string will stop matching.
  **Action before merge:** audit the repo's branch protection rules
  (`Settings → Branches → main`) and update any required-status check strings that
  reference `evals / skill evals (*)` or the agents/workflow check names.

- **`continue-on-error` placement is critical.** Setting it on a caller job (`uses:`)
  in GitHub Actions is unreliable for reusable workflows with matrix jobs; it MUST
  live on the job inside each tier file. The plan places it there in Steps 4 and 5.
  Do not move it to the caller jobs in `evals.yml`.

- **OPENROUTER_API_KEY is a secret — it cannot be in the caller's `env:` block for
  reusable workflows.** It must reach the tier file via `secrets: inherit`, then be
  referenced as `${{ secrets.OPENROUTER_API_KEY }}` in the tier file's `env:` block.
  The `EVAL_*` model name vars are not secrets and are duplicated directly into each
  tier file's top-level `env:`.

- **New tier files are not in the eval trigger paths.** Changing only
  `eval-skills.yml`, `eval-agents.yml`, or `eval-workflow.yml` will not trigger a
  CI eval run. This is per the spec's "no change to CI trigger paths" non-goal and
  is the accepted behavior.

- **No changes to `evals/package.json`, `ci-detect.mjs`,
  `agent-evals.config.yaml`, or any file under `evals/src/**`, `evals/skills/**`,
  `evals/agents/**`, `evals/workflow/**`.** These are spec non-goals.

---

## Definition of done

### General
- [ ] `cd evals && pnpm typecheck` exits 0 (no TypeScript errors)
- [ ] `cd evals && pnpm eval:quality` exits 0 (static skill-quality gate passes)
- [ ] All four workflow YAML files parse without error (Step 7a)

### AC-by-AC

**AC-1** — All four eval commands appear in `AGENTS.md` `## Commands` block as
`cd evals && pnpm eval:<name>` lines with a comment:
- [ ] `cd evals && pnpm eval:quality  # static SKILL.md gate, no model`
- [ ] `cd evals && pnpm eval:skills   # skill content-tier`
- [ ] `cd evals && pnpm eval:agents   # subagent tool-tier`
- [ ] `cd evals && pnpm eval:workflow # live-harness workflow-tier`

**AC-2** — Trigger→tier table present in `AGENTS.md` `## Read when`, with rows for:
- [ ] skill change → `eval:skills` + skip note
- [ ] agent change → `eval:agents` + skip note
- [ ] CLAUDE.md / agent `.md` / `evals/workflow/**` / `evals/src/**` → `eval:workflow`
- [ ] any `.claude/**` or `evals/**` → `eval:quality`

**AC-3** — Each table row's paths match `evals/scripts/ci-detect.mjs` (Step 7c cross-check passes):
- [ ] Row 1 matches ci-detect.mjs skill patterns (lines 86–88)
- [ ] Row 2 matches ci-detect.mjs agent patterns (lines 90–92)
- [ ] Row 3 matches ci-detect.mjs workflow conditions (lines 103–109)

**AC-4** — The `evals/README.md` deep-dive pointer is present beneath the table in
`AGENTS.md`:
- [ ] `→ Full CI and tier reference: \`evals/README.md\`` line present

**AC-5** — Three named tier workflow files exist and are recognizable by filename:
- [ ] `.github/workflows/eval-skills.yml` exists
- [ ] `.github/workflows/eval-agents.yml` exists
- [ ] `.github/workflows/eval-workflow.yml` exists

**AC-6** — Orchestrator `evals.yml` retains `detect` job and calls three tier files
as reusable workflows:
- [ ] `detect` job present with `outputs: skills / agents / run_workflow`
- [ ] Three caller jobs use `uses: ./.github/workflows/eval-*.yml`
- [ ] Each caller passes the detection output via `with:` and `secrets: inherit`

**AC-7** — Same `on.pull_request.paths` trigger set as before:
- [ ] `evals/**`, `.claude/**`, `CLAUDE.md`, `.github/workflows/evals.yml`

**AC-8** — Serialized `needs` chain preserved in orchestrator:
- [ ] `skills` needs `detect`
- [ ] `agents` needs `[detect, skills]`
- [ ] `workflow` needs `[detect, agents]`

**AC-9** — `continue-on-error: true` is on the job INSIDE `eval-agents.yml` and
`eval-workflow.yml` (NOT on the caller jobs in `evals.yml`):
- [ ] `eval-agents.yml` `agents` job: `continue-on-error: true`
- [ ] `eval-workflow.yml` `workflow` job: `continue-on-error: true`
- [ ] `evals.yml` caller jobs `agents` and `workflow`: no `continue-on-error`

**AC-10** — `strategy.fail-fast: false` is in `eval-skills.yml` skills job:
- [ ] `eval-skills.yml` has `strategy.fail-fast: false` in the skills job

**AC-11** — `quality` job in `evals.yml` unchanged (no `continue-on-error`; runs
`pnpm typecheck` and `pnpm eval:quality`):
- [ ] `quality` job present, runs typecheck + eval:quality, no continue-on-error

**AC-12** — Same models, env vars, and behavior as before the split:
- [ ] `EVAL_MODEL: google/gemini-2.5-flash` in orchestrator top-level env and each tier file env
- [ ] `EVAL_JUDGE_MODEL: google/gemini-2.5-flash` same
- [ ] `EVAL_BACKEND: openrouter` same
- [ ] Wiring check in Step 7b confirms `with:` keys match `inputs:` in all three tier files
