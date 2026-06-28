# pr-self-review Skill

**Version:** v1.0.0

---

## Focus

A mandatory pre-PR review gate. Before any pull request is opened against dev-digest, this skill reads the full diff between the current branch and `main`, detects which code surfaces changed, applies every domain skill relevant to those surfaces, and emits a **BLOCKED** or **PASS** verdict.

**BLOCKED = at least one CRITICAL finding.** PR must not be opened until all CRITICAL issues are resolved and a re-run produces PASS.

This skill contains only routing logic. The actual quality rules live in the six companion skills — this skill determines which of them to apply.

---

## What It Covers

- **Diff capture** — the exact `git diff` command that captures everything the PR would contain
- **Surface detection table** — maps every path prefix in the repo to a named surface (frontend routes, shared components, data hooks, backend modules, adapters, DB schema/migrations, shared contracts, reviewer-core)
- **Routing table** — maps active surfaces to the full set of companion skills that must be applied
- **Review priority order** — CRITICAL → HIGH → MEDIUM, so the most serious violations are found first
- **Citation requirement** — every finding must cite a real file path and diff line number; speculative findings are invalid (mirrors the grounding gate in `reviewer-core/src/grounding.ts`)
- **Report format** — structured output with surface summary, findings by severity, and a clear BLOCKED/PASS verdict
- **Verdict semantics** — CRITICAL blocks PR; HIGH/MEDIUM warn but do not block

---

## How to Invoke

Run explicitly before pushing or opening a PR:

```bash
# Typical usage — all commits on this branch not yet in main
git diff $(git merge-base main HEAD)..HEAD

# Or just ask Claude directly:
# /pr-self-review
# "run self review"
# "check my changes before PR"
# "pre-push review"
```

The skill reads the diff output, runs the review, and prints the report.

---

## Blocking Policy

| Severity | Effect |
|---|---|
| CRITICAL | **Blocks PR.** Fix all CRITICAL issues and re-run before pushing. |
| HIGH | Warning only. Must be addressed before merge is requested, but does not block PR creation. |
| MEDIUM | Suggestion. Address at your discretion during the PR review phase. |

---

## Use Cases

| Scenario | How the skill helps |
|---|---|
| Before opening a PR | Catches CRITICAL layer violations and structural issues before they reach reviewers |
| Mixed frontend + backend PR | Applies all six domain skills; no surface is skipped |
| PR touching DB schema | Automatically routes to `drizzle-orm-patterns` to catch hand-edited migrations |
| PR touching shared contracts | Flags vendor/shared sync issues between server and client |
| Reviewer-core change | Flags the change for manual inspection (no automated routing for review engine files) |

---

## Related Skills

| Skill | Role |
|---|---|
| [ui-architecture](../ui-architecture/SKILL.md) | File placement rules for `client/src/` — applied to all frontend surfaces |
| [react-best-practices](../react-best-practices/SKILL.md) | React component and hooks patterns — applied to all frontend surfaces |
| [react-testing-library](../react-testing-library/SKILL.md) | RTL test patterns — applied when test files are changed |
| [onion-architecture](../onion-architecture/SKILL.md) | Server layer placement and DI rules — applied to all backend surfaces |
| [fastify-best-practices](../fastify-best-practices/SKILL.md) | Fastify route/plugin patterns — applied when `server/src/modules/` changes |
| [drizzle-orm-patterns](../drizzle-orm-patterns/SKILL.md) | Drizzle query patterns — applied when `db/schema/` or `db/migrations/` changes |
| [engineering-insights](../engineering-insights/SKILL.md) | Workflow skill format reference (allowed-tools + checklist steps) |

---

## References

### reviewer-core — Grounding Gate
`dev-digest/reviewer-core/src/grounding.ts`
The citation requirement (every finding must reference a real diff line) mirrors `groundFindings()`. Uncited findings are dropped in the production review system; this skill applies the same rule locally.

### reviewer-core — Surface Routing Pattern
`dev-digest/reviewer-core/src/review/run.ts`
`reviewPullRequest()` routes based on diff structure (file count, size, mode). This skill replicates that routing logic at the Claude Code skill level.

### reviewer-core — Prompt Assembly
`dev-digest/reviewer-core/src/prompt.ts`
`assemblePrompt()` injects companion skill text via `PromptParts.skills`. The companion skills' SKILL.md content is the same text injected into production agents, making this skill's rules consistent with in-product behavior.

### engineering-insights Skill
`dev-digest/.claude/skills/engineering-insights/SKILL.md`
Reference for the `allowed-tools` + step-by-step checklist format used by workflow skills.

### Project Surface Conventions
`dev-digest/client/CLAUDE.md`, `dev-digest/server/CLAUDE.md`
Source for the path prefix conventions used in the surface detection table.
