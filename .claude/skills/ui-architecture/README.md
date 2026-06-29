# ui-architecture Skill

**Version:** v1.0.0

---

## Focus

This skill answers the structural question that other skills don't: **"I need to add X — what file do I create and where?"**

It codifies the client package's directory layout and placement decisions in a single, queryable document. It does not teach you how to write React components or Next.js data patterns — other skills cover that. It teaches you _where_ the code lives.

---

## What It Covers

- **Annotated directory map** — every folder in `src/` with a one-line purpose
- **Decision tree** — explicit "what I'm adding → where it goes" table for pages, feature components, shared components, hooks, API calls, types, utilities, contexts, i18n strings, and tests
- **Colocation pattern** — the `_components/<Name>/` folder anatomy: which files go inside, what each file's role is, when to omit optional files
- **Nested colocation** — when and how to add `_components/` inside a feature component, and when to promote to `components/` instead
- **Shared component structure** — how `components/` organizes complex multi-part UI features (like `diff-viewer/`)
- **File naming conventions** — kebab-case directories, PascalCase components, `use<Domain>` hooks, barrel `index.ts` files
- **Test placement rules** — colocated `*.test.tsx`, no `__tests__/` directories, what belongs in `src/test/`
- **Vendor zones** — which paths are locked and how to use them without modifying them
- **Anti-patterns** — CRITICAL / HIGH / MEDIUM violations with explanations

---

## Applicable Use Cases

| Scenario | How the skill helps |
|---|---|
| New developer onboarding | Provides the mental map of the client package in one read |
| Adding a new feature to a page | Decides between `_components/` (colocated) and `components/` (shared) |
| Reviewing a PR for structure | Anti-patterns section lists what to flag and at what severity |
| Asking "where does this test go?" | Test placement section gives the exact path |
| Deciding where a helper function lives | Distinguishes component-local `helpers.ts` from `lib/` utilities |
| Understanding the API call pipeline | Decision tree shows the path: component → hook → api.ts → server |
| Working with UI primitives | Vendor zone rules clarify what can be extended vs. what is locked |

---

## Related Skills

| Skill | Relationship |
|---|---|
| [next-best-practices](../next-best-practices/SKILL.md) | Covers Next.js file conventions (special files, RSC boundaries, async APIs) — the "how" of App Router files, not their placement |
| [react-best-practices](../react-best-practices/SKILL.md) | Covers component design, hooks rules, state patterns — the "how" of writing components, not where to put them |
| [react-testing-library](../react-testing-library/SKILL.md) | Covers how to write component and hook tests — this skill only tells you where the test file goes |

---

## References

### Official Documentation

- **Next.js Project Structure** — https://nextjs.org/docs/app/getting-started/project-structure
  File conventions for the App Router, route segment types, and the private folder `_` prefix that hides folders from route resolution.

- **Next.js Safe Colocation by Default** — https://nextjs.org/docs/app/getting-started/project-structure#safe-colocation-by-default
  Explains why non-`page.tsx`/`route.ts` files inside `app/` are not routable, making colocation safe without the `_` prefix being strictly required — but the `_` prefix documents intent explicitly.

- **TanStack Query — Queries** — https://tanstack.com/query/latest/docs/framework/react/guides/queries
  Query placement and key design patterns; the basis for the `lib/hooks/<domain>.ts` convention.

### Architecture References

- **Bulletproof React** — https://github.com/alan2207/bulletproof-react
  Feature-based architecture with colocated components, hooks, and tests per domain. The `_components/` pattern adapts the `features/<domain>/components/` concept for the App Router's folder-is-route constraint.

- **Feature-Sliced Design** — https://feature-sliced.design/
  Conceptual layering model (pages → features → shared → entities) that underpins the "route-colocated vs. shared" placement decision. The project uses a simplified two-layer variant.

- **Kent C. Dodds — "Colocation"** — https://kentcdodds.com/blog/colocation
  The foundational argument for keeping code that changes together in the same folder. The key insight: colocation makes deletion safe and reduces cognitive distance between a component and everything it depends on.

### Project-Internal Sources

- **`client/CLAUDE.md`** (`dev-digest/client/CLAUDE.md`) — Conventions section: thin pages, `_components/` prefix, API call routing via `lib/api.ts`, TanStack Query requirement, i18n string placement.
- **`client/README.md`** (`dev-digest/client/README.md`) — UI route map and testing approach.
- **`client/src/`** — Actual directory structure traversal and component inspection (`FindingsCounter/`, `diff-viewer/`, `RunTraceDrawer/`, `AgentEditor/`, `app-shell/`) used to verify conventions against the living codebase.
