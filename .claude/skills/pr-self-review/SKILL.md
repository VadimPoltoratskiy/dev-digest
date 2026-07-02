---
name: pr-self-review
description: "Pre-PR local review gate for the dev-digest project. Explicitly triggered by the developer before opening a pull request or pushing to remote. Reads the full diff between the current branch and main, detects which surfaces changed (client vs. server vs. both), applies the complete set of relevant domain skills to each surface (ui-architecture + react-best-practices + react-testing-library for frontend; onion-architecture + fastify-best-practices + drizzle-orm-patterns for backend), then reports findings and emits a BLOCKED or PASS verdict. PR creation must not proceed while any CRITICAL finding remains unresolved. Invoke explicitly: /pr-self-review, 'run self review', 'check changes before PR', 'pre-push review', 'review my diff'."
allowed-tools: Bash, Read, Grep, Glob
metadata:
  tags: workflow, pre-pr, gate, self-review, routing, orchestration, local-review, diff
---

# PR Self-Review (Pre-PR Gate)

A mandatory review pass over all local changes before opening a pull request. This skill orchestrates all domain skills and emits a **BLOCKED** or **PASS** verdict. Do not push or open a PR while the verdict is BLOCKED.

---

## When to Run

- Before opening a PR — always
- Before pushing a branch to remote for the first time
- After a refactor that touches multiple surfaces
- **NOT** during active coding, on every save, or as a substitute for tests

---

## Step 1 — Capture the Full Diff

Get everything that would enter the PR — all commits on this branch not yet in `main`:

```bash
git diff $(git merge-base main HEAD)..HEAD
```

If the branch has no commits yet (working tree only):

```bash
git diff HEAD
```

Extract the list of all changed file paths from the output. This is the input to Step 2.

---

## Step 2 — Surface Detection

Classify every changed file into one or more surfaces using its path prefix:

| Path prefix | Surface |
|---|---|
| `client/src/app/` | Frontend — Routes & Pages |
| `client/src/components/` | Frontend — Shared Components |
| `client/src/lib/hooks/` | Frontend — Data Hooks |
| `client/src/lib/api.ts` | Frontend — API Entry Point |
| `client/src/**/*.test.tsx` | Frontend — Component Tests |
| `client/src/lib/*.ts` | Frontend — Utilities |
| `client/src/vendor/` | Vendor — note presence only; do not apply rules |
| `server/src/modules/` | Backend — Feature Modules |
| `server/src/adapters/` | Backend — Adapters |
| `server/src/db/schema/` | Backend — DB Schema |
| `server/src/db/migrations/` | Backend — Migrations |
| `server/src/platform/` | Backend — Platform Core |
| `server/src/vendor/` | Backend — Shared Contracts |
| `reviewer-core/src/` | Reviewer Core — inspect manually (no surface routing) |

A single PR may activate multiple surfaces. Flag any changes to `reviewer-core/src/grounding.ts`, `prompt.ts`, or `run.ts` explicitly — these are high-risk files.

---

## Step 3 — Route to Companion Skills

Based on active surfaces, determine the complete set of companion skills to apply:

| Active surfaces | Companion skills |
|---|---|
| Any `client/src/` path | `ui-architecture` + `react-best-practices` |
| `client/src/**/*.test.tsx` included | + `react-testing-library` |
| Any `server/src/` path | `onion-architecture` + `fastify-best-practices` |
| `server/src/db/schema/` or `db/migrations/` | + `drizzle-orm-patterns` |
| Both frontend and backend | All skills from both rows above |
| `reviewer-core/src/` only | No routing — manual inspection required |

For each companion skill, read its full `SKILL.md` from:
```
.claude/skills/<skill-name>/SKILL.md
```

Apply every rule from its Anti-Patterns section to the diff.

---

## Step 4 — Apply Skills in CRITICAL-First Order

For each active companion skill, scan the diff for violations. Evaluate in severity order:

### CRITICAL (Blocks PR — must fix before opening)
- Layer boundary breaches: route calling DB directly, service importing adapter without DI
- Inline `fetch()` in a component body or service
- Hand-edited migration SQL file
- DB query in a route handler (`db.select()`, `db.insert()` etc. inside `routes.ts`)
- `vendor/` file modified directly

### HIGH (Should fix — warn but do not hard block)
- Feature component placed in `components/` when used by only one route
- Component file without colocation folder or `index.ts` barrel
- Hardcoded UI strings in components (must use `next-intl`)
- New route without workspace context (`getContext()` call missing)
- Repository method returning a DTO instead of typed row
- Service accessing `req` or `res` objects directly

### MEDIUM (Note for PR review)
- File naming violation (kebab-case directories, PascalCase components)
- Missing `constants.ts` or `helpers.ts` when the component has local static data
- Test helper placed in a colocated test file instead of `src/test/`
- New module not registered in `modules/index.ts` or `app.ts`

**Every finding must cite the exact file path and line number** from the diff where the violation occurs. Speculative or uncited findings must be dropped — this mirrors the citation grounding gate in `reviewer-core/src/grounding.ts`.

---

## Step 5 — Report and Gate

Emit this report structure:

```
## PR Self-Review: <branch-name>
Surfaces detected: <list>
Companion skills applied: <list>

### CRITICAL [BLOCKS PR]
- `<file>:<line>` — <one-sentence description of the violation>
  → [<skill-name> / Anti-Patterns: CRITICAL]

### HIGH
- `<file>:<line>` — <description>
  → [<skill-name> / Anti-Patterns: HIGH]

### MEDIUM
- `<file>:<line>` — <description>

### PASS ✓
- `<file>` — No violations found. (<skill-name>)

---
## Verdict: ❌ BLOCKED
<N> CRITICAL finding(s) must be resolved before this PR can be opened.
Run /pr-self-review again after fixing to confirm PASS.
```

If no CRITICAL findings:

```
---
## Verdict: ✅ PASS
<N> high / <M> medium findings noted above. PR may be opened.
Address HIGH findings before requesting merge.
```

---

## Verdict Semantics

| Verdict | Meaning | Action |
|---|---|---|
| ❌ BLOCKED | One or more CRITICAL findings | Fix all CRITICAL issues. Re-run. Do not push. |
| ✅ PASS | Zero CRITICAL findings | PR may be opened. HIGH/MEDIUM should be addressed during review. |

HIGH and MEDIUM findings alone never block. They are surfaced as PR review preparation, not merge gates.
