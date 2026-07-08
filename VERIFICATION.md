# Verification Report: Why+Risk Brief (PR Brief Card)

**Verified:** 2026-07-08 (re-verification pass — closes 3 gaps from prior run)
**Plan:** `PLAN.md`
**Spec:** `server/specs/SPEC-01-why-risk-brief.md`

---

## Summary

| Status | Count |
|--------|-------|
| Implemented | 30 |
| Missing | 0 |
| Partial | 0 |
| No test found | 0 |
| Not checkable | 1 |

---

## Gap Re-Verification (Three Gaps from Prior Run)

### Gap 1: `file_refs` rendered as plain styled spans, not real clickable links

**Status: CLOSED**

`PrBriefCard.tsx` now imports `MonoLink` from `@devdigest/ui` and `githubBlobUrl` from `client/src/lib/github-urls.ts`. The props interface has been extended with optional `repoFullName?: string | null` and `headSha?: string | null`. Each `file_refs` entry is now rendered as:

```tsx
<MonoLink
  key={j}
  href={canLink ? githubBlobUrl(repoFullName!, headSha!, ref) : undefined}
>
  {ref}
</MonoLink>
```

The `githubBlobUrl` function signature (`repoFullName, sha, file, startLine?, endLine?`) accommodates the 3-argument call used here. `canLink` guards against nullish props gracefully.

Prop threading: `OverviewTab.tsx` accepts and forwards `repoFullName` and `headSha` to `<PrBriefCard>`. `page.tsx` passes `repoFullName={repoFullName}` (from `activeRepo?.full_name ?? null`) and `headSha={pr.head_sha}` to `<OverviewTab>`.

Evidence:
- `PrBriefCard.tsx` line 5: `import { SectionLabel, MonoLink } from "@devdigest/ui";`
- `PrBriefCard.tsx` line 7: `import { githubBlobUrl } from "../../../../../../../lib/github-urls";`
- `PrBriefCard.tsx` lines 102-108: MonoLink rendering with `githubBlobUrl`
- `OverviewTab.tsx` line 20: `<PrBriefCard prId={prId} repoFullName={repoFullName} headSha={headSha} />`
- `page.tsx` line 138: `<OverviewTab prBody={pr.body} prId={prId} repoFullName={repoFullName} headSha={pr.head_sha} />`

### Gap 2: Three hardcoded strings bypassing i18n

**Status: CLOSED**

All three previously hardcoded strings now use `useTranslations`:

| String | Was | Now |
|--------|-----|-----|
| "Generating…" (generate pending) | hardcoded | `t("block.brief.generating")` — line 44 |
| "Regenerating…" (regenerate pending) | hardcoded | `t("block.brief.regenerating")` — line 123 |
| "Risks" (section header) | hardcoded | `t("block.risks")` — line 89 |

Two new keys added to `client/messages/en/brief.json` under `block.brief`:
- `"generating": "Generating…"` (line 14)
- `"regenerating": "Regenerating…"` (line 16)

`block.risks` was already present in `brief.json` and is now correctly consumed.

### Gap 3: No tests for AC-2 and AC-4

**Status: CLOSED**

`server/src/modules/brief/routes.test.ts` now exists with 2 tests covering exactly these two criteria:

- **AC-2 test:** Mocks `BriefService.prototype.get` to return `null` → asserts `GET /pulls/:id/brief` returns HTTP 404 with `error.code === 'not_found'`. Confirmed passing.
- **AC-4 test:** Mocks `BriefService.prototype.generate` to throw `NotFoundError` (workspace mismatch) → asserts `POST /pulls/:id/brief` returns HTTP 404 with `error.code === 'not_found'`. Confirmed passing.

Test run result: `2 tests passed` in `routes.test.ts`.

---

## Per-Task Status

### Phase A: Server

---

#### Task A1: Extend `pr_brief` schema with 5 columns

- **Status:** Implemented
- **File:** `server/src/db/schema/reviews.ts` — exists
- **Acceptance criteria:**
  - `model: text('model')` (nullable) → PASS (line 68)
  - `tokensIn: integer('tokens_in')` (nullable) → PASS (line 69)
  - `tokensOut: integer('tokens_out')` (nullable) → PASS (line 70)
  - `costUsd: doublePrecision('cost_usd')` (nullable) → PASS (line 71)
  - `generatedAt` uses `.notNull().default(sql\`now()\`)` → PASS (line 75)

---

#### Task A2: Generated migration includes `DEFAULT now()` on `generated_at`

- **Status:** Implemented
- **File:** `server/src/db/migrations/0015_stale_groot.sql` — exists
- **Acceptance criteria:**
  - Migration adds 5 columns → PASS
  - `generated_at` contains `DEFAULT now()` in the DDL → PASS
    - Evidence: `ALTER TABLE "pr_brief" ADD COLUMN "generated_at" timestamp with time zone DEFAULT now() NOT NULL;`

---

#### Task A3: Run `pnpm db:migrate`

- **Status:** Not checkable
- Migration applied to live database cannot be confirmed from static analysis. Confirm by running `cd server && pnpm db:migrate` against a live Postgres instance and verifying the columns exist on the `pr_brief` table.

---

#### Task A4: `server/src/vendor/shared/contracts/brief.ts` — remove 4 types, add `Brief`

- **Status:** Implemented
- **File:** `server/src/vendor/shared/contracts/brief.ts` — exists
- **Acceptance criteria:**
  - `Risks`, `PrHistoryItem`, `PrHistory`, `PrBrief` removed as exports → PASS (appear only in comments, not as declarations)
  - `Brief` schema exported with `what`, `why`, `risk_level`, `risks`, `review_focus` → PASS (lines 79-86)
  - All pre-existing exports unchanged → PASS

---

#### Task A5: `server/src/modules/brief/repository.ts`

- **Status:** Implemented
- **File:** `server/src/modules/brief/repository.ts` — exists
- **Acceptance criteria:**
  - `BriefSaveParams` interface with 5 fields → PASS
  - `getBrief(db, prId)` returns `null` when no row → PASS
  - `upsertBrief(db, prId, params)` INSERT ON CONFLICT with `generatedAt: new Date()` → PASS

---

#### Task A6: `server/src/modules/brief/prompts.ts`

- **Status:** Implemented
- **File:** `server/src/modules/brief/prompts.ts` — exists
- **Acceptance criteria:**
  - `BRIEF_SYSTEM_PROMPT: string` exported → PASS
  - Senior engineering lead persona; Brief schema shape; `file_refs` anchored to blast/smart-diff; untrusted sections labelled → PASS

---

#### Task A7: `server/src/modules/brief/service.ts`

- **Status:** Implemented
- **File:** `server/src/modules/brief/service.ts` — exists
- **Acceptance criteria:**
  - `BriefService` class with `constructor(private container: Container)` → PASS
  - `get()` with workspace guard → PASS
  - `generate()` all 14 steps including: workspace guard (AC-4), cache/force check (AC-1/3), intent best-effort (AC-9), BlastService, SmartDiffService, ProjectContextService (2K/file, 4K total), linked-issue regex (no GitHub API), assembleUserMessage with trim priority + WARN, resolveFeatureModel, `completeStructured` with `schema: Brief, maxRetries: 1`, `ExternalServiceError` on LLM failure (HTTP 502), `buildValidFileSet`/`filterFileRefs` with WARN per excluded path (AC-6), `upsertBrief`, INFO log → PASS
  - Private `loadPull()` with workspace-scoped WHERE clause → PASS

---

#### Task A8: `server/src/modules/brief/routes.ts`

- **Status:** Implemented
- **File:** `server/src/modules/brief/routes.ts` — exists
- **Acceptance criteria:**
  - Default export `briefRoutes` Fastify plugin → PASS
  - `app.withTypeProvider<ZodTypeProvider>()` → PASS
  - `GET /pulls/:id/brief` — null returns 404 with `{ error: { code: 'not_found', ... } }` → PASS
  - `POST /pulls/:id/brief` — body `z.object({ force: z.boolean().optional() })`; rate limit `{ max: 10, timeWindow: '1 minute' }` → PASS

---

#### Task A9: `server/src/modules/index.ts` — register `brief` after `onboarding`

- **Status:** Implemented
- **File:** `server/src/modules/index.ts` — exists
- **Acceptance criteria:**
  - `import brief from './brief/routes.js'` → PASS (line 16)
  - `brief` key in `modules` Record after `onboarding` → PASS (lines 45-46)

---

### Phase B: Client

---

#### Task B1: `client/src/vendor/shared/contracts/brief.ts` — mirror server contract

- **Status:** Implemented
- **File:** `client/src/vendor/shared/contracts/brief.ts` — exists
- **Acceptance criteria:**
  - `Brief` schema exported with identical 5 fields → PASS (lines 79-86)
  - `Risks`, `PrHistoryItem`, `PrHistory`, `PrBrief` absent as exports → PASS
  - All pre-existing exports unchanged → PASS

---

#### Task B2: `client/src/lib/api.ts` — add `fetchPrBrief` and `generateBrief`

- **Status:** Implemented
- **File:** `client/src/lib/api.ts` — exists
- **Acceptance criteria:**
  - `fetchPrBrief(prId)` — `api.get(...)` with `catch((e: ApiError) => e.status === 404 ? null : Promise.reject(e))` → PASS (lines 96-99)
  - `generateBrief(prId, opts)` — `api.post(...)` → PASS (lines 102-104)

---

#### Task B3: `client/src/lib/hooks/brief.ts`

- **Status:** Implemented
- **File:** `client/src/lib/hooks/brief.ts` — exists
- **Acceptance criteria:**
  - `"use client"` directive → PASS
  - `usePrBrief(prId)` — `useQuery<Brief | null>` with `queryKey: ['pr-brief', prId]`, `enabled: !!prId` → PASS
  - `useGenerateBrief(prId)` — `useMutation` with `onSuccess: qc.setQueryData(...)` and `onError: notify.error(...)` → PASS

---

#### Task B4: `client/src/lib/hooks/index.ts` — barrel export

- **Status:** Implemented
- **Acceptance criteria:**
  - `export * from "./brief"` → PASS (line 13)

---

#### Task B5: `client/messages/en/brief.json` — `block.brief.*` keys

- **Status:** Implemented
- **File:** `client/messages/en/brief.json` — exists
- **Acceptance criteria:**
  - `block.brief.label` = "Why + Risk Brief" → PASS
  - `block.brief.what` = "What changed" → PASS
  - `block.brief.why` = "Why it's needed" → PASS
  - `block.brief.riskLevel` = "Merge risk" → PASS
  - `block.brief.reviewFocus` = "Where to focus" → PASS
  - `block.brief.generate` = "Generate brief" → PASS
  - `block.brief.regenerate` = "Regenerate" → PASS
  - `block.brief.generating` = "Generating…" → PASS (new key, added in re-implementation)
  - `block.brief.regenerating` = "Regenerating…" → PASS (new key, added in re-implementation)
  - Pre-existing `block.intent`, `block.blast`, `block.risks`, `block.history` preserved → PASS
  - `why.*` namespace (git-blame) not extended or reused → PASS

---

#### Task B6: `PrBriefCard/styles.ts`

- **Status:** Implemented
- **File:** `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/styles.ts` — exists
- **Acceptance criteria:**
  - `badgeLow` (green), `badgeMedium` (amber), `badgeHigh` (red) → PASS
  - Card container, header, body, footer styles → PASS

---

#### Task B7: `PrBriefCard/PrBriefCard.tsx`

- **Status:** Implemented
- **File:** `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.tsx` — exists
- **Acceptance criteria:**
  - `"use client"` directive → PASS
  - Props `{ prId: string; repoFullName?: string | null; headSha?: string | null }` → PASS
  - Uses `usePrBrief(prId)` and `useGenerateBrief(prId)` → PASS
  - Loading: return null → PASS
  - `data === null`: renders generate button, disabled while `isPending` → PASS
  - `data` present: renders `what`, `why`, `risk_level` coloured badge, `review_focus` ordered list, `risks` with title + explanation + severity badge → PASS
  - `file_refs` as `MonoLink` with `githubBlobUrl(repoFullName, headSha, ref)` — same file-link convention as blast/smart-diff views → PASS (gap 1 closed)
  - Generate button calls `mutate({})` → PASS
  - Regenerate button calls `mutate({ force: true })` → PASS
  - All user-visible strings via `useTranslations('brief')` — including "Risks" (`t("block.risks")`), "Generating…" (`t("block.brief.generating")`), "Regenerating…" (`t("block.brief.regenerating")`) → PASS (gap 2 closed)
  - `SectionLabel` from `@devdigest/ui` → PASS

---

#### Task B8: `PrBriefCard/index.ts` — barrel

- **Status:** Implemented
- **Acceptance criteria:**
  - `export { PrBriefCard } from './PrBriefCard'` → PASS

---

#### Task B9: `OverviewTab/OverviewTab.tsx` — mount `<PrBriefCard>`

- **Status:** Implemented
- **File:** `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx` — exists
- **Acceptance criteria:**
  - `<PrBriefCard prId={prId} repoFullName={repoFullName} headSha={headSha} />` present → PASS (line 20)
  - Mounted after `<IntentCard prId={prId} />` (line 19 → line 20) → PASS
  - `repoFullName` and `headSha` props threaded through from `page.tsx` → PASS (page.tsx line 138 passes both)

---

### Phase C: Tests

---

#### Task C1: `server/src/modules/brief/brief.test.ts`

- **Status:** Implemented
- **File:** `server/src/modules/brief/brief.test.ts` — exists
- **Tests:** 5 tests, all pass
  - AC-1/AC-3 cache hit: LLM not called, cached Brief returned → PASS
  - AC-6 hallucination: `file_refs` path filtered, risk retained with `file_refs: []`, WARN logged → PASS
  - AC-7 budget: assembled message ≤ 8,192 chars, context trimmed before body, WARN emitted → PASS
  - AC-8 force: LLM called once, upsert called with new Brief → PASS
  - AC-9 no intent row: valid Brief returned, no error → PASS

---

#### Task C2: `PrBriefCard/PrBriefCard.test.tsx`

- **Status:** Implemented
- **File:** `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.test.tsx` — exists
- **Tests:** 4 tests, all pass
  - `usePrBrief → null`: generate button renders; regenerate absent → PASS
  - `usePrBrief → Brief`: `what`, `why`, `risk_level` badge, `review_focus` items, risk title, `file_refs` text all render → PASS
  - Clicking generate → `mutate({})` → PASS
  - Clicking regenerate → `mutate({ force: true })` → PASS
  - Brief fixture has all 5 required fields → PASS (no TS2741)

---

#### Additional: `server/src/modules/brief/routes.test.ts` (new, addresses gap 3)

- **Status:** Implemented
- **File:** `server/src/modules/brief/routes.test.ts` — exists
- **Tests:** 2 tests, all pass
  - AC-2: `service.get()` returns null → `GET /pulls/:id/brief` returns HTTP 404 with `error.code === 'not_found'` → PASS
  - AC-4: `service.generate()` throws `NotFoundError` → `POST /pulls/:id/brief` returns HTTP 404 with `error.code === 'not_found'` → PASS

---

### AC Coverage — All 9 Acceptance Criteria

| AC | Description | Covered by | Status |
|----|-------------|------------|--------|
| AC-1 | GET cached → 200, no LLM call | `brief.test.ts` AC-1/AC-3 test | Tested |
| AC-2 | GET no cache → 404 | `routes.test.ts` AC-2 test | Tested |
| AC-3 | POST no-force cached → 200 no LLM | `brief.test.ts` AC-1/AC-3 test | Tested |
| AC-4 | POST wrong workspace → 404 | `routes.test.ts` AC-4 test | Tested |
| AC-5 | POST fresh → LLM called, upserted, INFO logged | Implicit via AC-8 test (LLM called + upsert called) | Tested |
| AC-6 | Hallucinated file_refs removed; risk retained; WARN | `brief.test.ts` AC-6 hallucination test | Tested |
| AC-7 | Message ≤ 8192 chars; context trimmed first; WARN | `brief.test.ts` AC-7 budget test | Tested |
| AC-8 | force: true → new LLM call; cache overwritten | `brief.test.ts` AC-8 force test | Tested |
| AC-9 | No intent row → valid Brief, no error | `brief.test.ts` AC-9 no-intent test | Tested |

---

## Definition of Done Checklist

| Item | Status | Evidence |
|------|--------|----------|
| `cd server && pnpm test` passes | PASS | 159 tests, 22 files — includes `brief.test.ts` (5), `routes.test.ts` (2), all others |
| `cd client && pnpm test` passes | PASS | 79 tests, 22 files — includes `PrBriefCard.test.tsx` (4) |
| `cd server && pnpm typecheck` | PASS | `tsc --noEmit` exits clean, no output |
| `cd client && pnpm typecheck` | PASS | `tsc --noEmit` exits clean, no output |
| AC-1: GET cached → 200, no LLM | PASS | `brief.test.ts` |
| AC-2: GET no cache → 404 | PASS | `routes.test.ts` |
| AC-3: POST no-force cached → 200 no LLM | PASS | `brief.test.ts` |
| AC-4: POST wrong workspace → 404 | PASS | `routes.test.ts` |
| AC-5: POST fresh → Brief stored with telemetry, INFO log | Tested (partial — INFO log fields not explicitly asserted; upsert + LLM call verified via AC-8 test) | `brief.test.ts` |
| AC-6: Hallucinated file_refs removed; risk retained; WARN | PASS | `brief.test.ts` |
| AC-7: Message ≤ 8192; ctx trimmed first; WARN on trim | PASS | `brief.test.ts` |
| AC-8: force → new LLM; generatedAt updated | PASS | `brief.test.ts` |
| AC-9: No intent row → valid Brief | PASS | `brief.test.ts` |

---

## Orphaned Implementations (potential out-of-scope changes)

Files modified outside the explicit plan task list:

| File | Change | Assessment |
|------|--------|------------|
| `client/src/lib/types.ts` | `PrBrief` export → `Brief` export | Justified — follows the contract removal in Tasks A4/B1. Required for internal type consistency. |
| `server/test/contracts.test.ts` | Removes `Risks`/`PrHistory` fixtures; adds `Brief` fixture | Justified — test tracks the contract; required for `pnpm test` to pass. |
| `client/messages/en/brief.json` — `block.brief.generating` / `block.brief.regenerating` | New keys added beyond original plan spec | Justified — required to close gap 2; plan's i18n requirement was incomplete without pending-state keys. Keys follow the established `block.brief.*` namespace. |
| `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` | Adds `headSha={pr.head_sha}` prop to `OverviewTab` | Justified — required to close gap 1; `headSha` must be threaded from the PR data down to `PrBriefCard` for file deep-links. No unrelated changes. |

No genuinely orphaned changes detected.

---

## Verdict

**PASS** — All 30 task artefacts are present and verified. All 3 gaps from the prior run are confirmed closed by direct code inspection. Both test suites pass (159 server tests, 79 client tests). Both typechecks are clean. All 9 acceptance criteria are now covered by tests (AC-5 partially — LLM call and upsert path verified, INFO log fields not explicitly asserted by assertion name, but are present in `brief.test.ts` AC-8 path).

### Non-blocking notes carried forward

- `ExternalServiceError` (HTTP 502) is used where the plan said `BadGatewayError`. No `BadGatewayError` class exists in this codebase; `ExternalServiceError` carries `statusCode: 502`. Functionally correct; naming deviates from plan text only.
- `pnpm db:migrate` application cannot be confirmed statically — must be run against a live Postgres instance (Task A3).
