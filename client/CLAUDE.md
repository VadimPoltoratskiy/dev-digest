# client/ — @devdigest/web

Next.js 15 App Router + React 19 + TanStack Query. The studio UI: browse repos/PRs, run reviews, read findings, author agents.

## Commands
```sh
pnpm dev        # :3000
pnpm build
pnpm test       # vitest + jsdom (no API/browser needed)
pnpm typecheck
```

## Structure
```
src/
  app/                    # Next.js routes
    layout.tsx            # root layout + QueryClientProvider
    page.tsx              # root — redirects to first repo's PR list
    repos/[repoId]/pulls/ # PR list
    pulls/[number]/       # PR detail (overview · diff · findings tabs)
    agents/               # agent list + editor
    settings/             # API keys + model settings
    onboarding/           # add-repository form
  components/
    app-shell/            # nav, breadcrumbs, `g`-then-key keyboard shortcuts
  lib/
    api.ts                # all fetch calls — NEXT_PUBLIC_API_BASE (default :3001)
    hooks/                # TanStack Query hooks (one file per domain)
  vendor/
    ui/                   # vendored UI primitives (@devdigest/ui) — do not modify
    shared/               # @devdigest/shared Zod contracts (mirror of server vendor)
```

## Conventions
- **Pages are thin.** Feature logic lives in colocated `_components/<Name>/` folders next to `page.tsx`. Each has its own `*.test.tsx`.
- **All API calls go through `src/lib/api.ts`.** Never `fetch` inline in a component.
- **All data fetching via TanStack Query hooks** in `src/lib/hooks/`. No `useEffect`+`useState` for server data.
- **i18n strings** live in `messages/<locale>/*.json` — use `next-intl`; no hardcoded UI strings in components.
- **`_components/` prefix** keeps feature folders out of Next.js route resolution.

## Gotchas
- Component tests run under jsdom — `fetch` is mocked. They pass without a running API. Do not write tests that require a real API.
- Shared contracts in `src/vendor/shared/` mirror the server vendor. If contracts change on server, update client vendor too.
- `src/vendor/ui/` is vendored — do not modify or import from outside `src/`.
- `NEXT_PUBLIC_API_BASE` must be set at build time for production (it's baked in). In dev it defaults to `http://localhost:3001`.

## Read when
- Adding a route → `client/README.md` (UI route map)
- Adding a data hook → `src/lib/hooks/` (match existing pattern)
- Session start → read `INSIGHTS.md`; treat it as high-confidence guidance; before touching code confirm by summarizing the top 3 most relevant points aloud.
- Session end → run `/engineering-insights` to update `INSIGHTS.md`; do not skip this step.
