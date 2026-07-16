# INSIGHTS.md — evals harness & its CI

Session learnings accumulated over time. Treat as high-confidence guidance.
Read before working in this module. Update at session end via /engineering-insights.

---

## Patterns

### 2026-07-16 — eval CI is a reusable-workflow orchestrator, not one monolith
`.github/workflows/evals.yml` runs `detect` (ci-detect.mjs) + `quality`, then calls three named
reusable workflows (`eval-skills.yml`, `eval-agents.yml`, `eval-workflow.yml`, each `on:
workflow_call`) via `uses: ./...` with `secrets: inherit`. The `detect → skills → agents →
workflow` serialization (avoids OpenRouter throttling under one API key) lives in the orchestrator's
`needs` chain; each tier's own knobs live in its file. Add a new tier = new `eval-*.yml` +
one caller job.

## Decisions

### 2026-07-16 — AGENTS.md eval trigger table is a manual mirror of ci-detect.mjs
The "which change → which run" table in root `AGENTS.md` is hand-kept in sync with the regexes in
`evals/scripts/ci-detect.mjs` (skill/agent prefixes + the `runWorkflow` predicate) — no runtime
guard. When editing either, update both. Note the workflow tier fires on `.claude/agents/*.md`
(agent *definitions*) but NOT on `evals/agents/**` (eval cases) — don't collapse them to "any agent".

## Mistakes

### 2026-07-16 — continue-on-error / secrets can't sit on a reusable-workflow caller job
When splitting `evals.yml`, `continue-on-error` and repo secrets do NOT work on a job that only
does `uses: ./.github/workflows/eval-*.yml`. `continue-on-error: true` must live on the job *inside*
the called workflow (kept the agents/workflow tiers informational this way); secrets reach the
called workflow via `secrets: inherit` on the caller and are re-declared under `on.workflow_call.
secrets` in the tier file. Non-secret `EVAL_*` model vars must be duplicated into each tier file's
`env:` — they don't inherit.

### 2026-07-16 — don't add the new tier files to evals.yml trigger paths
Tempting to add `.github/workflows/eval-*.yml` to `on.pull_request.paths`, but the reusable tiers
only ever run when *called* by `evals.yml`; the spec's non-goal kept the original 4 paths. Trade-off
to remember: a PR editing only a tier file won't self-trigger eval CI.

## Context

### 2026-07-16 — no js-yaml/pyyaml on this box for workflow linting
Neither `pip3 install pyyaml` nor a system `yaml` module is available. To statically validate
`.github/workflows/*.yml` locally, parse with the `yaml@2.9.0` package already vendored under
`server/node_modules/.pnpm/yaml@2.9.0/` via a `node --input-type=module` script. Note: PyYAML/`yaml`
parse a bare `on:` key as boolean `true`, so read `doc.on ?? doc[true]`.

## Open Questions
