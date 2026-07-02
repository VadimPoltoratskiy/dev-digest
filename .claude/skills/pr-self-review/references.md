# PR Self-Review — References

Sources used during the creation of this skill.

---

## Project-Internal Sources

### reviewer-core — Grounding Gate
- **Path:** `dev-digest/reviewer-core/src/grounding.ts`
- **Relevance:** The citation requirement in Step 4 of this skill mirrors the mandatory grounding gate in `groundFindings()`. In the production system, any finding that cannot be tied to a real line in the diff is dropped silently. This skill applies the same discipline locally: uncited findings are invalid and must not be reported.

### reviewer-core — Surface Routing Pattern
- **Path:** `dev-digest/reviewer-core/src/review/run.ts`
- **Relevance:** `reviewPullRequest()` selects between single-pass and map-reduce mode based on diff size and file count, then routes to the appropriate executor. The surface detection and per-surface skill routing in this skill replicates that logic at the Claude Code skill level — diff in → classify → apply per surface → merge results.

### reviewer-core — Prompt Assembly
- **Path:** `dev-digest/reviewer-core/src/prompt.ts`
- **Relevance:** `assemblePrompt()` injects skill text via `PromptParts.skills`. Understanding this slot clarifies why the companion skills' SKILL.md content is the canonical source of review rules: the same text injected into the production agent is what this skill reads during local review.

### engineering-insights — Workflow Skill Format
- **Path:** `dev-digest/.claude/skills/engineering-insights/SKILL.md`
- **Relevance:** Reference for the `allowed-tools` + checklist-step format used by workflow skills (as opposed to knowledge reference skills that use `user-invocable: false`).

### client/CLAUDE.md and server/CLAUDE.md
- **Paths:** `dev-digest/client/CLAUDE.md`, `dev-digest/server/CLAUDE.md`
- **Relevance:** Source for the surface path conventions used in the surface detection table (Step 2).

---

## Companion Skills Referenced

The six domain skills whose Anti-Patterns sections are applied in Step 4:

| Skill | Path |
|---|---|
| `ui-architecture` | `.claude/skills/ui-architecture/SKILL.md` |
| `react-best-practices` | `.claude/skills/react-best-practices/SKILL.md` |
| `react-testing-library` | `.claude/skills/react-testing-library/SKILL.md` |
| `onion-architecture` | `.claude/skills/onion-architecture/SKILL.md` |
| `fastify-best-practices` | `.claude/skills/fastify-best-practices/SKILL.md` |
| `drizzle-orm-patterns` | `.claude/skills/drizzle-orm-patterns/SKILL.md` |
