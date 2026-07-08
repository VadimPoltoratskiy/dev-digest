# Plan: Brief Oversized Caveat (SPEC-02)

## Spec reference
`server/specs/SPEC-02-brief-oversized-caveat.md` (approved; follow-up to the already-shipped `server/specs/SPEC-01-why-risk-brief.md`).

## Execution mode: single-agent
Single-agent mode is adopted, in agreement with the orchestrator's recommendation. The 8 files form a tight sequential dependency: schema changes must land first so TypeScript is satisfied when the service stamps the new fields and the component renders them; both test files depend on the final shape of both the service and the component. The coordination overhead of parallel agents would exceed the benefit for a scope this small.

## Goal
When a PR's `SmartDiff.split_suggestion.too_big` flag is true at brief-generation time, stamp the persisted and returned `Brief` with `degraded: true` and a human-readable `degraded_reason` that includes the `total_lines` count — so `PrBriefCard` can render a visible caveat banner telling reviewers the summary may be incomplete. When `too_big` is false or absent, both fields stay absent from the `Brief` entirely.

## Modules affected
- `server/` — `vendor/shared/contracts/brief.ts` (additive schema extension) and `modules/brief/service.ts` (degraded stamp in the Application layer)
- `client/` — `vendor/shared/contracts/brief.ts` (mirror schema extension), `_components/PrBriefCard/styles.ts` (new `degradedBanner` style), `messages/en/brief.json` (new `block.brief.oversizedNotice` i18n key), `_components/PrBriefCard/PrBriefCard.tsx` (banner render + `Icon` import)

## Engineering Insights applied
- **`.optional()` not `.nullable()` for fields absent on some producers** (server/INSIGHTS.md, 2026-06-25 Decision: "`.nullish()` for fields only the API layer computes; `.nullable()` only when all producers always supply the field"). Both new fields use `.optional()`, matching the `BlastRadius.degraded` convention in the same contract file (lines 44–48). Using `.nullable()` here would force every non-oversized brief to carry explicit `null` values, breaking backward compatibility with cached rows that have neither field.
- **Both vendor/shared copies must change together** (client/INSIGHTS.md, 2026-06-25 Codebase Patterns: "client/src/vendor/shared/ is a manual mirror of server/src/vendor/shared/ — always update both when changing a Zod contract; no tooling enforces the sync"). Steps 1 and 2 are ordered immediately adjacent for this reason.
- **MockLLMProvider validates fixture against the real Zod schema** (server/INSIGHTS.md, 2026-07-06 Recurring Error). `MOCK_BRIEF` in `brief.test.ts` is created via `Brief.parse({...})`. After the schema extension, the fixture still passes because both new fields are optional. The existing tests require no fixture updates; the AC-5 backward-compat test explicitly verifies this.
- **Test fixtures must include all required fields** (client/INSIGHTS.md, 2026-07-06 Recurring Error: TS2741 when a Zod contract gains a new field). Both new fields are `.optional()` so `z.infer` makes them optional in the TypeScript type — no existing fixture update is required.

## Recommendations
- The `degraded_reason` string is produced in exactly one place (the service). Externalising it into a `constants.ts` file would be over-engineering for a single-site string. Leave it inline in `service.ts`.

## Architecture decisions
- **Stamp in `service.ts` (Application layer), not `routes.ts`** — per onion-architecture layer rules: business logic deriving a flag from domain data (SmartDiff result) belongs in the service. The route handler has no access to `smartDiff`; the service already holds it at the point the stamp is needed.
- **Stamp is a const-spread, not a mutation** — `filterFileRefs` returns `const validatedBrief`. The stamp produces a new `Brief` value via object spread so both `upsertBrief` and the `return` use the stamped object. This keeps the generation flow immutable and easy to trace.
- **No new DB migration** — the `pr_brief.json` JSONB column stores the complete `Brief` object. Optional fields write through on upsert and parse back on cache reads without any schema change. JSONB does not require a migration to accommodate new JSON keys.
- **No new routes, no new repository methods** — the stamp is purely a post-LLM, pre-persist transformation in the existing `BriefService.generate()` method.
- **Client banner uses `next-intl`, not a hardcoded string** — `BlastTab` hardcodes its banner text; `PrBriefCard` must use the `block.brief.oversizedNotice` i18n key with a `{reason}` placeholder interpolated at render time. This is consistent with every other string in `PrBriefCard`.
- **`Icon` import added to `PrBriefCard.tsx`** — the component currently imports `SectionLabel, MonoLink` from `@devdigest/ui` but not `Icon`. The banner requires `Icon.AlertTriangle` (same icon used in `BlastTab`), so the import declaration must be extended.
- **Banner placement: top of card body** — insert the banner immediately after the opening `<div style={s.card}>` and before the `what` section, so it is the first content a reviewer reads when the card is expanded.
- **`role="status"` on the banner `<div>`** — required by the spec's Accessibility non-functional (SPEC-02 §Non-functional). `role="status"` is polite and fires on render; `role="alert"` would be assertive and interrupt screen readers. Use `role="status"`.

## Tasks

All tasks are sequential and intended for one implementer.

### Step 1 — Server contract: extend `Brief` schema (additive, backward-compatible)

- [ ] `server/src/vendor/shared/contracts/brief.ts` — inside the `Brief` `z.object({...})` block, after `review_focus: z.array(z.string())`, add the two new optional fields:
  ```typescript
  degraded: z.boolean().optional(),       // NEW — absent unless too_big was true at generation time
  degraded_reason: z.string().optional(), // NEW — non-empty string with total_lines when degraded is true
  ```
  Position them immediately after `review_focus`, with comments matching the `BlastRadius.degraded` comment style already present at lines 44–48 of the same file. No other exports in this file change.

### Step 2 — Client contract mirror: identical additive change

- [ ] `client/src/vendor/shared/contracts/brief.ts` — apply the exact same two-field addition to the `Brief` schema (same position, same comments) as Step 1. The `Brief` object definition in both files must be character-for-character identical after this change.

### Step 3 — Server service: insert degraded stamp

- [ ] `server/src/modules/brief/service.ts` — in `BriefService.generate()`, between the `filterFileRefs` call (~line 145, produces `validatedBrief`) and the `upsertBrief` call (~line 148), insert:
  ```typescript
  // Stamp with degraded signal if the PR was too large to fully summarise (SPEC-02 AC-1/AC-2)
  const finalBrief: Brief = smartDiff.split_suggestion.too_big
    ? {
        ...validatedBrief,
        degraded: true,
        degraded_reason: `PR too large (${smartDiff.split_suggestion.total_lines} lines) — this summary may not reflect all changes`,
      }
    : validatedBrief;
  ```
  Replace every subsequent reference to `validatedBrief` with `finalBrief`:
  - The `json:` field in the `upsertBrief` call must become `json: finalBrief`
  - The final `return validatedBrief` must become `return finalBrief`

  The exact wording of `degraded_reason` is the implementer's call; it must include the `total_lines` integer and must be a non-empty string.

### Step 4 — Client styles: add `degradedBanner` to `PrBriefCard/styles.ts`

- [ ] `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/styles.ts` — add a `degradedBanner` entry to the `s` object, reproducing the style from `BlastTab/styles.ts` lines 20–29 exactly:
  ```typescript
  degradedBanner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderRadius: 6,
    background: "var(--warn-bg)",
    color: "var(--warn)",
    fontSize: 13,
    lineHeight: 1.4,
  } satisfies CSSProperties,
  ```

### Step 5 — Client i18n: add `oversizedNotice` key

- [ ] `client/messages/en/brief.json` — inside the existing `block.brief` object, add one new key:
  ```json
  "oversizedNotice": "{reason}"
  ```
  The full human-readable sentence is carried entirely in `degraded_reason` (server-composed); `{reason}` is the `next-intl` interpolation placeholder that the component fills. The key must live at `block.brief.oversizedNotice`, not at the top level of `brief.json`, and not under `why.*` (reserved for git-blame). All existing keys (`label`, `what`, `why`, `riskLevel`, `reviewFocus`, `generate`, `generating`, `regenerate`, `regenerating`) are unchanged.

### Step 6 — Client component: render caveat banner in `PrBriefCard`

- [ ] `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.tsx` — two changes:
  1. **Extend the `@devdigest/ui` import** to also include `Icon`:
     ```typescript
     import { Icon, SectionLabel, MonoLink } from "@devdigest/ui";
     ```
  2. **Insert the banner** at the top of the loaded-brief card body — immediately after `<div style={s.card}>` and before the `what` section:
     ```tsx
     {data.degraded && (
       <div role="status" style={s.degradedBanner}>
         <Icon.AlertTriangle size={14} style={{ flexShrink: 0 }} />
         <span>{t("block.brief.oversizedNotice", { reason: data.degraded_reason })}</span>
       </div>
     )}
     ```
     The banner must not appear in the "no brief yet" branch (where only the generate button is shown).

### Step 7 — Server tests: extend `brief.test.ts`

- [ ] `server/src/modules/brief/brief.test.ts` — add the following near the end of the file, after the existing `AC-9` test block. First add a fixture constant near the existing `MOCK_SMART_DIFF`:
  ```typescript
  const MOCK_SMART_DIFF_TOO_BIG: SmartDiff = {
    ...MOCK_SMART_DIFF,
    split_suggestion: { too_big: true, total_lines: 9524, proposed_splits: [] },
  };
  ```
  Then add three new `describe` blocks:

  **AC-1 / AC-3 — `too_big: true` stamps the Brief:**
  ```
  describe('BriefService.generate: too_big=true stamps degraded (AC-1, AC-3)', () => {
    it('returns Brief with degraded=true and degraded_reason containing total_lines; LLM called once', async () => {
      (SmartDiffService.prototype.buildForPull as Mock).mockResolvedValue(MOCK_SMART_DIFF_TOO_BIG);
      const container = buildMockContainer();
      const service = new BriefService(container as never);
      const result = await service.generate(MOCK_WORKSPACE_ID, MOCK_PR_ID, { force: true });
      expect(result.degraded).toBe(true);
      expect(result.degraded_reason).toContain('9524');
      // AC-3: stamp is server-side only — exactly one LLM call, no additional call for the stamp
      expect(container._mockLlm.calls).toHaveLength(1);
    });
  });
  ```

  **AC-2 — `too_big: false` leaves fields absent:**
  ```
  describe('BriefService.generate: too_big=false leaves degraded absent (AC-2)', () => {
    it('returns Brief without degraded or degraded_reason when too_big is false', async () => {
      // MOCK_SMART_DIFF has too_big: false — the default beforeEach fixture.
      const container = buildMockContainer();
      const service = new BriefService(container as never);
      const result = await service.generate(MOCK_WORKSPACE_ID, MOCK_PR_ID, { force: true });
      expect(result.degraded).toBeUndefined();
      expect(result.degraded_reason).toBeUndefined();
    });
  });
  ```

  **AC-5 — schema backward-compatibility (server side):**
  ```
  describe('Brief schema backward compatibility (AC-5)', () => {
    it('parses a pre-existing Brief-shaped JSON (no degraded fields) without error', () => {
      const legacyJson = {
        what: 'legacy what',
        why: 'legacy why',
        risk_level: 'low',
        risks: [],
        review_focus: [],
      };
      const result = Brief.safeParse(legacyJson);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.degraded).toBeUndefined();
        expect(result.data.degraded_reason).toBeUndefined();
      }
    });
  });
  ```

### Step 8 — Client tests: extend `PrBriefCard.test.tsx`

- [ ] `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.test.tsx` — add three new `describe` blocks after the existing ones:

  **AC-4 — banner renders when `degraded: true`:**
  ```
  describe('PrBriefCard — degraded banner renders when degraded is true (AC-4)', () => {
    it('renders a role="status" banner containing degraded_reason text when data.degraded is true', () => {
      vi.mocked(usePrBrief).mockReturnValue({
        data: {
          ...BRIEF_FIXTURE,
          degraded: true,
          degraded_reason: 'PR too large (9524 lines) — this summary may not reflect all changes',
        },
        isLoading: false,
      } as ReturnType<typeof usePrBrief>);
      vi.mocked(useGenerateBrief).mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      } as unknown as ReturnType<typeof useGenerateBrief>);

      renderCard();

      const banner = screen.getByRole('status');
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent('9524');
    });
  });
  ```

  **AC-4 — no banner when `degraded` is absent:**
  ```
  describe('PrBriefCard — no banner when degraded is absent (AC-4)', () => {
    it('does not render a role="status" element when data.degraded is absent', () => {
      vi.mocked(usePrBrief).mockReturnValue({
        data: BRIEF_FIXTURE,  // no degraded field
        isLoading: false,
      } as ReturnType<typeof usePrBrief>);
      vi.mocked(useGenerateBrief).mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      } as unknown as ReturnType<typeof useGenerateBrief>);

      renderCard();

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });
  ```

  **AC-5 — client-side schema backward-compatibility:**
  ```
  describe('Brief client schema backward compatibility (AC-5)', () => {
    it('parses a pre-existing Brief-shaped JSON (no degraded fields) without error', async () => {
      // Import from the client vendor path to test the client-side mirror independently.
      const { Brief } = await import('../../../../../../../vendor/shared/contracts/brief');
      const legacyJson = {
        what: 'legacy what',
        why: 'legacy why',
        risk_level: 'low' as const,
        risks: [],
        review_focus: [],
      };
      const result = Brief.safeParse(legacyJson);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.degraded).toBeUndefined();
        expect(result.data.degraded_reason).toBeUndefined();
      }
    });
  });
  ```

## Gotchas

- **No DB migration** — the `pr_brief.json` JSONB column accommodates new optional fields naturally. Do NOT run `pnpm db:generate`.
- **Both vendor/shared copies must change together** (Steps 1 and 2). Updating only the server copy will compile correctly inside `server/` but cause a type mismatch in `client/` that `pnpm typecheck` will catch. Always run typecheck in both packages before declaring done.
- **`finalBrief` must replace `validatedBrief` in both the `upsertBrief` call AND the return statement.** Omitting either replacement means the unstamped object is persisted or returned, failing AC-1.
- **`Icon` is not currently imported in `PrBriefCard.tsx`.** Forgetting to add it produces a runtime ReferenceError that TypeScript may not catch (depending on how `@devdigest/ui` exposes the namespace). Confirm the import compiles with `pnpm typecheck` in `client/`.
- **`role="status"` not `role="alert"`** — `role="alert"` is assertive and interrupts screen readers mid-sentence. `role="status"` is polite and announces on render. The spec requires `role="status"`.
- **`block.brief.oversizedNotice` position** — must be inside the `block.brief` object, not at `brief` top-level and not under `why.*`. Wrong placement causes a `next-intl` key-not-found warning and no visible text.
- **No CTA button in the banner** — the spec's Non-functional section explicitly forbids an inline call-to-action. Do not add a button to the banner div. The card footer's existing "Regenerate" button is the only affordance.
- **`MOCK_SMART_DIFF` in `brief.test.ts` already has `too_big: false`** — the default `beforeEach` restores this. The AC-1 test must override `SmartDiffService.prototype.buildForPull` with `MOCK_SMART_DIFF_TOO_BIG` via `mockResolvedValueOnce` or a `beforeEach`-level override scoped to that `describe` block.
- **Test fixture for the client banner test uses spread** — `{ ...BRIEF_FIXTURE, degraded: true, degraded_reason: '...' }` is valid because both new fields are `.optional()` in the updated `Brief` type. TypeScript will accept this without requiring a type cast.
- **Do not touch `server/src/db/schema/`** — no migration is needed; no schema file changes.

## Definition of done

- [ ] `pnpm typecheck` reports no errors in `server/`
- [ ] `pnpm typecheck` reports no errors in `client/`
- [ ] `pnpm test` passes in `server/` (all existing tests plus 3 new brief cases)
- [ ] `pnpm test` passes in `client/` (all existing tests plus 3 new PrBriefCard cases)
- [ ] **AC-1:** generating a brief for a PR where `too_big` is `true` returns and persists a `Brief` with `degraded === true` and a non-empty `degraded_reason` string that contains the `total_lines` count
- [ ] **AC-2:** generating a brief for a PR where `too_big` is `false` returns and persists a `Brief` where both `degraded` and `degraded_reason` are `undefined` (absent — not `false` or `""`)
- [ ] **AC-3:** in both the AC-1 and AC-2 scenarios, the LLM mock is called exactly once (the degraded stamp does not trigger any additional call)
- [ ] **AC-4:** `PrBriefCard` renders a `role="status"` banner containing the `degraded_reason` text when `data.degraded` is `true`; renders no such element when `degraded` is absent or falsy
- [ ] **AC-5:** a plain JSON object with only the five pre-existing `Brief` fields (`what`, `why`, `risk_level`, `risks`, `review_focus`) parses successfully through the updated `Brief` Zod schema on both server and client sides, with `degraded` and `degraded_reason` resolving to `undefined`
