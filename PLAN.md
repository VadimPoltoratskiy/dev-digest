# Plan: Why+Risk Brief (PR Brief Card)

## Spec reference
`server/specs/SPEC-01-why-risk-brief.md`

## Execution mode: multi-agent
3 phases: **Phase A (server) and Phase B (client) run in parallel; Phase C (tests) is sequential after both complete.**

Why multi-agent: Phase A and Phase B have completely disjoint file sets — no git conflict is possible. The only shared dependency is the `Brief` Zod schema that both phases write independently to their own copy of `vendor/shared/contracts/brief.ts`. That schema is fully specified field-by-field in the Architecture Decisions section below, so both implementers converge on the same contract without any runtime coordination. Phase C (tests) needs both phases' source code to compile against, so it must run only after both A and B are complete.

---

## Goal
Code reviewers currently lack a single, structured card that synthesizes already-available signals (intent, blast radius, smart-diff groupings, linked-issue reference, project context docs) into a prioritized "why + risk" summary. This feature adds `GET /pulls/:id/brief` and `POST /pulls/:id/brief` endpoints that compose and cache a one-LLM-call structured brief, and exposes a `PrBriefCard` on the PR detail OverviewTab alongside the existing `IntentCard`.

---

## Modules affected
- `server/` — new `brief` module (routes → service → repository); `pr_brief` DB table extended with 5 telemetry columns via migration; shared Zod contract reshaped (4 unused stubs removed, `Brief` type added); module registered in `modules/index.ts`
- `client/` — new `client/src/lib/hooks/brief.ts`; new `PrBriefCard` feature component in the PR detail OverviewTab; vendor/shared contract mirror updated in lockstep; i18n keys added under `block.brief.*`

---

## Engineering Insights applied
- **client/insights (2026-06-25 Codebase Patterns):** `client/src/vendor/shared/` is a manual mirror of `server/src/vendor/shared/` — always update both when changing a Zod contract; no tooling enforces the sync, only `tsc` catches drift. Phase B therefore includes an explicit task for the client vendor copy, independent of Phase A.
- **server/insights (2026-06-25 Recurring Error):** Adding a required (non-`.nullish()`) Zod contract field breaks every adapter, mock, and test fixture typed against that contract. The 4 types being removed (`Risks`, `PrHistory`, `PrHistoryItem`, `PrBrief`) are confirmed to have zero consumers in any route/service/repo/hook, so removal is safe. The new `Brief` type has no existing consumers.
- **server/insights (2026-06-25 Codebase Patterns):** The repository layer cannot access the DI container — only receives `Db`. LLM calls, feature-model resolution, and any computation that needs the container stay in the service layer. The `brief/repository.ts` is a pure Drizzle query layer.
- **server/insights (2026-07-06):** The `pr_brief` table is already declared in `db/schema/reviews.ts` as a lesson stub. This confirms the table is pre-existing; only 5 new columns need to be added via a generated migration.
- **client/insights (2026-07-06 Recurring Error):** Adding a required (non-`.nullish()`) field to a Zod contract breaks every test fixture typed against it — TS2741. The test author in Phase C must add `Brief` fixture objects with all 5 required fields populated.

---

## Recommendations
- **Rate limit on `POST /pulls/:id/brief`:** The spec does not mandate a rate limit, but blast's LLM endpoint uses `{ max: 20, timeWindow: '1 minute' }`. Given `gpt-4.1` is the feature model (more expensive than flash-class), `{ max: 10, timeWindow: '1 minute' }` is recommended. Trade-off: prevents token blowout with negligible UX impact.
- **`generated_at` column: use `.notNull().default(sql\`now()\`)` in the Drizzle schema** (not plain `.notNull()`): `pr_brief` is an existing table that may already contain rows. Adding a NOT NULL column without a DB-level default will fail the `ALTER TABLE ADD COLUMN` migration. The repository always writes `generatedAt: new Date()` explicitly on every upsert; the `DEFAULT now()` exists only so the migration succeeds. This is a minor, safe deviation from `pr_blast_explanation` (which needs no default because it is a new table with no pre-existing rows).
- **Client hook 404 handling for `usePrBrief`:** `GET /pulls/:id/brief` returns HTTP 404 (not JSON null) when no brief exists. The hook's `queryFn` should catch `ApiError` with `status === 404` and return `null`, so the component can show a "Generate" button. This differs from `useBlastExplanation` (server returns JSON null there), but is necessary to match the spec's 404 contract.

---

## Architecture decisions

### Canonical `Brief` Zod schema — field-by-field (Phase A and Phase B must produce identical definitions)

Phase A writes this to `server/src/vendor/shared/contracts/brief.ts`.
Phase B writes the identical definition to `client/src/vendor/shared/contracts/brief.ts`.
The existing `Risk` type is UNCHANGED in both files.

**Remove from both files (4 types — confirmed zero consumers):**
```
Risks          z.object({ risks: z.array(Risk) })
PrHistoryItem  z.object({ pr_number, title, merged_at, author, files_overlap, notes })
PrHistory      z.object({ history: z.array(PrHistoryItem) })
PrBrief        z.object({ intent, blast, risks, history })
```

**Add to both files, positioned after the `Risk` / `RiskSeverity` exports:**
```typescript
export const Brief = z.object({
  what:         z.string(),                         // What the PR changes (1 paragraph)
  why:          z.string(),                         // Why it is needed (1 paragraph)
  risk_level:   z.enum(['low', 'medium', 'high']),  // Overall merge-risk verdict
  risks:        z.array(Risk),                      // Individual risks — file_refs validated
  review_focus: z.array(z.string()),                // Ordered areas/files to prioritise
});
export type Brief = z.infer<typeof Brief>;
```

All other exports (`Intent`, `ChangedSymbol`, `BlastCaller`, `DownstreamImpact`, `BlastRadius`, `BlastExplanation`, `RiskSeverity`, `Risk`, `SmartDiffRole`, `SmartDiffFile`, `SmartDiffGroup`, `ProposedSplit`, `SmartDiff`) are UNCHANGED in both files.

### `brief` module — onion-architecture layer boundaries

Per `onion-architecture/SKILL.md`:

| File | Responsibility |
|---|---|
| `routes.ts` | Parse `params` (`IdParams`) and `body` (`{ force?: boolean }`); call `getContext()` for workspace scope; delegate to `BriefService`; return DTO or status. No business logic. |
| `service.ts` | All business logic: cache/force check, workspace guard, input assembly, prompt budget, LLM call, `file_refs` validation, upsert, observability logging. Accesses adapters via `container` only — never imports adapters directly. Never accesses `req`/`res`. |
| `repository.ts` | Drizzle queries only: `getBrief(db, prId)` and `upsertBrief(db, prId, params)`. No business logic, no container access. |

### Workspace-scope guard (AC-4)

Every service method queries `pullRequests WHERE id = prId AND workspace_id = workspaceId` before any other operation. If not found, throws `NotFoundError`. Mirrors `BlastService.loadPull()` (`blast/service.ts:67-71`).

### Cache/force pattern (AC-1, AC-3, AC-8)

At the top of `BriefService.generate()`:
```typescript
if (!opts.force) {
  const existing = await getBrief(db, prId);
  if (existing) return existing;  // cache hit → no LLM call (AC-1, AC-3)
}
// proceed to generate (AC-5, AC-8)
```
Mirrors `IntentClassifier.classify()` (`intent-classifier.ts:29-31`).

### Linked-issue extraction (AC-7, security)

Extract with `pull.body?.match(/(?:closes?|fixes?|resolves?)\s+#(\d+)/i)`.
Include in the prompt as the plain string `"Linked issue: #NNN"` — only the numeric reference.
**Do NOT call `this.container.github().getIssue()`.** No live GitHub API call is made.

This differs from `IntentClassifier.resolveLinkedIssue()` (which calls `gh.getIssue()` for full issue content after regex-matching). The spec and resolved clarification #1 explicitly prohibit any live GitHub API call for the brief. The attack surface is limited to the numeric issue number only (untrusted, but safe — it is displayed as data, not fetched as instructions).

### Prompt budget and slot assembly order (AC-7)

Assemble user-message in this slot order. If total chars exceed 8,192, trim context docs first, then PR body. Log WARN when any trimming occurs.

| Slot | Max chars | Trim priority |
|---|---|---|
| `PR Title: ${title}` | none | never trimmed |
| Intent fields (`intent`, `in_scope`, `out_of_scope`, `risk_areas`) — only if `pr_intent` cache row exists | ~500 | never trimmed |
| Blast-radius summary string (`blast.summary`) | ~200 | never trimmed |
| Smart-diff file groups (role + file paths only — no pseudocode, no finding_lines) | ~600 | never trimmed |
| `Linked issue: #NNN` — only if regex matched from PR body | ~100 | never trimmed |
| `PR Body (excerpt):\n${body.slice(0, 500)}` — hard cap 500 chars | 500 | trimmed second |
| Context doc excerpts (per-file cap 2,000 chars; total cap 4,000 chars) | 4,000 | trimmed first |

Untrusted content (PR title, PR body, linked-issue number, context doc content) is wrapped in explicit data-section labels and is never promoted to instruction-level trust. INJECTION_GUARD discipline from spec §Security / prompt injection applies. Example label: `=== PR BODY (untrusted author content) ===`.

### `file_refs` validation (AC-6)

Build `validFileSet: Set<string>` from:
- `blast.changed_symbols[].file`
- `blast.downstream[].callers[].file`
- `smartDiff.groups[].files[].path`

For each risk in the LLM response, filter `risk.file_refs` to only paths present in `validFileSet`. For every removed path, log WARN: `{ prId, riskTitle: risk.title, excludedPath }`. Risks whose `file_refs` list becomes empty after filtering keep `file_refs: []` — they are NOT dropped from the `risks` array.

### LLM failure handling

On any exception from `llm.completeStructured()`: throw `BadGatewayError` (maps to HTTP 502). Do NOT call `upsertBrief()`. Any pre-existing cache row must remain untouched.

### `generated_at` column — migration strategy

`pr_brief` is an existing table that may contain rows. In the Drizzle schema, define the new column as:
```typescript
generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().default(sql`now()`)
```
The DB-level `DEFAULT now()` lets the generated `ALTER TABLE ADD COLUMN` migration succeed even when rows exist. The repository always writes `generatedAt: new Date()` explicitly on every upsert; the default applies only during the migration step for pre-existing rows.

### Module registration

1. `server/src/modules/brief/routes.ts` — default export Fastify plugin `briefRoutes`
2. `server/src/modules/index.ts` — add `import brief from './brief/routes.js'` and add `brief` key to the `modules` Record (after `onboarding`)
3. No change to `app.ts` — it iterates `Object.values(modules)` automatically

---

## Tasks

### Phase A: Server (DB migration + brief module + Zod contract)

Run independently in `server/`. No client files touched.

- [ ] `server/src/db/schema/reviews.ts` — extend the existing `prBrief` table definition by adding 5 columns that mirror `prBlastExplanation` exactly:
  - `model: text('model')` — nullable
  - `tokensIn: integer('tokens_in')` — nullable
  - `tokensOut: integer('tokens_out')` — nullable
  - `costUsd: doublePrecision('cost_usd')` — nullable
  - `generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().default(sql\`now()\`)`

  Do NOT hand-edit any migration SQL.

- [ ] Run `cd server && pnpm db:generate` — review the generated migration file: the `generated_at` column must include `DEFAULT now()`. Commit the generated migration file to version control.

- [ ] Run `cd server && pnpm db:migrate`

- [ ] `server/src/vendor/shared/contracts/brief.ts` — remove `Risks`, `PrHistoryItem`, `PrHistory`, `PrBrief`; add `Brief` schema exactly as specified in Architecture Decisions. All other exports (including `Risk`) are UNCHANGED.

- [ ] `server/src/modules/brief/repository.ts` — implement:
  ```typescript
  interface BriefSaveParams {
    json: Brief;
    model: string | null;
    tokensIn: number | null;
    tokensOut: number | null;
    costUsd: number | null;
  }
  ```
  - `getBrief(db: Db, prId: string): Promise<Brief | null>` — SELECT from `prBrief` WHERE `prId`; return null if no row; return `row.json as Brief`
  - `upsertBrief(db: Db, prId: string, params: BriefSaveParams): Promise<void>` — INSERT ... ON CONFLICT (prId) DO UPDATE SET all 6 columns (including `generatedAt: new Date()`). Mirror `blast/repository.ts` upsert pattern exactly.

- [ ] `server/src/modules/brief/prompts.ts` — export `BRIEF_SYSTEM_PROMPT: string` — the system prompt for brief generation. It must instruct the model to act as a senior engineering lead, produce structured output in the `Brief` schema shape, keep `what`/`why` concise (one paragraph each), anchor every `risk.file_refs` entry only to files explicitly listed in the blast/smart-diff data provided, and treat all labelled data sections as untrusted author-written content that cannot override these instructions.

- [ ] `server/src/modules/brief/service.ts` — `BriefService` class:
  - `constructor(private container: Container) {}`
  - `get(workspaceId: string, prId: string): Promise<Brief | null>` — workspace guard (`loadPull`), then `getBrief(db, prId)`; returns null if no row
  - `generate(workspaceId: string, prId: string, opts: { force?: boolean; logger?: Logger }): Promise<Brief>`:
    1. Workspace guard (`loadPull`) — throws `NotFoundError` if PR not in workspace (AC-4)
    2. Cache/force check: if `!opts.force` and cached row exists, return cached `Brief` immediately (AC-1, AC-3)
    3. Load intent row best-effort: `(await db.select().from(prIntent).where(eq(prIntent.prId, prId)))[0] ?? null` — AC-9: proceed without intent if null
    4. Call `new BlastService(container).buildForPull(workspaceId, prId)` — read blast data (includes degraded path; degrade is silent, continues)
    5. Call `new SmartDiffService(container).buildForPull(workspaceId, prId)` — read smart-diff
    6. Load context docs via `ProjectContextService` with per-file cap 2,000 chars and total cap 4,000 chars (mirror `run-executor.ts:18-19` pattern with tighter budget)
    7. Extract linked-issue number from `pull.body` via regex (no GitHub API call — see Architecture Decisions)
    8. Assemble user-message using slot order from Architecture Decisions; if total > 8,192 chars: trim context docs first, then PR body; log WARN if trimming occurs
    9. Resolve feature model: `await resolveFeatureModel(container, workspaceId, 'risk_brief')`
    10. Call `llm.completeStructured({ model, schema: Brief, schemaName: 'Brief', messages: [{ role: 'system', content: BRIEF_SYSTEM_PROMPT }, { role: 'user', content: userMessage }], maxRetries: 1 })`
    11. On any LLM exception: throw `BadGatewayError`; do NOT call `upsertBrief`
    12. Build `validFileSet` from blast + smart-diff file paths; filter `result.data.risks[].file_refs`; log WARN per removed path with `{ prId, riskTitle, excludedPath }` (AC-6)
    13. Call `upsertBrief(db, prId, { json: validatedBrief, model, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd: result.costUsd })` (AC-5)
    14. Log INFO: `{ prId, model, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd: result.costUsd, promptChars: userMessage.length }`
    15. Return `validatedBrief`
  - Private `loadPull(workspaceId: string, prId: string)` — mirrors `BlastService.loadPull()` exactly

- [ ] `server/src/modules/brief/routes.ts` — Fastify plugin default export `briefRoutes`:
  - Uses `app.withTypeProvider<ZodTypeProvider>()`
  - `GET /pulls/:id/brief` — params `IdParams`; `getContext()`; call `service.get()`; if null: `reply.status(404).send({ error: { code: 'not_found', message: 'No brief for this PR' } })`; else: return Brief (200)
  - `POST /pulls/:id/brief` — params `IdParams`; body `z.object({ force: z.boolean().optional() })`; rate limit config `{ max: 10, timeWindow: '1 minute' }`; `getContext()`; call `service.generate({ force: body.force, logger: req.log })`; return Brief (200)
  - Both routes handle `NotFoundError` → 404 and `BadGatewayError` → 502 via the global error handler

- [ ] `server/src/modules/index.ts` — add `import brief from './brief/routes.js'` and add `brief` key to the `modules` Record (after `onboarding`)

---

### Phase B: Client (hooks + component + i18n + contract mirror)

Completely independent of Phase A — no server files touched. Run in parallel with Phase A.

- [ ] `client/src/vendor/shared/contracts/brief.ts` — apply the identical contract changes: remove `Risks`, `PrHistoryItem`, `PrHistory`, `PrBrief`; add `Brief` schema with exact same field definitions as specified in Architecture Decisions. All other exports UNCHANGED. (This file is a manual copy of the server vendor file — keep them in sync.)

- [ ] `client/src/lib/api.ts` — add two exported fetch functions after the existing onboarding functions:
  ```typescript
  import type { Brief } from '@devdigest/shared';  // add to existing import if needed

  export function fetchPrBrief(prId: string): Promise<Brief | null> {
    return api.get<Brief>(`/pulls/${prId}/brief`).catch((e: ApiError) =>
      e.status === 404 ? null : Promise.reject(e)
    );
  }

  export function generateBrief(prId: string, opts?: { force?: boolean }): Promise<Brief> {
    return api.post<Brief>(`/pulls/${prId}/brief`, opts);
  }
  ```

- [ ] `client/src/lib/hooks/brief.ts` — new file:
  ```typescript
  "use client";
  // usePrBrief(prId) — useQuery calling fetchPrBrief; returns Brief | null (null on 404)
  // useGenerateBrief(prId) — useMutation calling generateBrief; on success: sets queryData
  //   for ['pr-brief', prId]; on error: calls notify.error; mirrors blast hook pattern
  ```
  - `usePrBrief(prId: string | null | undefined)` — `useQuery<Brief | null>({ queryKey: ['pr-brief', prId], queryFn: () => fetchPrBrief(prId!), enabled: !!prId })`
  - `useGenerateBrief(prId: string | null | undefined)` — `useMutation<Brief, Error, { force?: boolean } | undefined>({ mutationFn: (opts) => generateBrief(prId!, opts), onSuccess: (data) => qc.setQueryData(['pr-brief', prId], data), onError: (err) => notify.error(\`Brief generation failed: ${err.message}\`) })`

- [ ] `client/src/lib/hooks/index.ts` — add `export * from './brief'` (following the existing barrel pattern for hooks in this file)

- [ ] `client/messages/en/brief.json` — add `brief` nested object inside the existing `block` object. Do NOT remove or rename any existing key. The existing `block` already contains `intent`, `blast`, `risks`, `history`. Add `brief` alongside them:
  ```json
  {
    "block": {
      "intent": "Intent",
      "blast": "Blast radius",
      "risks": "Risks",
      "history": "PR history",
      "brief": {
        "label": "Why + Risk Brief",
        "what": "What changed",
        "why": "Why it's needed",
        "riskLevel": "Merge risk",
        "reviewFocus": "Where to focus",
        "generate": "Generate brief",
        "regenerate": "Regenerate"
      }
    }
  }
  ```
  Preserve all other top-level keys in the file unchanged. The `why.*` namespace is reserved for the git-blame ("git-why") feature — do not extend or repurpose it.

- [ ] `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/styles.ts` — inline style objects following the `IntentCard/styles.ts` pattern (card container, header row, body text, badge variants for `low`/`medium`/`high` risk levels, footer row)

- [ ] `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.tsx` — feature component:
  - `"use client"` directive
  - Props: `{ prId: string }`
  - Uses `usePrBrief(prId)` and `useGenerateBrief(prId)`
  - When loading: return null (same pattern as IntentCard)
  - When `data === null` (no brief yet): render generate button calling `mutate({})`; button disabled while `isPending`
  - When `data` present: render card with:
    - `what` paragraph
    - `why` paragraph
    - `risk_level` coloured badge (`low` → green, `medium` → amber, `high` → red)
    - `review_focus` as an ordered bullet list
    - `risks` array: each risk renders its title, explanation, severity badge, and `file_refs` as clickable file-path links (same file-link convention used in blast/smart-diff views)
    - Regenerate button calling `mutate({ force: true })` when brief exists
  - All user-visible strings via `useTranslations('brief')` with `block.brief.*` key prefix
  - Use `SectionLabel` from `@devdigest/ui` (same as IntentCard) for section heading

- [ ] `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/index.ts` — barrel: `export { PrBriefCard } from './PrBriefCard'`

- [ ] `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx` — mount `<PrBriefCard prId={prId} />` after `<IntentCard prId={prId} />` (spec: "alongside the existing IntentCard"); `prId` prop is already present in this component

---

### Phase C: Tests (sequential — requires Phase A and Phase B to be complete)

- [ ] `server/src/modules/brief/brief.test.ts` — Vitest unit tests using mock container and mock LLM. Use `buildContainer(config, { llm: mockLlm })` pattern from existing tests.

  **AC-1 / AC-3 (cache hit, no second LLM call):**
  - Seed a `pr_brief` row via `upsertBrief()`
  - Call `service.generate(workspaceId, prId, {})` — no `force`
  - Assert `mockLlm.completeStructured` was NOT called
  - Assert returned `Brief` matches the seeded row's `json`

  **AC-6 (file_refs hallucination rejection):**
  - Configure mock LLM to return a `Brief` whose first risk includes `file_refs: ['src/nonexistent.ts']` — a path NOT present in the blast/smart-diff file set
  - Call `service.generate(workspaceId, prId, { force: true })`
  - Assert the returned `Brief` has no `file_refs` entry equal to `'src/nonexistent.ts'` in any risk
  - Assert WARN log was called with `{ prId, riskTitle: ..., excludedPath: 'src/nonexistent.ts' }`
  - Assert the risk object is still present in `risks` with `file_refs: []`

  **AC-7 (prompt budget trim proxy test):**
  - Extract the user-message assembly into a pure helper function (or test via a spy on the assembled message passed to `completeStructured`)
  - Construct input: PR body 2,000 chars, context docs 10,000 chars
  - Assert assembled user-message length ≤ 8,192 chars
  - Assert context docs are trimmed before PR body (swap trim order in a separate assertion: verify that reducing context first and body second yields a shorter message than doing it the other way)
  - Assert WARN log is emitted when trimming occurs

  **AC-8 (force regenerate):**
  - Seed `pr_brief` row with known `generatedAt`
  - Call `service.generate(workspaceId, prId, { force: true })`
  - Assert `mockLlm.completeStructured` WAS called (one call)
  - Re-read the `pr_brief` row from DB; assert `generatedAt` is strictly later than the seeded value

  **AC-9 (no intent row — degraded path):**
  - Call `service.generate()` on a PR that has no `pr_intent` row in the DB
  - Assert the call returns a well-formed `Brief` object
  - Assert no error is thrown

- [ ] `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.test.tsx` — RTL tests (jsdom, fetch mocked via `src/test/setup.ts`):
  - Mock `usePrBrief` returning `null` → generate button is rendered; regenerate button is absent
  - Mock `usePrBrief` returning a valid `Brief` fixture → `what` text, `why` text, `risk_level` badge, `review_focus` list, and at least one risk with its title and `file_refs` are all rendered
  - Clicking the generate button calls `generateBrief` mutation (`mutate({})`)
  - Clicking the regenerate button calls `generateBrief` mutation with `{ force: true }`
  - `Brief` test fixture must include all 5 required fields to avoid TS2741 (per client/insights recurring error)

---

## Gotchas
- **Migrations never auto-run.** After `pnpm db:generate` and committing the migration file, run `cd server && pnpm db:migrate` before starting the server or running integration tests.
- **`generated_at` column needs a DB-level default for migration safety.** Define it as `.notNull().default(sql\`now()\`)` in the Drizzle schema. A bare `.notNull()` without a default will cause the `ALTER TABLE ADD COLUMN` to fail on a non-empty `pr_brief` table. Review the generated migration SQL before applying: it must contain `DEFAULT now()` on the `generated_at` column.
- **Do not hand-edit `server/src/db/schema/`.** Only generate via `pnpm db:generate`; never modify the SQL files under `server/src/db/migrations/` manually.
- **Phase B contract must match Phase A field-for-field.** Both `vendor/shared/contracts/brief.ts` files (server and client) must export the same `Brief` definition. `pnpm typecheck` in each package will surface any drift between the two independent copies.
- **Linked-issue extraction does NOT call GitHub.** Use `pull.body?.match(/(?:closes?|fixes?|resolves?)\s+#(\d+)/i)` and include only the issue number string. Do NOT invoke `this.container.github().getIssue()`. This is a deliberate difference from `IntentClassifier.resolveLinkedIssue()`.
- **LLM failure must NOT overwrite the cache.** Call `upsertBrief()` only after a successful return from `completeStructured()`. On any exception, throw `BadGatewayError` before the upsert. Any pre-existing cache row must remain untouched.
- **`why.*` i18n namespace is reserved for the git-blame ("git-why") feature.** Add only under `block.brief.*`. Do not extend or rename the existing `why.*` keys.
- **Client vendor/shared is a manual copy — never a symlink or cross-package import.** Both `brief.ts` files must be updated independently: Phase A updates `server/src/vendor/shared/contracts/brief.ts`; Phase B updates `client/src/vendor/shared/contracts/brief.ts`. There is no build-time enforcement of parity.
- **Test `Brief` fixtures must conform to the real Zod schema.** `MockLLMProvider.completeStructured` validates fixtures against the real schema. An invalid fixture (e.g., wrong `risk_level` value or missing a required field) throws inside the service, and the symptom appears as "LLM was not called" rather than "fixture is invalid". Validate fixture objects with `Brief.parse(fixture)` in the test file before relying on them.
- **Module registration requires only `modules/index.ts`.** `app.ts` iterates `Object.values(modules)` automatically — no change to `app.ts` is needed when adding the `brief` key to the `modules` record.

---

## Definition of done
- [ ] `cd server && pnpm test` passes (unit + integration)
- [ ] `cd client && pnpm test` passes
- [ ] `cd server && pnpm typecheck` reports no errors
- [ ] `cd client && pnpm typecheck` reports no errors
- [ ] **AC-1:** `GET /pulls/:id/brief` with a cached row returns HTTP 200 with a well-formed `Brief`; server logs contain no second LLM generation call entry
- [ ] **AC-2:** `GET /pulls/:id/brief` on a PR with no cached row returns HTTP 404
- [ ] **AC-3:** `POST /pulls/:id/brief` (no `force`) with a cached row returns HTTP 200 Brief from cache; no LLM call in logs
- [ ] **AC-4:** `POST /pulls/:id/brief` with a PR UUID from a different workspace returns HTTP 404
- [ ] **AC-5:** `POST /pulls/:id/brief` on a fresh PR returns HTTP 200 with `Brief` containing `what`, `why`, `risk_level`, `risks`, `review_focus`; the `pr_brief` DB row now exists with `model`, `tokens_in`, `tokens_out`, `cost_usd`, `generated_at` populated; INFO log contains those fields plus `promptChars`
- [ ] **AC-6:** hallucinated `file_refs` paths are removed before return; WARN log emitted per removed path; the risk entry is still present in the `risks` array with `file_refs: []`
- [ ] **AC-7:** assembled user-message is ≤ 8,192 characters; context docs are trimmed before PR body (order verified in the unit test); WARN log is emitted when trimming occurs
- [ ] **AC-8:** `POST /pulls/:id/brief` with `force: true` triggers a new LLM call and overwrites the cache; the `generated_at` in the re-read DB row is strictly later than the previous value
- [ ] **AC-9:** `POST /pulls/:id/brief` on a PR with no `pr_intent` row returns HTTP 200 with a valid `Brief`; no error is thrown or propagated
