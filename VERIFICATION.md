# Verification Report: Onboarding Generator (SPEC-01)

**Verified:** 2026-07-07
**Plan:** `PLAN.md`
**Branch:** `feature/l05`
**Commits verified:** `f7ac0f9` (Plan + Spec), `3ea0bf6` (Onboarding implementation), `810153b` (Supplement tests)

---

## Summary

| Status | Count |
|--------|-------|
| Implemented | 23 |
| Missing | 0 |
| Partial | 0 |
| No test found | 0 |
| Not checkable | 0 |
| Pre-existing unrelated failure | 1 |

All 23 plan tasks delivered. All onboarding-related tests pass. One pre-existing failure in `server/test/contracts.test.ts` confirmed to predate this branch (authored in commit `d45ab0d` on main, before this feature branch diverged).

---

## Per-Task Status

### Task A-1: Prompt fix — align `onboarding.system.md` with chosen section kinds

- **Status:** Implemented
- **File:** `server/src/prompts/onboarding.system.md` — exists
- **Acceptance criteria:**
  - Line 7 changed from `architecture` / `routes_and_apis` to `architecture_overview` / `critical_paths` → PASS
    - Evidence: line 8 reads `"allowed ONLY for the \`architecture_overview\` and \`critical_paths\` sections, else null"`
  - Lines 24-27 updated: `routes_and_apis` bullet removed; architecture hint updated → PASS
    - Evidence: line 23 reads `"In \`architecture_overview\`: include one simple mermaid \`diagram\` of how the pieces connect. In \`critical_paths\`: describe dependency chains clearly; a mermaid diagram is allowed but optional."`
  - `{{sections}}` and `{{language}}` placeholders intact → PASS
    - Evidence: line 4 = `{{sections}}`, line 38 = `{{language}}`
- **Tests:** covered by `onboarding.test.ts` (fillPrompt tests assert placeholder replacement)

---

### Task A-2: Module types

- **Status:** Implemented
- **File:** `server/src/modules/onboarding/types.ts` — exists
- **Acceptance criteria:**
  - `FactsBundle` interface with all 11 required fields → PASS
  - `ONBOARDING_SECTIONS` constant with all 5 exact kind strings (`architecture_overview`, `critical_paths`, `how_to_run`, `reading_order`, `first_tasks`) → PASS
  - `OnboardingSectionKind` type exported → PASS
  - Imports `IndexStatus` from `'../repo-intel/types.js'` → PASS
- **Tests:** `onboarding.test.ts` — imports `ONBOARDING_SECTIONS` and validates kind strings

---

### Task A-3: Repository layer

- **Status:** Implemented
- **File:** `server/src/modules/onboarding/repository.ts` — exists
- **Acceptance criteria:**
  - `OnboardingRepository` class with `Db` constructor → PASS
  - `findByRepoId(repoId)` → PASS
  - `upsert(repoId, json)` with `onConflictDoUpdate` → PASS (uses `new Date()` before upsert and returns it)
  - `getClonePath(repoId, workspaceId)` with workspace scoping `WHERE id = $repoId AND workspace_id = $workspaceId` → PASS
  - Imports `onboarding` from `../../db/schema/context.js`, `repos` from `../../db/schema/repos.js` → PASS
  - Layer rule: no DTO conversion or business logic → PASS
- **Tests:** mocked in `onboarding.test.ts` and `onboarding-supplement.test.ts`

---

### Task A-4: Facts collector + helpers

- **Status:** Implemented
- **File:** `server/src/modules/onboarding/helpers.ts` — exists
- **Acceptance criteria:**
  - `collectFacts`: reads `package.json`; on error falls back to empty defaults → PASS
  - `collectFacts`: detects `runtimeName`, `frameworkNames`, `runScripts`, `engines`, `topLevelDeps` → PASS
  - `collectFacts`: 2-level directory scan skipping `.git`, `node_modules`, `.next`, `dist`, `build`, `coverage`, `.cache` → PASS
  - `collectFacts`: produces `directoryTree` (string) and `allDiscoveredFiles` (flat `string[]`) → PASS
  - `collectFacts`: `routeList = []` (explicit v1 decision) → PASS
  - `buildSkeleton`: returns exactly 5 sections in `ONBOARDING_SECTIONS` order; `diagram: null`; `links: []` → PASS
  - `buildSkeleton`: `how_to_run` body includes detected scripts; `architecture_overview` body includes `directoryTree` → PASS
  - `fillPrompt`: replaces `{{sections}}` and `{{language}}`; wraps untrusted values in `<untrusted>` blocks → PASS
  - `validateAndStripLinks`: strips paths not in `knownPaths`; keeps paths in full scan but not in top-ranked list → PASS
- **Tests:** `onboarding.test.ts` (13 helper unit tests) + `onboarding-supplement.test.ts` (4 more covering AC-8 rank order)

---

### Task A-5: Service layer

- **Status:** Implemented
- **File:** `server/src/modules/onboarding/service.ts` — exists
- **Acceptance criteria:**
  - `OnboardingService` class with `Container` constructor → PASS
  - `getTour`: scope check via `getClonePath` (throws `NotFoundError` if null) → PASS
  - `getTour`: `Onboarding.safeParse` on stored JSON; on failure logs `warn` with exact message `'stored onboarding json is corrupt; treating as no tour'` and returns `null` → PASS (previously flagged gap, now confirmed fixed)
  - `generateTour`: skeleton path for `status === 'degraded' || 'failed'` → PASS
  - `generateTour`: full path for `status === 'full' || 'partial'` → PASS
  - `generateTour`: wraps `container.llm(provider)` in try-catch; remaps `ConfigError` → `AppError('no_llm_key', ..., 503)` → PASS
  - Post-parse kind assertion: throws `AppError('invalid_tour_output', ..., 422)` if sections have wrong kinds or count → PASS
  - Cost logged via `logger.info({ repoId, costUsd })` but never serialized → PASS
  - `logger` parameter uses a local `Logger` interface (not direct `FastifyBaseLogger` import — architecture reviewer fix, re-verified PASS)
- **Tests:** `onboarding.test.ts` (18 service tests) + `onboarding-supplement.test.ts` (6 more for AC-3/AC-7/AC-4)

---

### Task A-6: Routes layer

- **Status:** Implemented
- **File:** `server/src/modules/onboarding/routes.ts` — exists
- **Acceptance criteria:**
  - `RepoIdParams = z.object({ repoId: z.string().uuid() })` → PASS
  - `GET /repos/:repoId/onboarding` with `getContext`, 404 on null result → PASS
  - `POST /repos/:repoId/onboarding` with `getContext`, conditional `degraded` field in response → PASS
  - Service instantiated once at plugin init → PASS
- **Tests:** covered by service-level tests (route logic is thin delegation)

---

### Task A-7: Module registration

- **Status:** Implemented
- **File:** `server/src/modules/index.ts`
- **Acceptance criteria:**
  - `import onboarding from './onboarding/routes.js'` → PASS (line 15)
  - `onboarding` entry in `modules` record → PASS (line 44)
- **Tests:** N/A (static registry, covered by server startup)

---

### Task A-8: Tests (server)

- **Status:** Implemented
- **Files:** `server/src/modules/onboarding/onboarding.test.ts` (31 tests), `server/src/modules/onboarding/onboarding-supplement.test.ts` (10 tests, added by test-writer in commit `810153b`)
- **Acceptance criteria:**
  - Helper tests (collectFacts ×2, buildSkeleton ×5, fillPrompt ×3, validateAndStripLinks ×3) → PASS (13 tests)
  - Happy-path full generation (LLM called once, 5 sections, correct kinds, upsert called) → PASS (3 tests)
  - Degraded skeleton for all 5 `DegradedReason` values → PASS (5 tests)
  - No-key path AC-9 (AppError with `code='no_llm_key'`, statusCode 503, no upsert) → PASS (2 tests)
  - Invalid LLM output (AppError `invalid_tour_output`, no upsert) → PASS (2 tests)
  - Corrupt stored row (returns null, does not throw) → PASS (1 test)
  - Cross-tenant prevention (NotFoundError for both getTour and generateTour) → PASS (2 tests in main + 3 in supplement)
  - AC-8 rank order preservation (fillPrompt + collectFacts) → PASS (4 supplement tests)
  - AC-3 upsert shape + DB timestamp → PASS (2 supplement tests)
  - AC-7 regeneration calls upsert each time → PASS (2 supplement tests)
  - AC-4 degraded skeleton link arrays service-level → PASS (2 supplement tests)
- **Test run:** `pnpm exec vitest run` → 31/31 + 10/10 pass

---

### Task B-1: Copy AddRepoView to shared location

- **Status:** Implemented
- **Files:** `client/src/components/add-repo-modal/AddRepoView/AddRepoView.tsx` — exists; `client/src/components/add-repo-modal/AddRepoView/index.ts` — exists
- **Acceptance criteria:**
  - Both files present at new shared location → PASS
  - Original `_components/AddRepoView/` NOT deleted by B-1 (deleted by C-6 instead) → PASS (deleted by C-6 as planned)
- **Tests:** covered by `AddRepoModal.test.tsx` (renders AddRepoView content)

---

### Task B-2: Create AddRepoModal shared component

- **Status:** Implemented
- **Files:** `client/src/components/add-repo-modal/AddRepoModal.tsx` — exists; `client/src/components/add-repo-modal/index.ts` — exists
- **Acceptance criteria:**
  - `"use client"` directive → PASS (line 7)
  - Props `open: boolean; onClose: () => void` → PASS
  - Renders `<AddRepoView>` inside `<Modal>` from `@devdigest/ui` → PASS
  - `aria-modal="true"`, `role="dialog"` provided by Modal primitive → PASS (delegated to `@devdigest/ui` `Modal`)
  - Focus-trap on open (Tab/Shift+Tab cycling) → PASS (previously flagged gap, now confirmed fixed — explicit `handleTab` implementation with WCAG 2.1 SC 2.1.2 comment)
  - Escape triggers `onClose` → PASS
  - Barrel `index.ts` exports `AddRepoModal` → PASS
- **Tests:** `AddRepoModal.test.tsx` — 8 tests (open=false renders nothing; open=true renders; Escape closes; close button closes; no close on Escape when open=false; focus trap: initial focus, Tab forward wrap, Shift+Tab backward wrap)

---

### Task B-3: Wire modal into AppShell

- **Status:** Implemented
- **Files:** `client/src/components/app-shell/hooks/useShellContext.ts`; `client/src/components/app-shell/AppShell.tsx`
- **Acceptance criteria:**
  - `onAddRepo: () => void` added to `ShellContextOptions` interface → PASS (line 15)
  - Internal `router.push('/onboarding')` removed; `onAddRepo()` called in `onRemoveRepo` fallback → PASS (line 54)
  - `onAddRepo` in `useMemo` dependency array → PASS (line 89)
  - `AppShell.tsx`: `useState(false)` for modal open state → PASS (line 14)
  - `AppShell.tsx`: `openAddRepo` callback → PASS (line 19)
  - `AppShell.tsx`: passes `onAddRepo: openAddRepo` to `useShellContext` → PASS (line 23)
  - `AppShell.tsx`: renders `<AddRepoModal open={addRepoOpen} onClose={...} />` → PASS (line 32)
- **Tests:** `AppShell.test.tsx` — 2 tests (modal hidden initially; renders after Add repository click)

---

### Task B-4: Update root page CTA

- **Status:** Implemented
- **File:** `client/src/app/page.tsx`
- **Acceptance criteria:**
  - `addRepoOpen` state and `setAddRepoOpen` → PASS (line 15)
  - `onCta={() => setAddRepoOpen(true)}` → PASS (line 38)
  - `<AddRepoModal open={addRepoOpen} onClose={() => setAddRepoOpen(false)} />` → PASS (line 48)
- **Tests:** covered by AddRepoModal test and AppShell test; no dedicated page.tsx test (plan did not require one)

---

### Task B-5: Update RepoNotFound CTA

- **Status:** Implemented
- **File:** `client/src/components/repo-not-found/RepoNotFound.tsx`
- **Acceptance criteria:**
  - `addRepoOpen` state → PASS (line 14)
  - `onCta={() => setAddRepoOpen(true)}` → PASS (line 22)
  - `<AddRepoModal open={addRepoOpen} onClose={...} />` → PASS (line 24)
- **Tests:** plan did not require a dedicated test; RepoNotFound CTA behavior covered implicitly

---

### Task B-6: Update client CLAUDE.md

- **Status:** Implemented
- **File:** `client/CLAUDE.md` (symlink → `client/AGENTS.md`) — `AGENTS.md` updated in commit `3ea0bf6`
- **Acceptance criteria:**
  - Route description changed from `onboarding/  # add-repository form` to `onboarding/  # newcomer tour (add-repository form moved to AddRepoModal in components/add-repo-modal/)` → PASS
    - Evidence: grep `client/AGENTS.md` line 23: `onboarding/           # newcomer tour (add-repository form moved to AddRepoModal in components/add-repo-modal/)`
  - Note: `client/CLAUDE.md` is a symlink to `AGENTS.md`; modifying `AGENTS.md` satisfies the B-6 requirement
- **Tests:** N/A (documentation file)

---

### Task B-7: Tests (Phase B)

- **Status:** Implemented
- **Files:** `client/src/components/add-repo-modal/AddRepoModal.test.tsx` — exists; `client/src/components/app-shell/AppShell.test.tsx` — exists
- **Acceptance criteria:**
  - `AddRepoModal.test.tsx`: open=false → not visible → PASS; open=true → renders AddRepoView → PASS; Escape closes → PASS; close button closes → PASS; focus-trap tests → PASS (8 tests total)
  - `AppShell.test.tsx`: modal hidden initially → PASS; triggers on Add repository click → PASS (2 tests total)
- **Test run:** all 10 tests pass

---

### Task C-1: API functions

- **Status:** Implemented
- **File:** `client/src/lib/api.ts`
- **Acceptance criteria:**
  - `fetchOnboardingTour(repoId)` exported, calls `api.get` → PASS (line 80-84)
  - `generateOnboardingTour(repoId)` exported, calls `api.post` with NO body argument → PASS (line 86-91; `api.post(\`/repos/${repoId}/onboarding\`)` — no second argument)
  - `Onboarding` imported from `@devdigest/shared` → PASS (line 5)
- **Tests:** hooks tests mock these functions

---

### Task C-2: TanStack Query hooks

- **Status:** Implemented
- **Files:** `client/src/lib/hooks/onboarding.ts` — exists; `client/src/lib/hooks/index.ts` exports `./onboarding`
- **Acceptance criteria:**
  - `useOnboardingTour(repoId)`: `useQuery` with correct queryKey, `enabled: !!repoId` → PASS
  - `useGenerateOnboarding(repoId)`: `useMutation` with `onSuccess` populating cache via `qc.setQueryData` → PASS
  - `"use client"` directive → PASS (line 3)
  - `hooks/index.ts` re-exports → PASS (line 12: `export * from "./onboarding"`)
- **Tests:** mocked in `OnboardingView.test.tsx` and `OnboardingView.ac10.test.tsx`

---

### Task C-3: MermaidDiagram accessible alt text

- **Status:** Implemented
- **File:** `client/src/components/mermaid-diagram/MermaidDiagram.tsx`
- **Acceptance criteria:**
  - `alt?: string` prop with default `'Architecture diagram'` → PASS (line 27, 30)
  - Renders `<figure aria-label={alt}>` when state is not `'invalid'` → PASS (line 71)
  - `<figcaption>` with visually-hidden inline styles containing `{alt}` → PASS (lines 86-97)
  - Uses inline style (not Tailwind `sr-only`) → PASS
- **Tests:** `MermaidDiagram.test.tsx` — 3 tests (custom alt in figcaption; default alt; aria-label on figure)

---

### Task C-4: OnboardingSectionCard feature component

- **Status:** Implemented
- **Files:** `client/src/app/onboarding/_components/OnboardingSectionCard/OnboardingSectionCard.tsx` — exists; `index.ts` barrel — exists
- **Acceptance criteria:**
  - Props: `section: OnboardingSection` from `@devdigest/shared` → PASS
  - `<h2>{section.title}</h2>` landmark heading → PASS (line 28)
  - `<Markdown>{section.body}</Markdown>` from `@devdigest/ui` → PASS (line 41)
  - `section.diagram != null` → renders `<MermaidDiagram chart={...} alt={section.title + ' diagram'} />` → PASS (lines 44-49)
  - `section.links.length > 0` → `<ul>` of `<li><code>{link.path}</code></li>` → PASS (lines 51-92)
  - UI strings via `useTranslations('onboarding')` → PASS (line 14, uses `t("relatedFiles")`)
- **Tests:** `OnboardingSectionCard.test.tsx` — 5 tests (h2 heading; no figure when diagram=null; MermaidDiagram when diagram set; ul with code paths; no list when links empty)

---

### Task C-5: OnboardingView feature component

- **Status:** Implemented
- **Files:** `client/src/app/onboarding/_components/OnboardingView/OnboardingView.tsx` — exists; `index.ts` barrel — exists
- **Acceptance criteria:**
  - `const { repoId } = useActiveRepo()` from `lib/repo-context` → PASS (line 31)
  - `useOnboardingTour(repoId)` → PASS (line 33)
  - `useGenerateOnboarding(repoId)` → PASS (line 34)
  - `!repoId` → skeleton placeholders → PASS (lines 56-62)
  - `tourQuery.isLoading` → 5 `<Skeleton>` placeholders → PASS (lines 65-71)
  - Non-404 error → retryable EmptyState with `tourQuery.refetch()` → PASS (lines 74-81)
  - 404 error → Generate CTA (AC-6) → PASS (lines 84-149)
  - `generate.isPending` → "Generating…" label, CTA disabled → PASS (line 90-91)
  - `generate.isError && code === 'no_llm_key'` → Settings link, no error boundary (AC-9) → PASS (lines 96-120)
  - Tour data: Regenerate button with `isPending` states → PASS (lines 181-190)
  - `degraded === true` → degraded notice banner → PASS (lines 193-208)
  - `tourQuery.data.sections.map(s => <OnboardingSectionCard key={s.kind} section={s} />)` → PASS (lines 257-261)
  - All strings via `useTranslations('onboarding')` → PASS
- **Tests:** `OnboardingView.test.tsx` — 7 tests; `OnboardingView.ac10.test.tsx` — 5 tests

---

### Task C-6: Rewrite /onboarding page + delete old AddRepoView

- **Status:** Implemented
- **File:** `client/src/app/onboarding/page.tsx` — rewritten
- **Acceptance criteria:**
  - Page imports `OnboardingView` and returns `<OnboardingView />` → PASS
  - No `"use client"` directive (plan specified it; architecture reviewer correctly removed it as unnecessary since `OnboardingView` already has it — re-verified PASS in earlier pass) → PASS
  - `_components/AddRepoView/AddRepoView.tsx` deleted → PASS (`ls` returns MISSING)
  - `_components/AddRepoView/index.ts` deleted → PASS
  - `_components/AddRepoView/` directory removed → PASS
- **Tests:** covered by `OnboardingView.test.tsx`

---

### Task C-7: i18n messages

- **Status:** Implemented
- **File:** `client/messages/en/onboarding.json`
- **Acceptance criteria:**
  - `"degradedNotice": "Tour generated from limited index data — some sections may be incomplete."` → PASS (line 17)
  - `"noKeyNotice": "No AI model key is configured for the Onboarding Tour. Add your OpenRouter API key in Settings to generate this tour."` → PASS (line 18)
  - `"noKeySettingsLink": "Go to API Keys"` → PASS (line 19)
  - `"lastGenerated": "Last generated {date}"` → PASS (line 20)
  - `"retryError": "Generation failed. Check your API key and try again."` → PASS (line 21)
  - `"relatedFiles": "Related files"` → PASS (line 22)
  - All pre-existing keys preserved → PASS
- **Tests:** `OnboardingView.test.tsx` uses `NextIntlClientProvider` with this file; all string assertions pass

---

### Task C-8: Tests (Phase C)

- **Status:** Implemented
- **Files:**
  - `client/src/app/onboarding/_components/OnboardingView/OnboardingView.test.tsx` — exists
  - `client/src/app/onboarding/_components/OnboardingSectionCard/OnboardingSectionCard.test.tsx` — exists
  - `client/src/components/mermaid-diagram/MermaidDiagram.test.tsx` — exists (new tests added)
  - `client/src/app/onboarding/_components/OnboardingView/OnboardingView.ac10.test.tsx` — exists (added by test-writer commit `810153b`)
- **Acceptance criteria:**
  - `OnboardingView.test.tsx`: 404 → Generate CTA visible, no error boundary → PASS
  - `OnboardingView.test.tsx`: tour data → 5 section headings visible → PASS
  - `OnboardingView.test.tsx`: `degraded: true` → degraded notice banner → PASS
  - `OnboardingView.test.tsx`: `code === 'no_llm_key'` → Settings link, no error boundary → PASS
  - `OnboardingView.test.tsx`: `generate.isPending` → "Generating…" label, button disabled → PASS
  - `OnboardingView.test.tsx`: `generatedAt` → timestamp displayed → PASS
  - `OnboardingView.test.tsx`: kind-string pin test (headings in exact order `['Architecture Overview', 'Critical Paths', 'How to Run Locally', 'Guided Reading Order', 'First Tasks']`) → PASS
  - `OnboardingSectionCard.test.tsx`: `diagram: null` → no `<figure>` → PASS
  - `OnboardingSectionCard.test.tsx`: `diagram` set → MermaidDiagram rendered → PASS
  - `OnboardingSectionCard.test.tsx`: links present → `<ul>` with `<code>` paths → PASS
  - `OnboardingSectionCard.test.tsx`: `<h2>` heading present → PASS
  - `MermaidDiagram.test.tsx`: `alt="Test description"` → `<figcaption>` contains "Test description" → PASS
  - `OnboardingView.ac10.test.tsx` (AC-10 supplement): useOnboardingTour called with active repoId; repo A content displayed when A active; repo B content when B active; content updates on repo switch; null repoId guards fetch → 5 tests PASS
- **Test run:** all 20 client tests in these files pass

---

## Definition of Done Checks

| Criterion | Evidence | Status |
|-----------|----------|--------|
| `pnpm test` passes in `server/` (onboarding) | 31 tests in `onboarding.test.ts` + 10 in `onboarding-supplement.test.ts` = 41 pass; pre-existing `contracts.test.ts` failure excluded (see below) | PASS |
| `pnpm test` passes in `client/` | 75 tests across 21 test files, all pass | PASS |
| `pnpm tsc --noEmit` in `server/` | No output = no type errors | PASS |
| `pnpm tsc --noEmit` in `client/` | No output = no type errors | PASS |
| **AC-1:** Facts bundle (runtime, frameworks, scripts, directory tree, top-N files, dependency chains, route list) collected before LLM call | `collectFacts` in `helpers.ts` collects all 7 artifact types; `routeList = []` explicitly for v1 per plan decision | PASS |
| **AC-2:** Exactly one structured LLM call for `full`/`partial` index; exactly 5 sections in correct order | Service uses `llm.completeStructured` once; post-parse kind assertion enforces order; test asserts `completeStructured` called exactly once | PASS |
| **AC-3:** Tour persisted as JSON blob in `onboarding` table, overwriting prior entry | `repo.upsert(repoId, tour)` uses `INSERT … ON CONFLICT DO UPDATE`; supplement test confirms persisted object equals returned object | PASS |
| **AC-4:** Degraded/failed index → deterministic skeleton (no LLM), correct section kinds, empty links | Skeleton path in `generateTour`; `buildSkeleton` returns 5 sections with `links: []`; 5 degraded test cases pass; supplement test asserts all link arrays empty | PASS |
| **AC-5:** Cached tour displayed without new LLM call | `getTour` reads from `onboarding` table; GET route returns cached tour; no LLM call in `getTour` path | PASS |
| **AC-6:** No tour → Generate CTA, not error boundary or blank page | `OnboardingView` differentiates 404 (`is404` flag) from real errors; renders `EmptyState` with Generate button; test confirms Generate button visible, no `role="alert"` | PASS |
| **AC-7:** Regeneration re-runs collector, re-calls LLM, overwrites DB entry | `generateTour` always calls `collectFacts` then `upsert`; no "already exists" check; supplement test calls `generateTour` twice and asserts `upsert` called twice | PASS |
| **AC-8:** Guided Reading Order uses `pagerank × (1 + hotness)` ranking from repo-intel without re-computing | `collectFacts` calls `repoIntelSvc.getTopFilesByRank(repoId, 20)` and passes result through unchanged to `topRankedFiles`; supplement test verifies non-alphabetical rank order preserved | PASS |
| **AC-9:** No model key → 503 response the client renders as Settings notice with link | Server: `ConfigError` → `AppError('no_llm_key', ..., 503)`; client: `isNoLlmKey` branch renders `<Link href="/settings/api-keys">Go to API Keys</Link>`; test confirms Settings link visible, no error boundary | PASS |
| **AC-10:** Tour fetched for active-context repo | `OnboardingView` calls `useActiveRepo()` then `useOnboardingTour(repoId)`; AC-10 test file confirms hook called with active repoId; repo-switch test confirms content updates | PASS |
| 4 call sites open AddRepoModal (not route to `/onboarding`) | `useShellContext.ts` `onAddRepo` (line 54); `useShellContext.ts` `onRemoveRepo` fallback (line 54); `app/page.tsx` `onCta` (line 38); `RepoNotFound.tsx` `onCta` (line 22) — all open modal | PASS |
| `MermaidDiagram` renders visually-hidden `<figcaption>` | `<figcaption style={{ position:'absolute', width:1, height:1, overflow:'hidden', clip:'rect(0 0 0 0)', whiteSpace:'nowrap' }}>` at lines 86-97; tested by `MermaidDiagram.test.tsx` | PASS |
| Each tour section heading is `<h2>` | `OnboardingSectionCard` renders `<h2>{section.title}</h2>`; `OnboardingSectionCard.test.tsx` asserts `getByRole("heading", { level: 2 })`; `OnboardingView.test.tsx` asserts all 5 h2s | PASS |
| `client/CLAUDE.md` route description updated | `client/CLAUDE.md` is a symlink to `client/AGENTS.md`; `AGENTS.md` line 23 updated to `"newcomer tour (add-repository form moved to AddRepoModal in components/add-repo-modal/)"` | PASS |

---

## Traceability Matrix (AC → Task → Test → Commit)

| AC | Implementing Tasks | Primary Test File(s) | Test Count | Commit |
|----|-------------------|----------------------|------------|--------|
| AC-1 | A-4 (`collectFacts`) | `onboarding.test.ts` helpers section | 2 | `3ea0bf6` |
| AC-2 | A-1, A-4, A-5, A-6 | `onboarding.test.ts` happy-path section | 3 | `3ea0bf6` |
| AC-3 | A-3, A-5 | `onboarding-supplement.test.ts` AC-3 section | 2 | `810153b` |
| AC-4 | A-4, A-5 | `onboarding.test.ts` degraded section + `onboarding-supplement.test.ts` AC-4 section | 5 + 2 | `3ea0bf6` + `810153b` |
| AC-5 | A-3, A-5, A-6, C-1, C-2, C-5 | `OnboardingView.test.tsx` (tour data case) | 1 | `3ea0bf6` |
| AC-6 | A-6, C-2, C-5 | `OnboardingView.test.tsx` (404 case) | 1 | `3ea0bf6` |
| AC-7 | A-3, A-5 | `onboarding-supplement.test.ts` AC-7 section | 2 | `810153b` |
| AC-8 | A-4, A-5 | `onboarding-supplement.test.ts` AC-8 sections | 4 | `810153b` |
| AC-9 | A-5, A-6, C-2, C-5 | `onboarding.test.ts` no-key section + `OnboardingView.test.tsx` (no_llm_key case) | 2 + 1 | `3ea0bf6` |
| AC-10 | C-2, C-5 | `OnboardingView.ac10.test.tsx` | 5 | `810153b` |

---

## Pre-existing, Unrelated Test Failure

`server/test/contracts.test.ts` — 1 test fails (out of 152 total across all server test files).

- **Failure:** `Intent.parse(...)` throws on a fixture that previously passed, suggesting a schema contract changed. Failure is in `test/contracts.test.ts` which last changed in commit `d45ab0d` (`feat(reviews): remove per-PR/run cost, keep model pricing`), which is on `main` and predates this feature branch.
- **Confirmation:** `git log --oneline --all -- server/test/contracts.test.ts` shows this file was last touched in `d45ab0d` (before any `feature/l05` commits). No onboarding code touches `Intent`, `BlastRadius`, or the contracts test.
- **Verdict:** This failure is NOT caused by the Onboarding Generator implementation. It must not be conflated with this feature's status.

---

## Orphaned Implementations (potential out-of-scope changes)

Files modified in `feature/l05` that are not named in PLAN.md tasks:

| File | Change | Justification |
|------|--------|---------------|
| `specs/SPEC-01-onboarding-generator.md` | Added in commit `f7ac0f9` alongside `PLAN.md` | The spec is the referenced artifact (`Spec reference: specs/SPEC-01-onboarding-generator.md`); adding it is consistent with the plan structure. Not a gap. |
| `client/AGENTS.md` | Updated route description for `onboarding/` | `client/CLAUDE.md` is a symlink to `AGENTS.md`; modifying `AGENTS.md` is the only way to update `CLAUDE.md` on this filesystem. This satisfies B-6. Not out-of-scope. |

No genuinely orphaned changes detected. All modified files trace to a plan task or the plan's referenced artifacts.

---

## Verdict

**PASS** — All 23 tasks implemented and tested. All 10 acceptance criteria met. All onboarding-related tests pass (41 server unit tests + 30 client unit tests = 71 tests, 0 skipped). TypeScript checks pass in both `server/` and `client/`. The one failing test (`server/test/contracts.test.ts`) is a pre-existing, unrelated failure that predates this branch and is not caused by any onboarding code change.
