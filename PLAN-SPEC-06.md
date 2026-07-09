# Plan: Review Focus Prior PRs (SPEC-06)

## Spec reference
`server/specs/SPEC-06-review-focus-prior-prs.md`

## Execution mode: single-agent
The phases carry hard sequential dependencies: the DB index migration must be applied before the backend service can be deployed or tested; the shared Zod contract must exist before the client can type-check against it; the endpoint must be live before the client component's lazy fetch is meaningful. One implementer running the phases in order is the right shape for this task. The client phase and the test phase could theoretically run in parallel (once the contract and endpoint exist), but the minor parallelism gain is not worth the coordination overhead for a scope this size.

## Goal
Introduce `GET /pulls/:id/files/prior-prs?path=<path>` — a read-only, DB-only endpoint that returns up to 10 of the most recent pull requests in the same repo (excluding the current PR) whose diff touched a given file path, along with the full pre-cap count. Surface this in the client as an expandable section on each "Where to focus" item in `PrBriefCard`, fetched lazily on first expand and served from the TanStack Query cache on re-expand.

## Modules affected
- `server/` — DB schema index addition (`prFiles.path`), new `prior-prs` module (repository + service + routes), new shared Zod contract, module registration in `modules/index.ts`
- `client/` — shared Zod contract mirror, new `fetchPriorPrs` API function in `lib/api.ts`, new `usePriorPrs` hook in `lib/hooks/pr-files.ts`, new `ReviewFocusItem` colocated sub-component, i18n additions in `messages/en/brief.json`, update to `PrBriefCard.tsx`

## Engineering Insights applied
- **server INSIGHTS (2026-06-25) — always use `.nullish()` for list-only derived fields**: `total` in `PriorPrList` is always set by the service, so `z.number().int()` (required) is correct. `opened_at` is nullable in the DB (`pullRequests.openedAt` is `timestamp` without default), so `PriorPr.opened_at` is `z.string().nullable()`. No `.nullish()` is used because both producers (the service) always supply these fields.
- **server INSIGHTS (2026-06-25) — adding a required (non-.nullish()) field to a Zod contract breaks every existing adapter/mock**: `PriorPr`/`PriorPrList` are brand-new types with no pre-existing producers — required fields are safe here with no fixture updates needed.
- **client INSIGHTS (2026-06-26) — lazy-fetch-on-open pattern**: `usePriorPrs(prId, path, enabled)` mirrors `usePrReviews(open ? prId : null)` from `FindingsCounter`. The `enabled: !!prId && !!path && enabled` guard ensures no request fires until `expanded` flips to `true` on first click (AC-6). TanStack Query caches the result under `["prior-prs", prId, path]` — no second fetch on re-expand.
- **client INSIGHTS (2026-06-25) — vendor/shared is a manual mirror**: the new `prior-prs.ts` contract file must be created in both `server/src/vendor/shared/contracts/` and `client/src/vendor/shared/contracts/`, and both `index.ts` barrels must export it. Only `tsc` enforces the sync.

## Recommendations
- **`useParams()` in `ReviewFocusItem` instead of prop threading**: `ReviewFocusItem` is a deeply colocated component permanently specific to the `repos/[repoId]/pulls/[number]` route. Using `useParams<{ repoId: string }>()` inside it gives direct access to `repoId` without adding a new prop to `PrBriefCard`, updating `OverviewTab`'s interface, and threading `repoId` through three layers. Trade-off: the component carries an implicit URL-shape coupling. Acceptable here because it will never be promoted to a shared component, and component tests mock `next/navigation` anyway.
- **Single-query window function (`COUNT(*) OVER()`) instead of a second round-trip**: Drizzle does not have a first-class window function API. Use `sql<number>\`count(*) over()\`` as a selected column. Postgres evaluates the window before `LIMIT`, so the returned value is the full pre-cap count. Read it from `rows[0]?.total ?? 0`. One DB round-trip per request; no subquery.

## Architecture decisions
- **New `prior-prs/` module, not folded into `pulls/`**: The codebase precedent (`blast`, `why`, `brief`) is small, single-purpose modules with their own `routes.ts` + `service.ts` + `repository.ts`. The `pulls` module handles PR CRUD; a file-history lookup has no business there. Per onion-architecture SKILL: "new domain feature → new module: `modules/<domain>/`."
- **New shared contract file `prior-prs.ts`**: Existing contract files are domain-grouped (`brief.ts`, `why.ts`). Adding `PriorPr`/`PriorPrList` to `brief.ts` would mix brief-generation concerns with file-history lookup. The project convention is "feature agents EXTEND with new files" — a standalone `prior-prs.ts` follows that.
- **`loadPull` guard — copied, not abstracted**: Three existing services (`blast/service.ts:67-74`, `why/service.ts:118-125`, `brief/service.ts:215-226`) already duplicate this pattern; the last one's comment explicitly says "Mirrors BlastService.loadPull() exactly." This is documented tolerated duplication. The new service copies the same pattern without introducing a cross-module helper.
- **Route URL: `GET /pulls/:id/files/prior-prs`**: `app.ts:169` registers modules with no prefix (`app.register(plugin)`). The route handler declares the full path. This URL is distinct from `/pulls/:id/blast` and does not conflict with any existing route.
- **i18n restructure for `reviewFocus`**: `block.brief.reviewFocus` is currently a plain string (`"Where to focus"`). Turning it into an object with a `.label` key (plus the new interaction keys) requires updating one call in `PrBriefCard.tsx` from `t("block.brief.reviewFocus")` to `t("block.brief.reviewFocus.label")`. This is a safe in-file change since `PrBriefCard.tsx` is edited as part of this task.

## Tasks

All tasks are sequential and intended for a single implementer.

---

### Phase 1 — DB Schema: add index on `prFiles.path`

- [ ] **`server/src/db/schema/pulls.ts`** — the `prFiles` table is declared via `pgTable('pr_files', { ... })` with no second argument (confirmed: no indexes exist today). Add a second argument providing the index:
  ```typescript
  export const prFiles = pgTable(
    'pr_files',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      prId: uuid('pr_id').notNull().references(() => pullRequests.id, { onDelete: 'cascade' }),
      path: text('path').notNull(),
      additions: integer('additions').notNull().default(0),
      deletions: integer('deletions').notNull().default(0),
      patch: text('patch'),
    },
    (t) => ({
      pathIdx: index('pr_files_path_idx').on(t.path),
    }),
  );
  ```
  Do not hand-edit any SQL file. Do not touch any other table definition.

- [ ] **Run `cd server && pnpm db:generate`** — Drizzle Kit will create a new numbered migration file in `server/src/db/migrations/`. Commit the schema change and the generated migration file together.

- [ ] **Run `cd server && pnpm db:migrate`** — applies the migration to the local Postgres instance. This step is a hard prerequisite for all subsequent server work. The migration is idempotent; re-running it on a DB that already has the index is a no-op.

---

### Phase 2 — Shared Zod Contract: `PriorPr` / `PriorPrList`

- [ ] **Create `server/src/vendor/shared/contracts/prior-prs.ts`** — new file, define and export the two contracts:
  ```typescript
  import { z } from 'zod';

  /**
   * A single prior pull request that touched a given file path.
   * PriorPr fields map directly to pullRequests columns.
   * opened_at is nullable because pullRequests.openedAt is nullable in the DB.
   */
  export const PriorPr = z.object({
    number:    z.number().int(),
    title:     z.string(),
    author:    z.string(),
    status:    z.string(),
    opened_at: z.string().nullable(),
  });
  export type PriorPr = z.infer<typeof PriorPr>;

  /**
   * Response shape for GET /pulls/:id/files/prior-prs.
   * items: newest-first, at most 10.
   * total: full count before the 10-item cap (COUNT(*) OVER() window — no second round-trip).
   */
  export const PriorPrList = z.object({
    items: z.array(PriorPr),
    total: z.number().int(),
  });
  export type PriorPrList = z.infer<typeof PriorPrList>;
  ```

- [ ] **Update `server/src/vendor/shared/index.ts`** — add `export * from './contracts/prior-prs.js';` following the same pattern as the existing `export * from './contracts/why.js';` line.

- [ ] **Create `client/src/vendor/shared/contracts/prior-prs.ts`** — exact copy of the server-side file above. Match any `.js` extension conventions already present in the other client contract files (e.g., the `zod` import has no extension). Keep content byte-for-byte identical to the server copy.

- [ ] **Update `client/src/vendor/shared/index.ts`** — add `export * from './contracts/prior-prs.js';` following the same pattern as the existing exports in that file.

- [ ] **Typecheck gate** — run `cd server && pnpm typecheck` and `cd client && pnpm typecheck`. Both must pass before proceeding. Fix any issues before moving to Phase 3.

---

### Phase 3 — Backend: `prior-prs` module

#### 3a — Repository

- [ ] **Create `server/src/modules/prior-prs/repository.ts`**:
  ```typescript
  import { and, eq, ne, desc, sql } from 'drizzle-orm';
  import type { Db } from '../../db/client.js';
  import * as t from '../../db/schema.js';

  export interface PriorPrRow {
    number:   number;
    title:    string;
    author:   string;
    status:   string;
    openedAt: Date | null;
    total:    number;
  }

  /**
   * Join prFiles ⋈ pullRequests, filter by path + repoId + exclude current prId,
   * order by openedAt DESC (NULLs last by Postgres default for DESC), cap at 10.
   * COUNT(*) OVER() gives the pre-cap total in the same query — no second round-trip.
   */
  export async function findPriorPrs(
    db: Db,
    repoId: string,
    prId: string,
    path: string,
  ): Promise<PriorPrRow[]> {
    return db
      .select({
        number:   t.pullRequests.number,
        title:    t.pullRequests.title,
        author:   t.pullRequests.author,
        status:   t.pullRequests.status,
        openedAt: t.pullRequests.openedAt,
        total:    sql<number>`count(*) over()`,
      })
      .from(t.prFiles)
      .innerJoin(t.pullRequests, eq(t.prFiles.prId, t.pullRequests.id))
      .where(
        and(
          eq(t.prFiles.path, path),
          eq(t.pullRequests.repoId, repoId),
          ne(t.pullRequests.id, prId),
        ),
      )
      .orderBy(desc(t.pullRequests.openedAt))
      .limit(10);
  }
  ```
  All user-supplied values flow exclusively through Drizzle's `eq()` / `ne()` helpers, which generate parameterized SQL placeholders — no raw string interpolation (security: parameterized query, per spec's Untrusted inputs section).

#### 3b — Service

- [ ] **Create `server/src/modules/prior-prs/service.ts`**:
  ```typescript
  import { and, eq } from 'drizzle-orm';
  import type { PriorPrList } from '@devdigest/shared';
  import * as t from '../../db/schema.js';
  import type { Container } from '../../platform/container.js';
  import { NotFoundError } from '../../platform/errors.js';
  import { findPriorPrs } from './repository.js';

  export class PriorPrsService {
    constructor(private container: Container) {}

    async getPriorPrs(
      workspaceId: string,
      prId: string,
      path: string,
    ): Promise<PriorPrList> {
      const pr = await this.loadPull(workspaceId, prId);
      const rows = await findPriorPrs(this.container.db, pr.repoId, prId, path);
      return {
        items: rows.map((r) => ({
          number:    r.number,
          title:     r.title,
          author:    r.author,
          status:    r.status,
          opened_at: r.openedAt ? r.openedAt.toISOString() : null,
        })),
        total: rows[0]?.total ?? 0,
      };
    }

    /**
     * Workspace-scoped PR lookup. Mirrors BlastService.loadPull() and
     * WhyService.loadPull() exactly. Throws NotFoundError (→ HTTP 404 via
     * the global error handler) when the PR does not belong to workspaceId.
     */
    private async loadPull(workspaceId: string, prId: string) {
      const [pr] = await this.container.db
        .select()
        .from(t.pullRequests)
        .where(
          and(
            eq(t.pullRequests.workspaceId, workspaceId),
            eq(t.pullRequests.id, prId),
          ),
        );
      if (!pr) throw new NotFoundError('Pull request not found');
      return pr;
    }
  }
  ```

#### 3c — Routes

- [ ] **Create `server/src/modules/prior-prs/routes.ts`** — follows `why/routes.ts` as the template:
  ```typescript
  import type { FastifyInstance } from 'fastify';
  import type { ZodTypeProvider } from 'fastify-type-provider-zod';
  import { z } from 'zod';
  import type { PriorPrList } from '@devdigest/shared';
  import { getContext } from '../_shared/context.js';
  import { IdParams } from '../_shared/schemas.js';
  import { PriorPrsService } from './service.js';

  const PriorPrsQuery = z.object({
    path: z.string().min(1),
  });

  export default async function priorPrsRoutes(appBase: FastifyInstance) {
    const app = appBase.withTypeProvider<ZodTypeProvider>();
    const { container } = app;
    const service = new PriorPrsService(container);

    app.get(
      '/pulls/:id/files/prior-prs',
      { schema: { params: IdParams, querystring: PriorPrsQuery } },
      async (req): Promise<PriorPrList> => {
        const { workspaceId } = await getContext(container, req);
        return service.getPriorPrs(workspaceId, req.params.id, req.query.path);
      },
    );
  }
  ```
  Zod `min(1)` on `path` enforces AC-5: an absent or empty `path` → 422 before the handler is reached. `NotFoundError` from `loadPull` → 404 via the global error handler in `app.ts` — no per-route try/catch needed.

#### 3d — Module registration

- [ ] **Update `server/src/modules/index.ts`** — add one import and one entry to the `modules` dictionary:
  ```typescript
  // add with other imports:
  import priorPrs from './prior-prs/routes.js';

  // add to the modules object:
  export const modules: Record<string, FastifyPluginAsync> = {
    // ... existing entries ...
    priorPrs,
  };
  ```
  No change to `app.ts` is needed — `app.ts:169` already iterates `Object.values(modules)` and registers every plugin.

- [ ] **Typecheck gate** — run `cd server && pnpm typecheck`. Fix any issues before moving to Phase 4.

---

### Phase 4 — Client

#### 4a — API function

- [ ] **Update `client/src/lib/api.ts`** — add `PriorPrList` to the existing `@devdigest/shared` import at the top of the file, then add the new exported fetch function near the other brief/why-related functions:
  ```typescript
  export function fetchPriorPrs(prId: string, path: string): Promise<PriorPrList> {
    return apiFetch<PriorPrList>(
      `/pulls/${prId}/files/prior-prs?path=${encodeURIComponent(path)}`,
    );
  }
  ```
  `encodeURIComponent` safely encodes forward slashes in paths like `src/auth/service.ts`. The server URL-decodes the value normally. Never use raw `fetch` — always `apiFetch`.

#### 4b — Hook

- [ ] **Create `client/src/lib/hooks/pr-files.ts`** — new domain hook file:
  ```typescript
  /* hooks/pr-files.ts — React Query hooks for PR file-history lookups (SPEC-06).
     Reads GET /pulls/:id/files/prior-prs?path=<path> — pure read, no mutation. */
  "use client";

  import { useQuery } from "@tanstack/react-query";
  import type { PriorPrList } from "@devdigest/shared";
  import { fetchPriorPrs } from "../api";

  /**
   * Prior PRs that touched a given file path in the same repo.
   * No request fires until enabled=true (i.e., until the ReviewFocusItem is
   * first expanded). TanStack Query caches under (prId, path) — no re-fetch
   * on subsequent expands of the same item (AC-6 lazy fetch + cache behaviour).
   */
  export function usePriorPrs(
    prId: string | null | undefined,
    path: string | null | undefined,
    enabled: boolean,
  ) {
    return useQuery<PriorPrList>({
      queryKey: ["prior-prs", prId, path],
      queryFn:  () => fetchPriorPrs(prId!, path!),
      enabled:  !!prId && !!path && enabled,
    });
  }
  ```

- [ ] **Update `client/src/lib/hooks/index.ts`** — if this file re-exports hook domain files, add `export * from './pr-files';`. If it uses named re-exports, follow the existing pattern.

#### 4c — i18n

- [ ] **Update `client/messages/en/brief.json`** — restructure `block.brief.reviewFocus` from a plain string into an object. The existing string value becomes the `.label` sub-key. Add all new interaction keys:
  ```json
  "reviewFocus": {
    "label":      "Where to focus",
    "expand":     "Show prior PRs",
    "collapse":   "Hide prior PRs",
    "loading":    "Loading prior PRs…",
    "noPriorPrs": "No prior PR history recorded for this path.",
    "priorPrs":   "Prior PRs touching this file",
    "truncation": "Showing {shown} of {total}"
  }
  ```
  `truncation` uses next-intl ICU message interpolation: `t("block.brief.reviewFocus.truncation", { shown: items.length, total })`. All other existing keys (`label`, `what`, `why`, `riskLevel`, `generate`, etc.) remain unchanged.

#### 4d — ReviewFocusItem component

- [ ] **Create directory** `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/_components/ReviewFocusItem/`

- [ ] **Create `ReviewFocusItem.tsx`** — new colocated sub-component (nested colocation: `_components/<Parent>/_components/<Name>/`, max 2 levels, per ui-architecture SKILL):

  Core behaviour:
  - Props: `prId: string`, `path: string`
  - State: `const [expanded, setExpanded] = useState(false)`
  - Uses `useParams<{ repoId: string }>()` — no prop threading needed; safe because this component is permanently colocated with the `repos/[repoId]/pulls/[number]` route
  - Uses `usePriorPrs(prId, path, expanded)` — fires on first expand only
  - Uses `useTranslations("brief")` for all text

  Rendered structure:
  ```tsx
  <li style={s.item}>
    {/* Toggle row: bullet + path text + expand/collapse indicator */}
    <button style={s.toggle} onClick={() => setExpanded(v => !v)}>
      <span style={s.bullet}>•</span>
      <span style={s.path}>{path}</span>
      <span style={s.chevron}>{expanded ? "▲" : "▼"}</span>
      <span style={s.expandLabel}>
        {expanded ? t("block.brief.reviewFocus.collapse") : t("block.brief.reviewFocus.expand")}
      </span>
    </button>

    {/* Expanded panel */}
    {expanded && (
      <div style={s.panel}>
        {isLoading && (
          <span style={s.loading}>{t("block.brief.reviewFocus.loading")}</span>
        )}
        {!isLoading && data?.items.length === 0 && (
          <span style={s.empty}>{t("block.brief.reviewFocus.noPriorPrs")}</span>
        )}
        {!isLoading && data && data.items.length > 0 && (
          <>
            <div style={s.priorPrsLabel}>{t("block.brief.reviewFocus.priorPrs")}</div>
            <ul style={s.priorList}>
              {data.items.map((item) => (
                <li key={item.number} style={s.priorItem}>
                  <a href={`/repos/${repoId}/pulls/${item.number}`} style={s.priorLink}>
                    <span style={s.priorNumber}>#{item.number}</span>
                    <span style={s.priorTitle}>{item.title}</span>
                  </a>
                  <span style={s.priorMeta}>
                    {item.author} · {item.status}
                    {item.opened_at && ` · ${new Date(item.opened_at).toLocaleDateString()}`}
                  </span>
                </li>
              ))}
            </ul>
            {data.total > data.items.length && (
              <span style={s.truncation}>
                {t("block.brief.reviewFocus.truncation", {
                  shown: data.items.length,
                  total: data.total,
                })}
              </span>
            )}
          </>
        )}
      </div>
    )}
  </li>
  ```
  Each `ReviewFocusItem` instance owns its own `expanded` state independently — no accordion, no mutual collapse (confirmed UX decision in spec).

- [ ] **Create `styles.ts`** in the same folder — `CSSProperties`-based style objects for all elements referenced above (`item`, `toggle`, `bullet`, `path`, `chevron`, `expandLabel`, `panel`, `loading`, `empty`, `priorPrsLabel`, `priorList`, `priorItem`, `priorLink`, `priorNumber`, `priorTitle`, `priorMeta`, `truncation`). Follow the `satisfies CSSProperties` convention from `PrBriefCard/styles.ts`.

- [ ] **Create `index.ts`** — barrel export:
  ```typescript
  export { ReviewFocusItem } from './ReviewFocusItem';
  ```

#### 4e — PrBriefCard update

- [ ] **Update `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.tsx`** — two changes:

  1. Add the import for `ReviewFocusItem` at the top:
     ```typescript
     import { ReviewFocusItem } from './_components/ReviewFocusItem';
     ```

  2. **Update the i18n call** on line 82 (currently `{t("block.brief.reviewFocus")}`):
     ```tsx
     <div style={s.sectionLabel}>{t("block.brief.reviewFocus.label")}</div>
     ```

  3. **Replace the inline `<li>` block** (current lines 84-89) with `ReviewFocusItem`. The outer `<ul style={s.list}>` wrapper remains; only the inner rendering changes:
     ```tsx
     {data.review_focus.map((item, i) => (
       <ReviewFocusItem key={i} prId={prId} path={item} />
     ))}
     ```
     The `<li>` element is now inside `ReviewFocusItem`, so remove the `<li style={s.listItem}>` wrapper that was previously there.

- [ ] **Typecheck gate** — run `cd client && pnpm typecheck`. Fix any issues (e.g., missing type imports, `useParams` return type).

---

### Phase 5 — Tests

#### 5a — Server integration tests

- [ ] **Create `server/src/modules/prior-prs/prior-prs.it.test.ts`** — integration test (`.it.test.ts` suffix = testcontainers Postgres). Use `buildApp()` with a real DB and Fastify `app.inject()` for HTTP assertions. Each test case must independently seed its workspace, repo, and pull-request rows, and rely only on data it seeds (tests must be independent and idempotent).

  Required test cases:
  - **AC-1 + AC-2 (filtering + exclusion)**: seed repo R; PR-A (touches `src/foo.ts`); PR-B (touches `src/foo.ts`, older than A); PR-C (touches `src/bar.ts`, different file). Call `GET /pulls/{id_of_A}/files/prior-prs?path=src/foo.ts`. Assert: HTTP 200; `items` contains exactly PR-B; PR-A is absent (excluded — current PR); PR-C is absent (different file); all five `PriorPr` fields are present on the PR-B row.
  - **AC-3 (empty result)**: call `GET /pulls/{id_of_A}/files/prior-prs?path=src/never-touched.ts`. Assert: HTTP 200; `items: []`; `total: 0`.
  - **AC-4 (workspace scope — 404)**: call the endpoint with a valid UUID that does not belong to the test workspace. Assert: HTTP 404.
  - **AC-5 (missing path — 422)**: call `GET /pulls/{id}/files/prior-prs` (no `path` param). Assert: HTTP 422. Also call with `?path=` (empty string). Assert: HTTP 422.
  - **AC-1a + cap (total > items.length)**: seed 12 PRs in repo R, all touching `src/hotspot.ts`. Call `GET /pulls/{id_of_one}/files/prior-prs?path=src/hotspot.ts`. Assert: HTTP 200; `items.length === 10`; `total === 11` (12 total minus the current PR). Also verify `items` are ordered newest-first by `opened_at`.
  - **AC-2 (current PR excluded even when its own diff matches)**: ensure the current PR's own `prFiles` row for the queried path does not appear in `items`. (Seeding the current PR with a matching `prFiles` row and asserting its absence covers this directly.)

#### 5b — Client component tests

- [ ] **Create `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/_components/ReviewFocusItem/ReviewFocusItem.test.tsx`** — Vitest + jsdom + React Testing Library. Mock `usePriorPrs` (import path: `@/lib/hooks/pr-files` or the relative path from this test file) and `useParams` from `next/navigation` (return `{ repoId: 'test-repo-id' }`). Tests run without a real API or browser.

  Required test cases:
  - **AC-6 — no request on initial render**: render `<ReviewFocusItem prId="pr-1" path="src/auth/service.ts" />`. Verify `usePriorPrs` was called with `enabled: false` (the third argument). Verify no network call fires.
  - **AC-7 — loading state**: simulate a click on the expand toggle. Mock `usePriorPrs` to return `{ isLoading: true, data: undefined }`. Assert the loading text is visible; assert no `<a>` link rows are rendered.
  - **AC-8 — empty state**: mock returns `{ isLoading: false, data: { items: [], total: 0 } }`. Assert the empty-state i18n string is visible; assert no list rows.
  - **AC-9 — populated list**: mock returns `{ isLoading: false, data: { items: [{ number: 42, title: "Refactor auth", author: "alice", status: "reviewed", opened_at: "2026-01-01T00:00:00Z" }], total: 1 } }`. Assert one row renders with number 42, the title, author, and status visible. Assert the row's link `href` is `/repos/test-repo-id/pulls/42` (using the mocked `repoId`).
  - **AC-10 — truncation indicator**: mock returns 10 items with `total: 15`. Assert the truncation indicator text contains "10" and "15". Assert it is visible alongside the list.
  - **AC-6 — no re-fetch on collapse + re-expand**: expand the item (first click), then collapse (second click), then expand again (third click). Assert `usePriorPrs` was only invoked with `enabled: true` once — subsequent expands use the TanStack Query cache, so `enabled` does not flip back to `false` between expands. (The hook's `enabled` guard fires the queryFn only on the transition from false → true for the first time; TanStack Query serves cached data thereafter.)
  - **Independent expansion**: render two `<ReviewFocusItem>` instances with different `path` values. Expand both. Assert both show their expanded content simultaneously. Verify clicking the first's toggle does not affect the second's visibility.

---

## Gotchas

- **Migration first, always**: `pr_files` has no index on `path` today — every request without it would table-scan a potentially large table. Phase 1 (`db:generate` + `db:migrate`) is a hard prerequisite for Phase 3. Do not skip it or defer it.
- **Never hand-edit migration SQL**: `server/src/db/migrations/` files are generated by Drizzle Kit. Hand-editing them desyncs the Drizzle snapshot and corrupts future generations. Always use `pnpm db:generate`.
- **Both vendor/shared copies must stay in sync**: `server/src/vendor/shared/contracts/prior-prs.ts` and `client/src/vendor/shared/contracts/prior-prs.ts` are manually mirrored. Only `tsc` catches drift. Run both typecheck commands after any contract change.
- **`reviewFocus` i18n restructure**: the existing call `t("block.brief.reviewFocus")` in `PrBriefCard.tsx` line 82 must be updated to `t("block.brief.reviewFocus.label")`. If this call is missed, the component will render `[object Object]` or a next-intl type error at runtime.
- **`COUNT(*) OVER()` is evaluated before `LIMIT` in Postgres**: the `total` value in the first (and only) returned row reflects the full pre-cap match count. When `rows` is empty, `rows[0]?.total` is `undefined` — the service falls back to `0`. Do not compute `total` from a separate query.
- **Drizzle `ne()` for the exclusion filter (AC-2)**: use `ne(t.pullRequests.id, prId)` not `not(eq(...))`. Verify the function name against the installed Drizzle version; in Drizzle ORM v0.28+ the function is `ne` from `drizzle-orm`.
- **`opened_at` null ordering**: Postgres `ORDER BY openedAt DESC` places `NULL` values last by default (`NULLS LAST` for DESC). No explicit `NULLS LAST` clause is needed — the default matches the spec's edge-case note.
- **`useParams()` in `ReviewFocusItem` requires Next.js context**: Vitest + jsdom does not provide a real App Router context. Component tests must mock `next/navigation`: `vi.mock('next/navigation', () => ({ useParams: () => ({ repoId: 'test-repo-id' }) }))`.
- **`client/src/vendor/` is a do-not-touch zone**: the only permitted changes there are adding the new `prior-prs.ts` contract file and updating the barrel `index.ts`. No other files in `client/src/vendor/` may be modified.
- **`ReviewFocusItem` renders a `<li>` tag**: the outer `<ul style={s.list}>` in `PrBriefCard.tsx` remains unchanged. The `<li>` element previously rendered inline moves inside `ReviewFocusItem`. Removing the outer `<ul>` would break the list structure.

## Definition of done

- [ ] `cd server && pnpm test` passes — all existing tests plus the new `prior-prs.it.test.ts` integration tests
- [ ] `cd client && pnpm test` passes — all existing tests plus the new `ReviewFocusItem.test.tsx` component tests
- [ ] `cd server && pnpm typecheck` reports no errors
- [ ] `cd client && pnpm typecheck` reports no errors
- [ ] A migration file exists in `server/src/db/migrations/` (Drizzle-generated, not hand-written) adding `pr_files_path_idx`, and it has been applied via `pnpm db:migrate`
- [ ] **AC-1**: `GET /pulls/:id/files/prior-prs?path=<path>` returns HTTP 200 with a `PriorPrList` containing only PRs from the same repo whose diff includes a `prFiles.path` row equal to the given path, ordered by `opened_at` DESC, limited to 10 items
- [ ] **AC-1a**: `PriorPrList.total` equals the full count of matching PRs before the 10-item cap, computed in a single query
- [ ] **AC-2**: The current PR (`:id`) is excluded from `items` even when its own diff contains a matching `prFiles.path` row
- [ ] **AC-3**: When no other ingested PR in the repo touches the given path, the response is HTTP 200 with `items: []` and `total: 0`
- [ ] **AC-4**: A PR UUID not belonging to the caller's workspace returns HTTP 404
- [ ] **AC-5**: An absent or empty `path` query parameter returns HTTP 422, rejected by the Zod querystring schema before the handler is reached
- [ ] **AC-6**: No request fires to `/pulls/:id/files/prior-prs` on initial page render; the request fires only on first expand of a `ReviewFocusItem`; subsequent expands of the same item use the TanStack Query cache
- [ ] **AC-7**: While the prior-PRs request is in-flight, the expanded item renders a loading indicator and no list rows
- [ ] **AC-8**: When `items` is empty, the expanded item renders the i18n empty-state message (no hardcoded strings)
- [ ] **AC-9**: When `items` is non-empty, each row renders all five fields (number, title, author, status, opened_at) and carries a link to `/repos/{repoId}/pulls/{number}`
- [ ] **AC-10**: When `total > items.length`, a truncation indicator is rendered showing both counts
- [ ] **Independent expansion**: two `ReviewFocusItem` instances can be expanded simultaneously; expanding one does not collapse the other
