# Plan: Eval Pipeline for Reviewer Agents

## Spec reference
`specs/SPEC-02-eval-pipeline.md` (approved ground truth; read in full before implementing any task).

## Execution mode: multi-agent
Multi-agent mode. The task description strongly recommended it, and the surface area justifies it: contracts, server business logic, and client UI are independently implementable once the Phase 1 contract work is done. Phase 2A (server) and Phase 2B (client lib) can run in parallel after Phase 1. Phase 3 (client UI) follows Phase 2B. Phase 4 (tests) follows Phase 2A + Phase 3.

## Goal
Build a regression-testing pipeline for DevDigest reviewer agents. Users turn accepted or dismissed findings into eval cases (`must_find` / `must_not_flag`) via a new "Turn into eval case" button on FindingCard, run the agent against its full case set in one action, and get deterministic recall/precision/citation_accuracy scores (zero LLM-as-judge — pure file:line matching + the existing citation-grounding gate). An Agent Editor Evals tab shows case list, run history, and a two-run comparison view. A global `/evals` dashboard shows cross-agent aggregate metrics and trend data.

## Modules affected
- `server/` — new eval-case + eval-run routes extend `modules/agents/`; new finding-to-eval-case route extends `modules/reviews/`; new `modules/evals/` handles the global dashboard; `vendor/shared/contracts/knowledge.ts` gains 9 new exports
- `client/` — `vendor/shared/contracts/knowledge.ts` mirror; `lib/api.ts`; new `lib/hooks/agents-eval.ts`; FindingCard gets a new button; AgentEditor gains an Evals tab; new `/evals` dashboard page

## Engineering Insights applied
- **`.nullish()` vs `.nullable()` for new contract fields** (server/INSIGHTS.md 2026-06-25): `AgentEvalCase.latest_run` uses `.nullish()` because it is absent until a run exists. Batch result metrics use `.nullable()` because the service always returns a value (even if null when a metric category has no cases). This mirrors the `cost_usd` precedent in RunSummary.
- **Both vendor/shared copies must change in lockstep** (client/INSIGHTS.md 2026-06-25): `client/src/vendor/shared/contracts/knowledge.ts` is a manual mirror of `server/src/vendor/shared/contracts/knowledge.ts`. Phase 1 updates both files as a single atomic step; no tooling enforces sync — only tsc catches drift.
- **Test fixtures must include all required contract fields** (client/INSIGHTS.md 2026-07-06): any new required field on `AgentEvalCase` or `AgentEvalBatchResult` must be added to every hardcoded fixture in test files. All new types use `.nullish()` or `.nullable()` for optional fields to avoid TS2741 on test fixtures.
- **MockLLMProvider validates fixtures against real Zod schemas** (server/INSIGHTS.md 2026-07-06): integration test fixtures for findings must use valid `FindingCategory` enum values (`bug`, `security`, `perf`, `style`, `test`) to avoid swallowed errors in `reviewPullRequest`.
- **Cost computed at read time from run columns** (server/INSIGHTS.md 2026-06-25): eval run cost is stored in `eval_runs.cost_usd` directly from `reviewPullRequest`'s `costUsd`; no PriceBook estimate needed (unlike agent_runs which lack stored cost).
- **`parseUnifiedDiff` is used by both skills and agents eval** — move it from `modules/skills/helpers.ts` to `modules/_shared/diff-helpers.ts` and update the skills import; the agents eval service imports from `_shared`.

## Recommendations
- **Extend `modules/agents/` rather than creating `modules/eval-agent/`** — the direct precedent is skills eval living inside `modules/skills/`. This avoids a second module registration for routes that are semantically owned by the agents domain. The global dashboard (`/evals/dashboard`) goes in a new `modules/evals/` because it is workspace-scoped across all agents and belongs to no single agent.
- **Define `AgentEvalBatchResult` instead of extending `EvalRun`** — `EvalRun.recall/precision/citation_accuracy` are currently required non-nullable (`z.number().min(0).max(1)`). The spec requires nullable metrics when a batch has no `must_find` or `must_not_flag` cases. Changing `EvalRun` would be a non-backward-compatible type change. Defining a parallel `AgentEvalBatchResult` with `.nullable()` metrics and an added `ran_at` field is cleaner and leaves `EvalRun` untouched (it is used by skills eval with different semantics).
- **Define `AgentEvalCase` instead of extending `EvalCase`** — same logic as above: `SkillEvalCase` is a parallel type, not an extension of `EvalCase`. Follow the same pattern.
- **`rangesOverlap` defined locally in `eval-scorer.ts`** — `reviewer-core/src/grounding.ts` has `rangeIntersects` but it is not exported from `@devdigest/reviewer-core`'s public surface. Defining the trivial two-line function locally (`Math.max(s1,s2) <= Math.min(e1,e2)`) avoids an import from a different package for a utility that is pure math.
- **`EvalDashboard` reused as-is** — the spec marks it as "contracts to reuse without modification". Its `current.recall` is a required `z.number()`. When there are no eval runs, the service returns `0.0` for all numeric metrics rather than `null`, satisfying the non-nullable contract.
- **`POST /findings/:id/eval-case` goes in `modules/reviews/routes.ts`** — findings action routes (`/findings/:id/accept`, `/findings/:id/dismiss`) already live there. This route follows the same shape: finding ID as route param, service call, 422/404 errors via `ValidationError`/`NotFoundError`.

## Architecture decisions

- **Onion layer compliance** (onion-architecture SKILL.md): scoring logic (`eval-scorer.ts`) is a pure TS module with no DB access — it belongs in the service layer as a helper, not in repository or routes. The service orchestrates: load cases → call `reviewPullRequest` → call scorer → insert rows → update batch metrics.
- **`getContext()` on every new route** (onion-architecture SKILL.md anti-patterns): every handler in `modules/agents/routes.ts`, `modules/reviews/routes.ts`, and `modules/evals/routes.ts` must call `getContext(app.container, req)` before delegating to the service. Missing this breaks multi-tenant scoping.
- **Route ordering for `/compare`** (fastify-best-practices): `GET /agents/:id/eval-runs/compare` must be registered **before** `GET /agents/:id/eval-runs` in `routes.ts` to prevent Fastify's static-before-parametric rule from silently capturing `/compare` as a run-id segment. Similarly, `POST /agents/:id/eval-runs` (trigger batch) must be registered before `GET /agents/:id/eval-runs` (list batches) to avoid any ambiguity.
- **Batch `ran_at` as a single `Date` instance** (AC-11): `const ranAt = new Date()` is captured once at the start of `runAgentEvalBatch()` and passed to every `insertEvalRun` call. This is the batch identity key used by the compare endpoint query (`WHERE ran_at = $ranAt`).
- **Agent config snapshotted once at batch start** (AC-11, edge case 5): provider, model, system_prompt, strategy, and skill bodies are read from the DB once before the loop. Concurrent `PUT /agents/:id` calls do not affect an in-flight batch.
- **Per-case error isolation** (AC-12): the case loop uses `try/catch`; on error, the case row is inserted with `pass=false` and the error message in `actual_output`; the loop continues. This mirrors `SkillsService.runAllEvalCases`.
- **`input_diff` through `reviewPullRequest` only** (security spec, `reviewer-core-ground-findings-gate`): the eval harness must call `reviewPullRequest(...)` with the case's `input_diff` as the diff argument — never pass `input_diff` to an LLM directly. The `assemblePrompt` + injection-guard path inside `reviewPullRequest` is the architectural enforcer.
- **`actual_output` rendered as escaped text** (security spec, A05 XSS): LLM-generated content stored in `eval_runs.actual_output` must be rendered as text in the client — no `dangerouslySetInnerHTML`.
- **FindingCard stays presentational** (ui-architecture SKILL.md): FindingCard does not call hooks directly. A new `onCreateEvalCase?: () => void` prop is added; the parent PR detail page wires up the mutation via `useTurnFindingIntoEvalCase()` hook and passes a bound callback.
- **`/evals` module registration** (onion-architecture SKILL.md step 2+3): new `modules/evals/routes.ts` exports a default Fastify plugin; it is added to `modules/index.ts` as a named entry; `app.ts` already registers all modules via `for (const plugin of Object.values(modules))` so no `app.ts` change is needed beyond the module registry.

---

## Tasks

### Phase 1: Zod Contracts (prerequisite — all other phases depend on this)

One implementer, sequential. Both vendor files must be updated in the same commit.

- [ ] `server/src/vendor/shared/contracts/knowledge.ts` — add 9 new exports at the bottom of the `// ---- Eval ----` section (after the existing `EvalCase` block, before `// ---- Memory ----`). Do NOT modify any existing type. New exports:
  - `AgentEvalExpectedFinding` — `z.object({ file, start_line, end_line, title, severity, category })` (all `z.string()`/`z.number().int()`)
  - `AgentEvalExpectedOutput` — `z.object({ kind: z.enum(['must_find','must_not_flag']), finding: AgentEvalExpectedFinding })`
  - `AgentEvalLatestRun` — `z.object({ pass: z.boolean().nullable(), ran_at: z.string() })`
  - `AgentEvalCase` — `z.object({ id, agent_id, name, notes: z.string().nullish(), input_diff: z.string(), expected_output: AgentEvalExpectedOutput, latest_run: AgentEvalLatestRun.nullish() })`
  - `AgentEvalPerTrace` — `z.object({ case_id: z.string(), case_name: z.string(), kind: z.enum(['must_find','must_not_flag']), pass: z.boolean(), expected_output: AgentEvalExpectedOutput, actual_findings: z.array(z.unknown()), error: z.string().nullish() })`
  - `AgentEvalBatchResult` — `z.object({ ran_at: z.string(), recall: z.number().nullable(), precision: z.number().nullable(), citation_accuracy: z.number().nullable(), traces_passed: z.number().int(), traces_total: z.number().int(), duration_ms: z.number().int(), cost_usd: z.number().nullable(), per_trace: z.array(AgentEvalPerTrace) })`
  - `AgentEvalCompareRun` — `z.object({ ran_at: z.string(), recall: z.number().nullable(), precision: z.number().nullable(), citation_accuracy: z.number().nullable(), cost_usd: z.number().nullable() })`
  - `AgentEvalFlip` — `z.object({ case_id: z.string(), case_name: z.string(), from_pass: z.boolean(), to_pass: z.boolean() })`
  - `AgentEvalCompare` — `z.object({ run_a: AgentEvalCompareRun, run_b: AgentEvalCompareRun, deltas: z.object({ recall: z.number().nullable(), precision: z.number().nullable(), citation_accuracy: z.number().nullable(), cost_usd: z.number().nullable() }), flips: z.array(AgentEvalFlip) })`
  - Export the corresponding `type` alias for each (e.g., `export type AgentEvalCase = z.infer<typeof AgentEvalCase>`)

- [ ] `client/src/vendor/shared/contracts/knowledge.ts` — apply the exact same additions as the server file above. Both files must be character-for-character identical in the new block.

---

### Phase 2A: Server routes + service + repository (parallel with Phase 2B)

One implementer, sequential within this phase. Depends on Phase 1.

#### Step A1 — Shared diff-parse helper (refactor prerequisite)

- [ ] `server/src/modules/_shared/diff-helpers.ts` — create new file; move the `parseUnifiedDiff` function from `server/src/modules/skills/helpers.ts` to here; export it.
- [ ] `server/src/modules/skills/helpers.ts` — replace the local `parseUnifiedDiff` definition with an import from `'../_shared/diff-helpers.js'`. Ensure existing skills tests still pass.

#### Step A2 — Eval scorer (pure deterministic functions, no DB/HTTP)

- [ ] `server/src/modules/agents/eval-scorer.ts` — create new file with the following pure exports (no imports from DB or adapters):
  - `rangesOverlap(s1: number, e1: number, s2: number, e2: number): boolean` — returns `Math.max(s1, s2) <= Math.min(e1, e2)` (line range intersection matching AC-8/AC-9 semantics)
  - `scoreMustFind(expected: AgentEvalExpectedFinding, actualFindings: Finding[]): boolean` — true iff any actual finding has `file === expected.file && rangesOverlap(finding.start_line, finding.end_line, expected.start_line, expected.end_line)`
  - `scoreMustNotFlag(expected: AgentEvalExpectedFinding, actualFindings: Finding[]): boolean` — true iff NO actual finding matches file + range
  - `computeBatchMetrics(results: Array<{ kind: 'must_find'|'must_not_flag'; pass: boolean; candidatesKept: number; candidatesDropped: number }>): { recall: number|null; precision: number|null; citation_accuracy: number|null }` — implements AC-5, AC-6, AC-7 formulas; returns null per metric when denominator is zero

#### Step A3 — Reviews module: repository + service + route for `POST /findings/:id/eval-case`

- [ ] `server/src/modules/reviews/repository/eval-case.repo.ts` — create new file with:
  - `getPrFilePatch(db: Db, prId: string, filePath: string): Promise<string | null | undefined>` — selects `patch` from `t.prFiles` where `prId = $prId AND path = $filePath`; returns `undefined` if no row, `null` if row exists but patch column is null
  - `insertFindingEvalCase(db: Db, values: { workspaceId, agentId, name, inputDiff, expectedOutput }): Promise<typeof t.evalCases.$inferSelect>` — inserts into `t.evalCases` with `ownerKind='agent'`, `ownerId=values.agentId`, `name=values.name`, `inputDiff=values.inputDiff`, `expectedOutput=values.expectedOutput`; returns the row

- [ ] `server/src/modules/reviews/service.ts` — add new method `createFindingEvalCase(workspaceId: string, findingId: string): Promise<AgentEvalCase>`:
  1. Call `findingContext(db, findingId)` (already in `review.repo.ts`) → `{ finding, review, pull }` or undefined
  2. If undefined → throw `NotFoundError('Finding not found')`
  3. If `pull.workspaceId !== workspaceId` → throw `NotFoundError('Finding not found')`
  4. If `finding.acceptedAt !== null && finding.dismissedAt !== null` → throw `ValidationError('Finding has both accepted_at and dismissed_at set — state is ambiguous (AC-3b)')`
  5. If `finding.acceptedAt === null && finding.dismissedAt === null` → throw `ValidationError('Finding must be accepted or dismissed before creating an eval case')`
  6. If `review.agentId === null` → throw `ValidationError('The finding\'s parent review has no linked agent (AC-3)')`
  7. Call `getPrFilePatch(db, pull.id, finding.file)` → `patch`
  8. If `patch === undefined || patch === null` → throw `ValidationError('No diff patch is available for this file — cannot create a case with empty input_diff (AC-3a)')`
  9. Determine `kind`: `finding.acceptedAt !== null ? 'must_find' : 'must_not_flag'`
  10. Derive `name` from `finding.title` (truncate to 80 chars; use as the case name)
  11. Call `insertFindingEvalCase(...)` with `expectedOutput = { kind, finding: { file, start_line, end_line, title, severity, category } }`
  12. Return `AgentEvalCase`-shaped object (with `latest_run: null`)

- [ ] `server/src/modules/reviews/routes.ts` — add after the existing finding action loop:
  ```
  app.post('/findings/:id/eval-case', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const evalCase = await service.createFindingEvalCase(workspaceId, req.params.id);
    reply.status(201);
    return evalCase;
  });
  ```

#### Step A4 — Agents module: repository methods for eval cases + runs

- [ ] `server/src/modules/agents/repository.ts` — add new methods (following the `SkillsRepository` pattern):
  - `listAgentEvalCases(workspaceId: string, agentId: string)` — selects from `t.evalCases` where `workspaceId=$workspaceId AND ownerKind='agent' AND ownerId=$agentId`, ordered by `name ASC`; for each case, fetches the latest `eval_runs` row (by `ran_at DESC LIMIT 1`) and attaches it as `latestRun`
  - `getAgentEvalCase(workspaceId: string, caseId: string)` — selects one `eval_cases` row scoped to workspace + `ownerKind='agent'`
  - `deleteAgentEvalCase(workspaceId: string, agentId: string, caseId: string): Promise<boolean>` — deletes from `t.evalCases` where `workspaceId=$workspaceId AND id=$caseId AND ownerKind='agent' AND ownerId=$agentId`
  - `insertEvalRun(values: { caseId, pass, ranAt, actualOutput, durationMs?, costUsd? }): Promise<typeof t.evalRuns.$inferSelect>` — inserts into `t.evalRuns`; `recall/precision/citationAccuracy` start as null (set later via batch update)
  - `updateBatchMetrics(caseIds: string[], ranAt: Date, metrics: { recall: number|null, precision: number|null, citationAccuracy: number|null }): Promise<void>` — updates `eval_runs` SET `recall=$recall, precision=$precision, citation_accuracy=$citationAccuracy` WHERE `case_id IN ($caseIds) AND ran_at = $ranAt`
  - `listEvalRunsByCaseIds(caseIds: string[]): Promise<(typeof t.evalRuns.$inferSelect)[]>` — selects all eval_runs rows for the given case IDs, ordered by `ran_at DESC`; used by `GET /agents/:id/eval-runs` grouping logic
  - `listEvalRunsByRanAt(caseIds: string[], ranAt: Date): Promise<(typeof t.evalRuns.$inferSelect & { caseName: string })[]>` — joins `eval_runs` with `eval_cases` to get `case_name`; used by compare endpoint

#### Step A5 — Agents module: service methods for eval batch

- [ ] `server/src/modules/agents/service.ts` — add new methods:
  - `listAgentEvalCases(workspaceId: string, agentId: string): Promise<AgentEvalCase[]>`:
    1. Verify agent exists (404 if not)
    2. Call repo `listAgentEvalCases` → map rows to `AgentEvalCase` DTO

  - `deleteAgentEvalCase(workspaceId: string, agentId: string, caseId: string): Promise<boolean>`:
    1. Call repo `deleteAgentEvalCase`; return false → throw `NotFoundError`

  - `runAgentEvalBatch(workspaceId: string, agentId: string): Promise<AgentEvalBatchResult>`:
    1. Load agent row (404 if not found)
    2. Load agent's linked skill bodies via `repo.listSkillLinks(agentId)` + skills table join
    3. Capture `ranAt = new Date()` — single timestamp for entire batch
    4. Load all eval cases: `repo.listAgentEvalCases(workspaceId, agentId)`
    5. If zero cases: return `{ ran_at: ranAt.toISOString(), recall: null, precision: null, citation_accuracy: null, traces_passed: 0, traces_total: 0, duration_ms: 0, cost_usd: null, per_trace: [] }`
    6. Resolve LLM adapter: `const llm = await this.container.llm(agent.provider)`
    7. Loop through cases:
       - Parse `case.expectedOutput` as `AgentEvalExpectedOutput` (`.parse()` — throw on invalid)
       - `const diff = parseUnifiedDiff(case.inputDiff ?? '')`
       - `const start = Date.now()`
       - Try: `const outcome = await reviewPullRequest({ diff, systemPrompt: agent.systemPrompt, model: agent.model, strategy: agent.strategy, skills: skillBodies, llm })`
       - On error: insert `eval_runs` row with `pass=false, actualOutput: { error: err.message }, ranAt`, continue loop
       - On success: call `scoreMustFind` or `scoreMustNotFlag` based on `expected.kind`; insert `eval_runs` row with `pass`, `actualOutput: { findings: outcome.review.findings }`, `ranAt`, `durationMs`, `costUsd: outcome.costUsd`
       - Accumulate per-trace results + candidate counts (kept = `outcome.review.findings.length`, dropped = `outcome.dropped.length`)
    8. Compute batch metrics via `computeBatchMetrics(results)`
    9. Update all inserted rows: `repo.updateBatchMetrics(caseIds, ranAt, metrics)`
    10. Return `AgentEvalBatchResult`

  - `listAgentEvalRuns(workspaceId: string, agentId: string): Promise<EvalRunRecord[]>`:
    1. Verify agent exists (404)
    2. Load case IDs for agent via repo
    3. Call `repo.listEvalRunsByCaseIds(caseIds)` → map to `EvalRunRecord` DTOs (include `case_name` via join)

  - `compareAgentEvalRuns(workspaceId: string, agentId: string, ranAtA: string, ranAtB: string): Promise<AgentEvalCompare>`:
    1. Verify agent exists (404)
    2. Validate `ranAtA !== ranAtB` (422 if equal)
    3. Validate both are parseable ISO timestamps (422 if not)
    4. Load batch A rows and batch B rows via `repo.listEvalRunsByRanAt`
    5. If either batch empty → throw `NotFoundError`
    6. Extract batch-level metrics from first row of each batch (denormalized onto every row)
    7. Compute deltas: `B.recall - A.recall` (null if either is null)
    8. Compute flip list: cases where `pass` changed between A and B
    9. Return `AgentEvalCompare`

#### Step A6 — Agents module: new routes

- [ ] `server/src/modules/agents/routes.ts` — add 5 new routes after the existing agent routes. Route registration order matters: register `/eval-runs/compare` before `/eval-runs`:

  ```
  const EvalCaseParams = z.object({ id: z.string().uuid(), caseId: z.string().uuid() });
  const CompareQuery = z.object({ a: z.string(), b: z.string() });

  // eval-runs/compare MUST be before eval-runs (static before parametric)
  app.get('/agents/:id/eval-runs/compare', { schema: { params: IdParams, querystring: CompareQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.compareAgentEvalRuns(workspaceId, req.params.id, req.query.a, req.query.b);
  });

  app.post('/agents/:id/eval-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.runAgentEvalBatch(workspaceId, req.params.id);
  });

  app.get('/agents/:id/eval-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listAgentEvalRuns(workspaceId, req.params.id);
  });

  app.get('/agents/:id/eval-cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const agent = await service.get(workspaceId, req.params.id);
    if (!agent) throw new NotFoundError('Agent not found');
    return service.listAgentEvalCases(workspaceId, req.params.id);
  });

  app.delete('/agents/:id/eval-cases/:caseId', { schema: { params: EvalCaseParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.deleteAgentEvalCase(workspaceId, req.params.id, req.params.caseId);
    reply.status(204);
  });
  ```

#### Step A7 — New `modules/evals/` module (global dashboard)

- [ ] `server/src/modules/evals/repository.ts` — create new file:
  - `getEvalDashboard(db: Db, workspaceId: string, ownerId?: string): Promise<EvalDashboard>`:
    1. Build `WHERE` clause: `workspaceId=$workspaceId AND ownerKind='agent'` + optional `ownerId=$ownerId`
    2. Count total eval cases
    3. Query `eval_runs` ordered by `ran_at DESC`; group rows into batches by `ran_at`; take most recent batch as "current" and second-most-recent as "prior"
    4. Compute `current` metrics (recall/precision/citation_accuracy/traces from the current batch rows); if no batches, return zeros
    5. Compute `delta` as `current - prior` metrics (zeros if no prior batch)
    6. Build `trend` array from the last N batches (up to 20), one `EvalTrendPoint` per unique `ran_at`
    7. Return `EvalDashboard` with `alert: null` always

- [ ] `server/src/modules/evals/service.ts` — create new file:
  - `EvalsService` class with `constructor(private container: Container)`
  - `getDashboard(workspaceId: string, ownerId?: string): Promise<EvalDashboard>` — delegates to repository; validates `ownerId` (if provided) is a known agent in the workspace (404 if not)

- [ ] `server/src/modules/evals/routes.ts` — create new Fastify plugin:
  ```typescript
  const DashboardQuery = z.object({ owner_id: z.string().uuid().optional() });

  export default async function evalsRoutes(appBase: FastifyInstance) {
    const app = appBase.withTypeProvider<ZodTypeProvider>();
    const service = new EvalsService(app.container);

    app.get('/evals/dashboard', { schema: { querystring: DashboardQuery } }, async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getDashboard(workspaceId, req.query.owner_id);
    });
  }
  ```

- [ ] `server/src/modules/index.ts` — add `import evals from './evals/routes.js';` and add `evals` to the `modules` record

---

### Phase 2B: Client lib additions (parallel with Phase 2A)

One implementer, sequential within this phase. Depends on Phase 1. No dependency on Phase 2A.

- [ ] `client/src/lib/api.ts` — add 7 new exported async functions:
  - `postFindingEvalCase(findingId: string): Promise<AgentEvalCase>` → `POST /findings/${findingId}/eval-case`
  - `getAgentEvalCases(agentId: string): Promise<AgentEvalCase[]>` → `GET /agents/${agentId}/eval-cases`
  - `deleteAgentEvalCase(agentId: string, caseId: string): Promise<void>` → `DELETE /agents/${agentId}/eval-cases/${caseId}`
  - `postAgentEvalRuns(agentId: string): Promise<AgentEvalBatchResult>` → `POST /agents/${agentId}/eval-runs`
  - `getAgentEvalRuns(agentId: string): Promise<EvalRunRecord[]>` → `GET /agents/${agentId}/eval-runs`
  - `getAgentEvalRunsCompare(agentId: string, a: string, b: string): Promise<AgentEvalCompare>` → `GET /agents/${agentId}/eval-runs/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`
  - `getEvalsDashboard(ownerId?: string): Promise<EvalDashboard>` → `GET /evals/dashboard${ownerId ? '?owner_id=' + ownerId : ''}`

- [ ] `client/src/lib/hooks/agents-eval.ts` — create new file with TanStack Query hooks:
  - `useAgentEvalCases(agentId: string | null | undefined)` — `useQuery`, key `['agent-eval-cases', agentId]`, `enabled: !!agentId`
  - `useTurnFindingIntoEvalCase()` — `useMutation`, calls `postFindingEvalCase`; `onSuccess` → no automatic invalidation (the caller decides which query to refresh)
  - `useDeleteAgentEvalCase(agentId: string)` — `useMutation`, `onSuccess` → invalidate `['agent-eval-cases', agentId]`
  - `useRunAgentEvalBatch(agentId: string)` — `useMutation`, calls `postAgentEvalRuns`; `onSuccess` → invalidate `['agent-eval-cases', agentId]` and `['agent-eval-runs', agentId]`
  - `useAgentEvalRuns(agentId: string | null | undefined)` — `useQuery`, key `['agent-eval-runs', agentId]`, `enabled: !!agentId`
  - `useAgentEvalRunsCompare(agentId: string | null | undefined, a: string | null, b: string | null)` — `useQuery`, key `['agent-eval-compare', agentId, a, b]`, `enabled: !!agentId && !!a && !!b`
  - `useEvalsDashboard(ownerId?: string)` — `useQuery`, key `['evals-dashboard', ownerId]`

- [ ] `client/src/lib/hooks/index.ts` — re-export all hooks from `agents-eval.ts` if an index exists; otherwise just confirm the new file is importable by component files

---

### Phase 3: Client UI (after Phase 2B)

One implementer, sequential within this phase.

#### Step C1 — i18n: add `finding.createEvalCase` key

- [ ] `client/messages/en/prReview.json` — inside the `finding` object, add:
  ```json
  "createEvalCase": "Turn into eval case"
  ```
  Existing keys are unchanged.

#### Step C2 — FindingCard: new "Turn into eval case" button

- [ ] `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx` — four changes:
  1. Add `onCreateEvalCase?: () => void` to the props interface
  2. Import the `useTurnFindingIntoEvalCase` hook (NOT used inside FindingCard — this prop is wired externally; no hook call in FindingCard itself)
  3. Add the button inside the `{expanded && ...}` block, inside `<div style={s.actions}>`, after the existing Dismiss button — only when `accepted || dismissed`:
     ```tsx
     {(accepted || dismissed) && (
       <Button
         kind="ghost"
         size="sm"
         icon="FlaskConical"
         disabled={pending}
         onClick={() => onCreateEvalCase?.()}
         aria-label={t("finding.createEvalCase")}
       >
         {t("finding.createEvalCase")}
       </Button>
     )}
     ```
  4. The `FindingActionKind` enum is NOT modified — this button does not use `onAction`

- [ ] The parent component that renders FindingCard (search for `<FindingCard` usages in `client/src/app/repos/[repoId]/pulls/[number]/`) — add `onCreateEvalCase={() => createEvalCase.mutate(f.id)}` prop to each `<FindingCard>`, where `createEvalCase` comes from `useTurnFindingIntoEvalCase()` called once at the parent level

#### Step C3 — AgentEditor: add Evals tab to TABS constant

- [ ] `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` — add the evals entry to `TABS`:
  ```typescript
  { key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" },
  ```
  The `editor.tabs.evals` key already exists in `client/messages/en/agents.json` with value `"Evals"`.

#### Step C4 — AgentEditor: create EvalsTab component

- [ ] `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx` — create new component `EvalsTab({ agentId }: { agentId: string })`. Behavior per the spec's Evals tab state machine (Architecture & workflows):
  - **Case list section**: uses `useAgentEvalCases(agentId)`. Renders each case with: kind badge (`must_find` / `must_not_flag`), name, pass/fail icon from `latest_run.pass`, and a Delete button (`useDeleteAgentEvalCase`). Case list strings from `eval.json` `evalsTab.*` keys.
  - **Run history section**: uses `useAgentEvalRuns(agentId)`. Groups raw `EvalRunRecord[]` by `ran_at` (client-side, not server-side). Each batch row shows `ran_at` (formatted), recall, precision, citation_accuracy, cost_usd badges. Null metrics render as "N/A". Row is selectable for comparison.
  - **Compare selection**: user selects exactly two batch rows; a "Compare" button appears; calls `useAgentEvalRunsCompare(agentId, a, b)`. Compare view shows `deltas` (formatted as +/- with N/A for null) and `flips` table. No system-prompt diff panel (AC-17).
  - **"Run all evals" button**: calls `useRunAgentEvalBatch(agentId)`; shows loading state during run; invalidates both cases and runs on completion.
  - All visible strings must use `useTranslations("eval")` with keys from `eval.json` (`evalsTab.*`, `dashboard.*`).

- [ ] `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/index.ts` — barrel: `export { EvalsTab } from './EvalsTab';`

#### Step C5 — AgentEditor: wire EvalsTab into the tab switcher

- [ ] `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx` — add:
  1. `import { EvalsTab } from './_components/EvalsTab';`
  2. New branch in the `<div style={s.body}>`:
     ```tsx
     {tab === "evals" && <EvalsTab agentId={agent.id} />}
     ```

#### Step C6 — /evals global dashboard page

- [ ] `client/src/app/evals/page.tsx` — create thin page component: `import { EvalsDashboard } from './_components/EvalsDashboard'; export default function EvalsPage() { return <EvalsDashboard />; }`

- [ ] `client/src/app/evals/_components/EvalsDashboard/EvalsDashboard.tsx` — create component using `useEvalsDashboard()`. Render using `eval.json` `dashboard.*` i18n keys:
  - Header: total cases count (`dashboard.casesSummary`)
  - Current batch metrics: recall, precision, citation_accuracy as numeric badges with labels (`dashboard.metrics.*`)
  - Delta vs prior batch (formatted as signed numbers, N/A for null)
  - Trend table/chart from `dashboard.trend` array (one row per batch point)
  - Recent runs list from `dashboard.recent_runs` (`dashboard.recentRuns`)
  - All metric values rendered as visible text (not color-only; accessibility requirement)
  - Empty state: `dashboard.noRuns` text

- [ ] `client/src/app/evals/_components/EvalsDashboard/index.ts` — barrel: `export { EvalsDashboard } from './EvalsDashboard';`

---

### Phase 4: Tests (after Phase 2A + Phase 3)

One implementer, sequential within this phase.

#### Server tests

- [ ] `server/src/modules/agents/eval-scorer.test.ts` — unit tests for `eval-scorer.ts`:
  - `rangesOverlap`: boundary cases (overlap at exactly one line, adjacent but non-overlapping, fully contained, fully outside)
  - `scoreMustFind`: expected finding matched by file+range, not matched by wrong file, not matched by adjacent range
  - `scoreMustNotFlag`: passes when no match, fails when match present
  - `computeBatchMetrics`: recall=null when zero must_find cases, precision=null when zero must_not_flag, citation_accuracy=null when zero candidates, correct fractions with mixed cases, all-error batch

- [ ] `server/src/modules/reviews/review-eval-case.it.test.ts` — integration test for `POST /findings/:id/eval-case`:
  - Returns 201 + `AgentEvalCase` for valid accepted finding with diff patch available (AC-1)
  - Returns 201 + `must_not_flag` case for dismissed finding (AC-2)
  - Returns 422 when `review.agent_id` is null (AC-3)
  - Returns 422 when `pr_files.patch` is null for the finding's file (AC-3a)
  - Returns 422 when finding has both `accepted_at` and `dismissed_at` set (AC-3b)
  - Returns 404 when finding does not exist (AC-4)

- [ ] `server/src/modules/agents/agent-eval-runs.it.test.ts` — integration test for batch run:
  - Returns 200 with `traces_total=0` and all metrics null for an agent with zero cases (AC-13)
  - Returns 200 with correct recall/precision/citation_accuracy for a batch with known must_find + must_not_flag cases using MockLLMProvider fixture (AC-5/6/7)
  - All `eval_runs` rows for a batch share the exact same `ran_at` value (AC-11)
  - Failing LLM call on one case produces `pass=false` row; batch returns 200 (AC-12)

#### Client tests

- [ ] `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.test.tsx` — add/extend tests:
  - "Turn into eval case" button renders when `accepted_at` is set (AC-19)
  - "Turn into eval case" button renders when `dismissed_at` is set (AC-19)
  - "Turn into eval case" button is absent when neither flag is set (AC-20)
  - `onCreateEvalCase` prop is called when button is clicked
  - Existing accept/dismiss button tests still pass (non-regression)

- [ ] `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.test.tsx` — RTL tests:
  - Renders case list with kind badge and pass/fail icon when data is loaded
  - Shows "never run" state when `latest_run` is null
  - "Run all evals" button is present and calls mutation on click
  - Compare button appears when two batch rows are selected; compare view shows deltas and flip list
  - Null metrics display as "N/A" not as "0" or "NaN"

- [ ] `client/src/app/evals/_components/EvalsDashboard/EvalsDashboard.test.tsx` — RTL tests:
  - Renders cases total count, current metrics, delta section, and recent runs from mocked hook data
  - Shows `dashboard.noRuns` text when `recent_runs` is empty
  - All three metric values appear as visible text (not hidden behind color-only badges)

---

## Gotchas

- **No DB migration** — `eval_cases` and `eval_runs` tables already exist with all required columns (`owner_kind='agent'` is already in the enum; `recall/precision/citation_accuracy` columns are already on `eval_runs`). Do NOT run `pnpm db:generate` or `pnpm db:migrate`.
- **Both vendor/shared copies must change together** — `client/src/vendor/shared/contracts/knowledge.ts` is a manual mirror of `server/src/vendor/shared/contracts/knowledge.ts`. Update both in Phase 1 or tsc will catch drift. No tooling enforces the sync.
- **`FindingActionKind` must NOT be modified** — the button in FindingCard must not route through `onAction`. It uses a separate `onCreateEvalCase` prop. Any change to `FindingActionKind` breaks the existing accept/dismiss/learn/reply flow (the enum is in the do-not-touch shared contract).
- **`client/src/vendor/ui/` is a do-not-touch zone** — the nav entry for `/evals` already exists in `client/src/vendor/ui/nav.ts`; do not modify it.
- **Route registration order in `agents/routes.ts`** — `GET /agents/:id/eval-runs/compare` must be registered BEFORE `GET /agents/:id/eval-runs`. Fastify's parametric routing would otherwise absorb the literal segment `compare` as a run-id.
- **`ranAt` as a single `Date` instance** — `const ranAt = new Date()` is captured once at the start of `runAgentEvalBatch` and reused for every `insertEvalRun` call. JavaScript `Date` equality (`===`) on `Date` objects compares references, so pass the same instance or use `.toISOString()` string comparison in the UPDATE WHERE clause.
- **`input_diff` must flow through `reviewPullRequest`** — never pass `case.inputDiff` directly to an LLM adapter. The spec's security section and `reviewer-core-ground-findings-gate` rule mandate using `reviewPullRequest` as the only LLM entry point during eval runs.
- **`outcome.dropped`** — the `reviewPullRequest` return value includes a `dropped` array (findings rejected by the citation-grounding gate). This is required for `citation_accuracy` computation (AC-7). Verify it is present in the type returned by `@devdigest/reviewer-core` before writing the service.
- **`EvalDashboard.current.recall` is non-nullable** — when there are no eval runs at all, the service must return `0.0` (not `null`) for `current.recall/precision/citation_accuracy` to satisfy the existing `EvalDashboard` Zod contract (which is not modified per the spec).
- **i18n strings for the Evals tab and dashboard already exist** in `client/messages/en/eval.json` under `evalsTab.*` and `dashboard.*`. Check those keys before adding new ones. The only genuinely missing key is `prReview.finding.createEvalCase`.

## Definition of done

- [ ] `pnpm typecheck` passes in `server/` with no errors
- [ ] `pnpm typecheck` passes in `client/` with no errors
- [ ] `pnpm test` passes in `server/` (all existing tests plus new eval-scorer unit tests and integration tests)
- [ ] `pnpm test` passes in `client/` (all existing tests plus new FindingCard, EvalsTab, and EvalsDashboard tests)
- [ ] **AC-1:** `POST /findings/:id/eval-case` for an accepted finding returns 201 with `expected_output.kind='must_find'` and non-empty `input_diff`
- [ ] **AC-2:** `POST /findings/:id/eval-case` for a dismissed finding returns 201 with `expected_output.kind='must_not_flag'`
- [ ] **AC-3:** returns 422 when `review.agent_id` is null; **AC-3a:** returns 422 when no patch is available; **AC-3b:** returns 422 when both `accepted_at` and `dismissed_at` are set
- [ ] **AC-4:** returns 404 when the finding does not exist
- [ ] **AC-5/6/7:** batch metrics (recall/precision/citation_accuracy) computed correctly from a mixed must_find+must_not_flag case set; null returned for metrics with zero eligible cases
- [ ] **AC-8/9:** per-case `pass` reflects file+line range overlap (including boundary-touch overlap); must_not_flag passes iff no overlap
- [ ] **AC-10:** no LLM calls occur after all per-case `reviewPullRequest` calls complete — scoring is purely deterministic
- [ ] **AC-11:** all `eval_runs` rows in a batch share the exact same `ran_at` timestamp; all rows carry the same batch-level metrics
- [ ] **AC-12:** a failing LLM case records `pass=false` in its row; remaining cases complete; batch returns 200
- [ ] **AC-13:** `POST /agents/:id/eval-runs` with zero cases returns 200 with `traces_total=0` and all metrics null
- [ ] **AC-14/15:** Agent Editor Evals tab renders case list with kind/name/pass-fail, run history with metric badges, and "Run all evals" button; clicking it updates the history
- [ ] **AC-16:** comparing two batch runs shows metric deltas and a flip list; null metric deltas display as N/A
- [ ] **AC-17:** compare view contains no system-prompt diff panel
- [ ] **AC-18:** `/evals` page renders total case count, current metrics, delta, trend, and recent runs
- [ ] **AC-19/20:** "Turn into eval case" button renders on FindingCard iff `accepted_at` or `dismissed_at` is set; absent otherwise
