# Plan: Community Skill Import — Fix source tag, metadata, and filter pills

## Spec reference
`specs/SPEC-05-community-skill-import.md` (Status: approved, all clarifications resolved 2026-07-16)

## Execution mode: single-agent
The user chose single-agent, sequential mode. All tasks are ordered so each step's
output (helpers, hooks) is available before the code that consumes it is written.

---

## Goal
The Community tab in the Skills import drawer has three bugs: (1) community catalog
imports are persisted with `source = 'imported_url'` instead of `source = 'community'`;
(2) the catalog entry's `description` and tag-derived `type` are discarded, leaving
skills with placeholder descriptions and every community import defaulting to
`type = 'custom'`; (3) the filter pills (`TypeScript / Python / Go / Rust` for language,
`security / performance / style / test` for tags) are hardcoded and do not match the
actual catalog contents, making several pills always return empty results.

---

## Modules affected
- `server/` — **zero changes.** The spec's Service Contracts section confirms no new
  endpoints are introduced. `searchCatalog` already handles `lang`/`tag` filtering and
  already includes `lang='any'` entries under a language filter (AC-8). `POST
  /skills/import/save` already enforces `enabled:false` and applies `sanitizeImportedBody`
  (AC-4/AC-5). `SkillSource` already includes `'community'` and `ImportSaveBody` already
  accepts it (AC-1). No server file is touched.
- `client/` — `lib/hooks/skills.ts` (new wrapper hook), `app/skills/_components/ImportDrawer/helpers.ts` (new pure helper), `app/skills/_components/ImportDrawer/ImportDrawer.tsx` (refactor), new test files

---

## Engineering Insights applied
- **client/INSIGHTS: vendor/shared mirrors server/vendor/shared** — no new contracts are
  added, so this sync requirement does not apply. The existing `CommunitySkillEntry`
  contract (already in both vendor copies) is sufficient for all new code.
- **client/INSIGHTS: vi.mock at module level** — `ImportDrawer.test.tsx` already mocks
  the whole `skills` hooks module. `useCommunitySkillFacets` must be added to that mock
  factory or the component will throw "not a function" in jsdom when it mounts.
- **client/INSIGHTS: test fixture contracts** — no Zod contracts are modified, so
  existing test fixtures remain valid. No TS2741 risk.
- **react-best-practices: Derive, Don't Store** — facet values (`langs`, `tags`) are
  derived synchronously from TanStack Query data inside `useCommunitySkillFacets`. No
  `useState` + `useEffect` chain is used. For 10 catalog entries this derivation is
  negligible cost — no `useMemo` required.
- **react-best-practices: Push State Down** — `selectedEntry` state for the community
  import preview lives inside `CommunityTab`, the only component that needs it.
  `ImportDrawer`'s existing `prefillName`/`prefillBody` state is removed entirely.

---

## Architecture decisions
- **No server endpoint for facets — client-side derivation from unfiltered catalog
  fetch.** The spec's Architecture diagram shows facets derived inside `CommunityTab`
  from the `GET /skills/community` (no-filter) response already fetched when the tab
  opens. The spec's Service Contracts section explicitly states no new endpoints are
  introduced. A new `useCommunitySkillFacets()` wrapper hook calls
  `useSearchCommunitySkills(undefined, {})` (unfiltered) and derives `{ langs, tags }`
  from the result. This is a separate TanStack Query key from the component's filtered
  query (which passes active `lang`/`tag` values), so the full catalog data remains
  available for facet computation regardless of what filters the user has selected.
- **`useCommunitySkillFacets()` as a thin wrapper, not inline derivation.** The wrapper
  keeps `CommunityTab` free of Set/map derivation logic and is independently testable
  via a mock. Added to `client/src/lib/hooks/skills.ts` alongside
  `useSearchCommunitySkills`, following the existing one-file-per-domain pattern.
- **`ImportPreviewPanel` source/description/type as optional props with defaults.**
  Adding `source?: 'imported_url' | 'community'` (default `'imported_url'`),
  `initialDescription?: string` (default `""`), and `initialType?: SkillType` (default
  `"custom"`) keeps the component fully backward-compatible. `FileTab` and `UrlTab` pass
  no new props and continue to work exactly as before (per Zod rule: add fields as
  optional, never remove or rename existing ones — applied here to component props by
  analogy).
- **`CommunityTab` owns its own preview state.** Instead of the existing round-trip
  through `ImportDrawer` state (prefillName/prefillBody → setTab("file")), `CommunityTab`
  adds a `selectedEntry: CommunitySkillEntry | null` state and renders `ImportPreviewPanel`
  in-place when `selectedEntry` is non-null. This isolates the community import path from
  the file tab (per react-best-practices: "Push state down — keep state in the component
  that actually needs it").
- **Token count for the community preview is a client-side estimate.** The community path
  bypasses `POST /skills/import` (the server preview endpoint) because the body is
  already available from the catalog fetch. Token count is estimated as
  `Math.ceil(entry.body.length / 4)`, matching the server's `estimateTokens()` formula.
  No extra network request is made (satisfies spec performance non-functional).
- **`tagToType()` in `ImportDrawer/helpers.ts`.** Pure function with no side effects,
  used only by `CommunityTab`. Per ui-architecture, single-component helpers live in the
  component's `helpers.ts` (colocated). Exported for unit testing in a sibling
  `helpers.test.ts`.

---

## Tasks

### Group 1 — Client: `useCommunitySkillFacets()` wrapper hook

- [ ] `client/src/lib/hooks/skills.ts` — add the following export after `useSearchCommunitySkills` (end of the community-catalog section):
  ```ts
  /**
   * Returns the distinct language and tag values present in the full community
   * catalog. Derived client-side from an unfiltered catalog fetch so that
   * active lang/tag filters on the CommunityTab do not shrink the facet set.
   * No new API endpoint is introduced (per spec Service Contracts).
   */
  export function useCommunitySkillFacets(): { langs: string[]; tags: string[] } {
    const { data } = useSearchCommunitySkills(undefined, {});
    const entries = data ?? [];
    const langs = [...new Set(entries.map((e) => e.lang).filter((l) => l !== 'any'))].sort();
    const tags = [...new Set(entries.flatMap((e) => e.tags))].sort();
    return { langs, tags };
  }
  ```
  No new import is required — `useSearchCommunitySkills` is already defined in the same
  file. TanStack Query deduplicates the unfiltered request if the component also issues
  an unfiltered query within the same cache window.

---

### Group 2 — Client: `tagToType()` pure helper

- [ ] `client/src/app/skills/_components/ImportDrawer/helpers.ts` (new file):
  ```ts
  import type { SkillType } from '@devdigest/shared';

  const SECURITY_TAGS = new Set(['security', 'owasp', 'sql', 'secrets']);
  const CONVENTION_TAGS = new Set(['frontend', 'react', 'a11y']);

  /**
   * Derives SkillType from a CommunitySkillEntry's tags array.
   * Precedence (AC-3): security → convention → custom.
   * Never returns 'rubric' — that type is reserved for manually authored skills.
   */
  export function tagToType(tags: string[]): SkillType {
    if (tags.some((t) => SECURITY_TAGS.has(t))) return 'security';
    if (tags.some((t) => CONVENTION_TAGS.has(t))) return 'convention';
    return 'custom';
  }
  ```

---

### Group 3 — Client: `ImportDrawer.tsx` refactor

All changes are in `client/src/app/skills/_components/ImportDrawer/ImportDrawer.tsx`.

**a. Add imports at the top of the file:**
- `CommunitySkillEntry` (type-only) from `@devdigest/shared`
- `useCommunitySkillFacets` from `'../../../../lib/hooks/skills'`
- `tagToType` from `'./helpers'`

**b. `ImportPreviewPanel` — add three optional props:**
```ts
function ImportPreviewPanel({
  preview,
  initialName,
  source = 'imported_url',
  initialDescription = '',
  initialType = 'custom',
  onBack,
  onImported,
  onClose,
}: {
  preview: { name: string; body_preview: string; token_count: number };
  initialName?: string;
  source?: 'imported_url' | 'community';
  initialDescription?: string;
  initialType?: SkillType;
  onBack: () => void;
  onImported?: () => void;
  onClose: () => void;
})
```

**c. `ImportPreviewPanel` — initialize state with new defaults:**
```ts
const [description, setDescription] = React.useState(initialDescription);
const [type, setType] = React.useState<SkillType>(initialType);
```

**d. `ImportPreviewPanel.handleSave` — replace hardcoded `"imported_url"` with prop:**
```ts
source,  // was: source: "imported_url"
```

**e. `ImportDrawer` — remove prefill state and the community round-trip mechanism:**
- Remove `const [prefillName, setPrefillName] = React.useState("")`
- Remove `const [prefillBody, setPrefillBody] = React.useState("")`
- Remove the `handleCommunityImport` function

**f. `ImportDrawer` — update the `FileTab` call (remove now-unused props):**
```tsx
{tab === 'file' && (
  <FileTab onClose={onClose} onImported={onImported} />
)}
```

**g. `ImportDrawer` — update the `CommunityTab` call:**
```tsx
{tab === 'community' && (
  <CommunityTab onClose={onClose} onImported={onImported} />
)}
```

**h. `FileTab` — remove `initialName`/`initialBody` props and their `useEffect` syncs:**
- Remove `initialName?: string` and `initialBody?: string` from the prop destructuring
  and prop type
- Remove the two `React.useEffect` hooks that synced those props into local state
- Initialize local state directly with empty strings:
  ```ts
  const [name, setName] = React.useState('');
  const [body, setBody] = React.useState('');
  ```

**i. `CommunityTab` — change prop signature (remove `onImportSkill`, add `onClose`/`onImported`):**
```ts
function CommunityTab({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported?: () => void;
})
```

**j. `CommunityTab` — add `selectedEntry` state and derive filter pill arrays:**
```ts
const [selectedEntry, setSelectedEntry] = React.useState<CommunitySkillEntry | null>(null);
const { langs, tags: catalogTags } = useCommunitySkillFacets();
const langFilters = ['All', ...langs];
const tagFilters = ['All', ...catalogTags];
```

**k. `CommunityTab` — render `ImportPreviewPanel` when entry is selected:**
Insert at the top of the `CommunityTab` return (before the search UI block):
```tsx
if (selectedEntry) {
  return (
    <ImportPreviewPanel
      preview={{
        name: selectedEntry.name,
        body_preview: selectedEntry.body,
        token_count: Math.ceil(selectedEntry.body.length / 4),
      }}
      source="community"
      initialDescription={selectedEntry.description}
      initialType={tagToType(selectedEntry.tags)}
      onBack={() => setSelectedEntry(null)}
      onImported={onImported}
      onClose={onClose}
    />
  );
}
```

**l. `CommunityTab` — replace hardcoded filter constants with derived arrays:**
- Delete the module-level `const LANG_FILTERS = [...]` constant (line 389 in the current
  file)
- Delete the module-level `const TAG_FILTERS = [...]` constant (line 390 in the current
  file)
- Update the filter pill render blocks to iterate `langFilters` and `tagFilters`
  respectively (same JSX structure, only the source array changes)

**m. `CommunityTab` — update Import button handler:**
```tsx
// WAS: onClick={() => onImportSkill(entry.name, entry.body)}
// NOW:
onClick={() => setSelectedEntry(entry)}
```

---

### Group 4 — Client: tests

**a. `client/src/app/skills/_components/ImportDrawer/helpers.test.ts` (new file):**

Unit tests for `tagToType()` — all ten cases from AC-3 plus edge cases:
- `tagToType(['security', 'owasp'])` → `'security'`
- `tagToType(['sql'])` → `'security'`
- `tagToType(['secrets'])` → `'security'`
- `tagToType(['frontend', 'react'])` → `'convention'`
- `tagToType(['a11y'])` → `'convention'`
- `tagToType(['cleanup', 'dx'])` → `'custom'`
- `tagToType(['safety', 'database', 'drizzle'])` → `'custom'`
- `tagToType([])` → `'custom'`
- `tagToType(['security', 'react'])` → `'security'` (security wins over convention per AC-3 precedence)
- `tagToType(['frontend', 'owasp'])` → `'security'` (same precedence, opposite tag order)

**b. `client/src/app/skills/_components/ImportDrawer/ImportDrawer.test.tsx` — extend:**

1. **Add `useCommunitySkillFacets` to the module-level `vi.mock` factory:**
   ```ts
   vi.mock("../../../../lib/hooks/skills", () => ({
     useImportSkillFetch: vi.fn(),
     useImportSkillPreview: vi.fn(),
     useImportSkillSave: vi.fn(),
     useSearchCommunitySkills: vi.fn(),
     useCommunitySkillFacets: vi.fn(),   // ADD
   }));
   ```
   Add the import alongside the other mocked-hook imports:
   ```ts
   import { ..., useCommunitySkillFacets } from "../../../../lib/hooks/skills";
   ```

2. **Extend `setupDefaultMocks()`** to configure the new mock:
   ```ts
   (useCommunitySkillFacets as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
     langs: ['TypeScript'],
     tags: ['owasp', 'react', 'cleanup'],
   });
   ```

3. **New `describe` block: `"Community tab — import path"`:**

   - **Test: `"clicking Import opens the preview panel directly (no file-tab round-trip)"`**
     - Mock `useSearchCommunitySkills` to return one entry:
       `[{ name: 'owasp-top-10-review', description: 'Maps diff changes to the OWASP Top 10 with CWE references.', tags: ['security','owasp'], lang: 'any', body: '# OWASP\n…', repo: 'secdev/agent-skills', stars: 1240 }]`
     - Render with `initialTab="community"`
     - Click the "Import" button on the entry
     - Assert: preview panel name input shows `owasp-top-10-review`
     - Assert: description input is pre-filled with
       `'Maps diff changes to the OWASP Top 10 with CWE references.'`
       (not `'owasp-top-10-review'`, which was the old placeholder behavior)
     - Assert: the file-tab body textarea (`Skill body (Markdown)` label) is NOT in the
       document (confirms there is no round-trip to the file tab)

   - **Test: `"save sends source='community'"`**
     - Same setup; click Import then click the save ("Import skill") button
     - Assert: `saveMutateAsync` was called with
       `expect.objectContaining({ source: 'community' })`

   - **Test: `"filter pills come from useCommunitySkillFacets, not the hardcoded list"`**
     - Mock `useCommunitySkillFacets` to return `{ langs: ['TypeScript'], tags: ['owasp'] }`
     - Render with `initialTab="community"`
     - Assert in document: `TypeScript` pill, `All` pills (two — one for lang, one for tags)
     - Assert NOT in document: `Python`, `Go`, `Rust` (old hardcoded lang pills)
     - Assert in document: `owasp` pill
     - Assert NOT in document: `performance`, `style`, `test` (old hardcoded tag pills)

---

### Group 5 — Verify

- [ ] `cd client && pnpm test` — all tests green (existing + new)
- [ ] `cd client && pnpm typecheck` — zero errors (confirms `CommunitySkillEntry` import,
  `tagToType` type signature, and `ImportPreviewPanel` optional props are all sound)
- [ ] Optional: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — confirms
  no server regressions (nothing was changed; this is a safety check only)

---

## Gotchas

- **Zero server changes.** No file under `server/` is modified. The only bug is
  client-side — the wrong `source` value being sent, and the catalog entry's metadata
  being discarded before saving.
- **`useCommunitySkillFacets` must appear in the `vi.mock` factory.** The entire `skills`
  hooks module is mocked at module level in `ImportDrawer.test.tsx`. Any export NOT listed
  in the factory causes "not a function" when the component mounts. Add
  `useCommunitySkillFacets: vi.fn()` before running the new tests.
- **Two independent queries in `CommunityTab`.** After the refactor, `CommunityTab` makes
  two `useSearchCommunitySkills` calls: one (via `useCommunitySkillFacets`) with no
  filters for facet derivation, and one with active `lang`/`tag` filter values for the
  result list. These use different TanStack Query keys and do not interfere. The unfiltered
  call is stable and TanStack Query will deduplicate it when the user has no filters
  active (the keys happen to match).
- **`LANG_FILTERS` and `TAG_FILTERS` are module-level constants.** They sit at lines
  389–390 of the current `ImportDrawer.tsx`, outside any component function. Delete both
  `const` declarations; they are replaced entirely by the `langFilters`/`tagFilters`
  variables derived inside `CommunityTab`.
- **`FileTab` effect removal.** The two `React.useEffect` hooks that sync `initialName`
  and `initialBody` from props are the only consumers of those props. Both effects and
  both prop declarations must be removed together. No other call site passes those values
  once `ImportDrawer`'s prefill mechanism is deleted.
- **`ImportPreviewPanel` state is mount-time only.** React's `useState(init)` uses the
  initial value only on first mount. `setSelectedEntry(null)` (onBack) unmounts the panel,
  and clicking Import on a different entry mounts a fresh instance — no stale state from
  a previous entry bleeds through.
- **`sanitizeImportedBody` runs server-side.** The community entry's `body` is sent
  verbatim as the `body` field in `POST /skills/import/save`; the server's existing
  handler calls `sanitizeImportedBody(body)` before persisting (AC-4). No client-side
  sanitization is needed.
- **Do NOT modify `server/src/db/schema/`** — the `source` column already carries
  `'community'` in its enum; no migration is needed.
- **Do NOT modify `client/src/vendor/`** — no contracts change; the existing
  `CommunitySkillEntry` in both vendor copies is sufficient.

---

## Definition of done

- [ ] `cd client && pnpm test` passes (all existing + new tests)
- [ ] `cd client && pnpm typecheck` reports zero errors
- [ ] AC-1: Community import saves `source = 'community'` — verified by `saveMutateAsync`
  called with `{ source: 'community' }` in test
- [ ] AC-2: Description pre-filled from `entry.description` (not `entry.name`) — verified
  by test asserting description input value equals the catalog description string
- [ ] AC-3: Type pre-selected via AC-3 heuristic — verified by `tagToType` unit tests
  covering all documented tag sets; `CommunityTab` passes `initialType={tagToType(entry.tags)}`
  to `ImportPreviewPanel`
- [ ] AC-4: Body passes through the server's existing `sanitizeImportedBody` step —
  confirmed by existing server behavior; no server change is needed
- [ ] AC-5: `enabled:false` server-enforced regardless of client payload — confirmed by
  existing server behavior; no server change is needed
- [ ] AC-6: "needs vetting" badge rendered by `SkillCard.tsx` when
  `!skill.enabled && skill.source !== 'manual'` — no code change required; existing
  behavior already satisfies this
- [ ] AC-7: Filter pills derived from `useCommunitySkillFacets()` (unfiltered catalog
  data); no `Python`, `Go`, `Rust`, `performance`, `style`, or `test` pills can appear
  unless the catalog adds those values — verified by filter-pill test
- [ ] AC-8 / AC-9: Language and tag filtering behavior unchanged on the server —
  `searchCatalog` already includes `lang='any'` entries under a language filter and
  already filters by tag; no client change needed for these behaviors
