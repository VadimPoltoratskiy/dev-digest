# Plan: Export to CI (SPEC-03)

## Spec reference
`specs/SPEC-03-export-to-ci.md`

## Execution mode: multi-agent
User chose multi-agent with parallel phases. Phase 1 (schema migration + shared contracts + GitHubClient interface) is sequential and a hard prerequisite for all later work. Phase 2 (server `modules/ci/`) and Phase 3 (client `/ci-runs` page + AgentEditor CI tab) are independent and run in parallel once Phase 1 is complete. Phase 4 (tests) requires both Phase 2 and Phase 3 to finish.

## Goal
An agent configured in DevDigest studio can be exported as a versioned YAML manifest + GitHub Actions workflow bundle, committed to a target repo as a PR via a 4-step Export Wizard, and have its CI-originated run results ingested back into DevDigest on user-triggered refresh. New surfaces: `modules/ci/` server module (5 endpoints + preflight), a global `/ci-runs` page, and a CI tab in the Agent Editor.

## Modules affected
- `server/` — new `modules/ci/` plugin (routes + service + repository + helpers); `db/schema/ci.ts` (add `duration_ms` column); `vendor/shared/adapters.ts` + `adapters/github/octokit.ts` + `adapters/mocks.ts` (three new `GitHubClient` methods); `vendor/shared/contracts/eval-ci.ts` (two contract changes); `package.json` (add `js-yaml`)
- `client/` — new `app/ci-runs/` page; new CI tab in `app/agents/[id]/_components/AgentEditor/`; `vendor/shared/contracts/eval-ci.ts` (mirror server contract changes); `lib/hooks/ci.ts` (new TanStack Query hooks); `lib/api.ts` (new fetch functions); i18n messages; `package.json` (add `jszip`)

## Engineering Insights applied
- `vendor/shared/` is a **manual mirror** — both `server/src/vendor/shared/contracts/eval-ci.ts` and `client/src/vendor/shared/contracts/eval-ci.ts` must be updated in lockstep. Drift is caught only by `tsc`, not at runtime. (client INSIGHTS.md)
- Derived fields that require a JOIN (`agent` name from `ci_installations`, `duration_s` computed from `duration_ms`) cannot be returned from the repository layer — the repository returns raw typed rows; enrichment happens in the service. (server INSIGHTS.md: "repo layer cannot access PriceBook")
- Adding a new field to a shared Zod contract with `.default()` makes it optional in the input type but required in the output type (`z.infer`). Any test fixture typed as the output shape needs the new field added, or TS2741 fires. After Phase 1 adds `post_as` to `AgentManifest`, all `AgentManifest`-typed fixtures in tests must include `post_as: 'github_review'`. (client INSIGHTS.md recurring errors + server INSIGHTS.md)
- The DB-backed integration tests must use the `*.it.test.ts` suffix and import `test/helpers/pg.ts`; hermetic unit tests use any other suffix. Docker absence causes IT tests to self-skip safely. (server docs README.md)

## Recommendations (chosen as plan approach — see Step 2 analysis)
- **Client-side ZIP (AC-4):** The API consistently returns `CiExport { files: CiFile[] }` JSON for both `action: 'open_pr'` and `action: 'files'`. The Install step uses `jszip` in the browser to produce the downloadable archive from the returned `files` array. This keeps the API JSON-only and avoids a binary-response endpoint. Add `jszip` to `client/`.
- **`CiExportInput.post_as` backward-compat alias:** The spec renames `'none'` → `'exit_code_only'`. Apply the rename AND wrap with `z.preprocess((v) => (v === 'none' ? 'exit_code_only' : v), z.enum([...]))` so any caller still using the old string gets a silent coercion instead of a 422.
- **Agent-runner binary lazy singleton:** `CiService` reads `agent-runner/dist/index.js` exactly once at construction time and stores it as `private readonly runnerBinary: Buffer | null`. Subsequent export calls reuse the cached buffer. On ENOENT, logs a warning and stores `null` — exports still succeed but the runner file entry has empty contents.
- **YAML serialization via `js-yaml`:** Add `js-yaml` + `@types/js-yaml` to `server/`. Use `jsYaml.dump(manifest, { lineWidth: -1 })` for manifest YAML. After serialization, validate the round-trip with `AgentManifest.safeParse(jsYaml.load(yaml))` and throw before committing if validation fails.

## Architecture decisions
- **New `modules/ci/` follows the onion model** (routes → service → repository → adapters via DI container). All Drizzle queries are in `CiRepository`; no DB access in routes or service directly. Per onion-architecture SKILL.md.
- **All CI-related routes live in `modules/ci/routes.ts`**, including the agent-scoped ones (`/agents/:id/export-ci`, `/agents/:id/ci-installations`). Fastify plugins registered without a prefix declare absolute paths. Splitting CI routes across the agents module would scatter cohesive functionality. Per onion-architecture decision tree: "new domain feature → new module."
- **Preflight endpoint `GET /ci/preflight?repo=...`** is added as an implementation detail to satisfy AC-22 (check write access before the Install step enables "Open a PR"). Not in the spec's service contracts table but required. Returns `{ has_write_access: boolean }`. Lightweight — no DB write.
- **`GitHubClient` interface extended with three new methods** (`listWorkflowRuns`, `downloadArtifact`, `checkWriteAccess`) in `server/src/vendor/shared/adapters.ts`, with real implementations in the octokit adapter and stubs in `mocks.ts`. All GitHub calls stay behind one interface — no direct `octokit` import in service code.
- **SSRF mitigation on `repo` field:** `CiExportInput.repo` uses `.regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, 'repo must be owner/name format')` at the Zod schema definition level. Route boundary rejects malformed values before they reach `GitHubClient`. Per security skill A05/injection: attacker-controlled URL fragment → validate before passing to any HTTP client.
- **Ingest deduplication by `(ci_installation_id, github_url)`:** `CiRepository.findRunByInstallationAndUrl` checks for an existing `ci_runs` row before each insert. Prevents duplicates on repeated refresh clicks (spec Edge case 7). No new DB unique constraint needed — a `SELECT` guard is sufficient given user-triggered cadence.
- **Export Wizard colocated under AgentEditor:** The wizard is launched only from the agent CI tab (`Add repository` / `Update CI config`). Belongs at `_components/AgentEditor/_components/ExportWizard/`. Per ui-architecture SKILL.md: "a component used only by one route → that route's `_components/`; a sub-component of a feature component → `_components/<Parent>/_components/<Name>/`."
- **`AgentManifest.post_as` as optional-with-default:** `z.enum(['github_review', 'pr_comment', 'exit_code_only']).default('github_review')`. Existing manifests without the field parse cleanly — `.default()` supplies the value. Backward-compatible per Zod best-practices `refine-defaults` rule.
- **"Fail CI on" selector uses existing `PATCH /agents/:id` endpoint:** `agents.ci_fail_on` is already a column the agent PATCH endpoint accepts. No new endpoint for AC-20 — the CI tab's selector mutation reuses the existing `useUpdateAgent` hook.

---

## Tasks

### Phase 1: DB schema migration + shared contracts + GitHubClient interface (sequential — must complete before Phases 2 and 3)

#### 1a. DB schema migration

- [ ] `server/src/db/schema/ci.ts` — add `durationMs: integer('duration_ms')` column to the `ciRuns` table definition; place it after `source`. The column is nullable with no default. (This is the only permitted edit to this file — Drizzle ORM generates the SQL.)
- [ ] Run `cd server && pnpm db:generate` — review the auto-generated migration file in `server/src/db/migrations/` to confirm it adds only `duration_ms integer`; commit the migration file
- [ ] Run `cd server && pnpm db:migrate` — apply the migration to the local database

#### 1b. Server dependency

- [ ] `server/package.json` — add `"js-yaml": "^4.1.0"` to `dependencies` and `"@types/js-yaml": "^4.0.9"` to `devDependencies`; run `cd server && pnpm install`

#### 1c. Shared Zod contracts — server side

File: `server/src/vendor/shared/contracts/eval-ci.ts`

- [ ] **`AgentManifest`** — add the `post_as` field after `ci_fail_on`:
  ```typescript
  post_as: z.enum(['github_review', 'pr_comment', 'exit_code_only']).default('github_review'),
  ```
  Verify the already-exported `AgentManifestInput = z.input<typeof AgentManifest>` picks up `post_as?` automatically (it will, since `.default()` makes the input optional).

- [ ] **`CiExportInput.post_as`** — replace the existing `z.enum(['github_review', 'pr_comment', 'none']).default('github_review')` with:
  ```typescript
  post_as: z.preprocess(
    (v) => (v === 'none' ? 'exit_code_only' : v),
    z.enum(['github_review', 'pr_comment', 'exit_code_only']).default('github_review'),
  ),
  ```

- [ ] **`CiExportInput.repo`** — chain a regex validator onto the existing `z.string().min(1)`:
  ```typescript
  repo: z.string().min(1).regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, 'repo must be owner/name format'),
  ```

- [ ] Verify `CiExportInputBody = z.input<typeof CiExportInput>` is still exported (it exists in the current file; confirm it remains accurate after the preprocess wrapper — `z.input` resolves preprocess correctly).

#### 1d. Shared Zod contracts — client side mirror

File: `client/src/vendor/shared/contracts/eval-ci.ts`

- [ ] Apply the **identical** three changes from 1c: `AgentManifest.post_as`, `CiExportInput.post_as` preprocess alias, `CiExportInput.repo` regex.
- [ ] Confirm `CiFailOn` is imported from `'./knowledge.js'` (already present) — no new imports needed for the `post_as` enum (the enum values are string literals).

#### 1e. GitHubClient interface extension

File: `server/src/vendor/shared/adapters.ts`

- [ ] Add the `WorkflowRun` interface before the `GitHubClient` interface:
  ```typescript
  export interface WorkflowRun {
    id: number;
    html_url: string;
    created_at: string;
    status: string | null;
  }
  ```

- [ ] Add three new method signatures to the `GitHubClient` interface (append after `currentLogin`):
  ```typescript
  /** List recent GitHub Actions workflow runs for a specific workflow file. */
  listWorkflowRuns(repo: RepoRef, workflowFile: string): Promise<WorkflowRun[]>;
  /** Download a named artifact from a GHA run. Returns the raw JSON string, or null if not found. */
  downloadArtifact(repo: RepoRef, runId: number, artifactName: string): Promise<string | null>;
  /** Check if the authenticated token has push (write) access to the repo. */
  checkWriteAccess(repo: RepoRef): Promise<boolean>;
  ```

File: `server/src/adapters/github/octokit.ts`

- [ ] Implement `listWorkflowRuns`: call `octokit.rest.actions.listWorkflowRuns({ owner: repo.owner, repo: repo.name, workflow_id: workflowFile, per_page: 30 })`; map each run to `WorkflowRun { id, html_url, created_at, status }`.
- [ ] Implement `downloadArtifact`: call `octokit.rest.actions.listWorkflowRunArtifacts({ owner: repo.owner, repo: repo.name, run_id: runId })`; find artifact by name; if not found return `null`; fetch the download URL with `octokit.rest.actions.downloadArtifact({ owner, repo: repo.name, artifact_id, archive_format: 'zip' })` — note GitHub returns a redirect to a zip; use `fetch` on the redirect URL, unzip the single JSON file, and return its text content. Return `null` on any error.
- [ ] Implement `checkWriteAccess`: call `octokit.rest.repos.get({ owner: repo.owner, repo: repo.name })`; return `data.permissions?.push === true`; catch 403/404 and return `false`.

File: `server/src/adapters/mocks.ts`

- [ ] Add stub implementations to the mock GitHub client:
  - `listWorkflowRuns`: returns `[]`
  - `downloadArtifact`: returns `null`
  - `checkWriteAccess`: returns `true`

#### 1f. Client dependency

- [ ] `client/package.json` — add `"jszip": "^3.10.1"` to `dependencies`; run `cd client && pnpm install`

---

### Phase 2: Server `modules/ci/` (parallel with Phase 3 — requires Phase 1)

#### 2a. Module scaffold

- [ ] Create directory `server/src/modules/ci/`

#### 2b. `helpers.ts` — pure generation functions (no DB, no adapters)

File: `server/src/modules/ci/helpers.ts`

- [ ] `agentSlug(name: string): string` — lowercase; replace spaces with `-`; strip non-`[a-z0-9-]` characters; collapse consecutive hyphens.

- [ ] `buildAgentManifest(params: { agent: AgentRow; skillSlugs: string[]; postAs: 'github_review' | 'pr_comment' | 'exit_code_only' }): AgentManifest` — constructs the object and calls `AgentManifest.parse(...)`. Throw if parse fails (malformed agent data would be a server invariant violation).

- [ ] `manifestToYaml(manifest: AgentManifest): string` — calls `jsYaml.dump(manifest, { lineWidth: -1, quotingType: '"', forceQuotes: false })`; validates round-trip: `const check = AgentManifest.safeParse(jsYaml.load(yaml)); if (!check.success) throw new Error(...)`. Returns the YAML string.

- [ ] `buildWorkflowYaml(params: { slug: string; triggers: string[]; postAs: string }): string` — generates GitHub Actions YAML enforcing all security ACs:
  - Top-level `permissions: { contents: read, pull-requests: write }` and no other permissions (AC-8)
  - Trigger: `on: { pull_request: { types: [<triggers>] } }` — only `pull_request`, never `pull_request_target` or `issue_comment` (AC-9, AC-10)
  - `OPENROUTER_API_KEY` referenced exclusively as `${{ secrets.OPENROUTER_API_KEY }}` (AC-11)
  - Runner step: `run: node .devdigest/runner/index.js` with env vars `DEVDIGEST_POST_AS: <postAs>`, `GITHUB_REPOSITORY: ${{ github.repository }}`, `PR_NUMBER: ${{ github.event.pull_request.number }}`
  - Use `jsYaml.dump(workflowObject, { lineWidth: -1 })` to serialize; do NOT hand-build the string with template literals (escaping risk)

- [ ] `buildCiBundle(params: { slug: string; manifestYaml: string; skills: Array<{ slug: string; body: string }>; workflowYaml: string | null; runnerBinary: Buffer | null }): CiFile[]` — assembles the file array per AC-2:
  - `.devdigest/agents/<slug>.yaml` — manifest YAML, `editable: false`
  - `.devdigest/skills/<skill-slug>.md` per skill — body text, `editable: false`
  - `.devdigest/memory.jsonl` — empty string contents, `editable: false`
  - `.devdigest/runner/index.js` — `runnerBinary?.toString('binary') ?? ''`, `editable: false`
  - `.github/workflows/devdigest-review.yml` — workflow YAML (omitted if `workflowYaml` is null, i.e. non-gha target per AC-7), `editable: true`

- [ ] `parseRepoRef(repo: string): RepoRef` — splits on `/` and returns `{ owner: parts[0]!, name: parts[1]! }`. Trusted input (already Zod-regex validated at route boundary).

#### 2c. `types.ts` — module-local types

File: `server/src/modules/ci/types.ts`

- [ ] Define `AgentRow` and `SkillRow` type aliases (using `typeof agents.$inferSelect` and `typeof skills.$inferSelect` from the Drizzle schema) so `repository.ts` and `service.ts` share typed row shapes without importing from other modules.
- [ ] Define `NewCiRunRow` (the insert shape for `ci_runs` without `id`).

#### 2d. `repository.ts` — DB queries (Drizzle only, returns typed rows)

File: `server/src/modules/ci/repository.ts`

- [ ] `CiRepository` class; constructor takes `db: Db`.
- [ ] `findAgentById(agentId: string): Promise<AgentRow | null>` — `SELECT` from `agents` where `id = agentId`.
- [ ] `findSkillsByAgentId(agentId: string): Promise<SkillRow[]>` — `SELECT skills.* FROM skills JOIN agent_skills ON ... WHERE agent_skills.agent_id = agentId ORDER BY agent_skills.order ASC`. Returns skills in link order.
- [ ] `findInstallationsByAgent(agentId: string): Promise<CiInstallationRow[]>` — `SELECT * FROM ci_installations WHERE agent_id = agentId`.
- [ ] `findInstallationsByWorkspace(workspaceId: string): Promise<CiInstallationRow[]>` — joins `ci_installations → agents` filtering by `agents.workspace_id = workspaceId`.
- [ ] `upsertInstallation(input: { agentId: string; repo: string; targetType: string }): Promise<CiInstallationRow>` — INSERT with `onConflictDoUpdate` if a unique constraint on `(agent_id, repo)` exists; otherwise plain INSERT then SELECT back. Check the existing `ci_installations` schema for constraints.
- [ ] `findRunsByInstallationIds(ids: string[]): Promise<CiRunRow[]>` — `SELECT * FROM ci_runs WHERE ci_installation_id IN (ids) ORDER BY ran_at DESC`. Returns empty array for empty `ids`.
- [ ] `findRunById(id: string): Promise<CiRunRow | null>`.
- [ ] `findRunByInstallationAndUrl(installationId: string, githubUrl: string): Promise<CiRunRow | null>` — deduplication check; `SELECT ... WHERE ci_installation_id = installationId AND github_url = githubUrl LIMIT 1`.
- [ ] `insertRun(input: NewCiRunRow): Promise<CiRunRow>` — `INSERT INTO ci_runs (...) VALUES (...) RETURNING *`.

#### 2e. `service.ts` — CiService (orchestration)

File: `server/src/modules/ci/service.ts`

- [ ] `CiService` class; constructor takes `container: Container`.
- [ ] Constructor body: resolve the agent-runner binary path via `path.resolve(new URL(import.meta.url).pathname, '../../../../../agent-runner/dist/index.js')`; read it with `fs.readFileSync`; store as `private readonly runnerBinary: Buffer | null`; on ENOENT log `container.log?.warn('agent-runner binary not found; runner file will be empty')` and store `null`.
- [ ] `exportCi(agentId: string, input: CiExportInput, workspaceId: string): Promise<CiExport>`:
  1. `const repo = new CiRepository(container.db)`
  2. Load agent via `repo.findAgentById(agentId)` — throw `NotFoundError` if null
  3. Load linked skills via `repo.findSkillsByAgentId(agentId)`
  4. `buildAgentManifest({ agent, skillSlugs: skills.map(s => s.slug), postAs: input.post_as })`
  5. `manifestToYaml(manifest)` — throw on validation failure (returns 422 via error handler)
  6. If `input.target === 'gha'`: `buildWorkflowYaml({ slug, triggers: input.triggers, postAs: input.post_as })`; else `workflowYaml = null`
  7. `buildCiBundle({ slug, manifestYaml, skills: skills.map(s => ({ slug: s.slug, body: s.body })), workflowYaml, runnerBinary: this.runnerBinary })`
  8. If `input.action === 'files'`: return `{ installation: { id: '', agent_id: agentId, repo: input.repo, target_type: input.target, installed_at: new Date().toISOString() }, files, pr_url: null }` — no DB write, no GitHub call
  9. If `input.action === 'open_pr'` and `input.target === 'gha'`:
     - `const repoRef = parseRepoRef(input.repo)`
     - `const github = container.github()`
     - `const existingPr = await github.findOpenPr(repoRef, 'devdigest/ci')`
     - `await github.commitFiles(repoRef, { branch: 'devdigest/ci', base: input.base, message: `chore: export DevDigest agent "${agent.name}" to CI`, files: files.map(f => ({ path: f.path, contents: f.contents })) })`
     - If `existingPr`: `prUrl = existingPr.url`; upsert installation; return with existing URL
     - If no existing PR: `const newPr = await github.openPullRequest(repoRef, { title: \`Add DevDigest agent: ${agent.name}\`, head: 'devdigest/ci', base: input.base, body: '...' })`; upsert installation; return with new URL
     - If `commitFiles` throws a 403: rethrow as `new ValidationError('GitHub token lacks write access to this repository', 422)`
  10. If `input.action === 'open_pr'` and `input.target !== 'gha'`: return `{ installation: null, files, pr_url: null }` (AC-7 non-gha ZIP-only path; no GitHub calls)

- [ ] `checkWriteAccess(repo: string): Promise<boolean>`:
  - `parseRepoRef(repo)` — catch malformed and return `false`
  - `return container.github().checkWriteAccess(repoRef)` — catch any error and return `false`

- [ ] `getCiInstallations(agentId: string): Promise<CiInstallation[]>`:
  - Load via `new CiRepository(container.db).findInstallationsByAgent(agentId)`
  - Map rows to `CiInstallation` DTO (all string fields, `installed_at.toISOString()`)

- [ ] `getCiRuns(workspaceId: string, agentId?: string): Promise<CiRun[]>`:
  - Load installations (by agent if `agentId` provided; else all for workspace via `findInstallationsByWorkspace`)
  - Load runs via `findRunsByInstallationIds(installationIds)`
  - Build a `Map<installationId, agentName>` from the installations (requires one `findAgentById` per unique `agent_id` — or load agents in a single IN-query)
  - Enrich each run: `agent = agentNameMap.get(run.ciInstallationId) ?? null`; `duration_s = run.durationMs != null ? run.durationMs / 1000 : null`
  - Return enriched `CiRun[]` ordered by `ran_at DESC` (already ordered by repository)

- [ ] `getCiRun(id: string, workspaceId: string): Promise<CiRun>`:
  - Load via `findRunById(id)` — throw `NotFoundError` if null
  - Verify the run's installation belongs to the workspace (load installation, check `agent → workspace_id`) — throw `NotFoundError` if mismatch (treats unauthorized as not-found per spec)
  - Enrich and return

- [ ] `refreshCiRuns(workspaceId: string): Promise<{ inserted: number; skipped: number }>`:
  - Load all installations for workspace
  - For each installation sequentially (spec performance budget: 30s for 10 installations):
    - `const repoRef = parseRepoRef(installation.repo)`
    - `const runs = await container.github().listWorkflowRuns(repoRef, 'devdigest-review.yml')`
    - For each run: check `findRunByInstallationAndUrl(installation.id, run.html_url)` — skip if exists
    - `const raw = await container.github().downloadArtifact(repoRef, run.id, 'devdigest-result')` — skip if null
    - Wrap `JSON.parse(raw)` in try-catch; on failure log and `skipped++`
    - `const parsed = CiResultArtifact.safeParse(json)` — on failure log parse error and `skipped++`
    - On success: `insertRun({ ciInstallationId: installation.id, prNumber: parsed.data.pr_number ?? null, ranAt: new Date(run.created_at), status: run.status, findingsCount: parsed.data.findings_count, costUsd: parsed.data.cost_usd, githubUrl: run.html_url, source: 'ci', durationMs: parsed.data.duration_ms ?? null })`; `inserted++`
  - Return `{ inserted, skipped }`

#### 2f. `routes.ts` — Fastify plugin

File: `server/src/modules/ci/routes.ts`

- [ ] Standard `FastifyPluginAsync` export using `.withTypeProvider<ZodTypeProvider>()` pattern (as seen in other modules). Instantiate `new CiService(opts.container)` at plugin level; call `getContext(opts.container, req)` in each handler.

- [ ] `POST /agents/:id/export-ci` — params: `{ id: z.string().uuid() }`; body: `CiExportInput`; response `200`: `CiExport`; response `404`: agent not found; response `422`: validation error or GitHub 403. Rate limit: 10/min. Calls `service.exportCi(params.id, body, workspaceId)`.

- [ ] `GET /agents/:id/ci-installations` — params: `{ id: z.string().uuid() }`; response `200`: `z.array(CiInstallation)`; response `404`: agent not found. Calls `service.getCiInstallations(params.id)`.

- [ ] `GET /ci/runs` — query: `{ agent_id: z.string().uuid().optional() }`; response `200`: `z.array(CiRun)`. Calls `service.getCiRuns(workspaceId, query.agent_id)`.

- [ ] `POST /ci/runs/refresh` — no body; response `200`: `z.object({ inserted: z.number().int(), skipped: z.number().int() })`. Rate limit: 6/min (network-bound; prevent accidental hammering). Calls `service.refreshCiRuns(workspaceId)`.

- [ ] `GET /ci/runs/:id` — params: `{ id: z.string().uuid() }`; response `200`: `CiRun`; response `404`: run not found or not in workspace. Calls `service.getCiRun(params.id, workspaceId)`.

- [ ] `GET /ci/preflight` — query: `{ repo: z.string().min(1).regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/) }`; response `200`: `z.object({ has_write_access: z.boolean() })`. Calls `service.checkWriteAccess(query.repo)`.

#### 2g. Module registration

- [ ] `server/src/modules/index.ts` — add `import ci from './ci/routes.js'` and add `ci` to the `modules` Record (the `for...of` loop in `app.ts` picks it up automatically — no change to `app.ts` needed)

---

### Phase 3: Client `/ci-runs` page + AgentEditor CI tab (parallel with Phase 2 — requires Phase 1)

#### 3a. New API functions

File: `client/src/lib/api.ts` — add these exported async functions (all `fetch`-based, consistent with existing pattern):

- [ ] `fetchCiRuns(agentId?: string): Promise<CiRun[]>` — `GET /ci/runs?agent_id={agentId}` (omit query param when `agentId` is undefined)
- [ ] `fetchCiRun(id: string): Promise<CiRun>` — `GET /ci/runs/{id}`
- [ ] `refreshCiRuns(): Promise<{ inserted: number; skipped: number }>` — `POST /ci/runs/refresh` with empty body
- [ ] `exportCi(agentId: string, input: CiExportInputBody): Promise<CiExport>` — `POST /agents/{agentId}/export-ci`
- [ ] `fetchCiInstallations(agentId: string): Promise<CiInstallation[]>` — `GET /agents/{agentId}/ci-installations`
- [ ] `checkCiPreflight(repo: string): Promise<{ has_write_access: boolean }>` — `GET /ci/preflight?repo={encodeURIComponent(repo)}`

#### 3b. New TanStack Query hooks

File: `client/src/lib/hooks/ci.ts` (new file):

- [ ] `useCiRuns(agentId?: string)` — `useQuery({ queryKey: ['ci-runs', agentId ?? null], queryFn: () => fetchCiRuns(agentId) })`
- [ ] `useCiInstallations(agentId: string)` — `useQuery({ queryKey: ['ci-installations', agentId], queryFn: () => fetchCiInstallations(agentId) })`
- [ ] `useRefreshCiRuns()` — `useMutation({ mutationFn: refreshCiRuns, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ci-runs'] }) })`
- [ ] `useExportCi(agentId: string)` — `useMutation({ mutationFn: (input: CiExportInputBody) => exportCi(agentId, input) })`
- [ ] `useCiPreflight(repo: string | null)` — `useQuery({ queryKey: ['ci-preflight', repo], queryFn: () => checkCiPreflight(repo!), enabled: !!repo })`

File: `client/src/lib/hooks/index.ts` — add `export * from './ci'`

#### 3c. i18n messages

File: `client/messages/en/agents.json` — add keys under the existing `agents` namespace (do not replace the file; merge new keys):

```json
"editor.tabs.ci": "CI",
"ci.deploymentSummary": "Active in {count} repo(s)",
"ci.noInstallations": "No repositories configured yet.",
"ci.addRepo": "Add repository",
"ci.updateConfig": "Update CI config",
"ci.failOn": "Fail CI on",
"ci.failOn.never": "Never",
"ci.failOn.critical": "Critical findings",
"ci.failOn.warning": "Warning findings",
"ci.failOn.any": "Any findings",
"ci.runHistory": "CI Run History",
"ci.wizard.title": "Export to CI",
"ci.wizard.step1": "Target",
"ci.wizard.step2": "Preview",
"ci.wizard.step3": "Configure",
"ci.wizard.step4": "Install",
"ci.wizard.openPr": "Open a PR with these files",
"ci.wizard.copyZip": "Copy files as a ZIP",
"ci.wizard.noWriteAccess": "The DevDigest GitHub token lacks write access to this repository. Only \"Copy files as a ZIP\" is available.",
"ci.wizard.branchProtectionHint": "To block merges, you must also set \"Fail CI on\" in this agent's CI tab and add a required status check in your repository's branch protection settings — DevDigest cannot configure branch protection automatically.",
"ci.wizard.postAs.label": "Post results as",
"ci.wizard.postAs.github_review": "GitHub review (recommended — can REQUEST_CHANGES)",
"ci.wizard.postAs.pr_comment": "PR comment",
"ci.wizard.postAs.exit_code_only": "Exit code only (posts nothing to the PR)",
"ci.wizard.secretsPanel.title": "Required GitHub Actions secrets",
"ci.wizard.secretsPanel.openrouterKey": "OPENROUTER_API_KEY",
"ci.wizard.secretsPanel.openrouterKeyHint": "Create this in your repository Settings → Secrets and variables → Actions",
"ci.wizard.secretsPanel.githubToken": "GITHUB_TOKEN",
"ci.wizard.secretsPanel.githubTokenHint": "Auto-provided by GitHub Actions — no setup required"
```

File: `client/messages/en/ci-runs.json` (new file):

```json
{
  "title": "CI Runs",
  "refresh": "Refresh",
  "refreshing": "Refreshing…",
  "table.pr": "PR",
  "table.repo": "Repository",
  "table.agent": "Agent",
  "table.status": "Status",
  "table.findings": "Findings",
  "table.cost": "Cost (USD)",
  "table.duration": "Duration",
  "table.jobLink": "Job",
  "table.jobLink.none": "—",
  "empty": "No CI runs yet. Configure an agent's CI tab and run the export wizard to get started."
}
```

#### 3d. CI Runs page

- [ ] `client/src/app/ci-runs/page.tsx` — thin page component; imports and renders `<CiRunsView />`; add `export const metadata = { title: 'CI Runs' }`.

- [ ] `client/src/app/ci-runs/_components/CiRunsView/CiRunsView.tsx` — `'use client'` component:
  - Uses `useCiRuns()` (no agent filter — global view) and `useRefreshCiRuns()`
  - Renders a Refresh button; on click calls `mutate()` from `useRefreshCiRuns()`; shows loading state while pending
  - Renders a table with columns per AC-16: PR number, repository (from `CiRun.ci_installation_id` → enriched via service, surfaced as part of the `CiRun` DTO — note: the service enriches `agent` but not `repo` explicitly; the `ci_installation_id` is available; see Gotchas), agent name, status, findings count, cost formatted to 4 decimal places, duration in seconds, job link
  - `github_url` renders as `<a href={...} target="_blank">View</a>` or `"—"` if null (Edge case 10)
  - Rows are ordered newest-first (the service returns them in that order)
  - Uses `useTranslations('ci-runs')` for all visible strings

  **Gotcha — `repo` enrichment in `CiRun`:** The current `CiRun` Zod contract (in `eval-ci.ts`) does not include a `repo` field. The service enriches `agent` and `duration_s` but not `repo`. For the CI Runs page to show repository name, the implementer should either: (a) extend `CiRun` with a `repo: z.string().nullish()` field populated by the service via the installation join, or (b) display `ci_installation_id` and let the user look it up. Option (a) is the right user experience — add `repo: z.string().nullish()` to `CiRun` in both `vendor/shared/` files (backward-compatible addition) and populate it in `CiService.getCiRuns`.

- [ ] `client/src/app/ci-runs/_components/CiRunsView/index.ts` — barrel: `export { CiRunsView } from './CiRunsView'`

- [ ] `client/src/app/ci-runs/_components/CiRunsView/CiRunsView.test.tsx` — RTL unit tests (fetch mocked):
  - Renders table rows from mocked `fetchCiRuns` response
  - Refresh button calls `refreshCiRuns` mutation
  - Row with `github_url: null` displays `"—"` in the job column
  - Empty state renders the correct message when `data` is empty

#### 3e. AgentEditor — add CI tab to constants

File: `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`

- [ ] Add `{ key: "ci", labelKey: "editor.tabs.ci", icon: "GitBranch" }` to the `TABS` array, after `"evals"`. The `"GitBranch"` icon must exist in `@devdigest/ui`'s `IconName` type — if it does not, substitute the closest available icon (e.g., `"Terminal"` or `"Workflow"`).

#### 3f. Export Wizard component

Directory: `client/src/app/agents/[id]/_components/AgentEditor/_components/ExportWizard/`

- [ ] `ExportWizard.tsx` — `'use client'` multi-step modal/dialog. Accepts props:
  ```typescript
  interface ExportWizardProps {
    agentId: string;
    open: boolean;
    onClose: () => void;
    prefilledRepo?: string; // for "Update CI config" re-open
  }
  ```
  Internal state: `step: 1 | 2 | 3 | 4`, `target: CiTarget`, `repo: string`, `base: string`, `triggers: string[]`, `postAs: 'github_review' | 'pr_comment' | 'exit_code_only'`, `files: CiFile[]`, `editedWorkflow: string`.

  **Step 1 — Target (`TargetStep`):**
  - Provider selector: GHA fully enabled; circle/jenkins/cli shown as disabled placeholders with a "(coming soon)" label (per AC-7)
  - Repo text input (pre-filled from `prefilledRepo` if provided)
  - Base branch text input (defaults to `"main"`)
  - "Next" advances to Step 2 and calls `exportCi(agentId, { repo, target, action: 'files', post_as: postAs, triggers, base })` to fetch the preview bundle

  **Step 2 — Preview (`PreviewStep`):**
  - Lists all file paths returned in `files`
  - For `.github/workflows/devdigest-review.yml`: renders an editable `<textarea>` with a visible `<label id="workflow-label">Workflow YAML</label>` and `aria-labelledby="workflow-label"` on the textarea (per spec accessibility NFR AC-NFR); stores edits in `editedWorkflow`
  - "Next" advances to Step 3

  **Step 3 — Configure (`ConfigureStep`):**
  - Trigger checkboxes: `opened` and `synchronize` pre-checked; `reopened` unchecked-by-default but available (per AC-6)
  - Secrets panel: `OPENROUTER_API_KEY` (must-create) and `GITHUB_TOKEN` (auto-provided, marked ready)
  - "Post results as" radio group: `github_review` (default), `pr_comment`, `exit_code_only` — no `none` option
  - Inline branch-protection hint (per AC-6 NFR)
  - "Next" advances to Step 4 and calls `useCiPreflight(repo)` to begin preflight check

  **Step 4 — Install (`InstallStep`):**
  - On mount (or on step transition): query `useCiPreflight(repo)` result
  - If `has_write_access === false`: "Open a PR" button disabled + explanatory message; only "Copy as ZIP" is functional (per AC-22)
  - If `has_write_access === true`: "Open a PR" button calls `useExportCi` with `action: 'open_pr'` and the (possibly edited) workflow — note: the edited workflow needs to flow back: update the relevant `CiFile` in the files array before submitting
  - "Copy as ZIP": instantiates `new JSZip()`, adds each file in `files` (using `editedWorkflow` for the workflow file), calls `zip.generateAsync({ type: 'blob' })`, triggers browser download via `URL.createObjectURL`
  - On "Open a PR" success: shows PR URL as a clickable link; closes wizard on confirmation

  **Step indicators:** rendered as `<ol role="list">` with each `<li>` having `aria-current="step"` on the active step (per spec accessibility NFR).

- [ ] `ExportWizard/index.ts` — barrel: `export { ExportWizard } from './ExportWizard'`

- [ ] `ExportWizard/ExportWizard.test.tsx` — RTL tests (fetch mocked):
  - Clicking "Next" on Step 1 calls `fetchCiRuns` (mock the export call) and advances to Step 2
  - Step 2 renders a `<textarea>` with a visible label for the workflow file
  - Step 3 "Post results as" radio: selecting `exit_code_only` updates internal state; advance to Step 4
  - Step 4 with preflight `has_write_access: false`: "Open a PR" button is disabled; "Copy as ZIP" is enabled
  - Step 4 "Copy as ZIP": verifies JSZip `generateAsync` was called (spy on JSZip)

#### 3g. CI Tab component

Directory: `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/`

- [ ] `CiTab.tsx` — `'use client'` component. Accepts `{ agentId: string; ciFailOn: string }` props (agent data already loaded by AgentEditor parent).
  - **Deployment summary** (AC-18): renders count from `useCiInstallations(agentId).data?.length ?? 0` — e.g. "Active in 2 repo(s)"
  - **Per-repository list** (AC-19): maps installations; each row shows `installation.repo`, `installation.target_type`, `installation.installed_at` formatted as date, last run status (find most recent `CiRun` for this installation from `useCiRuns(agentId)` data, or "No runs yet")
    - "Add repository" button: sets wizard open with no prefilledRepo
    - "Update CI config" button per row: sets wizard open with `prefilledRepo={installation.repo}`
  - **"Fail CI on" selector** (AC-20): `<select>` with options `never`, `critical`, `warning`, `any`; controlled by `ciFailOn` prop; `onChange` calls the existing `useUpdateAgent` mutation with `{ ci_fail_on: newValue }` — reuse whatever agent update hook already exists in `lib/hooks/agents.ts`
  - **Run history table** (AC-21): sourced from `useCiRuns(agentId)`; columns: PR number, repo, status, findings count, cost, date
  - Renders `<ExportWizard agentId={agentId} open={wizardOpen} onClose={() => setWizardOpen(false)} prefilledRepo={wizardRepo} />`

- [ ] `CiTab/index.ts` — barrel: `export { CiTab } from './CiTab'`

- [ ] `CiTab/CiTab.test.tsx` — RTL tests:
  - Renders deployment summary with correct count from mocked `fetchCiInstallations`
  - "Add repository" button opens wizard (wizard `open` prop becomes `true`)
  - "Fail CI on" change calls `useUpdateAgent` with the new value
  - Run history table renders rows from mocked `fetchCiRuns`

#### 3h. Wire CI tab into AgentEditor

File: `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`

- [ ] Import `CiTab` from `./_components/CiTab`
- [ ] In the tab-content switch/render logic, add a branch for `activeTab === 'ci'` that renders `<CiTab agentId={agent.id} ciFailOn={agent.ci_fail_on} />`

---

### Phase 4: Tests (after Phases 2 and 3 complete)

#### 4a. Server unit tests (hermetic — no DB)

File: `server/src/modules/ci/ci.test.ts`

- [ ] `agentSlug()` — edge cases: consecutive spaces, leading/trailing spaces, special characters, unicode letters (stripped), already-valid slug (unchanged)
- [ ] `buildWorkflowYaml()` — assert generated YAML: (a) no `pull_request_target` token anywhere; (b) no `issue_comment` token; (c) contains `contents: read` and `pull-requests: write`; (d) `OPENROUTER_API_KEY` appears only as the literal string `${{ secrets.OPENROUTER_API_KEY }}`; (e) top-level `on.pull_request` exists
- [ ] `manifestToYaml()` — YAML-special characters in `system_prompt` (colons, quotes, newlines, `{braces}`) survive `jsYaml.dump` → `jsYaml.load` → `AgentManifest.safeParse` round-trip without error
- [ ] `CiService.exportCi()` with `MockGitHubClient`:
  - `action='files'` → no `commitFiles` call, no `openPullRequest` call, returns `pr_url: null`
  - `action='open_pr'`, `findOpenPr` returns `null` → `commitFiles` called once, `openPullRequest` called once, `pr_url` matches `openPullRequest` return value
  - `action='open_pr'`, `findOpenPr` returns existing URL → `commitFiles` called, `openPullRequest` NOT called, `pr_url` matches existing URL (AC-3 deduplication)
  - `target='circle'` → no GitHub calls, no workflow file in bundle, returns `pr_url: null`
- [ ] `CiService.refreshCiRuns()` with mock container:
  - Valid artifact inserted, `inserted: 1, skipped: 0`
  - Same `github_url` already in `ci_runs` (mock `findRunByInstallationAndUrl` returns existing row) → `skipped: 1, inserted: 0`
  - `downloadArtifact` returns `null` → `skipped: 1, inserted: 0`
  - Artifact JSON fails `CiResultArtifact.safeParse` → `skipped: 1, inserted: 0`
  - `duration_ms` from artifact stored in `insertRun` call argument

#### 4b. Server integration test (DB-backed)

File: `server/src/modules/ci/ci.it.test.ts`

- [ ] `POST /agents/:id/export-ci` with `action='files'` → 200; `files` array contains `.devdigest/agents/`, `.devdigest/memory.jsonl`, `.github/workflows/devdigest-review.yml`; no `ci_installations` row created
- [ ] `GET /agents/:id/ci-installations` → 200; returns seeded installation rows for the agent
- [ ] `GET /ci/runs` → 200; returns seeded runs with non-null `agent` field and `duration_s` computed correctly (e.g. `duration_ms: 5000` → `duration_s: 5`)
- [ ] `POST /ci/runs/refresh` with mock GitHub adapter configured to return one `WorkflowRun` and one valid artifact JSON → 200 `{ inserted: 1, skipped: 0 }`; second identical refresh → `{ inserted: 0, skipped: 0 }` (deduplication)
- [ ] `GET /ci/preflight?repo=owner/name` → 200 `{ has_write_access: true }` (mock `checkWriteAccess` returns true)

---

## Gotchas

- **Migrations never auto-run.** Phase 1a must fully complete (`pnpm db:generate` → commit → `pnpm db:migrate`) before the Phase 2 service or Phase 4 integration tests reference `ci_runs.duration_ms`. Skipping this causes a runtime column-not-found error.
- **`server/src/db/schema/` is a do-not-touch zone for hand-edits.** Phase 1a adds `durationMs` to the Drizzle table definition only; the SQL migration file is generated, never hand-written.
- **Both `vendor/shared/` mirrors must change in Phase 1 (tasks 1c and 1d).** Any contract in `server/src/vendor/shared/` that changes must receive an identical change in `client/src/vendor/shared/`. Drift is caught only by `pnpm typecheck` in the client.
- **`AgentManifest` test fixtures must be updated after Phase 1c/1d.** Every hardcoded object typed as `AgentManifest` (output type) needs `post_as: 'github_review'` added, or TS2741 fires. Run `grep -r 'AgentManifest' server/src client/src --include='*.test.*'` to find all affected fixtures.
- **`agent-runner/dist/index.js` must exist before testing export functionality.** Run `cd agent-runner && pnpm build` (check agent-runner's `package.json` for the build script). If absent, `CiService` logs a warning and the runner file in the bundle has empty contents — integration tests should mock or pre-build.
- **`CiRun.repo` field.** The current `CiRun` contract lacks a `repo` field. Phase 3d notes the need to add `repo: z.string().nullish()` to both `vendor/shared/` files (backward-compatible, optional). This must be done in Phase 1c/1d alongside the other contract changes, or Phase 3 will need a small patch to Phase 1's output.
- **Non-`gha` targets (AC-7) have no workflow YAML in the bundle.** `buildCiBundle` skips the `.github/workflows/` entry when `workflowYaml` is null. The Install step must detect `target !== 'gha'` and hide "Open a PR" entirely (not just disable it per AC-22, but structurally absent for non-GHA targets).
- **ZIP download is client-side only.** Phase 4 tests cannot verify the actual ZIP file contents under vitest/jsdom (no File System API). Spy on `JSZip.prototype.generateAsync` to confirm it is called with the correct files array.
- **`GitHubClient.downloadArtifact` must handle GitHub's artifact ZIP redirect.** GitHub's artifact download API returns a ZIP file (even for single-file artifacts). The octokit implementation must unzip it to extract `devdigest-result.json`. The `adm-zip` or Node's built-in `zlib` (for gzip streams) may be needed — check the specific Octokit response type. If the added complexity is prohibitive, a simpler approach is to use `octokit.request('GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts')` and then fetch the download URL directly and handle the ZIP; add `adm-zip` to `server/` if needed.
- **`.github/workflows/` is a do-not-touch zone in this codebase's repo.** The `buildWorkflowYaml` function generates a YAML string that will be committed to the TARGET repository via `GitHubClient.commitFiles` — it never writes to the DevDigest repo's own `.github/workflows/`.

## Definition of done

- [ ] `pnpm test` passes in `server/` (unit + integration)
- [ ] `pnpm test` passes in `client/`
- [ ] `pnpm typecheck` reports no errors in `server/`
- [ ] `pnpm typecheck` reports no errors in `client/`
- [ ] **AC-1** — `POST /agents/:id/export-ci` returns a bundle whose `.devdigest/agents/<slug>.yaml` passes `AgentManifest.safeParse` and whose `post_as` field matches the request's `post_as` value
- [ ] **AC-2** — Returned `files` for `target='gha'` contains exactly the five file categories; no extras
- [ ] **AC-3** — `action='open_pr'` returns a PR URL; repeating the call returns the same URL without a duplicate PR
- [ ] **AC-4** — `action='files'` returns the bundle with `pr_url: null` and creates no `ci_installations` row
- [ ] **AC-5** — Preview step renders all file paths; workflow YAML is in an editable `<textarea>` with a visible `<label>`
- [ ] **AC-6** — Configure step: `opened` + `synchronize` pre-checked; `github_review` default selected; `exit_code_only` option present; no `none` option; secrets panel lists both secrets; branch-protection hint visible
- [ ] **AC-7** — CircleCI/Jenkins/CLI targets: wizard completes without error; bundle contains only manifest + skill files; only "Copy as ZIP" is offered
- [ ] **AC-8/9/10/11** — Generated workflow YAML: `permissions: {contents: read, pull-requests: write}` only; sole trigger is `on: pull_request:`; no `pull_request_target` or `issue_comment`; `OPENROUTER_API_KEY` appears only as `${{ secrets.OPENROUTER_API_KEY }}`
- [ ] **AC-16** — `/ci-runs` page renders all required columns ordered newest-first; `github_url: null` shows `"—"`
- [ ] **AC-17** — Refresh inserts new `ci_runs` rows with `duration_ms` populated; repeated refresh inserts zero duplicate rows; invalid artifact is skipped with no malformed row
- [ ] **AC-18/19/20/21** — Agent CI tab shows installation count; per-repo list with "Add repository" / "Update CI config"; "Fail CI on" selector persists via `PATCH /agents/:id`; run history table
- [ ] **AC-22** — Install step disables "Open a PR" and shows explanatory message when preflight returns `has_write_access: false`; "Copy as ZIP" remains available
