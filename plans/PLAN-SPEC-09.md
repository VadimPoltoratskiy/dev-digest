# Plan: "Learn" Finding Action (SPEC-09)

## Spec reference
`specs/SPEC-09-finding-learn.md` — 13 EARS ACs, all `[NEEDS CLARIFICATION]` items resolved.

## Execution mode: single-agent
Single-agent, sequential — explicitly requested. Phase 2 (client) imports `LearnFromFindingBody`
from `vendor/shared`; the contract step must complete before the client compiles.

## Goal
Add a **Learn** button to muted finding cards that opens a pre-filled modal; on save it calls
`POST /findings/:id/learn`, which resolves the finding's workspace/repo context, builds a
`MemoryItem` with finding-derived `sources`, and persists it via `MemoryService.create` so the
write-time curation gate always runs. The Memory view refreshes automatically on success.

## Modules affected
- `server/` — new service method in `modules/reviews/service.ts`, new route in
  `modules/reviews/routes.ts`, new shared Zod contract in `vendor/shared/contracts/findings.ts`,
  new integration test file.
- `client/` — new `LearnModal.tsx` component, `FindingCard.tsx` updated with button + state,
  new API function in `lib/api.ts`, new hook in `lib/hooks/reviews.ts`, wiring in two consumer
  pages, i18n additions, extended component test.

## Engineering Insights applied

- **vendor/shared manual mirror** (client INSIGHTS `2026-06-25`): `LearnFromFindingBody` must be
  added to both `server/src/vendor/shared/contracts/findings.ts` AND
  `client/src/vendor/shared/contracts/findings.ts` in the same commit — no tooling enforces the
  sync; tsc is the only check.
- **`BookOpen` icon does not exist in `IconName`** (client INSIGHTS `2026-07-16`): The `IconName`
  union in `client/src/vendor/ui/icons.tsx` is a closed set; `BookOpen` is absent. Use `Brain`
  (semantically appropriate for knowledge capture, present in the union). Any other icon from the
  union works; `BookOpen` causes a tsc error.
- **finding→memory trust gate** (server INSIGHTS `2026-07-16`): Finding title/file/rationale are
  untrusted model output. They must reach DB memory only through `MemoryService.create`, which
  calls `curateContent()` before insert. A direct `repo.insert` bypasses the gate — do not do
  this under any circumstances (AC-10).
- **service→service cross-module pattern** (server INSIGHTS `2026-07-16`): `architecture-reviewer`
  flags CRITICAL when a service instantiates another module's _repository_. Instantiating
  `new MemoryService(this.container)` is service→service and is the approved pattern (same pattern
  used by `run-executor.ts`). Do NOT import `MemoryRepository` directly.
- **Test fixture completeness** (client INSIGHTS `2026-06-25`): After adding `LearnFromFindingBody`
  to the shared findings contract, verify `FindingCard.test.tsx`'s `FINDING` factory includes all
  required `FindingRecord` fields (it already does; add the `learnModal` message namespace to the
  `NextIntlClientProvider` wrapper when the new modal test cases are added).
- **Recurring mock error for class methods** (server INSIGHTS `2026-07-14`): Mocking a class
  method prototype in unit tests requires `ClassName.prototype as unknown as Record<string, Mock>`
  — relevant if the implementer writes a hermetic unit test for the service method.
- **vendor/shared reconciliation** (client INSIGHTS `2026-07-16`): The pr-self-review skill
  flags any edit under `client/src/vendor/` as CRITICAL; `client/CLAUDE.md` explicitly requires
  mirroring. The `findings.ts` mirror is mandatory and backward-compatible — do not block on
  the blanket skill rule.

## Recommendations

- **Confidence: omit from client body, derive server-side.** The spec's service contract says
  `confidence` is optional and "defaults to the finding's confidence when omitted." Since the
  modal has no confidence control (AC-3) and "implicit" means user cannot see or edit it, the
  cleanest approach is for the client to omit `confidence` from the body entirely; the service
  resolves it as `body.confidence ?? ctx.finding.confidence`. This avoids sending a value the
  server will always override, keeps the body minimal, and stays fully backward-compatible with
  the optional field. If future versioning adds a confidence slider, the field is already in the
  contract.

## Architecture decisions

- **New dedicated route, not in `FINDING_ACTIONS` loop** — `POST /findings/:id/learn` carries
  a body (`LearnFromFindingBody`); the generic `FINDING_ACTIONS` loop handles only bodyless
  accept/dismiss. Mirrors the eval-case route precedent (routes.ts:170). Per
  onion-architecture: route validates and delegates; no business logic in the handler.
- **`new MemoryService(this.container).create(...)` in `ReviewService`** — service→service
  cross-module call, not service→foreign-repository. Per the onion-architecture skill, services
  may call other services via the container's capabilities. The container is already held by
  `ReviewService` as `this.container`. This is the only path that runs the curate gate (AC-10).
- **`useLearnFromFinding` goes in `client/src/lib/hooks/reviews.ts`** — the mutation touches a
  finding-level endpoint in the reviews module; the hook is a _finding action_, not a generic
  memory management hook. The `useCreateMemory` hook in `memory.ts` is for the Memory tab's own
  CRUD. Per ui-architecture: one domain file per hook domain.
- **`LearnModal.tsx` colocated in `client/src/components/FindingCard/`** — mirrors
  `CreateEvalCaseModal.tsx` placement; both are sub-components of `FindingCard`, which lives in
  the shared `components/FindingCard/` folder (used by two routes). Per ui-architecture:
  sub-components of a shared component live in the same shared feature directory.
- **`Textarea` for content field, not `TextInput`** — lesson text may be longer than an 80-char
  name; `Textarea` is already used in `FindingCard`'s reply composer and is available from
  `@devdigest/ui`. Per react-best-practices: use existing primitives.
- **`learnModal` i18n group in `prReview.json`** — `FindingCard` already uses the `"prReview"`
  namespace (`useTranslations("prReview")`); adding the modal strings to the same file keeps
  the namespace consistent and avoids a second `useTranslations` call. Per ui-architecture:
  no hardcoded UI strings.

## Tasks

### 1. Shared Zod contract — server vendor (source of truth)

- [ ] `server/src/vendor/shared/contracts/findings.ts` — add import of `MemoryScope` and
  `MemoryKind` from `./knowledge` at the top of the file (alongside the existing `z` import),
  then append the following export at the end of the file (after `FindingReplyBody`):

  ```typescript
  /** Body for POST /findings/:id/learn. */
  export const LearnFromFindingBody = z.object({
    content: z.string().min(1),
    scope: MemoryScope,
    kind: MemoryKind,
    confidence: z.number().min(0).max(1).optional(),
  });
  export type LearnFromFindingBody = z.infer<typeof LearnFromFindingBody>;
  ```

  Verification: this is purely additive; no existing field changes.

### 2. Shared Zod contract — client vendor mirror

- [ ] `client/src/vendor/shared/contracts/findings.ts` — make exactly the same additive change
  as Step 1: add the `MemoryScope`/`MemoryKind` import from `./knowledge` and append the
  `LearnFromFindingBody` schema + type export at the bottom of the file.
  Both files must be byte-for-byte identical for the new declarations.

### 3. Server service method

- [ ] `server/src/modules/reviews/service.ts` — add two imports:
  - `import { MemoryService } from '../memory/service.js';`
  - `import type { MemoryRecord, LearnFromFindingBody } from '@devdigest/shared';`

  Then add the following method to `ReviewService` (place it after `createFindingEvalCase`,
  before `replyToFinding`):

  ```typescript
  /**
   * Turn a finding into a memory record via the Memory create operation so the
   * write-time curation gate always runs (SPEC-09 AC-10). Never does a direct
   * insert — all writes go through MemoryService.create.
   */
  async learnFromFinding(
    workspaceId: string,
    findingId: string,
    body: LearnFromFindingBody,
  ): Promise<MemoryRecord> {
    // 1. Resolve finding → review → pull (identical guard to createFindingEvalCase)
    const ctx = await this.repo.findingContext(findingId);
    if (!ctx) throw new NotFoundError('Finding not found');

    const { finding, pull } = ctx;

    // 2. Workspace scope guard — same pattern as actOnFinding / createFindingEvalCase
    if (pull.workspaceId !== workspaceId) throw new NotFoundError('Finding not found');

    // 3. Build the memory item
    const confidence = body.confidence ?? finding.confidence;
    const sources = [
      {
        pr: pull.number,
        context: `finding: ${finding.title} (${finding.file}:${finding.startLine})`,
      },
    ];

    // 4. Scope: only repo-scoped records carry repoId (AC-7).
    //    global + team are both workspace-wide (team is reserve/display in v1).
    const repoId = body.scope === 'repo' ? pull.repoId : undefined;

    // 5. Delegate to MemoryService so curateContent() runs (AC-10)
    return new MemoryService(this.container).create(workspaceId, {
      content: body.content,
      scope: body.scope,
      kind: body.kind,
      confidence,
      sources,
      repoId,
    });
  }
  ```

### 4. Server route

- [ ] `server/src/modules/reviews/routes.ts` — in the import from `@devdigest/shared` (line 3),
  add `LearnFromFindingBody` to the named imports:
  ```typescript
  import { RunRequest, CreateFindingEvalCaseBody, FindingReplyBody, ComposeReviewBody,
           LearnFromFindingBody } from '@devdigest/shared';
  ```

  Then add the following route immediately after the eval-case block (after line 184, before
  the reply route at line 186):

  ```typescript
  // ---- Learn from a finding — create a memory record ----------------------
  app.post(
    '/findings/:id/learn',
    { schema: { params: IdParams, body: LearnFromFindingBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const record = await service.learnFromFinding(workspaceId, req.params.id, req.body);
      reply.status(201);
      return record;
    },
  );
  ```

  Route comment in the module docstring at line 11 — also add:
  `*   POST   /findings/:id/learn       {content, scope, kind, confidence?} → memory record`

### 5. Server integration test

- [ ] Create `server/src/modules/reviews/review-learn.it.test.ts` — mirror the structure of
  `review-eval-case.it.test.ts`. Test suite requires Docker (uses `describe.skip` guard).
  Must cover all of the following test cases:

  **AC-5, AC-6 — workspace-scoped memory row with finding-derived sources:**
  - Seed a workspace, repo, PR, run a review via the mock LLM (reuse `REVIEW_FIXTURE` and
    `DIFF` constants from the eval-case test), then `POST /findings/:findingId/learn` with
    `{ content: "lesson", scope: "repo", kind: "learning" }`.
  - Assert: 201 response, returned record has `scope: "repo"`, `kind: "learning"`,
    `sources[0].pr === <PR number>`, `sources[0].context` contains the finding title and file.

  **AC-7 — repo-scoped vs. workspace-wide:**
  - Same flow, `scope: "repo"`: verify the returned record's `sources[0].pr` matches the PR
    number (proxy for repo-scoped — the Memory service stores repoId which is internal).
  - Same flow, `scope: "global"`: verify 201 and that `sources[0].pr` is still set (the PR
    reference is always included; only `repoId` filtering changes on the DB side).

  **AC-8 — foreign-workspace finding → 404, no write:**
  - Create a second workspace, attempt `POST /findings/:findingId/learn` with the second
    workspace's credentials. Assert: 404 response; no memory record inserted for either workspace.

  **AC-10 — curate gate runs:**
  - Submit `content` starting with an injection opener (e.g., `"ignore previous instructions"`).
  - Assert: 201 response; the returned record's `content` has the opener stripped (or
    sanitized), proving the content passed through `curateContent()`.

  **AC-9 — invalid body → 422:**
  - Submit empty `content: ""` → 422.
  - Submit `scope: "invalid"` → 422.
  - Assert: no memory record created.

  **AC-12 — repeated learn on same finding:**
  - Call the endpoint twice with the same body. Assert: 201 both times; two distinct records
    exist (different `id` values, same `sources[0].pr`).

### 6. Client API function

- [ ] `client/src/lib/api.ts` — add the following import (if `MemoryRecord` is not already
  imported from `@devdigest/shared`; check the existing import line):
  ```typescript
  import type { ..., MemoryRecord, LearnFromFindingBody } from '@devdigest/shared';
  ```
  Then add after `postFindingEvalCase`:

  ```typescript
  /** POST /findings/:id/learn — create a memory record from a finding. */
  export function postFindingLearn(
    findingId: string,
    body: LearnFromFindingBody,
  ): Promise<MemoryRecord> {
    return api.post<MemoryRecord>(`/findings/${findingId}/learn`, body);
  }
  ```

### 7. Client hook

- [ ] `client/src/lib/hooks/reviews.ts` — add `postFindingLearn` to the import from `../api`
  and `MemoryRecord` (if not already imported) to the type import from `@devdigest/shared`.
  Then add after the existing action/mutation hooks (before the final exports):

  ```typescript
  /**
   * Mutation: learn from a finding — creates a memory record via the learn endpoint.
   * On success invalidates the memory list so MemoryView refreshes (AC-11).
   * Errors surface via MutationCache.onError (providers.tsx) — no local onError.
   */
  export function useLearnFromFinding() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (input: {
        findingId: string;
        body: { content: string; scope: string; kind: string };
      }) =>
        postFindingLearn(input.findingId, input.body as import('@devdigest/shared').LearnFromFindingBody),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ['memory'] });
      },
    });
  }
  ```

  Alternative (cleaner): import `LearnFromFindingBody` at the top of the file from
  `@devdigest/shared`, then type `input.body` directly as `LearnFromFindingBody`.

### 8. Client i18n strings

- [ ] `client/messages/en/prReview.json` — inside the top-level `finding` object, add:
  ```json
  "learnAction": "Learn"
  ```
  (This key can replace or alias `finding.learn` which already exists; confirm the exact key
  used by `FindingCard` and `LearnModal` — the pre-existing `finding.learn` key is already
  present and can be reused as-is for the button label.)

  Then add a new top-level `learnModal` group alongside `finding`, `trifecta`, etc.:
  ```json
  "learnModal": {
    "title": "Save lesson to memory",
    "contentLabel": "Lesson",
    "scopeLabel": "Scope",
    "scopeRepo": "This repo",
    "scopeTeam": "Team",
    "scopeGlobal": "Global",
    "kindLabel": "Kind",
    "kindDecision": "Decision",
    "kindConvention": "Convention",
    "kindPreference": "Preference",
    "kindFact": "Fact",
    "kindLearning": "Learning",
    "save": "Save",
    "saving": "Saving…",
    "cancel": "Cancel"
  }
  ```

### 9. Client LearnModal component

- [ ] Create `client/src/components/FindingCard/LearnModal.tsx` — mirror the structure of
  `CreateEvalCaseModal.tsx` exactly (same imports, same `createPortal` to `document.body`
  for the opacity-transparency reason). Differences from `CreateEvalCaseModal`:

  **Props:**
  ```typescript
  export function LearnModal({
    f,
    pending,
    onSubmit,
    onClose,
  }: {
    f: FindingRecord;
    pending?: boolean;
    onSubmit: (body: { content: string; scope: string; kind: string }) => void;
    onClose: () => void;
  })
  ```

  **State:**
  ```typescript
  const [content, setContent] = React.useState(f.title);  // AC-3: default = title only
  const [scope, setScope] = React.useState<'repo' | 'global' | 'team'>('repo');  // AC-3
  const [kind, setKind] = React.useState<'decision'|'convention'|'preference'|'fact'|'learning'>('learning'); // AC-3
  const canSave = content.trim().length > 0;  // AC-9 edge case: disabled while blank
  ```

  **Form fields (inside the Modal):**
  1. `FormField label={t("learnModal.contentLabel")} required` → `<Textarea value={content} onChange={setContent} rows={4} />` (use `Textarea` not `TextInput` — lesson text can be longer)
  2. `FormField label={t("learnModal.scopeLabel")}` → `<SelectInput value={scope} onChange={(v) => setScope(v as ...)} options={[{value:'repo', label:t("learnModal.scopeRepo")}, {value:'team', label:t("learnModal.scopeTeam")}, {value:'global', label:t("learnModal.scopeGlobal")}]} mono={false} />`
  3. `FormField label={t("learnModal.kindLabel")}` → `<SelectInput value={kind} onChange={(v) => setKind(v as ...)} options={[all 5 kind options]} mono={false} />`

  **Submit handler:**
  ```typescript
  onSubmit({ content: content.trim(), scope, kind })
  ```
  Note: `confidence` is NOT included in the modal's submission body — it is omitted so the
  server falls back to `body.confidence ?? finding.confidence` (the server derives it from
  the finding). This matches the "implicit" spec language (AC-3, Non-goal).

  **i18n namespace:** `const t = useTranslations("prReview");` (same namespace as `FindingCard`).

  **Imports needed:** `React`, `createPortal`, `useTranslations`, `Modal`, `FormField`,
  `Textarea`, `SelectInput`, `Button` from `@devdigest/ui`, `type FindingRecord` from
  `@devdigest/shared`.

### 10. Client FindingCard update

- [ ] `client/src/components/FindingCard/FindingCard.tsx` — four changes:

  **a) New import** — add `LearnModal` import:
  ```typescript
  import { LearnModal } from './LearnModal';
  ```

  **b) New props** — add `onLearn?` and `learnPending?` to the props destructuring and
  interface (place after `evalCasePending`):
  ```typescript
  onLearn?: (body: { content: string; scope: string; kind: string }) => void;
  learnPending?: boolean;
  ```

  **c) New state** — add `learnModalOpen` alongside `evalModalOpen`:
  ```typescript
  const [learnModalOpen, setLearnModalOpen] = React.useState(false);
  ```

  **d) Learn button** — inside the `{muted && (...)}` group (line 121), add immediately after
  the eval-case button:
  ```tsx
  {muted && (
    <>
      <Button
        kind="ghost"
        size="sm"
        icon="Brain"
        disabled={learnPending}
        onClick={() => setLearnModalOpen(true)}
        aria-label={t('finding.learn')}
      >
        {t('finding.learn')}
      </Button>
    </>
  )}
  ```
  Keep the existing eval-case button unchanged. The `{muted && ...}` wrapper for the eval-case
  button already exists at line 121; expand it to include the Learn button in the same group
  (both are gated on `muted`).

  **e) LearnModal render** — add after the `{evalModalOpen && <CreateEvalCaseModal ... />}`
  block:
  ```tsx
  {learnModalOpen && (
    <LearnModal
      f={f}
      pending={learnPending}
      onClose={() => setLearnModalOpen(false)}
      onSubmit={(body) => {
        onLearn?.(body);
        setLearnModalOpen(false);
      }}
    />
  )}
  ```

### 11. Wire Learn into FindingsPanel

- [ ] `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx`

  **a)** Add `useLearnFromFinding` to the import from the hooks path (currently imports
  `useTurnFindingIntoEvalCase` from `'../../../../../../../lib/hooks/agents-eval'`):
  ```typescript
  import { useLearnFromFinding } from '../../../../../../../lib/hooks/reviews';
  ```

  **b)** Instantiate the hook alongside `createEvalCase`:
  ```typescript
  const learnFromFinding = useLearnFromFinding();
  ```

  **c)** Pass `onLearn` and `learnPending` to each `<FindingCard>`:
  ```tsx
  learnPending={learnFromFinding.isPending}
  onLearn={(body) => learnFromFinding.mutate({ findingId: f.id, body })}
  ```

### 12. Wire Learn into TabsView

- [ ] `client/src/app/multi-runs/[multiRunId]/_components/TabsView/TabsView.tsx`

  **a)** Add `useLearnFromFinding` import from `@/lib/hooks/reviews`:
  ```typescript
  import { useLearnFromFinding } from '@/lib/hooks/reviews';
  ```

  **b)** Instantiate alongside `createEvalCase`:
  ```typescript
  const learnFromFinding = useLearnFromFinding();
  ```

  **c)** Pass `onLearn` and `learnPending` to each `<FindingCard>` in the findings loop:
  ```tsx
  learnPending={learnFromFinding.isPending}
  onLearn={(body) => learnFromFinding.mutate({ findingId: f.id, body })}
  ```

### 13. Client tests — extend FindingCard.test.tsx

- [ ] `client/src/components/FindingCard/FindingCard.test.tsx` — add a new `describe` block
  after the eval case block. The `NextIntlClientProvider` messages wrapper must include
  the `prReview` namespace (which already includes `learnModal` after Step 8).

  **New describe block: `"FindingCard — Learn button"`**

  Test cases to add:
  1. `"does not show Learn button when finding is not accepted or dismissed"` — render with
     the base `FINDING` (no timestamps) + `defaultExpanded`; assert
     `screen.queryByText("Learn")` is not in the document (AC-2).
  2. `"shows Learn button when finding is accepted"` — render with
     `{ ...FINDING, accepted_at: "2026-07-01T00:00:00.000Z" }`; assert `screen.getByText("Learn")`
     is in the document (AC-1).
  3. `"shows Learn button when finding is dismissed"` — same but with `dismissed_at` set (AC-1).
  4. `"opens LearnModal on click and calls onLearn with the body on save"`:
     - Render accepted finding with `onLearn={vi.fn()}` + `defaultExpanded`.
     - `fireEvent.click(screen.getByText("Learn"))` — modal opens.
     - Assert content field pre-filled with finding title (`"Hardcoded Stripe secret key"`).
     - `fireEvent.click(screen.getByText("Save"))` (modal footer save button).
     - Assert `onLearn` was called with
       `{ content: "Hardcoded Stripe secret key", scope: "repo", kind: "learning" }` (AC-3, AC-4).
  5. `"Learn modal Save is disabled while content is blank"` (AC-9 guard):
     - Open modal, clear the content field (set to empty string).
     - Assert the Save button is disabled.

  Note on the `renderWithIntl` helper: the `messages` object passed to
  `NextIntlClientProvider` must include the `learnModal` keys under `prReview`. Update the
  import to pick up the updated `prReview.json` (the test file already imports
  `messages/en/prReview.json` — no path change needed, just ensure the keys are present after
  Step 8).

## Gotchas

- **No DB schema changes, no migration.** `learned_at` is a Non-goal in the spec. Do NOT add
  any column to `server/src/db/schema/`. `pnpm db:generate` is not needed.
- **Do NOT touch `actOnFinding` or `FINDING_ACTIONS`** — the existing `learn` enum member in
  `FindingActionKind` stays unchanged; the generic finding-action loop stays as-is. The new
  route is fully separate.
- **`vendor/shared/` manual mirror** — tsc is the only enforcement. Both files must be updated
  together. A mismatch causes a type error only in the package that lags.
- **`BookOpen` icon is not in the `IconName` union** — use `Brain`. Any other icon from the
  union is acceptable; `BookOpen` causes `TS2345`.
- **`MemoryService` is not yet imported in `reviews/service.ts`** — add the import in Step 3.
  The path is `'../memory/service.js'` (`.js` extension required for ESM resolution).
- **Integration test uses the `review-eval-case.it.test.ts` fixture pattern** — reuse
  `REVIEW_FIXTURE`, `DIFF`, and `setupRepoAndPr` helpers. The curate-gate test (AC-10) must
  submit content with an injection opener and verify it is stripped in the response body (check
  `curateContent` in `server/src/modules/memory/helpers.ts` for what it strips, to write a
  reliable assertion).
- **i18n namespace consistency** — `FindingCard` uses `useTranslations("prReview")`; the new
  `LearnModal` must also use `"prReview"`, not a new namespace. The test wrapper already
  provides `prReview` messages via the import; `learnModal` sub-keys will be available after
  Step 8.
- **`confidence` not sent from client** — the modal omits `confidence` from the submission body.
  The server service uses `body.confidence ?? finding.confidence`. The `LearnFromFindingBody`
  contract has `confidence` as optional — this is correct and intentional.
- **`Textarea` import** — `Textarea` is already used in `FindingCard.tsx` (reply composer) and
  is importable from `@devdigest/ui`. `TextInput` is the wrong primitive for multi-line content.

## AC → task mapping

| AC | Task(s) |
|---|---|
| AC-1 (Learn button on muted findings) | Task 10d |
| AC-2 (Learn button hidden when not muted) | Task 10d (inside `{muted && ...}` guard) |
| AC-3 (Modal pre-filled: title, kind=learning, scope=repo, no confidence control) | Task 9 |
| AC-4 (Submit content/scope/kind/confidence to learn endpoint) | Tasks 9, 7, 6 |
| AC-5 (Endpoint creates exactly one memory record, returns 201) | Tasks 3, 4 |
| AC-6 (sources: PR number + finding title/file/line context) | Task 3 |
| AC-7 (scope=repo → repoId; global/team → no repoId) | Task 3 |
| AC-8 (404 for missing or foreign-workspace finding) | Tasks 3, 5 |
| AC-9 (422 for empty content or invalid scope/kind) | Tasks 1-2 (Zod schema), 5 (test), 9 (canSave guard) |
| AC-10 (curate gate via MemoryService.create) | Task 3 (no direct insert), 5 (test) |
| AC-11 (Memory view refreshes on success) | Task 7 (invalidate `["memory"]`) |
| AC-12 (repeated learn allowed) | Task 3 (no dedup check), 5 (test) |
| AC-13 (Learn functional in both consumers) | Tasks 11, 12 |

## Definition of done

- [ ] `pnpm test` passes in `server/` (all unit + integration tests, including
  `review-learn.it.test.ts` when Docker is available; integration tests self-skip otherwise).
- [ ] `pnpm test` passes in `client/` (including new Learn button tests in `FindingCard.test.tsx`).
- [ ] `pnpm tsc --noEmit` reports no errors in `server/`.
- [ ] `pnpm tsc --noEmit` reports no errors in `client/`.
- [ ] AC-1: Learn button visible only on accepted/dismissed finding cards.
- [ ] AC-3: Modal opens with content=finding.title, scope=repo, kind=learning; no confidence field.
- [ ] AC-5: `POST /findings/:id/learn` with valid body returns 201 + MemoryRecord.
- [ ] AC-6: Returned record's `sources[0]` has `pr` matching the finding's PR number and
  `context` containing the finding title, file, and start line.
- [ ] AC-8: Foreign-workspace or nonexistent finding → 404.
- [ ] AC-9: Empty content → 422; invalid scope/kind → 422.
- [ ] AC-10: Content with injection openers is stored sanitized (curate gate ran).
- [ ] AC-11: Saving via Learn causes the Memory tab list to update without manual reload.
- [ ] AC-13: Learn button functional from both the PR findings panel and multi-runs comparison view.
