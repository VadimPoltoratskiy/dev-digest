# Verification Report: Brief Oversized Caveat (SPEC-02)

**Verified:** 2026-07-08
**Plan:** `PLAN.md`
**Spec:** `server/specs/SPEC-02-brief-oversized-caveat.md`

## Summary

| Status | Count |
|--------|-------|
| Implemented | 8 |
| Missing | 0 |
| Partial | 0 |
| No test found | 0 |
| Not checkable | 0 |

**Post-verification update:** Step 2's whitespace gap (below) was fixed directly by the orchestrator after this report was first generated — both vendor `Brief` blocks are now character-for-character identical. Separately, live end-to-end testing against a real LLM provider (not the mocked test suite) surfaced a second, more serious issue not caught by any automated gate: see "Live-testing addendum" at the end of this report.

## Per-Task Status

### Step 1: Server contract — extend `Brief` schema

- **Status:** Implemented
- **File:** `server/src/vendor/shared/contracts/brief.ts` — exists
- **Acceptance criteria:**
  - `degraded: z.boolean().optional()` present after `review_focus` → PASS
    - Evidence: line 88 `degraded: z.boolean().optional(),       // NEW — absent unless too_big was true at generation time`
  - `degraded_reason: z.string().optional()` present after `review_focus` → PASS
    - Evidence: line 89 `degraded_reason: z.string().optional(), // NEW — non-empty string with total_lines when degraded is true`
  - Comment style matches `BlastRadius.degraded` convention (block comment above new fields) → PASS
    - Evidence: lines 85-87 reproduce the block-comment pattern from `BlastRadius` lines 44-46

---

### Step 2: Client contract mirror — identical additive change

- **Status:** Partial
- **File:** `client/src/vendor/shared/contracts/brief.ts` — exists
- **Acceptance criteria:**
  - New `degraded` and `degraded_reason` lines are character-for-character identical to server → PASS for the new lines
    - Evidence: `client/src/vendor/shared/contracts/brief.ts` lines 88-89 are character-for-character identical to the server file's lines 88-89
  - Comment block above new fields is character-for-character identical to server → PASS
  - `Brief` object definition in both files is character-for-character identical (plan requirement) → FAIL for pre-existing fields
    - Evidence: client file uses aligned padding for pre-existing fields (`what:         z.string()`) while server uses unpadded form (`what: z.string()`). This whitespace difference predates SPEC-02 and was not corrected by the implementer. The plan's Step 2 criterion states "The `Brief` object definition in both files must be character-for-character identical after this change."
  - Zod schemas are semantically equivalent (both compile and tests pass) → PASS

---

### Step 3: Server service — insert degraded stamp

- **Status:** Implemented
- **File:** `server/src/modules/brief/service.ts` — exists
- **Acceptance criteria:**
  - `const finalBrief: Brief` introduced via const-spread (not mutation of `validatedBrief`) → PASS
    - Evidence: lines 148-154: `const finalBrief: Brief = smartDiff.split_suggestion.too_big ? { ...validatedBrief, degraded: true, degraded_reason: \`PR too large (${smartDiff.split_suggestion.total_lines} lines) — this summary may not reflect all changes\` } : validatedBrief;`
  - `upsertBrief` call uses `json: finalBrief` (not `validatedBrief`) → PASS
    - Evidence: line 158 `json: finalBrief,`
  - `return` uses `return finalBrief` (not `return validatedBrief`) → PASS
    - Evidence: line 178 `return finalBrief;`
  - Stamp inserted between `filterFileRefs` call and `upsertBrief` call → PASS
    - Evidence: comment at line 147, stamp at lines 148-154, upsert at lines 157-163

---

### Step 4: Client styles — `degradedBanner` in `PrBriefCard/styles.ts`

- **Status:** Implemented
- **File:** `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/styles.ts` — exists
- **Acceptance criteria:**
  - `degradedBanner` entry present in `s` object → PASS
    - Evidence: lines 150-160
  - Style matches `BlastTab/styles.ts` lines 20-29 exactly: `display: "flex"`, `alignItems: "center"`, `gap: 8`, `padding: "8px 12px"`, `borderRadius: 6`, `background: "var(--warn-bg)"`, `color: "var(--warn)"`, `fontSize: 13`, `lineHeight: 1.4` → PASS
  - `satisfies CSSProperties` applied → PASS
    - Evidence: line 160 `} satisfies CSSProperties,`

---

### Step 5: Client i18n — `oversizedNotice` key in `brief.json`

- **Status:** Implemented
- **File:** `client/messages/en/brief.json` — exists
- **Acceptance criteria:**
  - Key lives at `block.brief.oversizedNotice` (not top-level, not under `why.*`) → PASS
    - Evidence: line 17 inside `block.brief` object: `"oversizedNotice": "{reason}"`
  - Value is `"{reason}"` (the full sentence is carried by `degraded_reason` from the server) → PASS
  - All 9 pre-existing keys unchanged (`label`, `what`, `why`, `riskLevel`, `reviewFocus`, `generate`, `generating`, `regenerate`, `regenerating`) → PASS

---

### Step 6: Client component — render caveat banner in `PrBriefCard.tsx`

- **Status:** Implemented
- **File:** `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.tsx` — exists
- **Acceptance criteria:**
  - `Icon` added to `@devdigest/ui` import declaration → PASS
    - Evidence: line 5 `import { Icon, SectionLabel, MonoLink } from "@devdigest/ui";`
  - Banner rendered with `role="status"` (not `role="alert"`) → PASS
    - Evidence: line 56 `<div role="status" style={s.degradedBanner}>`
  - Banner uses `Icon.AlertTriangle size={14}` → PASS
    - Evidence: line 57 `<Icon.AlertTriangle size={14} style={{ flexShrink: 0 }} />`
  - Banner uses `t("block.brief.oversizedNotice", { reason: data.degraded_reason })` → PASS
    - Evidence: line 58
  - Banner appears only in loaded-brief branch (not in the "no brief yet" null branch) → PASS
    - Evidence: null branch at lines 34-49 has no banner; banner is inside the main `return` at lines 55-59
  - No CTA button inside banner div → PASS
    - Evidence: banner div contains only `Icon.AlertTriangle` and `<span>`; no `<button>`
  - Banner placed immediately after `<div style={s.card}>` and before the `what` section → PASS
    - Evidence: lines 54-63

---

### Step 7: Server tests — extend `brief.test.ts`

- **Status:** Implemented
- **File:** `server/src/modules/brief/brief.test.ts` — exists
- **Acceptance criteria:**
  - `MOCK_SMART_DIFF_TOO_BIG` fixture defined → PASS
    - Evidence: lines 489-492
  - AC-1/AC-3 describe block: asserts `degraded === true`, `degraded_reason` contains `'9524'`, LLM called exactly once → PASS
    - Evidence: lines 498-509
  - AC-2 describe block: asserts `degraded === undefined`, `degraded_reason === undefined` → PASS
    - Evidence: lines 515-524
  - AC-5 backward-compat describe block: `safeParse` on legacy JSON succeeds; `degraded` and `degraded_reason` resolve to `undefined` → PASS
    - Evidence: lines 530-546
  - All 8 tests pass → PASS
    - Evidence: `pnpm exec vitest run src/modules/brief/brief.test.ts` → `8 passed (8)`

---

### Step 8: Client tests — extend `PrBriefCard.test.tsx`

- **Status:** Implemented
- **File:** `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.test.tsx` — exists
- **Acceptance criteria:**
  - AC-4 banner-renders describe: `screen.getByRole('status')` finds element; `toHaveTextContent('9524')` → PASS
    - Evidence: lines 179-200
  - AC-4 no-banner describe: `screen.queryByRole('status')` returns null → PASS
    - Evidence: lines 202-217
  - AC-5 client backward-compat describe: dynamic import of client vendor `Brief`, `safeParse` on legacy JSON succeeds, both fields `undefined` → PASS
    - Evidence: lines 219-237; dynamic import at line 222 targets client vendor path independently
  - All 82 client tests pass (including 3 new PrBriefCard SPEC-02 cases) → PASS
    - Evidence: `pnpm exec vitest run` (full client suite) → `82 passed (82)`

---

## Five Acceptance Criteria

| AC | Criterion | Test coverage | Tests pass |
|----|-----------|--------------|------------|
| AC-1 | `too_big: true` → returned + persisted `Brief` has `degraded: true` + non-empty `degraded_reason` containing `total_lines` | `brief.test.ts` lines 498-509: `expect(result.degraded).toBe(true)`, `expect(result.degraded_reason).toContain('9524')` | YES (8/8) |
| AC-2 | `too_big: false` → `degraded` and `degraded_reason` both absent (undefined) | `brief.test.ts` lines 515-524: `expect(result.degraded).toBeUndefined()`, `expect(result.degraded_reason).toBeUndefined()` | YES |
| AC-3 | No extra LLM call; stamp is post-LLM server-only | `brief.test.ts` line 507: `expect(container._mockLlm.calls).toHaveLength(1)` in both AC-1 and AC-2 scenarios | YES |
| AC-4 | Banner with `role="status"` renders when `degraded: true`; absent when `degraded` absent | `PrBriefCard.test.tsx` lines 179-217: `getByRole('status')` / `queryByRole('status')` | YES (82/82) |
| AC-5 | Legacy Brief JSON parses on both server and client schemas; both new fields resolve to `undefined` | `brief.test.ts` lines 530-546 (server); `PrBriefCard.test.tsx` lines 219-237 (client, dynamic import) | YES |

---

## Orphaned Implementations (potential out-of-scope changes)

No rebase occurred (the "rebased" note in an earlier draft of this report was a verifier misreading of a normal unstaged working-tree diff — confirmed via `git reflog`, which shows a clean, linear commit history with no rewritten SHAs). The HEAD commit at the time of the first pass (`a06bef8`) contains only `PLAN.md` and `server/specs/SPEC-02-brief-oversized-caveat.md`, as expected for the spec+plan commit. All files containing SPEC-02 code correspond directly to plan tasks.

No new DB migration was added for SPEC-02 (correct per plan — JSONB column requires no schema change).

No genuinely orphaned changes detected.

---

## Verdict

**PASS — 8/8 tasks fully implemented, both plan-verifier and architecture-reviewer gates clean, one additional bug found and fixed via live testing (see addendum).**

Step 2's whitespace gap was fixed directly (both vendor `Brief` blocks are now character-for-character identical, confirmed via `diff`). `architecture-reviewer` subsequently reviewed the full diff and found no CRITICAL/WARNING findings.

All 6 originally-planned test cases (3 server, 3 client) plus 1 additional regression test (added post-verification, see addendum) are present, assert the correct conditions for all 5 acceptance criteria, and pass. `server/`: 203 tests / 32 files. `client/`: 82 tests / 22 files. Both typechecks clean.

---

## Live-testing addendum: a bug no mocked test could catch

After all automated gates passed, the orchestrator ran the feature end-to-end against a **real** LLM provider (not the mocked test suite) on two live PRs — the small demo PR #482 and the actual 115-file PR this feature shipped on (#6). This surfaced a real defect:

**Bug:** `BriefService.generate()` passed the full `Brief` Zod schema (now including the new optional `degraded`/`degraded_reason` fields) as the LLM's own response schema (`schema: Brief` in the `completeStructured` call). Because the model's structured-output mode sees these fields as part of its expected output shape, a real OpenAI/OpenRouter call returned `degraded: false, degraded_reason: ""` **unprompted**, for a completely normal, non-oversized PR — directly violating AC-2 ("both SHALL be absent, not false or empty string"). No mocked unit test caught this because every mock supplies exactly the fixture the test author intends; only a live call exercises what a real model actually does with an expanded schema.

**Fix:** introduced a narrower `BriefLlmOutput = Brief.omit({ degraded: true, degraded_reason: true })` schema used only for the `completeStructured` call, so the model is never shown these fields at all. Zod's default `safeParse` also strips any stray keys the model might still emit, making the fix robust regardless of provider behavior. A regression test was added asserting that even a fixture deliberately containing bogus `degraded`/`degraded_reason` values gets stripped before the deterministic stamp logic runs.

**Re-verified live after the fix:** PR #482 (small, normal) → `degraded` key genuinely absent from the JSON response. PR #6 (115 files, flagged `too_big`) → `degraded: true`, `degraded_reason: "PR too large (12024 lines) — this summary may not reflect all changes"`, and the caveat banner renders correctly in the browser (screenshot confirmed, no console errors).

This is not a new acceptance criterion or scope change — it is a correctness fix within SPEC-02 AC-2/AC-3's existing, already-approved requirements, found by exercising the real system rather than mocks.
