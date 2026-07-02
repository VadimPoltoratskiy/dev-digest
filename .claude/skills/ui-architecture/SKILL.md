---
name: ui-architecture
description: "Answers 'what goes where' on the client — the placement decision tree for every new file in an App Router project. Use when adding a page, a feature component, a shared component, a data hook, a helper, or a test and you're unsure which directory and naming pattern to follow. Use when reviewing a PR for structural correctness, or when a new contributor asks where to put something. Covers the annotated directory map, the _components/ colocation pattern with its internal file anatomy, file naming conventions (kebab-case directories, PascalCase components, use<Domain> hooks), test placement rules (colocated *.test.tsx — no separate __tests__/), shared vs. feature component decision boundary, and vendor zones that must not be modified. Trigger terms: where to put, where does X go, project structure, file placement, colocation, feature folder, new page, new component, new hook, shared component, frontend architecture, directory layout, where do tests go."
user-invocable: false
metadata:
  tags: architecture, structure, file-placement, colocation, components, pages, hooks, tests, App Router, frontend
---

# UI Architecture

The placement decision tree for the client package (`src/`). For _how_ to write components and hooks, see [react-best-practices](../react-best-practices/SKILL.md). For Next.js file conventions (RSC boundaries, special files, async APIs), see [next-best-practices](../next-best-practices/SKILL.md).

---

## Directory Map

```
src/
├── app/                              # Next.js App Router — routes and their colocated components
│   ├── layout.tsx                    # Root layout + QueryClientProvider
│   ├── page.tsx                      # Root — redirects to first repo
│   ├── repos/[repoId]/pulls/
│   │   ├── page.tsx                  # PR list page (thin)
│   │   └── _components/              # Feature components for this route only
│   │       ├── PRRow/
│   │       └── FilterBar/
│   ├── repos/[repoId]/pulls/[number]/
│   │   ├── page.tsx                  # PR detail page (thin)
│   │   └── _components/              # Feature components for this route only
│   │       ├── FindingCard/
│   │       ├── RunTraceDrawer/
│   │       │   └── _components/      # Sub-components (nested colocation, max 2 levels)
│   │       │       ├── TraceBody/
│   │       │       └── PromptBlock/
│   │       └── RunStatus/
│   ├── agents/
│   ├── settings/[section]/
│   └── onboarding/
│
├── components/                       # Shared components — used by 2+ routes
│   ├── FindingsCounter/              # Simple shared component
│   ├── RunCostBadge/
│   ├── app-shell/                    # Complex shared: nav, breadcrumbs, shortcuts
│   │   ├── AppShell.tsx
│   │   ├── constants.ts
│   │   ├── helpers.ts
│   │   ├── hooks/                    # Component-specific hooks subfolder
│   │   └── index.ts
│   └── diff-viewer/                  # Complex shared: own sub-components
│       ├── DiffViewer/               # PascalCase subfolders (no _ prefix outside app/)
│       ├── CodeLine/
│       ├── constants.ts
│       ├── helpers.ts
│       ├── styles.ts
│       └── index.ts
│
├── lib/                              # Non-visual shared code
│   ├── api.ts                        # ALL fetch calls — single entry point
│   ├── hooks/                        # TanStack Query hooks, one file per domain
│   │   ├── core.ts                   # Base query client config
│   │   ├── reviews.ts
│   │   ├── agents.ts
│   │   ├── repo-intel.ts
│   │   ├── trace.ts
│   │   └── index.ts
│   ├── types.ts                      # Shared TypeScript interfaces/types
│   ├── providers.tsx                 # React context providers (QueryClient, etc.)
│   ├── repo-context.tsx              # Repo selection state context
│   └── [utility].ts                  # Domain helpers: github-urls, model-label, etc.
│
├── vendor/
│   ├── ui/                           # Vendored UI primitives — IMPORT ONLY, NEVER MODIFY
│   └── shared/                       # Zod contracts mirrored from server — UPDATE IN LOCKSTEP ONLY
│
├── i18n/
│   └── request.ts                    # next-intl config
│
└── test/
    └── setup.ts                      # Vitest globals + fetch mock — NOT for component tests
```

---

## Decision Tree

When you need to add something, find it in this table:

| What you're adding | Where it goes |
|---|---|
| A new page / route | `app/<route>/page.tsx` |
| A component used only by **one** route | `app/<route>/_components/<Name>/` |
| A component used by **two or more** routes | `components/<Name>/` |
| A sub-component of a feature component | `app/<route>/_components/<Parent>/_components/<Name>/` |
| A sub-component of a shared component | `components/<feature-dir>/<Name>/` (no `_` prefix) |
| A data-fetching / mutation hook | `lib/hooks/<domain>.ts` — add a new export |
| A new HTTP call to the API | `lib/api.ts` — add a new exported `async function` |
| A shared TypeScript type | `lib/types.ts` |
| A domain utility (URL builder, formatter) | `lib/<utility-name>.ts` |
| A React context or provider | `lib/<context-name>.tsx` |
| An i18n string | `messages/<locale>/*.json` |
| A UI primitive (button, badge, input, dialog) | Use existing from `vendor/ui/` — do **not** create your own |
| A shared Zod contract | `vendor/shared/` — only when server vendor also changes |
| Test setup or global test fixtures | `test/setup.ts` |
| A component test | `<same folder as component>/<Name>.test.tsx` |

---

## Colocation Pattern

Feature components live inside `_components/` next to their page. The `_` prefix prevents Next.js from treating the folder as a route segment.

```
app/<route>/
├── page.tsx                          # Thin: composes from _components only
└── _components/
    └── <ComponentName>/
        ├── <ComponentName>.tsx       # Main export (aim for < 200 lines)
        ├── index.ts                  # Barrel: re-exports <ComponentName> only
        ├── constants.ts              # Static data local to this component (omit if empty)
        ├── helpers.ts                # Pure utility functions (omit if trivial)
        ├── styles.ts                 # Tailwind class strings via cn() (omit if trivial)
        └── <ComponentName>.test.tsx  # Component test, colocated here
```

**Nesting:** A feature component that grows complex enough to need its own sub-components adds `_components/<Name>/_components/<SubName>/`. Keep nesting to two levels; if a third level is needed, the inner component is complex enough to promote to `components/`.

**Pages are thin.** A `page.tsx` imports one top-level component from `_components/` and renders it. It does not contain JSX logic, hooks, or data fetching itself.

---

## Shared Component Structure

`components/` follows the same folder-per-component convention. Complex shared features (like `diff-viewer`) get a kebab-case directory with PascalCase sub-component folders. No `_` prefix is needed here because `components/` is not under `app/`.

```
components/
└── <feature-name>/               # kebab-case root directory
    ├── <SubComponent>/           # PascalCase subfolder per sub-component
    │   ├── <SubComponent>.tsx
    │   └── index.ts
    ├── constants.ts              # Constants shared across sub-components
    ├── helpers.ts                # Helpers shared across sub-components
    ├── styles.ts                 # Shared Tailwind class strings
    └── index.ts                  # Barrel exporting the public surface
```

---

## File Naming Conventions

| File type | Convention | Examples |
|---|---|---|
| Directories | `kebab-case` | `diff-viewer/`, `app-shell/`, `repo-intel/` |
| Component files | `PascalCase.tsx` | `FindingCard.tsx`, `RunStatus.tsx` |
| Hook domain files | `<domain>.ts` inside `lib/hooks/` | `reviews.ts`, `agents.ts` |
| Utility/helper files | `kebab-case.ts` | `github-urls.ts`, `model-label.ts` |
| Barrel files | `index.ts` | Required in every component folder |
| Test files | `<ComponentName>.test.tsx` | `FindingCard.test.tsx` |
| Constants | `constants.ts` | Inside component or shared feature folder |
| Helpers | `helpers.ts` | Pure functions only, no side effects |
| Styles | `styles.ts` | `cn()`-based Tailwind string exports |

---

## Test Placement

- **Feature component test:** `app/<route>/_components/<Name>/<Name>.test.tsx` — colocated
- **Shared component test:** `components/<Name>/<Name>.test.tsx` — colocated
- **Utility or hook test:** `.test.ts` colocated next to the file under test
- **Global test setup:** `src/test/setup.ts` — Vitest configuration and `fetch` mocking
- **No `__tests__/` directories** — colocation is the enforced convention

Tests run under Vitest + jsdom with `fetch` mocked. They need no running API or browser.

---

## Vendor Zones

These paths are locked. Import from them; never modify them.

| Path | What it is | Rule |
|---|---|---|
| `src/vendor/ui/` | Vendored UI primitives (`@devdigest/ui`) | Import as-is. Build wrappers in `components/` using these as building blocks. |
| `src/vendor/shared/` | Zod contracts mirrored from `server/src/vendor/shared/` | Update only when the server vendor changes; both sides must stay in sync. |

---

## Anti-Patterns

### CRITICAL

- **Inline `fetch` in a component body** — all HTTP calls go through exported functions in `lib/api.ts`. Components import from `lib/api.ts`, not `fetch` directly.
- **`useEffect + useState` for server data** — async data always goes through TanStack Query hooks in `lib/hooks/`. No `useEffect`+`useState` chains for fetching.

### HIGH

- **Feature component placed in `components/`** — `components/` is for cross-route reuse. A component used by exactly one route belongs in that route's `_components/`.
- **Hardcoded UI strings in components** — all user-visible text goes in `messages/<locale>/*.json` and is consumed via `next-intl`. No string literals in JSX.
- **Recreating a `vendor/ui/` primitive** — always check `vendor/ui/` before building a button, badge, input, or dialog from scratch.
- **Feature-specific helpers dumped in `lib/`** — `lib/*.ts` is for cross-page utilities. Helpers used by only one component belong in that component's `helpers.ts`.

### MEDIUM

- **Component file dropped directly in `app/<route>/`** — feature components must be inside `_components/<Name>/`; a bare file at the route level breaks colocation and is invisible to reviewers scanning the folder structure.
- **Missing `index.ts` barrel** — every component folder must export via `index.ts` so callers import from `'./_components/Foo'` not `'./_components/Foo/Foo'`.
- **Reusable test helpers in colocated test files** — test factories and fixtures shared across test files belong in `src/test/`; keep them out of individual `*.test.tsx` files.
