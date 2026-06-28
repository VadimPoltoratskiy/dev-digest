# UI Architecture — References

Technical sources used during the creation of this skill.

---

## Official Documentation

### Next.js — Project Structure & Organization
- **URL:** https://nextjs.org/docs/app/getting-started/project-structure
- **Key sections:** App Router folder conventions, safe colocation by default, private folders with `_` prefix

### Next.js — Safe Colocation by Default
- **URL:** https://nextjs.org/docs/app/getting-started/project-structure#safe-colocation-by-default
- **Key insight:** Files inside `app/` are only routable if they export a `page.tsx` or `route.ts`; everything else is invisible to the router. The `_` prefix provides an explicit escape hatch that documents intent.

### TanStack Query — Query Placement
- **URL:** https://tanstack.com/query/latest/docs/framework/react/guides/queries
- **Key insight:** Query keys and query functions belong in dedicated hook files, not inlined in components, to enable cache sharing across component trees.

---

## Architecture References

### Bulletproof React
- **URL:** https://github.com/alan2207/bulletproof-react
- **Relevance:** Feature-based project structure with colocated components, hooks, and tests per domain. The `_components/` pattern in this project mirrors the `features/<domain>/components/` convention from Bulletproof React, adapted for App Router's folder-is-route model.

### Feature-Sliced Design
- **URL:** https://feature-sliced.design/
- **Relevance:** Provides the conceptual model for layers (pages → widgets → features → shared) that underpins the placement decision tree. The project uses a simplified two-layer variant: route-colocated features vs. shared components.

### Kent C. Dodds — "Colocation"
- **URL:** https://kentcdodds.com/blog/colocation
- **Key thesis:** Code that changes together should live together. Colocation reduces cognitive distance between a component and its tests, constants, and helpers, and makes deletions safe (remove the folder, not scattered files).

---

## Project-Internal Sources

### `client/CLAUDE.md`
- **Path:** `dev-digest/client/CLAUDE.md`
- **Content used:** Conventions section (thin pages, `_components/` prefix, API call routing via `lib/api.ts`, TanStack Query requirement, i18n string placement).

### `client/README.md`
- **Path:** `dev-digest/client/README.md`
- **Content used:** UI route map, stack description, testing approach (jsdom, fetch mocked).

### `client/src/` — Live codebase observation
- The directory map, colocation examples, and anti-patterns were derived by traversing the actual `src/` tree and reading representative component folders (`FindingsCounter/`, `diff-viewer/`, `RunTraceDrawer/`, `AgentEditor/`).
