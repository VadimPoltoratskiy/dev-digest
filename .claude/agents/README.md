# DevDigest AI Agents

Custom Claude Code subagent definitions for the DevDigest project.
Each file in this directory defines a specialized agent invokable via the `Agent` tool with `subagent_type: "<name>"`.

## Workflow

```
                ┌──────────────┐
                │  researcher  │  ← codebase + web lookup
                └──────┬───────┘
                       │ research report
                       ▼
                ┌──────────────┐
                │   planner    │  ← reads all INSIGHTS.md + all domain skills
                └──────┬───────┘
                       │ PLAN.md
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   ┌────────────┐ ┌────────────┐ ┌────────────┐
   │implementer │ │implementer │ │implementer │  ← parallel, one per phase
   │  Phase 1   │ │  Phase 2   │ │  Phase 3   │
   └────────────┘ └────────────┘ └────────────┘
```

Phases that are independent can run in parallel. Phases with dependencies (e.g., Phase 2 needs the DB migration from Phase 1) must run sequentially.

## Agent reference

### `researcher`
**File:** `researcher.md`
**Model:** `claude-sonnet-4-6`
**Tools:** `Read, Bash, WebSearch, WebFetch`
**Skills:** none preloaded

Read-only information gatherer. Given a query, searches the codebase (grep/find/read) or the web (standard search + fetch) and returns a structured research report with cited sources. Includes an interview mode: if the query is vague, it asks up to 3 clarifying questions before researching. Never writes or modifies files.

**When to use:** Before planning, when the planner needs to understand an existing implementation or find external documentation. Can also be used directly when you need a focused lookup without a full planning cycle.

---

### `planner`
**File:** `planner.md`
**Model:** `claude-sonnet-4-6`
**Tools:** `Read, Bash, Write, Agent`
**Skills preloaded:** `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`, `ui-architecture`, `next-best-practices`, `react-best-practices`, `react-testing-library`, `typescript-expert`, `zod`, `security`

Development planner. Takes a feature/fix/refactor goal and produces a `PLAN.md` artifact with phased tasks, affected file paths, and a definition of done. Knows all 4 project modules and all domain skill constraints. Reads INSIGHTS.md files before planning. Delegates codebase and web research to the `researcher` subagent to keep its own context clean.

**When to use:** Before any non-trivial implementation. The planner ensures that implementers work from a consistent, architecturally-sound plan rather than making individual design decisions under time pressure.

---

### `implementer`
**File:** `implementer.md`
**Model:** `claude-sonnet-4-6`
**Tools:** `Read, Write, Edit, Bash`
**Skills preloaded:** `typescript-expert`, `zod`, `security`, `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`, `ui-architecture`, `next-best-practices`, `react-best-practices`, `react-testing-library`

Code implementer. Receives a `PLAN.md` and a phase assignment. Reads the module's INSIGHTS.md before starting. Applies the correct skill set based on the module being implemented (backend vs. frontend). Runs `pnpm test` after every task. Does not plan, research, or make scope decisions — stops and asks if something is unclear. Designed to run in parallel: spawn one implementer per independent plan phase.

**When to use:** After a PLAN.md exists. Spawn one instance per independent phase to parallelize implementation.

---

## Design principles

All agents in this directory are built on the following practices:

| Principle | Applied in | Source |
|---|---|---|
| `description` as concrete trigger condition, not generic label | All agents | [Builder.io — Claude Code Subagents](https://www.builder.io/blog/claude-code-subagents) |
| Tool minimalism — restrict to exactly what each agent needs | All agents | [Builder.io — Claude Code Subagents](https://www.builder.io/blog/claude-code-subagents) |
| `skills` frontmatter to preload domain knowledge at startup | planner, implementer | [Claude Code — Custom Subagents](https://code.claude.com/docs/en/sub-agents) |
| Durable file artifact (`PLAN.md`) as the handoff format | planner output | [Builder.io — Claude Code Subagents](https://www.builder.io/blog/claude-code-subagents) |
| Explicit Definition of Done embedded in system prompt | planner, implementer | [Builder.io — Claude Code Subagents](https://www.builder.io/blog/claude-code-subagents) |
| Orchestrator-Subagent: delegate research, don't inline it | planner → researcher | [Anthropic — Multi-Agent Coordination Patterns](https://claude.com/blog/multi-agent-coordination-patterns) |
| Fresh isolated context — all project knowledge in the system prompt | All agents | [Claude Code — Custom Subagents](https://code.claude.com/docs/en/sub-agents) |
| Decompose work by context requirements, not by work type | implementer (module-scoped) | [Anthropic — Multi-Agent Coordination Patterns](https://claude.com/blog/multi-agent-coordination-patterns) |
| Parallel execution — one implementer per independent phase | implementer | [Claudefa.st — Sub-Agent Best Practices](https://claudefa.st/blog/guide/agents/sub-agent-best-practices) |
| Interview mode before starting if scope is unclear | researcher, planner | Custom pattern |
| Module-scoped INSIGHTS.md reading before implementation | planner (all modules), implementer (own module) | Custom pattern for this project |
| Progressive disclosure — skills stay concise; details in companion files | skills in `.claude/skills/` | [Claude Code — Skills](https://code.claude.com/docs/en/skills) |

## Sources

- [Claude Code — Custom Subagents](https://code.claude.com/docs/en/sub-agents) — frontmatter schema, tool scoping, `skills` preloading, model selection, scope priority
- [Claude Code — Skills](https://code.claude.com/docs/en/skills) — skill invocation, `context: fork`, `when_to_use`, progressive disclosure, `disable-model-invocation`
- [Anthropic — Skill Authoring Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) — conciseness principle, degrees of freedom, description authoring rules, progressive disclosure structure
- [Anthropic — Multi-Agent Coordination Patterns](https://claude.com/blog/multi-agent-coordination-patterns) — Orchestrator-Subagent, Generator-Verifier, Agent Teams, context-centric decomposition
- [Builder.io — Claude Code Subagents](https://www.builder.io/blog/claude-code-subagents) — description routing heuristics, durable artifact outputs, tool minimalism, definition of done
- [Claudefa.st — Sub-Agent Best Practices](https://claudefa.st/blog/guide/agents/sub-agent-best-practices) — parallel vs. sequential decision rule, stateless-by-default pattern
