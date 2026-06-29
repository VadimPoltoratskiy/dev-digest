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
          │            │            │
          └────────────┼────────────┘
                       │ implementation done
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
   │test-writer  │ │arch-reviewer│ │plan-verifier│  ← quality gate
   └─────────────┘ └─────────────┘ └─────────────┘
                                         │
                                         ▼
                                  ┌─────────────┐
                                  │ doc-writer  │  ← documentation
                                  └─────────────┘
```

Phases that are independent can run in parallel. Phases with dependencies (e.g., Phase 2 needs the DB migration from Phase 1) must run sequentially.

The quality gate agents (`test-writer`, `arch-reviewer`, `plan-verifier`) can all run in parallel after implementation. `doc-writer` runs last, once the implementation is verified.

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

### `test-writer`
**File:** `test-writer.md`
**Model:** `claude-sonnet-4-6`
**Tools:** `Read, Write, Bash`
**Skills preloaded:** `typescript-expert`, `zod`, `security`, `onion-architecture`, `fastify-best-practices`, `react-testing-library`

Test writer for all four packages. Writes Vitest unit and integration tests following the project's exact conventions: `.it.test.ts` suffix for DB integration tests, hermetic mocks via `server/src/adapters/mocks.ts`, React Testing Library for `client/` components, and pure engine tests for `reviewer-core/`. Extracts test intentions before writing any code. Never modifies source files.

**When to use:** When a module needs test coverage added or expanded. Spawn after implementation phases complete, or proactively when a file has no tests. Can run in parallel with `arch-reviewer` and `plan-verifier`.

---

### `arch-reviewer`
**File:** `arch-reviewer.md`
**Model:** `claude-opus-4-8`
**Tools:** `Read, Bash` (read-only — no write access)
**Skills preloaded:** `onion-architecture`, `ui-architecture`, `next-best-practices`, `react-best-practices`, `fastify-best-practices`, `security`, `typescript-expert`

Read-only architectural reviewer. Uses grep and file reads to gather structural evidence before asserting any violation. Checks onion-architecture layer boundaries, RSC boundaries, UI file placement, and security patterns. Reports findings in a fixed schema (severity / rule / file:line / evidence / recommendation / confidence). Suppresses low-confidence findings to stay under the 10% false-positive threshold. Never writes files.

**When to use:** After a code change to verify architectural integrity. Especially valuable before PRs that touch multiple layers. Can run in parallel with `test-writer` and `plan-verifier`.

---

### `plan-verifier`
**File:** `plan-verifier.md`
**Model:** `claude-sonnet-4-6`
**Tools:** `Read, Bash, Write`
**Skills preloaded:** `typescript-expert`

Adversarial plan verifier. Reads a `PLAN.md` and verifies task-by-task that every requirement was implemented, acceptance criteria are met (via grep/ls/test runs), and tests exist. Designed with adversarial incentives — assumes things are missing until external evidence proves otherwise. Produces a `VERIFICATION.md` report with per-task status and a PASS / GAPS FOUND verdict. Does not review code quality or style.

**When to use:** After an implementation phase is complete, before marking a phase done. Catches tasks that were skipped or only partially implemented. Can run in parallel with `test-writer` and `arch-reviewer`.

---

### `doc-writer`
**File:** `doc-writer.md`
**Model:** `claude-sonnet-4-6`
**Tools:** `Read, Write, Bash`
**Skills preloaded:** `mermaid-diagram`, `onion-architecture`, `ui-architecture`, `typescript-expert`

Documentation writer with three modes: (A) describe existing code by reading source files, (B) convert a `PLAN.md` into structured documentation, (C) convert any given input into documentation with Mermaid diagrams. Knows the project's documentation locations (`{module}/docs/`, `docs/`, module READMEs). Generates Mermaid diagrams (flowchart / sequence / state / ER) based on semantic triggers. Cites `file:line` for every factual claim about code. Never describes what it hasn't read.

**When to use:** After implementation is verified, to document what was built. Also useful for converting existing plans into documentation, or for generating architecture diagrams on demand.

---

## Design principles

All agents in this directory are built on the following practices:

| Principle | Applied in | Source |
|---|---|---|
| `description` as concrete trigger condition, not generic label | All agents | [Builder.io — Claude Code Subagents](https://www.builder.io/blog/claude-code-subagents) |
| Tool minimalism — restrict to exactly what each agent needs | All agents | [Builder.io — Claude Code Subagents](https://www.builder.io/blog/claude-code-subagents) |
| `skills` frontmatter to preload domain knowledge at startup | planner, implementer, test-writer, arch-reviewer, doc-writer | [Claude Code — Custom Subagents](https://code.claude.com/docs/en/sub-agents) |
| Durable file artifact (`PLAN.md`, `VERIFICATION.md`) as the handoff format | planner, plan-verifier output | [Builder.io — Claude Code Subagents](https://www.builder.io/blog/claude-code-subagents) |
| Explicit Definition of Done embedded in system prompt | planner, implementer, test-writer | [Builder.io — Claude Code Subagents](https://www.builder.io/blog/claude-code-subagents) |
| Orchestrator-Subagent: delegate research, don't inline it | planner → researcher | [Anthropic — Multi-Agent Coordination Patterns](https://claude.com/blog/multi-agent-coordination-patterns) |
| Fresh isolated context — all project knowledge in the system prompt | All agents | [Claude Code — Custom Subagents](https://code.claude.com/docs/en/sub-agents) |
| Decompose work by context requirements, not by work type | implementer (module-scoped) | [Anthropic — Multi-Agent Coordination Patterns](https://claude.com/blog/multi-agent-coordination-patterns) |
| Parallel execution — one implementer per independent phase | implementer | [Claudefa.st — Sub-Agent Best Practices](https://claudefa.st/blog/guide/agents/sub-agent-best-practices) |
| Interview mode before starting if scope is unclear | researcher, planner | Custom pattern |
| Module-scoped INSIGHTS.md reading before implementation | planner (all modules), implementer (own module), test-writer, arch-reviewer | Custom pattern for this project |
| Progressive disclosure — skills stay concise; details in companion files | skills in `.claude/skills/` | [Claude Code — Skills](https://code.claude.com/docs/en/skills) |
| Intention extraction before test generation | test-writer | [IntUT: Test Intention Guided LLM-Based Unit Test Generation — ICSE 2025](https://conf.researchr.org/details/icse-2025/icse-2025-research-track/242) |
| Evidence before assertion — grep before claiming a violation | arch-reviewer | [Tanagram — AI Agent Architecture Patterns for Code Review](https://www.tanagram.ai/blog/ai-agent-architecture-patterns-for-code-review-automation-the-complete-guide) |
| False positive suppression — report fewer, higher-confidence findings | arch-reviewer | [Graphite — Expected false-positive rate from AI code review tools](https://graphite.dev/guides/ai-code-review-false-positives) |
| Adversarial incentive design — verifier assumes gaps, not success | plan-verifier | [Augment Code — Spec-Driven Development](https://www.augmentcode.com/guides/what-is-spec-driven-development) |
| Generator-Verifier pattern — external tools (grep, test runner) over LLM judgment | plan-verifier | [arXiv — A Survey of Frontiers in LLM Reasoning](https://arxiv.org/pdf/2504.09037) |
| Semantic diagram triggers — choose diagram type from content | doc-writer | [mermaid.ai — From Claude to Mermaid: AI-generated diagrams](https://mermaid.ai/blog/posts/claude-to-mermaid-ai-generated-diagrams) |
| File:line citations for all code facts | doc-writer | [orchi.tech — The AI-Driven Documentation Engine](https://orchi.tech/en/blog/2026/03/24/the-ai-driven-documentation-engine-how-a-coordinated-team-of-ai-agents-produces-technical-documentation/) |
| Explicit write-destination rules — WHERE to output is in the system prompt | doc-writer | [IBM — AI Code Documentation: Benefits and Top Tips](https://www.ibm.com/think/insights/ai-code-documentation-benefits-top-tips) |

## Sources

- [Claude Code — Custom Subagents](https://code.claude.com/docs/en/sub-agents) — frontmatter schema, tool scoping, `skills` preloading, model selection, scope priority
- [Claude Code — Skills](https://code.claude.com/docs/en/skills) — skill invocation, `context: fork`, `when_to_use`, progressive disclosure, `disable-model-invocation`
- [Anthropic — Skill Authoring Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) — conciseness principle, degrees of freedom, description authoring rules, progressive disclosure structure
- [Anthropic — Multi-Agent Coordination Patterns](https://claude.com/blog/multi-agent-coordination-patterns) — Orchestrator-Subagent, Generator-Verifier, Agent Teams, context-centric decomposition
- [Builder.io — Claude Code Subagents](https://www.builder.io/blog/claude-code-subagents) — description routing heuristics, durable artifact outputs, tool minimalism, definition of done
- [Claudefa.st — Sub-Agent Best Practices](https://claudefa.st/blog/guide/agents/sub-agent-best-practices) — parallel vs. sequential decision rule, stateless-by-default pattern
- [IntUT: Test Intention Guided LLM-Based Unit Test Generation — ICSE 2025](https://conf.researchr.org/details/icse-2025/icse-2025-research-track/242) — intention extraction before test generation (+94% branch coverage)
- [Airwallex Engineering — From 2 weeks to 2 hours](https://medium.com/airwallex-engineering/how-we-used-claude-code-subagents-to-cut-integration-testing-from-2-weeks-to-2-hours-8a19ed7793f8) — specialist agents by test category, proprietary convention preloading
- [OpenObserve — Autonomous QA Testing with AI Agents](https://openobserve.ai/blog/autonomous-qa-testing-ai-agents-claude-code/) — explicit guardrails (must-NOT constraints) in system prompts
- [Tanagram — AI Agent Architecture Patterns for Code Review](https://www.tanagram.ai/blog/ai-agent-architecture-patterns-for-code-review-automation-the-complete-guide) — deterministic evidence before AI assertion (85%+ accuracy)
- [Graphite — Expected false-positive rate from AI code review tools](https://graphite.dev/guides/ai-code-review-false-positives) — 10% false-positive threshold for developer trust
- [Augment Code — Spec-Driven Development](https://www.augmentcode.com/guides/what-is-spec-driven-development) — adversarial verifier incentives, specification as executable contract
- [arXiv — A Survey of Frontiers in LLM Reasoning](https://arxiv.org/pdf/2504.09037) — Generator-Verifier and Generator-Critic-Refiner patterns
- [aqua cloud — AI Requirement Traceability Best Practices](https://aqua-cloud.io/ai-requirement-traceability/) — bidirectional traceability, orphan detection
- [mermaid.ai — From Claude to Mermaid: AI-generated diagrams](https://mermaid.ai/blog/posts/claude-to-mermaid-ai-generated-diagrams) — semantic diagram type triggers
- [orchi.tech — The AI-Driven Documentation Engine](https://orchi.tech/en/blog/2026/03/24/the-ai-driven-documentation-engine-how-a-coordinated-team-of-ai-agents-produces-technical-documentation/) — file:line citation requirement for factual accuracy
- [IBM — AI Code Documentation: Benefits and Top Tips](https://www.ibm.com/think/insights/ai-code-documentation-benefits-top-tips) — explicit write-destination documentation in agent prompts
