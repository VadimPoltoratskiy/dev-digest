# Plan: Onboarding Generator (SPEC-01)

## Spec reference
`specs/SPEC-01-onboarding-generator.md`

## Execution mode: multi-agent
Three independent phases — one implementer each, all running in parallel. No phase depends on another's output because each targets disjoint file sets and the API contract (server ↔ client boundary) is fully defined in the spec and in the already-frozen shared Zod contracts.

**Conflict analysis (verified):**
- Phase A (server): touches only `server/` files.
- Phase B (client modal/nav): creates `client/src/components/add-repo-modal/AddRepoView/` (copy of current file — does NOT delete the original), updates `client/src/components/app-shell/`, `client/src/app/page.tsx` (root page), `client/src/components/repo-not-found/`, `client/CLAUDE.md`. Does NOT delete `client/src/app/onboarding/_components/AddRepoView/` and does NOT touch `client/src/app/onboarding/page.tsx`.
- Phase C (client tour page): creates `client/src/app/onboarding/_components/OnboardingView/` and `OnboardingSectionCard/`, rewrites `client/src/app/onboarding/page.tsx` (removing the `AddRepoView` import — making the original `_components/AddRepoView/` folder orphaned dead code), then explicitly deletes the now-orphaned `_components/AddRepoView/` folder. Also touches `client/src/lib/api.ts`, `client/src/lib/hooks/`, `client/src/components/mermaid-diagram/MermaidDiagram.tsx`, `client/messages/en/onboarding.json`.

**Independence guarantee:** Phase B copies `AddRepoView` to a new shared location but does NOT delete the original — so the original `page.tsx` (which still imports from the old path) remains `tsc`-valid during Phase B's window. Phase C rewrites `page.tsx` to import `OnboardingView` and then deletes the original `AddRepoView` folder — these happen atomically within Phase C. No file overlap between phases. All three agents may start immediately.

---

## Goal
New contributors to an indexed repository spend hours reading READMEs and tracing call paths before they can contribute. The Onboarding Generator surfaces a 5-section newcomer tour — Architecture Overview, Critical Paths, How to Run Locally, Guided Reading Order, First Tasks — produced in a single structured LLM call grounded in deterministic artifacts already indexed by DevDigest. The current `/onboarding` route (which holds the add-repository form) is repurposed for the tour; the add-repo form moves to a modal triggered from the repo switcher and empty-state CTAs throughout the app.

---

## Modules affected
- `server/` — new `onboarding` feature module (routes → service → repository + facts collector helper); prompt file fix; module registration in `index.ts`. No DB migration needed.
- `client/` — new `OnboardingView` tour page at `/onboarding`; new `AddRepoModal` shared component; four nav call-site rewires; `MermaidDiagram` accessible alt-text addition; new TanStack Query hooks + API functions.

---

## Engineering Insights applied
- **Cost stays in service, never in shared DTOs.** Per `server/insights/INSIGHTS.md:2026-06-25`, cost-related fields (like `costUsd`) are never bolted onto primary domain objects. The service logs cost via `app.log.info({ repoId, costUsd }, 'onboarding tour generated')` (Pino, not `console.log`) and never serializes it to the client.
- **`.nullish()` vs `.nullable()` for optional fields.** Any field absent on some producers should use `.nullish()`; `.nullable()` only when all producers always supply it. The local `OnboardingGenerateResponse` type uses `degraded: z.boolean().optional()`.
- **`useActiveRepo()` for repo-scoped pages without a URL `:repoId`.** Per `client/insights/INSIGHTS.md:2026-07-06`, the `OnboardingView` must use `useActiveRepo()` from `lib/repo-context.tsx` — not prop-drilling, consistent with `ConventionsView`.
- **New shared components belong in `components/`.** Per `client/insights/INSIGHTS.md:2026-06-25`, `AddRepoModal` is triggered from `AppShell`, `page.tsx` (root), and `RepoNotFound` — it belongs in `components/add-repo-modal/`.
- **No `useEffect + useState` for server data.** Per `client/insights/INSIGHTS.md` and `react-best-practices`, onboarding data goes through TanStack Query hooks.
- **Integration test mock fixtures must be updated when contracts extend.** Per `server/insights/INSIGHTS.md:2026-07-06`, `MockLLMProvider.completeStructured` in `mocks.ts` validates fixtures against real schemas — any new `OnboardingSection` fixture must use the exact `kind` values chosen here.

---

## Recommendations
- **Merge facts-collector logic into `helpers.ts` rather than a separate adapter.** The facts collector reads local filesystem paths and calls the repo-intel facade — it is orchestration, not an external integration. Placing it in a `helpers.ts` file (pure functions called by the service) keeps it testable without creating an unnecessary adapter layer. Per onion-architecture SKILL.md, `helpers.ts` = pure DTO converters and mapping functions.
- **Use `z.string().uuid()` for the `repoId` param in both routes.** The spec requires 422 on invalid UUID. `fastify-type-provider-zod` rejects invalid UUIDs automatically at the route boundary if `params: z.object({ repoId: z.string().uuid() })` is declared. No manual validation needed in the handler.
- **Validate and strip `OnboardingLink.path` values against the full file tree before persistence.** Do this in the service after receiving the LLM response — strip any link whose `path` is not present in `bundle.allDiscoveredFiles` (the complete 2-level FS scan, NOT a rank-limited slice). This prevents hallucinated or injected paths from reaching the DB (spec: Untrusted Inputs table).

---

## Architecture decisions

### Section `kind` values (implementer must use these exact strings)
The spec leaves the five kind values as an explicit planner decision. The chosen values — snake_case, consistent with existing enums (`flag_off`, `index_failed`, etc.), and semantically clear — are:

| Section | `kind` string | Diagram allowed? |
|---|---|---|
| Architecture Overview | `architecture_overview` | Yes |
| Critical Paths | `critical_paths` | Yes |
| How to Run Locally | `how_to_run` | No |
| Guided Reading Order | `reading_order` | No |
| First Tasks | `first_tasks` | No |

These values flow into three places: (1) the updated `onboarding.system.md` prompt, (2) the server service's section ordering and skeleton builder, (3) the client `OnboardingSectionCard` for section-specific rendering. `kind` is `z.string()` in the frozen shared contract — drift produces silent UI bugs, not a type error. Two safety nets are required: (a) a server-side post-parse assertion in `generateTour` that the 5 returned sections have exactly the expected kinds in order (throws `AppError('invalid_tour_output')` if not), and (b) client-side tests that pin the expected kind strings as literals (see C-8).

### `degraded` field placement
The frozen shared `Onboarding` contract (`sections: OnboardingSection[]`) has no room for `degraded`. Per spec, `degraded: true` is a POST-only response envelope field — not a tour property. Both sides use a local extension:
- Server routes: local response shape `Onboarding & { degraded?: boolean; generatedAt: string }`
- Client hooks: `type OnboardingGenerateResponse = Onboarding & { degraded?: boolean; generatedAt: string }`

The shared contracts in `server/src/vendor/shared/` and `client/src/vendor/shared/` are NOT modified.

### `workspaceId` threading (security requirement)
The `onboarding` table has no `workspaceId` column — it is keyed only by `repoId`. However, all service methods accept `workspaceId` and pass it to `repository.getClonePath(repoId, workspaceId)`, which queries `repos` with `WHERE id = $repoId AND workspace_id = $workspaceId`. If that row is not found (repo does not exist or belongs to a different workspace), the repository returns `null`, the service throws `NotFoundError`, and the route returns 404. This mirrors the scoping pattern in `conventions/routes.ts:42-48`. `getContext()` is called in every route handler and `workspaceId` is threaded to every service call — never discarded.

### LLM call pattern (verified against `conventions/service.ts:88-105`)
The correct call sequence:
1. `const { provider, model } = await resolveFeatureModel(container, workspaceId, 'onboarding')` — from `server/src/modules/settings/feature-models.ts:51`.
2. `const llm = await container.llm(provider)` — `container.llm(id: 'openai'|'anthropic'|'openrouter')` requires a provider id (verified: `container.ts:163`).
3. `llm.completeStructured({ model, schemaName, schema, messages, maxTokens, temperature })` — one object argument (verified: `conventions/service.ts:91-105`).

### No-key error remapping (AC-9)
`container.llm(provider)` throws `ConfigError` (code: `'config_error'`, statusCode: 500 — verified: `errors.ts:37-40`) when the API key is absent. This propagates as a generic 500 if unhandled (the conventions precedent at service.ts:86-88 intentionally lets it propagate). The onboarding service must NOT follow that precedent here because AC-9 requires a 503 the client renders as a Settings notice. Wrap `await container.llm(provider)` in try-catch; if the caught error `instanceof ConfigError` (or has `code === 'config_error'`), rethrow as `new AppError('no_llm_key', '…', 503)`. The global error handler in `app.ts` then serializes this as `503 { error: { code: 'no_llm_key', … } }`.

### Degraded branch logic (uses real `IndexStatus` and `DegradedReason`)
`IndexStatus` = `'full' | 'partial' | 'degraded' | 'failed'` — verified at `repo-intel/types.ts:25`. No `'unknown'` member exists. `DegradedReason` = `'flag_off' | 'index_failed' | 'index_partial' | 'repo_too_large' | 'no_data'` — verified at `types.ts:27-33`.

Branch decision:
- **Full path** (LLM call): `state.status === 'full' || state.status === 'partial'`
- **Skeleton path** (no LLM call, returns `degraded: true`): `state.status === 'degraded' || state.status === 'failed'`

All five `DegradedReason` values result in the skeleton path in v1 (spec Edge cases 1 & 7). The `degradedReason` is logged for observability but does not change the code path. `getIndexState` also covers the `repoIntelEnabled === false` case (`degradedReason: 'flag_off'`) — no separate flag check needed.

`getIndexState(repoId)` always returns an `IndexState` without throwing (synthesises `status: 'degraded', degradedReason: 'no_data'` when no row exists — verified at `service.ts:189-205`).

### `routeList` is empty in v1 (explicit decision, not implementer judgment)
No route-list method exists on `RepoIntelService` (verified by code search). Per AC-1's qualifier "if available from the repo index", `routeList` is hardcoded to `[]` in the facts collector for v1.

### `allDiscoveredFiles` as `knownPaths` source (not rank-limited slice)
`validateAndStripLinks` must check paths against `bundle.allDiscoveredFiles` — the complete flat list of all files found during the 2-level FS scan. Using `topRankedFiles` (top 20) + `criticalPaths` would silently strip legitimate links to any file outside the top 20, defeating the grounding validation.

### Corrupt stored `json` recovery
`getTour` uses `Onboarding.safeParse(stored.json)`. On parse failure (corrupt row), it logs a warning and returns `null` — treating it identically to "no tour yet". This allows the client to show the Generate CTA, and the next generation overwrites the corrupt row. Throwing on parse failure would leave the tour permanently at a 500 error with no user-reachable recovery path.

### No migration needed
`server/src/db/schema/context.ts:120–126` already defines the `onboarding` table with `repoId UUID PK → repos.id (cascade)`, `json jsonb NOT NULL`, `generated_at timestamptz NOT NULL DEFAULT NOW()`. Confirmed byte-for-byte. No `pnpm db:generate` or `pnpm db:migrate` step is included in this plan.

---

## Tasks

### Phase A: Server — Onboarding Module (self-contained; no dependencies on B or C)

#### A-1. Prompt fix — align `onboarding.system.md` with the chosen section kinds
- [ ] `server/src/prompts/onboarding.system.md` — make exactly these changes (do not change any other prose):
  1. Line 7: change `"allowed ONLY for the \`architecture\` and \`routes_and_apis\` sections, else null"` to `"allowed ONLY for the \`architecture_overview\` and \`critical_paths\` sections, else null"`.
  2. Lines 24–27 (section-specific formatting hints): remove the `routes_and_apis` bullet entirely; change `"In \`architecture\`: include one simple mermaid \`diagram\` of how the pieces connect."` to `"In \`architecture_overview\`: include one simple mermaid \`diagram\` of how the pieces connect. In \`critical_paths\`: describe dependency chains clearly; a mermaid diagram is allowed but optional."`.
  3. Verify `{{sections}}` and `{{language}}` placeholders remain intact — they are filled at runtime by the service.

#### A-2. Module types
- [ ] `server/src/modules/onboarding/types.ts` — define:
  ```typescript
  import type { IndexStatus } from '../repo-intel/types.js';

  export interface FactsBundle {
    runtimeName: string | null;           // from engines.node
    frameworkNames: string[];             // detected from topLevelDeps keys
    runScripts: Record<string, string>;   // package.json scripts; empty if no package.json
    engines: Record<string, string>;      // package.json engines; empty if absent
    topLevelDeps: Record<string, string>; // dependencies + devDependencies merged
    directoryTree: string;               // compact indented tree string (2 levels, for prompt)
    allDiscoveredFiles: string[];         // COMPLETE flat file list from 2-level FS scan
    topRankedFiles: string[];            // from repo-intel getTopFilesByRank(repoId, 20)
    criticalPaths: string[][];           // from repo-intel getCriticalPaths(repoId)
    routeList: string[];                 // always [] in v1
    indexStatus: IndexStatus;            // 'full'|'partial'|'degraded'|'failed' — set by service
  }

  export const ONBOARDING_SECTIONS = [
    { kind: 'architecture_overview', title: 'Architecture Overview' },
    { kind: 'critical_paths',        title: 'Critical Paths'        },
    { kind: 'how_to_run',            title: 'How to Run Locally'    },
    { kind: 'reading_order',         title: 'Guided Reading Order'  },
    { kind: 'first_tasks',           title: 'First Tasks'           },
  ] as const;
  export type OnboardingSectionKind = (typeof ONBOARDING_SECTIONS)[number]['kind'];
  ```

#### A-3. Repository layer
- [ ] `server/src/modules/onboarding/repository.ts` — define `OnboardingRepository` class accepting `Db`:
  - `findByRepoId(repoId: string): Promise<{ json: unknown; generatedAt: Date } | null>` — `SELECT json, generated_at FROM onboarding WHERE repo_id = $repoId`.
  - `upsert(repoId: string, json: unknown): Promise<Date>` — INSERT ON CONFLICT (repo_id) DO UPDATE SET json = EXCLUDED.json, generated_at = NOW() using `.onConflictDoUpdate(...)`. Return the persisted `generatedAt` — use `.returning({ generatedAt: onboarding.generatedAt })` and return the first row's value (or capture `new Date()` immediately before the upsert and return it if `.returning()` is not suitable for the update path).
  - `getClonePath(repoId: string, workspaceId: string): Promise<string | null>` — `SELECT clone_path FROM repos WHERE id = $repoId AND workspace_id = $workspaceId`. Returns `null` if no row found (repo doesn't exist or belongs to a different workspace — security scoping).
  - Import `onboarding` from `../../db/schema/context.js`; import `repos` from `../../db/schema/repos.js`.
  - **Layer rule:** returns raw DB types only. No DTO conversion or business logic.

#### A-4. Facts collector + helpers
- [ ] `server/src/modules/onboarding/helpers.ts` — pure helper functions (no class, no container):

  **`collectFacts(params: { repoId: string; clonePath: string; repoIntelSvc: RepoIntelService }): Promise<Omit<FactsBundle, 'indexStatus'>>`**
  1. Try `fs.promises.readFile(path.join(clonePath, 'package.json'), 'utf-8')` → `JSON.parse`. On any error: `runScripts = {}`, `engines = {}`, `topLevelDeps = {}`, `runtimeName = null`, `frameworkNames = []`.
  2. If parsed: extract `scripts` → `runScripts`; `engines` → `engines`; merge `dependencies + devDependencies` → `topLevelDeps`; detect `runtimeName = ('node' in engines) ? 'node' : null`; detect `frameworkNames` by checking `topLevelDeps` keys against the set `['react', 'next', 'vue', 'nuxt', 'express', 'fastify', 'koa', 'hapi', 'nestjs', '@nestjs/core', 'angular', '@angular/core', 'svelte', 'remix', '@remix-run/node', 'astro']`.
  3. Scan directory tree two levels. Skip `.git`, `node_modules`, `.next`, `dist`, `build`, `coverage`, `.cache` at both levels. Produce two outputs from this scan: `directoryTree` (compact indented string for prompt injection) and `allDiscoveredFiles` (flat `string[]` of all file relative paths found — this is the knownPaths source for link validation, not the rank-limited list).
  4. `topRankedFiles = await repoIntelSvc.getTopFilesByRank(repoId, 20)`.
  5. `criticalPaths = await repoIntelSvc.getCriticalPaths(repoId)`.
  6. `routeList = []` (no route-list facade method exists in v1 — explicit v1 decision).
  7. Return the assembled bundle (without `indexStatus` — service sets that after `getIndexState`).

  **`buildSkeleton(bundle: Omit<FactsBundle, 'indexStatus'>): Onboarding`**
  - Returns exactly 5 `OnboardingSection` records in the order defined by `ONBOARDING_SECTIONS`.
  - `diagram: null` on all sections.
  - `links: []` on all sections.
  - `how_to_run` body: include detected scripts from `bundle.runScripts` and engine requirements from `bundle.engines`; if both are empty, acknowledge the absence.
  - `architecture_overview` body: include `bundle.directoryTree`.
  - Other sections: acknowledge limited data without inventing paths.

  **`fillPrompt(template: string, bundle: Omit<FactsBundle, 'indexStatus'>): { system: string; user: string }`**
  - Replace `{{sections}}` with ordered list of kind + title from `ONBOARDING_SECTIONS` (e.g., `"1. architecture_overview — Architecture Overview\n2. critical_paths — Critical Paths\n…"`).
  - Replace `{{language}}` with `"English"`.
  - Assemble user message with labeled fact blocks. Wrap all repo-sourced values (scripts, file names, directory names, dependency names) in `<untrusted>…</untrusted>` blocks as required by the spec's security model.

  **`validateAndStripLinks(sections: OnboardingSection[], knownPaths: Set<string>): OnboardingSection[]`**
  - Strip any `OnboardingLink.path` value whose path is NOT in `knownPaths`.
  - Build `knownPaths` in the caller from `bundle.allDiscoveredFiles` — the complete 2-level FS scan, NOT from `topRankedFiles + criticalPaths`.

#### A-5. Service layer
- [ ] `server/src/modules/onboarding/service.ts` — `OnboardingService` class with `constructor(private container: Container)`. Imports: `resolveFeatureModel` from `'../settings/feature-models.js'`; `ConfigError`, `AppError`, `NotFoundError` from `'../../platform/errors.js'`; `Onboarding` from `'@devdigest/shared'`; `RepoIntelService` from `'../repo-intel/index.js'`; helpers from `'./helpers.js'`; `ONBOARDING_SECTIONS` from `'./types.js'`.

  **`getTour(workspaceId: string, repoId: string): Promise<(Onboarding & { generatedAt: Date }) | null>`**
  1. `const repo = new OnboardingRepository(this.container.db)`.
  2. Scope check: `const clonePath = await repo.getClonePath(repoId, workspaceId)`. If `null`, throw `new NotFoundError('Repository not found')`.
  3. `const stored = await repo.findByRepoId(repoId)`. If `null`, return `null`.
  4. `const parsed = Onboarding.safeParse(stored.json)`. If `!parsed.success`: log warning `this.container.log?.warn({ repoId }, 'stored onboarding json is corrupt; treating as no tour')` and return `null` (do NOT throw — this allows the Generate CTA to appear and overwrite the corrupt row).
  5. Return `{ ...parsed.data, generatedAt: stored.generatedAt }`.

  **`generateTour(workspaceId: string, repoId: string, logger: FastifyBaseLogger): Promise<{ tour: Onboarding; degraded: boolean; generatedAt: Date }>`**
  1. `const repo = new OnboardingRepository(this.container.db)`.
  2. `const clonePath = await repo.getClonePath(repoId, workspaceId)`. If `null`, throw `new NotFoundError('Repository not found')`.
  3. `const riSvc = new RepoIntelService(this.container)`.
  4. `const state = await riSvc.getIndexState(repoId)` — always returns, never throws.
  5. `const bundle = await collectFacts({ repoId, clonePath, repoIntelSvc: riSvc })`.
  6. **Skeleton path** — when `state.status === 'degraded' || state.status === 'failed'`:
     ```typescript
     logger.info({ repoId, degradedReason: state.degradedReason }, 'onboarding: generating skeleton (degraded index)');
     const skeleton = buildSkeleton(bundle);
     const generatedAt = await repo.upsert(repoId, skeleton);
     return { tour: skeleton, degraded: true, generatedAt };
     ```
  7. **Full path** — when `state.status === 'full' || state.status === 'partial'`:
     ```typescript
     const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'onboarding');

     let llm: LLMProvider;
     try {
       llm = await this.container.llm(provider);
     } catch (err) {
       if (err instanceof ConfigError || (err as { code?: string }).code === 'config_error') {
         throw new AppError(
           'no_llm_key',
           'No model key is configured for the Onboarding Tour feature. Add your API key in Settings → API Keys.',
           503,
         );
       }
       throw err;
     }

     const template = await fs.promises.readFile(
       new URL('../../prompts/onboarding.system.md', import.meta.url), 'utf-8',
     );
     const { system, user } = fillPrompt(template, bundle);

     const result = await llm.completeStructured({
       model,
       schemaName: 'Onboarding',
       schema: Onboarding,
       messages: [
         { role: 'system', content: system },
         { role: 'user', content: user },
       ],
       maxTokens: 8192,
       temperature: 0,
     });

     // Zod's z.string() kind field will NOT reject wrong kinds — assert explicitly.
     const expectedKinds = ONBOARDING_SECTIONS.map(s => s.kind);
     const actualKinds = result.data.sections.map(s => s.kind);
     if (actualKinds.length !== 5 || !expectedKinds.every((k, i) => k === actualKinds[i])) {
       throw new AppError('invalid_tour_output', 'LLM returned sections with wrong kind values or count', 422);
     }

     const knownPaths = new Set(bundle.allDiscoveredFiles);
     const tour: Onboarding = {
       sections: validateAndStripLinks(result.data.sections, knownPaths),
     };

     logger.info({ repoId, costUsd: result.costUsd }, 'onboarding tour generated');

     const generatedAt = await repo.upsert(repoId, tour);
     return { tour, degraded: false, generatedAt };
     ```

#### A-6. Routes layer
- [ ] `server/src/modules/onboarding/routes.ts` — default-exported Fastify plugin:
  ```typescript
  const RepoIdParams = z.object({ repoId: z.string().uuid() });
  // Invalid UUID → auto-422 by fastify-type-provider-zod before handler runs.
  ```

  **`GET /repos/:repoId/onboarding`:**
  - `const { workspaceId } = await getContext(container, req)`.
  - `const result = await service.getTour(workspaceId, req.params.repoId)`.
  - If `result === null` → `reply.status(404).send({ error: { code: 'not_found', message: 'No tour generated for this repository yet' } })`.
  - Else → return `{ ...result, generatedAt: result.generatedAt.toISOString() }`.

  **`POST /repos/:repoId/onboarding`:**
  - `const { workspaceId } = await getContext(container, req)`.
  - `const { tour, degraded, generatedAt } = await service.generateTour(workspaceId, req.params.repoId, req.log)`.
  - Return `{ ...tour, generatedAt: generatedAt.toISOString(), ...(degraded ? { degraded: true } : {}) }`.
  - `AppError(503, 'no_llm_key')` → global error handler → `503 { error: { code: 'no_llm_key', message: '…' } }`.
  - `NotFoundError` → 404. `AppError(422, 'invalid_tour_output')` → 422.

  Instantiate `const service = new OnboardingService(container)` once at plugin init.

#### A-7. Module registration
- [ ] `server/src/modules/index.ts` — add `import onboarding from './onboarding/routes.js'` and add `onboarding` to the `modules` record.

#### A-8. Tests (server)
- [ ] `server/src/modules/onboarding/onboarding.test.ts` — unit tests (hermetic, no DB):

  **Helper unit tests (pure functions, no mocks needed):**
  - `collectFacts` with mocked FS returning a known `package.json` → assert `runScripts`, `frameworkNames`, `directoryTree`, `allDiscoveredFiles` all populated correctly.
  - `collectFacts` when `package.json` absent → `runScripts = {}`, `frameworkNames = []`; `allDiscoveredFiles` still populated from FS scan.
  - `buildSkeleton` → assert exactly 5 sections in `ONBOARDING_SECTIONS` order; all `diagram: null`; all `links: []`; `how_to_run` body contains script text.
  - `fillPrompt` → assert `{{sections}}` replaced with all 5 entries; `{{language}}` replaced; untrusted values wrapped in `<untrusted>` blocks.
  - `validateAndStripLinks` → a path NOT in `knownPaths` is stripped; a valid path that is in the 2-level tree but NOT in `topRankedFiles` is KEPT (proves the full scan is used, not the rank-limited list); empty links pass through.

  **Service tests (use `buildContainer(config, { llm: { openrouter: mockLlm } })`):**

  - **Happy-path full generation:**
    - Fixture: 5 sections with correct kinds in order, `diagram: null`, `links: []`.
    - Mock `getIndexState` → `{ status: 'full' }`.
    - Mock `getClonePath` → valid temp path; mock FS with a `package.json`.
    - Mock `upsert` → returns `new Date()`.
    - Assert `mockLlm.calls.filter(c => c.method === 'completeStructured').length === 1`.
    - Assert returned `tour.sections.length === 5`.
    - Assert `tour.sections.map(s => s.kind)` equals `['architecture_overview', 'critical_paths', 'how_to_run', 'reading_order', 'first_tasks']` in that exact order.
    - Assert `degraded === false`.
    - Assert `upsert` called once with the repoId and tour object.

  - **Degraded skeleton — 5 named cases (one per `DegradedReason`):**
    - `flag_off`: mock `getIndexState` → `{ status: 'degraded', degradedReason: 'flag_off' }` → assert NO LLM call, `degraded === true`, `tour.sections.length === 5`.
    - `index_failed`: mock `getIndexState` → `{ status: 'failed', degradedReason: 'index_failed' }` → same.
    - `index_partial`: mock `getIndexState` → `{ status: 'degraded', degradedReason: 'index_partial' }` → same.
    - `repo_too_large`: mock `getIndexState` → `{ status: 'degraded', degradedReason: 'repo_too_large' }` → same.
    - `no_data`: mock `getIndexState` → `{ status: 'degraded', degradedReason: 'no_data' }` (synthesised by getIndexState when no row exists) → same.

  - **No-key path (AC-9):**
    - Mock `container.llm(provider)` to throw `new ConfigError('OPENROUTER_API_KEY is not configured')`.
    - Assert `generateTour` throws an error with `code === 'no_llm_key'` and `statusCode === 503`.
    - Assert NO `upsert` call.

  - **Invalid LLM output (wrong kind strings):**
    - Fixture: sections with `kind: 'architecture'` instead of `'architecture_overview'` (or any wrong value).
    - Assert `generateTour` throws with `code === 'invalid_tour_output'` and `statusCode === 422`.
    - Assert NO `upsert` call.

  - **Corrupt stored row:**
    - Mock `findByRepoId` → `{ json: { invalid: 'garbage' }, generatedAt: new Date() }` (fails Onboarding.safeParse).
    - Assert `getTour` returns `null` (does NOT throw).

  - **Cross-tenant access prevention:**
    - Mock `getClonePath(repoId, wrongWorkspaceId)` → `null`.
    - Assert `getTour(wrongWorkspaceId, repoId)` throws `NotFoundError`.
    - Assert `generateTour(wrongWorkspaceId, repoId, logger)` throws `NotFoundError`.

---

### Phase B: Client — AddRepoModal + Navigation Refactor (self-contained; no dependencies on A or C)

#### B-1. Copy AddRepoView to shared location (copy only — do NOT delete original)
- [ ] Create `client/src/components/add-repo-modal/AddRepoView/AddRepoView.tsx` — copy the contents of `client/src/app/onboarding/_components/AddRepoView/AddRepoView.tsx` here. All logic unchanged; only file path changes.
- [ ] Create `client/src/components/add-repo-modal/AddRepoView/index.ts` — barrel: `export { AddRepoView } from './AddRepoView'`.
- [ ] **Do NOT delete** `client/src/app/onboarding/_components/AddRepoView/` at this stage — Phase C owns that deletion (task C-6). Leaving it in place keeps the original `page.tsx` `tsc`-valid during Phase B's window.

#### B-2. Create AddRepoModal shared component
- [ ] `client/src/components/add-repo-modal/AddRepoModal.tsx` — `"use client"` component:
  - Props: `open: boolean; onClose: () => void`.
  - Renders a modal dialog (use `Dialog` or equivalent from `@devdigest/ui`; if no modal primitive exists, implement with a fixed-position overlay). Contains `<AddRepoView />` from `./AddRepoView` and a close button.
  - `aria-modal="true"`, `role="dialog"`. Focus-trap on open; `Escape` triggers `onClose`.
  - All UI strings via `next-intl`.
- [ ] `client/src/components/add-repo-modal/index.ts` — barrel: `export { AddRepoModal } from './AddRepoModal'`.

#### B-3. Wire modal into AppShell
- [ ] `client/src/components/app-shell/hooks/useShellContext.ts`:
  1. Add `onAddRepo: () => void` to the `ShellContextOptions` interface (consistent with existing `onOpenCommandPalette` pattern).
  2. Remove the internal `const onAddRepo = React.useCallback(() => router.push('/onboarding'), [router])`.
  3. In `onRemoveRepo` (line ~52), replace `router.push('/onboarding')` with `onAddRepo()`.
  4. Update `React.useMemo<ShellContext>` dependencies to include `onAddRepo`.
- [ ] `client/src/components/app-shell/AppShell.tsx`:
  1. Add `const [addRepoOpen, setAddRepoOpen] = React.useState(false)`.
  2. Add `const openAddRepo = React.useCallback(() => setAddRepoOpen(true), [])`.
  3. Pass `onAddRepo: openAddRepo` to `useShellContext(...)`.
  4. Import and render `<AddRepoModal open={addRepoOpen} onClose={() => setAddRepoOpen(false)} />` as a sibling of `<CommandPalette>` and `<ShortcutsHelp>`.

#### B-4. Update root page CTA
- [ ] `client/src/app/page.tsx`:
  1. Add `const [addRepoOpen, setAddRepoOpen] = React.useState(false)`.
  2. Change `onCta={() => router.push('/onboarding')}` to `onCta={() => setAddRepoOpen(true)}`.
  3. Import `AddRepoModal`; render `<AddRepoModal open={addRepoOpen} onClose={() => setAddRepoOpen(false)} />` at the bottom of `PageContainer`.
  4. Remove `useRouter` hook if no longer used in this file.

#### B-5. Update RepoNotFound CTA
- [ ] `client/src/components/repo-not-found/RepoNotFound.tsx`:
  1. Add `const [addRepoOpen, setAddRepoOpen] = React.useState(false)`.
  2. Change `onCta={() => router.push('/onboarding')}` to `onCta={() => setAddRepoOpen(true)}`.
  3. Import `AddRepoModal`; render `<AddRepoModal open={addRepoOpen} onClose={() => setAddRepoOpen(false)} />`.
  4. Remove `useRouter` import if no longer needed.

#### B-6. Update client CLAUDE.md
- [ ] `client/CLAUDE.md` — change `onboarding/  # add-repository form` to `onboarding/  # newcomer tour (add-repository form moved to AddRepoModal in components/add-repo-modal/)`.

#### B-7. Tests (Phase B)
- [ ] `client/src/components/add-repo-modal/AddRepoModal.test.tsx`:
  - `open={false}` → modal content not visible.
  - `open={true}` → modal renders and contains `AddRepoView`.
  - Escape key or close button calls `onClose`.
- [ ] Update/create `client/src/components/app-shell/AppShell.test.tsx` — verify `AddRepoModal` renders when `onAddRepo` is triggered.

---

### Phase C: Client — /onboarding Tour Page (self-contained; no dependencies on A or B)

> The API contract (GET/POST `/repos/:repoId/onboarding`) is fully defined in the spec's Service Contracts section. Phase C implements against that contract; Phase A implements the server side. They are independent. Phase C also owns the deletion of the old `_components/AddRepoView/` folder (B-1 does not delete it).

#### C-1. API functions
- [ ] `client/src/lib/api.ts` — add two exported functions:
  ```typescript
  export function fetchOnboardingTour(repoId: string): Promise<Onboarding & { generatedAt: string }> {
    return api.get(`/repos/${repoId}/onboarding`);
  }
  export function generateOnboardingTour(repoId: string): Promise<Onboarding & { generatedAt: string; degraded?: boolean }> {
    return api.post(`/repos/${repoId}/onboarding`);
    // No body argument — api.post(url) without body sends no Content-Type header,
    // which is correct (a bodyless POST with Content-Type: application/json errors in Fastify).
  }
  ```
  Import `Onboarding` from `@devdigest/shared`.

#### C-2. TanStack Query hooks
- [ ] `client/src/lib/hooks/onboarding.ts` — `"use client"`:
  - `useOnboardingTour(repoId: string | null | undefined)`:
    ```typescript
    useQuery<Onboarding & { generatedAt: string }>({
      queryKey: ['onboarding-tour', repoId],
      queryFn: () => fetchOnboardingTour(repoId!),
      enabled: !!repoId,
    });
    ```
    When server returns 404, `error` is `ApiError` with `status === 404` — differentiated from real errors in the component.
  - `useGenerateOnboarding(repoId: string | null | undefined)`:
    ```typescript
    useMutation<Onboarding & { generatedAt: string; degraded?: boolean }, Error>({
      mutationFn: () => generateOnboardingTour(repoId!),
      onSuccess: (data) => qc.setQueryData(['onboarding-tour', repoId], data),
    });
    ```
    On 503 `code === 'no_llm_key'`, mutation `error` has `(error as ApiError).code === 'no_llm_key'` — component handles as Settings notice, not error boundary.
- [ ] `client/src/lib/hooks/index.ts` — add `export * from './onboarding'`.

#### C-3. MermaidDiagram accessible alt text
- [ ] `client/src/components/mermaid-diagram/MermaidDiagram.tsx` — add `alt` prop:
  - Add `alt?: string` prop (default: `'Architecture diagram'`).
  - When rendering (`state === 'ok'`), wrap in:
    ```tsx
    <figure aria-label={alt}>
      <div ref={ref} style={{ display: 'flex', justifyContent: 'center', … }} />
      <figcaption style={{
        position: 'absolute', width: 1, height: 1, overflow: 'hidden',
        clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap'
      }}>
        {alt}
      </figcaption>
    </figure>
    ```
  - Use inline style for the visually-hidden pattern (do not assume `sr-only` Tailwind class exists — verify first; use inline style as the safe fallback).
  - `if (state === 'invalid') return null` path unchanged.

#### C-4. OnboardingSectionCard feature component
- [ ] `client/src/app/onboarding/_components/OnboardingSectionCard/OnboardingSectionCard.tsx` — `"use client"`:
  - Props: `section: OnboardingSection` (from `@devdigest/shared`).
  - `<h2>{section.title}</h2>` — landmark heading (spec accessibility AC).
  - `<Markdown>{section.body}</Markdown>` — from `@devdigest/ui`; sanitized. Verify it disallows `javascript:` URLs; if not, apply a URL transform prop or wrapper.
  - If `section.diagram != null`: `<MermaidDiagram chart={section.diagram} alt={section.title + ' diagram'} />`.
  - If `section.links.length > 0`: `<ul>` of links rendered as `<li><code>{link.path}</code></li>` (repo-relative paths, not hyperlinks).
  - UI label strings via `useTranslations('onboarding')`.
- [ ] `client/src/app/onboarding/_components/OnboardingSectionCard/index.ts` — barrel.

#### C-5. OnboardingView feature component
- [ ] `client/src/app/onboarding/_components/OnboardingView/OnboardingView.tsx` — `"use client"`:
  - `const { repoId } = useActiveRepo()` (from `lib/repo-context`).
  - `const tourQuery = useOnboardingTour(repoId)`.
  - `const generate = useGenerateOnboarding(repoId)`.
  - **State machine:**
    - `!repoId` → skeleton placeholders.
    - `tourQuery.isLoading` → 5 `<Skeleton>` placeholders.
    - `tourQuery.isError && (tourQuery.error as ApiError).status !== 404` → retryable error (EmptyState + retry button calling `tourQuery.refetch()`).
    - `tourQuery.isError && (tourQuery.error as ApiError).status === 404` → AC-6: Generate CTA. `<EmptyState onCta={() => generate.mutate()} />`. If `generate.isPending`, CTA shows `t('onboarding.generate.generating')` and is disabled.
    - `generate.isError && (generate.error as ApiError).code === 'no_llm_key'` → AC-9: no-key notice with `<Link href="/settings/api-keys">{t('onboarding.noKeySettingsLink')}</Link>`. No error boundary.
    - `generate.isError` (other) → inline error with try-again button.
    - `tourQuery.data` exists → show tour. Header row: "Regenerate" button (label: `generate.isPending ? t('onboarding.regenerating') : t('onboarding.regenerate')`; disabled when pending) + `t('onboarding.lastGenerated', { date: new Date(tourQuery.data.generatedAt).toLocaleString() })`.
    - `tourQuery.data.degraded === true` → degraded notice banner (`t('onboarding.degradedNotice')`).
    - `tourQuery.data.sections.map(s => <OnboardingSectionCard key={s.kind} section={s} />)`.
  - All strings via `useTranslations('onboarding')`.
- [ ] `client/src/app/onboarding/_components/OnboardingView/index.ts` — barrel.

#### C-6. Rewrite /onboarding page + delete old AddRepoView
- [ ] `client/src/app/onboarding/page.tsx` — replace entire contents:
  ```tsx
  "use client";
  import { OnboardingView } from "./_components/OnboardingView";
  export default function OnboardingPage() {
    return <OnboardingView />;
  }
  ```
- [ ] Delete `client/src/app/onboarding/_components/AddRepoView/AddRepoView.tsx`.
- [ ] Delete `client/src/app/onboarding/_components/AddRepoView/index.ts`.
- [ ] Remove the now-empty `client/src/app/onboarding/_components/AddRepoView/` directory.

#### C-7. i18n messages
- [ ] `client/messages/en/onboarding.json` — add the following keys (keep all existing keys intact):
  ```json
  {
    "degradedNotice": "Tour generated from limited index data — some sections may be incomplete.",
    "noKeyNotice": "No AI model key is configured for the Onboarding Tour. Add your OpenRouter API key in Settings to generate this tour.",
    "noKeySettingsLink": "Go to API Keys",
    "lastGenerated": "Last generated {date}",
    "retryError": "Generation failed. Check your API key and try again.",
    "relatedFiles": "Related files"
  }
  ```

#### C-8. Tests (Phase C)
- [ ] `client/src/app/onboarding/_components/OnboardingView/OnboardingView.test.tsx`:
  - Mock `useActiveRepo` → fixed `repoId`.
  - Mock `useOnboardingTour` with `ApiError` status 404 → "Generate Tour" CTA visible, no error boundary.
  - Mock `useOnboardingTour` with tour data → 5 section headings visible.
  - Mock `useOnboardingTour` with `{ degraded: true }` → degraded notice banner visible.
  - Mock `useGenerateOnboarding` error `code === 'no_llm_key'` → Settings link visible, no error boundary.
  - Mock `useGenerateOnboarding` pending → "Generating…" label; button disabled.
  - Mock tour data with `generatedAt` → assert timestamp displayed.
  - **Kind-string pin test (drift safety net):** assert rendered section headings appear in the exact order `['Architecture Overview', 'Critical Paths', 'How to Run Locally', 'Guided Reading Order', 'First Tasks']`. This test will fail if the server changes kind strings without a corresponding client update — necessary because `kind` is an unconstrained `z.string()` in the frozen contract and Zod will NOT catch drift.

- [ ] `client/src/app/onboarding/_components/OnboardingSectionCard/OnboardingSectionCard.test.tsx`:
  - `diagram: null` → no `<figure>` in DOM.
  - `diagram: 'flowchart LR…'` → `MermaidDiagram` rendered.
  - `links` present → `<ul>` with `<code>` paths rendered.
  - `<h2>` heading present (landmark check).

- [ ] `client/src/components/mermaid-diagram/MermaidDiagram.test.tsx` — add test: with `alt="Test description"`, `<figcaption>` contains "Test description".

---

## Gotchas

- **No migration.** The `onboarding` table already exists. Do NOT run `pnpm db:generate` or `pnpm db:migrate`.
- **Shared contracts are frozen.** `server/src/vendor/shared/contracts/knowledge.ts` and the client mirror must NOT be modified. `degraded` and `generatedAt` are route-local extension types only.
- **`kind` is `z.string()` — Zod will NOT reject wrong kind values from the LLM.** The safety nets are: (a) the explicit post-parse `kind` assertion in A-5 (throws `AppError('invalid_tour_output')` before upsert), and (b) the kind-string pin test in C-8. Do not assume the frozen Zod contract catches drift.
- **`container.llm(id)` throws `ConfigError` (statusCode 500), not a specialized no-key error.** Always wrap `container.llm(provider)` in try-catch and remap `ConfigError` to `AppError('no_llm_key', …, 503)`. Letting it propagate produces a generic 500 that the client cannot render as a Settings notice (AC-9 violation).
- **`resolveFeatureModel` requires `workspaceId`.** The `generateTour` method signature must include `workspaceId` or the call to `resolveFeatureModel(container, workspaceId, 'onboarding')` will not compile.
- **`workspaceId` must be passed to all service methods.** The `onboarding` table has no `workspace_id` column — scoping is enforced by querying `repos WHERE id = $repoId AND workspace_id = $workspaceId` in `getClonePath`. Omitting this check allows any authenticated user to read or generate another workspace's tour.
- **`allDiscoveredFiles` (full 2-level scan) is the `knownPaths` source — not `topRankedFiles`.** Using `topRankedFiles` (top 20) would silently strip legitimate links to files outside the top 20. `allDiscoveredFiles` must cover everything the LLM sees in the directory tree.
- **Prompt file MUST be updated.** `server/src/prompts/onboarding.system.md` references `architecture` and `routes_and_apis` for diagram allowance. If left unchanged, the LLM produces sections with those old `kind` values, the server's post-parse assertion fires, and generation permanently fails with `invalid_tour_output`. Update it before running integration tests.
- **Phase B does NOT delete `_components/AddRepoView/`.** Phase C handles that deletion in C-6. Phase B's deletion of the original would break the original `page.tsx`'s import path, making the codebase `tsc`-invalid before Phase C runs.
- **Bodyless POST from client.** `generateOnboardingTour` calls `api.post(url)` with no body argument. Do not pass `{}` — `api.post(url, {})` would serialize it to `"{}"` and set `Content-Type: application/json`, which causes Fastify to error ("Body cannot be empty when content-type is application/json") since no body schema is declared on the route.
- **`IndexStatus` has no `'unknown'` value.** The real union is `'full' | 'partial' | 'degraded' | 'failed'` — verified at `repo-intel/types.ts:25`. Do not add an `'unknown'` branch.
- **Cost logging only, never serialized.** `logger.info({ repoId, costUsd }, 'onboarding tour generated')` is server-side only. Do not add `costUsd` to any response DTO or shared contract field.
- **Integration test fixtures must pin exact `kind` strings.** `MockLLMProvider.completeStructured` validates fixtures against the real Zod schema — but since `kind` is `z.string()`, wrong kind values will NOT fail fixture parsing. They will fail the service's post-parse assertion instead, making tests appear to pass fixture validation but fail at the assertion step. Use exactly: `'architecture_overview'`, `'critical_paths'`, `'how_to_run'`, `'reading_order'`, `'first_tasks'`.

---

## Definition of done

- [ ] `pnpm test` passes in `server/` with no skipped onboarding-related tests.
- [ ] `pnpm test` passes in `client/` with no skipped onboarding-related tests.
- [ ] `pnpm tsc --noEmit` reports no errors in `server/`.
- [ ] `pnpm tsc --noEmit` reports no errors in `client/`.
- [ ] **AC-1** The system shall collect a deterministic facts bundle from the repository before any LLM call; the bundle shall include: detected runtime and framework names (from package manifest files and lock files), run scripts (from the package manifest), top-level directory tree structure (two levels deep), top-N files by PageRank-derived rank, dependency chains from the import graph, and API/route list if available from the repo index.
- [ ] **AC-2** WHEN tour generation is triggered for a repository whose index status is `full` or `partial`, the system shall issue exactly one structured LLM call using the "Onboarding Tour" feature-model slot and the existing onboarding system prompt, producing exactly 5 section records covering: Architecture Overview, Critical Paths, How to Run Locally, Guided Reading Order, and First Tasks — in that order. The "First Tasks" section content shall be inferred by the LLM solely from the deterministic facts bundle already collected (codebase structure, stack, test layout, scripts); no GitHub good-first-issue label data is fetched.
- [ ] **AC-3** WHEN the structured LLM call completes successfully, the system shall persist the full tour as a single JSON blob in the `onboarding` table keyed by repository ID, overwriting any prior entry for that repository.
- [ ] **AC-4** IF the repository's index status is `degraded`, `failed`, or the repo-intel flag is off at the time generation is triggered, THEN the system shall return a deterministic fallback skeleton — 5 section records with the correct section kind identifiers and display titles, bodies generated solely from the deterministic facts available (scripts, stack, directory tree) without calling the LLM, and empty link arrays — rather than an error response.
- [ ] **AC-5** WHILE a valid cached tour exists for the active repository in the `onboarding` table, the client `/onboarding` route shall display all 5 sections without triggering a new LLM call.
- [ ] **AC-6** WHEN the user navigates to the `/onboarding` route and no tour has been generated for the active repository, the system shall display a "Generate Tour" call-to-action rather than an error boundary or blank page.
- [ ] **AC-7** WHEN the user triggers tour regeneration, the system shall re-run the facts collector, re-issue the single structured LLM call, overwrite the persisted tour entry, and display the new tour.
- [ ] **AC-8** The Guided Reading Order section shall present file paths ranked by `pagerank × (1 + hotness)` where `hotness = 0` in v1; the system shall derive this ranking solely from the repo-intel module's existing ranked-file and critical-paths data without re-computing the ranking math independently.
- [ ] **AC-9** IF no model key is configured for the "Onboarding Tour" feature at generation time, THEN the system shall return a structured response that the client renders as a user-visible notice with a link to the Settings page, rather than an unhandled error boundary.
- [ ] **AC-10** WHEN the `/onboarding` route is loaded, the system shall fetch and display the tour for the repository currently active in the navigation context (the same repo selector used by all other repo-scoped pages).
- [ ] The four call sites that previously navigated to `/onboarding` for the add-repo form — `useShellContext.ts` `onAddRepo` callback, `useShellContext.ts` empty-repo fallback in `onRemoveRepo`, `client/src/app/page.tsx` empty-state CTA, `client/src/components/repo-not-found/RepoNotFound.tsx` CTA — all open `AddRepoModal` instead of routing to `/onboarding`.
- [ ] `MermaidDiagram` renders a visually-hidden accessible `<figcaption>` for each diagram (spec accessibility requirement).
- [ ] Each tour section heading is an `<h2>` landmark element (spec accessibility requirement).
- [ ] `client/CLAUDE.md` route description updated to reflect the new purpose of `/onboarding`.
