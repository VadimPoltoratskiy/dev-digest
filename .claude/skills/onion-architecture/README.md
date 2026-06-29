# onion-architecture Skill

**Version:** v1.0.0

---

## Focus

This skill answers the structural question that other backend skills don't: **"I need to add X to the server — which layer does it belong to, and where does the file go?"**

It codifies the server's four-layer onion architecture (presentation → application → infrastructure → core) as a placement decision tree. It does not teach you how to write Fastify routes, Drizzle queries, or PostgreSQL schemas — other skills cover those. It teaches you _where_ the code lives and _how_ layers communicate with each other.

---

## What It Covers

- **Annotated directory map** — every folder in `server/src/` with a one-line purpose
- **The four-layer model** — core (`platform/`), infrastructure (`db/` + `adapters/`), application (`service.ts`), presentation (`routes.ts`) — with a clear statement of what each layer is allowed to do
- **Decision tree** — "what I'm adding → where it goes" table for modules, routes, services, repositories, adapters, platform utilities, shared contracts, jobs, and SSE channels
- **Module anatomy** — the canonical file set inside a feature module (`routes.ts`, `service.ts`, `repository.ts`, `helpers.ts`, `constants.ts`) and when to omit optional files
- **Split repository pattern** — when and how to split a `repository.ts` into `repository/<entity>.repo.ts` files
- **DI container usage** — how services consume adapters via the container (and why direct imports are forbidden)
- **Module registration** — the three mandatory steps to wire a new module into the app
- **Import boundary rules** — which layers may import from which, expressed as a table
- **File naming conventions** — kebab-case module dirs, fixed-name module files, `<entity>.repo.ts` for split repos
- **Anti-patterns** — CRITICAL / HIGH / MEDIUM violations with explanations

---

## Applicable Use Cases

| Scenario | How the skill helps |
|---|---|
| Adding a new domain feature end-to-end | Decision tree shows new module structure; module anatomy shows file set |
| Adding a route to an existing module | Layer responsibilities clarify what `routes.ts` may and may not do |
| Adding a service method that calls the LLM | DI container section shows the correct `container.llm()` pattern |
| Writing a new DB query | Repository section clarifies what stays in the repo layer vs. the service |
| Integrating a new third-party API | Adapter creation + container registration steps |
| Reviewing a PR for architectural violations | Anti-patterns section lists what to flag and at what severity |
| Onboarding a new backend contributor | Directory map + onion layer diagram provide the complete mental model |
| Deciding whether something belongs in `platform/` or a module | Layer responsibility table answers directly |

---

## Related Skills

| Skill | Relationship |
|---|---|
| [fastify-best-practices](../fastify-best-practices/SKILL.md) | Covers **how** to write Fastify routes: schemas, hooks, plugins, lifecycle, auth. This skill only tells you that routes go in `modules/<domain>/routes.ts`. |
| [drizzle-orm-patterns](../drizzle-orm-patterns/SKILL.md) | Covers **how** to write Drizzle queries: schema definition, joins, transactions, migrations. This skill only tells you that queries go in `repository.ts`. |
| [postgresql-table-design](../postgresql-table-design/SKILL.md) | Covers **how** to design tables: data types, indexes, constraints. This skill only tells you that schema definitions go in `db/schema/<domain>.ts`. |

A complete backend task typically needs **this skill** (where?) plus one or more of the above (how?).

---

## References

### Foundational Architecture Patterns

- **Onion Architecture — Jeffrey Palermo (2008)** — https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/
  The original formulation: dependencies flow inward; the application core has no external dependencies. Infrastructure (DB, external APIs) is at the outer edge and implements core-defined interfaces.

- **Hexagonal Architecture (Ports and Adapters) — Alistair Cockburn (2005)** — https://alistair.cockburn.us/hexagonal-architecture/
  Applications communicate with the outside world only through "ports" (interfaces). "Adapters" implement those ports. Maps directly to `adapters/` and the DI container as the port resolver.

- **Clean Architecture — Robert C. Martin (2012)** — https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html
  The Dependency Rule and separation of Entities / Use Cases / Interface Adapters / Frameworks maps to this project's platform → adapters → service → routes layering.

### Node.js / TypeScript Architecture

- **NestJS Controllers, Services, Repositories** — https://docs.nestjs.com/controllers
  NestJS formalizes the three-layer module structure in Node.js. This project uses the same architecture without the NestJS framework overhead.

- **Dependency Injection in Node.js without a framework — Khalil Stemmler** — https://khalilstemmler.com/articles/software-design-architecture/dependency-injection-inversion-of-control/
  Manual DI container construction: passing adapters as constructor parameters enables test injection and inversion of control — the pattern used in `platform/container.ts`.

- **Vertical Slice Architecture — Jimmy Bogard** — https://jimmybogard.com/vertical-slice-architecture/
  This project uses a hybrid: one module per domain (vertical slices) with a strict horizontal layer contract within each module. The `modules/_shared/` directory exists for genuine cross-cutting concerns that don't fit either model cleanly.

### Project-Internal Sources

- **`server/README.md`** (`dev-digest/server/README.md`) — Full request/response flow diagram, API endpoint map, testing split.
- **`server/CLAUDE.md`** (`dev-digest/server/CLAUDE.md`) — Commands, gotchas (migrations, secrets, repo-intel degradation).
- **`server/src/`** — Directory map and all examples derived from traversing the live codebase: `agents/`, `repos/`, `reviews/`, `platform/container.ts`, `modules/index.ts`, `app.ts`.
