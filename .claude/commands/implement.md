---
name: implement
description: Execute an existing PLAN.md — implementer(s) → plan-verifier → architecture-reviewer, looping fixes back to implementer with a capped iteration budget.
argument-hint: "<path-to-PLAN.md> [free-text extra requirements] [--design <path-or-url> ...]"
allowed-tools:
  - Read
  - Bash
  - Agent
  - AskUserQuestion
  - TodoWrite
---
<objective>
Execute an existing `PLAN.md` end-to-end through implementation and the
mechanical/architectural quality gate, looping fixes back to `implementer` with a
capped iteration budget, then stop and summarize.

Does NOT create specs or plans — `spec-creator` and `implementation-planner` are run
manually, beforehand, by the user, in their own chats. This command starts from an
existing `PLAN.md` and assumes it is trustworthy ground truth for what to build.

Order: `implementer`(s) → `plan-verifier` (cheap, mechanical, fail-fast) →
`architecture-reviewer` (qualitative, only after a mechanical PASS) → summary.
`test-writer`, `security-reviewer`, and `doc-writer` are explicitly OUT of scope —
noted as manual follow-ups in the final summary, never invoked automatically.
</objective>

<context>
Arguments (`$ARGUMENTS`):
1. Required, first token: path to an existing `PLAN.md`. If missing, or the file
   doesn't exist, stop and ask for it (`AskUserQuestion`) — never guess a path.
2. Optional free text after the path: extra requirements/corrections/context to pass
   verbatim to every `implementer` spawn, on top of `PLAN.md`.
3. Optional, repeatable `--design <path-or-url>`: design references passed through
   to `implementer` spawns unchanged.

Flag handling rule: a flag/argument is only active if its literal form is present in
`$ARGUMENTS` — do not infer any of the above from context.

Iteration caps (fixed, not user-configurable per run):
- `plan-verifier` gap-fix loop: max 3 iterations.
- `architecture-reviewer` fix loop: max 2 iterations.
On cap-out: STOP, do not loop further. Report the unresolved report to the user
instead of declaring the phase done.

Capture `git rev-parse HEAD` as `BASE_SHA` before spawning any `implementer` — used
to scope `architecture-reviewer`'s diff consistently across iterations regardless
of whether `implementer` commits anything.

This command never runs `git commit` itself — it leaves the working tree for the
user to review and commit, consistent with the project's git-safety default.
</context>

<process>
Step 1 — Load the plan
  Read the `PLAN.md` at the given path in full. Extract: phases, per-phase tasks,
  stated `Execution mode` (single-agent | multi-agent), `Modules affected`, and
  `Definition of done`.
  If `Execution mode` isn't stated, ask the user once (`AskUserQuestion`) — never
  silently default to one or the other.
  Record `BASE_SHA = $(git rev-parse HEAD)`.
  Use `TodoWrite` to track phases/steps through the run.

Step 2 — Spawn implementer(s)
  Multi-agent: one `implementer` subagent (`Agent` tool, `subagent_type:
  "implementer"`) per independent phase, spawned in parallel. A phase with a stated
  dependency on another phase waits for that phase's implementer to finish first
  (sequential barrier) — do not parallelize phases the plan itself marks dependent.
  Single-agent: one `implementer`, run sequentially in plan order.
  Pass every implementer: the `PLAN.md` path plus its phase assignment, the optional
  free-text extra requirements from `$ARGUMENTS`, and any `--design` references,
  verbatim. Wait for the current wave to fully return before proceeding.

Step 3 — plan-verifier (mechanical gate, runs first)
  Spawn `plan-verifier` (`subagent_type: "plan-verifier"`) with the `PLAN.md` path.
  - Verdict PASS → go to Step 4.
  - Verdict GAPS FOUND → re-spawn `implementer` only for the flagged phases/tasks,
    passing the `VERIFICATION.md` gap list as extra context, then re-run
    `plan-verifier`. Count this as one iteration.
  - After 3 iterations without a PASS: STOP. Report the last `VERIFICATION.md` and
    the persistent gaps to the user — do not proceed to Step 4 and do not report
    the plan as complete.

Step 4 — architecture-reviewer (qualitative gate, only after a mechanical PASS)
  Spawn `architecture-reviewer` (`subagent_type: "architecture-reviewer"`) scoped to
  `git diff BASE_SHA` (fall back to `PLAN.md`'s `Modules affected` file list if the
  diff is empty because changes are uncommitted-but-untracked).
  - No CRITICAL/WARNING findings (verdict PASS, or SUGGESTION-only) → go to Step 5.
  - Findings at CRITICAL/WARNING severity → re-spawn `implementer` for the affected
    phase(s), passing the finding list (file:line, rule, recommendation) as extra
    context, then re-run `architecture-reviewer` against the same `BASE_SHA` diff.
    Count this as one iteration.
  - After 2 iterations still finding CRITICAL/WARNING: STOP. Report the unresolved
    findings to the user — do not proceed to Step 5 and do not report the plan as
    complete.

Step 5 — Summary
  Report to the user:
  - Phases completed and their execution mode.
  - Final `plan-verifier` verdict (and iteration count if it looped).
  - Final `architecture-reviewer` verdict (and iteration count if it looped).
  - Any cap-out escalation from Step 3 or Step 4, called out explicitly as blocking.
  - Explicit next steps: "`test-writer` was not run — invoke it manually for test
    coverage." / "`security-reviewer` and `doc-writer` are available separately —
    not run by this command."
  Do not run `git commit` or any other write beyond what `implementer` already did.
</process>
