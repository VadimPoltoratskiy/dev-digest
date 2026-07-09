# Cross-model review: PLAN.md (Why+Risk Brief)

**Reviewer:** `openai/gpt-4o` via OpenRouter (`OPENROUTER_API_KEY` from `server/.env`), invoked cold with only `SPEC-01-why-risk-brief.md` and `PLAN.md` as context — no access to the orchestrating chat session.
**Usage:** 13,445 prompt tokens / 706 completion tokens.
**Prompt:** "staff engineer reviewing this plan cold... look for architecture mistakes, missed edge cases, security issues (especially prompt injection), test coverage gaps, migration safety issues, and internal inconsistencies between spec and plan."

## Raw verdict

> Overall, the plan does an impressive job outlining the implementation strategy... takes into account key architectural boundaries, prompt injection handling, workspace access controls, cache considerations, database migration strategies, and cross-module integration. However, there are some issues to address before execution.

## Findings and disposition

| # | Severity (as rated) | Finding | Disposition |
|---|---|---|---|
| 1 | Blocker | Rate limiting mentioned in Recommendations but claimed "not incorporated into the server implementation details" | **False positive — already addressed.** `PLAN.md`'s Phase A `routes.ts` task explicitly specifies `rate limit config { max: 10, timeWindow: '1 minute' }` on `POST /pulls/:id/brief` (not just the Recommendations section the reviewer was quoting). No plan change needed; the reviewer read the Recommendations note but missed its restatement in the Tasks section. |
| 2 | Warning | Wants an explicit demonstration of untrusted-input labeling in the prompt assembly | **Already addressed.** Architecture Decisions § "Prompt budget and slot assembly order" gives a concrete label example (`=== PR BODY (untrusted author content) ===`) and states every untrusted slot is wrapped this way. No plan change needed. |
| 3 | Warning | Telemetry/observability logs should have a "redundancy/fallback" mechanism | **Accepted as out of scope.** This project's existing INFO/WARN logging convention (mirrored from `intent-classifier.ts`/`blast/service.ts`) has no such redundancy layer anywhere else in the codebase; adding one here would be inconsistent with established patterns and beyond this feature's scope. Not applied. |
| 4 | Nit | No build-time check that the server/client `brief.ts` contract copies stay in sync, beyond `pnpm typecheck` | **Valid, real gap — genuinely useful catch.** The plan already flags this as a Gotcha ("no build-time enforcement of parity"), but relying solely on independent `tsc` runs in two packages is weaker than a single equality check. **Accepted as a follow-up**, not blocking this plan: worth a future lightweight test asserting both `Brief` Zod schemas serialize to identical JSON Schema, but out of scope for this feature's Phase C given the existing project convention (Intent/Blast/SmartDiff contracts already rely on the same manual-mirror + typecheck pattern with no such test). |
| 5 | Nit | `DEFAULT now()` (DB clock) vs. `new Date()` (app clock) could disagree slightly | **Accepted, negligible.** `generatedAt` is a display/cache-freshness timestamp, not used for any ordering-sensitive business logic; sub-second DB/app clock skew has no functional impact. Not applied. |
| 6 | Nit | Consider network/resource-constraint edge cases for LLM calls | **Already covered.** Plan's "LLM failure handling" section already routes any `completeStructured()` exception (including network failures) to `BadGatewayError` (502) without touching the cache — this is the general failure path, no separate case needed. |
| 7 | Nit | Consider downstream impact of null/absent intent fields | **Already covered by AC-9** ("no intent row" degraded-path test in Phase C) — explicitly designed for and tested. |
| 8 | Nit | Add more inline rationale/comments for architectural choices | Stylistic; not applied — `PLAN.md`'s Architecture Decisions section already states rationale for each nontrivial choice (e.g., the `generated_at` default deviation is explained in-line). |

## Net assessment

One real, useful catch (#4 — no automated parity check between the two contract mirrors, beyond typecheck), matching an existing project-wide pattern rather than a defect unique to this plan. The "blocker" (#1) and two "warnings" (#2, #3) were reviewer misses or scope calls, not plan defects. No revision to `PLAN.md` was made as a result of this review; `implementation-planner` was not re-invoked. Proceeding to `/implement PLAN.md`.
