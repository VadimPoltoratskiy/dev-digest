# DevDigest AI Agents

Custom Claude Code subagent definitions for the DevDigest project.
Each file in this directory defines a specialized agent invokable via the `Agent` tool with `subagent_type: "<name>"`.

## Workflow

```
                      ┌──────────────┐
                      │ spec-creator │  ← EARS acceptance criteria, gap analysis,
                      │  (optional)  │    traceability, verification, self-check
                      └──────┬───────┘
                     (optional, ad hoc, own invocations)
                       ┌─────┴──────┐
                       ▼            ▼
                ┌──────────────┐ ┌──────────────┐
                │  brainstorm  │ │  researcher  │  ← behavioral/UX ambiguities
                │ (weigh opts) │ │ (facts/docs) │     / factual sub-questions
                └──────────────┘ └──────────────┘
                             │ SPEC-NN.md
          ┌──────────────┐        ┌──────────────┐
          │  brainstorm  │        │  researcher  │  ← codebase + web lookup
          │ (weigh opts) │        └──────┬───────┘
          └──────┬───────┘               │ research report
                 │ options + recommendation
                 └───────────┬───────────┘
                             ▼
              ┌───────────────────────────┐
              │  implementation-planner    │  ← reads all INSIGHTS.md; typescript-expert/
              └──────────────┬─────────────┘    zod/security preloaded, rest read on demand
                             │ PLAN.md
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
   ┌────────────┐     ┌────────────┐     ┌────────────┐
   │implementer │     │implementer │     │implementer │  ← parallel, one per phase
   │  Phase 1   │     │  Phase 2   │     │  Phase 3   │
   └────────────┘     └────────────┘     └────────────┘
          │                  │                  │
          └──────────────────┼──────────────────┘
                             │ implementation done
   ┌──────────────┬──────────┴───────────┬───────────────────┐
   ▼              ▼                      ▼                   ▼
┌─────────────┐┌───────────────────────┐┌───────────────┐┌───────────────────┐
│ test-writer ││ architecture-reviewer ││ plan-verifier ││ security-reviewer │  ← quality gate
└─────────────┘└───────────────────────┘└───────────────┘└───────────────────┘
                             │
                             ▼
                      ┌─────────────┐
                      │ doc-writer  │  ← documentation
                      └─────────────┘
```

`spec-creator` is an optional first step: for a feature where requirements aren't already unambiguous, it turns the request into a `SPEC-NN.md` with EARS-formatted acceptance criteria, architecture/workflow diagrams, service contracts, and tagged input provenance — leaving anything unresolved as `[NEEDS CLARIFICATION]`, and never any implementation detail. `brainstorm` runs before `implementation-planner` on non-trivial or ambiguous work to weigh solution options; `researcher` gathers facts. Either or both can feed the planner. `implementation-planner` reads the spec (if one exists) as ground truth for WHAT the feature does, reviews it for feasibility/architecture fit, adds its own recommendations, and asks whether to run single-agent or multi-agent execution before producing `PLAN.md` — it never writes specs itself. In multi-agent mode, phases that are independent can run in parallel; phases with dependencies (e.g., Phase 2 needs the DB migration from Phase 1) must run sequentially.

The quality gate agents (`test-writer`, `architecture-reviewer`, `plan-verifier`, `security-reviewer`) can all run in parallel after implementation. `doc-writer` runs last, once the implementation is verified.

## `/implement` command

`.claude/commands/implement.md` automates the loop from an existing `PLAN.md` through
implementation and the mechanical/architectural quality gate: `implementer`(s) →
`plan-verifier` (cheap, mechanical, runs first — fail fast on missing work before
spending tokens on a qualitative review) → `architecture-reviewer` (now on Sonnet).
Each gate re-spawns `implementer` to fix what it flagged and re-checks, up to a
capped number of iterations, then stops and reports if still unresolved.
`spec-creator` and `implementation-planner` are **not** part of this command — they
stay manual, separate invocations, run before a `PLAN.md` exists. `test-writer`,
`security-reviewer`, and `doc-writer` are also **not** invoked automatically by this
command — run them manually as separate follow-ups.

## Agent reference

### `spec-creator`
**File:** `spec-creator.md`
**Model:** `claude-sonnet-4-6`
**Tools:** `Read, Bash, Write, Edit, Agent`
**Skills preloaded:** `onion-architecture`, `ui-architecture`, `fastify-best-practices`, `next-best-practices`, `security`, `zod`, `mermaid-diagram`

Specification writer for Spec-Driven Development. Given a feature/fix/refactor request scoped to one module, reads that module's `insights/INSIGHTS.md`/`docs/README.md`/`AGENTS.md` plus the relevant source and shared Zod contracts (and, when a feature genuinely crosses module boundaries, the other module's `insights/INSIGHTS.md` too), then produces a `SPEC-NN-<slug>.md` using a fixed template: Problem/why, Goals/Non-goals, User stories, EARS-formatted Acceptance criteria (`AC-N` IDs), Edge cases, Non-functional, Architecture & workflows, Service contracts, tagged Inputs (provenance), Untrusted inputs, a `Traceability` table (`AC-N` → evidence), a `Verification` section (per-AC check recipe), and open `[NEEDS CLARIFICATION]` items. Can delegate to `researcher` (parallel instances for independent factual sub-questions) and `brainstorm` (genuine behavioral/UX ambiguities only — never implementation choices). Runs a mandatory gap-analysis pass plus a final mechanical self-check before finalizing. Write/Edit are scoped by prose guardrails to the target module's specs folder (`server/specs/`, `client/specs/`, `reviewer-core/specs/`, or `e2e/requirement-specs/` — never `e2e/specs/`, which holds test-flow JSON) — or root `specs/` for the rare feature with no single owning module. Never resolves a genuine ambiguity itself; always surfaces it instead.

**When to use:** Before `brainstorm`/`implementation-planner`, on any feature where requirements aren't already unambiguous and testable. Its `SPEC-NN.md` output is read directly by `implementation-planner` the same way a `brainstorm` recommendation feeds it.

---

### `researcher`
**File:** `researcher.md`
**Model:** `claude-sonnet-4-6`
**Tools:** `Read, Bash, WebSearch, WebFetch`
**Skills:** none preloaded

Read-only information gatherer. Given a query, searches the codebase (grep/find/read) or the web (standard search + fetch) and returns a structured research report with cited sources. Includes an interview mode: if the query is vague, it asks up to 3 clarifying questions before researching. Never writes or modifies files.

**When to use:** Before planning, when `implementation-planner` needs to understand an existing implementation or find external documentation. Can also be used directly when you need a focused lookup without a full planning cycle.

---

### `brainstorm`
**File:** `brainstorm.md`
**Model:** `claude-sonnet-4-6`
**Tools:** `Read, Bash, WebSearch, WebFetch`
**Skills preloaded:** `onion-architecture`, `ui-architecture`, `typescript-expert`, `security`

Read-only solution-options generator. Given a goal, does a brief grounding pass over the affected code and constraints, then produces 2–4 materially distinct approaches, scores them against fixed criteria (architecture fit, complexity, risk, performance, security surface, testability, reversibility) in a comparison matrix, and recommends one — naming the trade-off being accepted. Includes an interview mode for vague goals. Feeds its report to `implementation-planner`. Never writes files.

**When to use:** Before planning, on any non-trivial or ambiguous change where the design isn't obvious and it's worth weighing alternatives before committing. Its output becomes input to `implementation-planner`.

---

### `implementation-planner`
**File:** `implementation-planner.md`
**Model:** `claude-sonnet-4-6`
**Tools:** `Read, Bash, Write, Agent`
**Skills preloaded:** `typescript-expert`, `zod`, `security` (the remaining domain skills — `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`, `ui-architecture`, `next-best-practices`, `react-best-practices`, `react-testing-library` — are read on demand via `Read`, scoped to whichever module(s) the task actually touches, to avoid preloading tokens for modules a given task doesn't touch)

Implementation planner — the HOW, never the WHAT. Reads a `SPEC-NN.md` (if one exists, checking root `specs/` too for the rare no-single-owner feature) as ground truth for goals/acceptance-criteria/architecture-workflows/service-contracts, reviews it for implementation feasibility and architecture fit, surfaces its own recommendations, asks the user to resolve any open `[NEEDS CLARIFICATION]` items, and always asks whether to run single-agent (one implementer, sequential) or multi-agent (parallel implementers per phase) mode before producing `PLAN.md` with phased tasks, affected file paths, and a definition of done. If no spec exists, it can still plan directly from the request via a lightweight interview, but never formalizes goals/acceptance-criteria into a spec itself — that's `spec-creator`'s job. Knows all 4 project modules and all domain skill constraints. Reads each module's `insights/INSIGHTS.md` before planning. Delegates codebase and web research to the `researcher` subagent to keep its own context clean. Read-only with respect to every module's `specs/`/`requirement-specs/` folder (and root `specs/`).

**When to use:** Before any non-trivial implementation, ideally after `spec-creator` has produced a `SPEC-NN.md`. Ensures implementers work from a consistent, architecturally-sound plan rather than making individual design decisions under time pressure.

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

**When to use:** When a module needs test coverage added or expanded. Spawn after implementation phases complete, or proactively when a file has no tests. Can run in parallel with `architecture-reviewer` and `plan-verifier`.

---

### `architecture-reviewer`
**File:** `architecture-reviewer.md`
**Model:** `claude-sonnet-4-6`
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

**When to use:** After an implementation phase is complete, before marking a phase done. Catches tasks that were skipped or only partially implemented. Can run in parallel with `test-writer` and `architecture-reviewer`.

---

### `security-reviewer`
**File:** `security-reviewer.md`
**Model:** `claude-sonnet-4-6`
**Tools:** `Read, Bash, WebSearch, WebFetch`
**Skills preloaded:** `security`, `typescript-expert`, `fastify-best-practices`, `drizzle-orm-patterns`, `zod`, `next-best-practices`

Read-only security reviewer that audits a **git diff**. Acquires the diff (provided, or via `git diff` / `--staged` / `main...HEAD`), traces untrusted input from source to sink, and checks it against the OWASP Top 10 plus injection, auth bypass, secret leakage, SSRF, and the AI lethal-trifecta (classified conservatively). Uses web lookups for dependency CVEs. Reports findings in a fixed schema (severity / kind / category / file:line / evidence / exploit path / recommendation / confidence) and emits a merge verdict (`request_changes` / `comment` / `approve`) that is a pure function of the findings. Never writes files.

**When to use:** After a code change, especially before a PR that touches request handling, DB queries, auth, secrets, or dependencies. Can run in parallel with `test-writer`, `architecture-reviewer`, and `plan-verifier`.

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
| `skills` frontmatter to preload domain knowledge at startup | implementation-planner, implementer, test-writer, architecture-reviewer, security-reviewer, brainstorm, doc-writer, spec-creator | [Claude Code — Custom Subagents](https://code.claude.com/docs/en/sub-agents) |
| Durable file artifact (`SPEC-NN.md`, `PLAN.md`, `VERIFICATION.md`) as the handoff format | spec-creator, implementation-planner, plan-verifier output | [Builder.io — Claude Code Subagents](https://www.builder.io/blog/claude-code-subagents) |
| Explicit Definition of Done embedded in system prompt | implementation-planner, implementer, test-writer | [Builder.io — Claude Code Subagents](https://www.builder.io/blog/claude-code-subagents) |
| Orchestrator-Subagent: delegate research, don't inline it | implementation-planner → researcher | [Anthropic — Multi-Agent Coordination Patterns](https://claude.com/blog/multi-agent-coordination-patterns) |
| Fresh isolated context — all project knowledge in the system prompt | All agents | [Claude Code — Custom Subagents](https://code.claude.com/docs/en/sub-agents) |
| Decompose work by context requirements, not by work type | implementer (module-scoped) | [Anthropic — Multi-Agent Coordination Patterns](https://claude.com/blog/multi-agent-coordination-patterns) |
| Parallel execution — one implementer per independent phase, user chooses single- vs. multi-agent mode | implementer, implementation-planner | [Claudefa.st — Sub-Agent Best Practices](https://claudefa.st/blog/guide/agents/sub-agent-best-practices) |
| Interview mode before starting if scope is unclear | researcher, implementation-planner, brainstorm, spec-creator | Custom pattern |
| Divergent option generation + scored trade-off matrix before committing | brainstorm | [Anthropic — Multi-Agent Coordination Patterns](https://claude.com/blog/multi-agent-coordination-patterns) |
| Module-scoped INSIGHTS.md reading before implementation | implementation-planner (all modules), implementer (own module), test-writer, architecture-reviewer | Custom pattern for this project |
| Separation of WHAT (spec) from HOW (plan) — downstream agent reads upstream artifact as ground truth, never redefines it | spec-creator → implementation-planner | [Augment Code — Spec-Driven Development](https://www.augmentcode.com/guides/what-is-spec-driven-development) |
| Progressive disclosure — skills stay concise; details in companion files | skills in `.claude/skills/` | [Claude Code — Skills](https://code.claude.com/docs/en/skills) |
| Intention extraction before test generation | test-writer | [IntUT: Test Intention Guided LLM-Based Unit Test Generation — ICSE 2025](https://conf.researchr.org/details/icse-2025/icse-2025-research-track/242) |
| Evidence before assertion — grep before claiming a violation | architecture-reviewer, security-reviewer | [Tanagram — AI Agent Architecture Patterns for Code Review](https://www.tanagram.ai/blog/ai-agent-architecture-patterns-for-code-review-automation-the-complete-guide) |
| False positive suppression — report fewer, higher-confidence findings | architecture-reviewer, security-reviewer | [Graphite — Expected false-positive rate from AI code review tools](https://graphite.dev/guides/ai-code-review-false-positives) |
| Source-to-sink taint tracing over OWASP Top 10; conservative lethal-trifecta classification | security-reviewer | [OWASP — Top Ten](https://owasp.org/www-project-top-ten/) |
| Verdict as a pure function of findings (no request_changes without a CRITICAL) | security-reviewer | Custom pattern for this project |
| Adversarial incentive design — verifier assumes gaps, not success | plan-verifier | [Augment Code — Spec-Driven Development](https://www.augmentcode.com/guides/what-is-spec-driven-development) |
| Specification as an executable contract, generated up front — EARS syntax forces trigger/state/response instead of vague prose | spec-creator | [Augment Code — Spec-Driven Development](https://www.augmentcode.com/guides/what-is-spec-driven-development) |
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
