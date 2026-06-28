# Onion Architecture — References

Technical sources used during the creation of this skill.

---

## Foundational Architecture Patterns

### Onion Architecture — Jeffrey Palermo (2008)
- **Original post:** https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/
- **Series:** Parts 1–4 at jeffreypalermo.com
- **Core principle:** Dependencies flow inward; the application core has no external dependencies. Infrastructure (DB, APIs) is at the outer edge and depends on core interfaces — not the reverse.

### Hexagonal Architecture (Ports and Adapters) — Alistair Cockburn (2005)
- **Original article:** https://alistair.cockburn.us/hexagonal-architecture/
- **Core principle:** An application communicates with the outside world only through "ports" (interfaces). "Adapters" implement those ports for specific technologies. This maps directly to the project's `adapters/` directory and the DI container as the port resolver.

### Clean Architecture — Robert C. Martin
- **Book:** *Clean Architecture* (2017), Prentice Hall
- **Blog summary:** https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html
- **Relevance:** The Dependency Rule ("source code dependencies must point only inward") and the separation of Entities, Use Cases, Interface Adapters, and Frameworks/Drivers maps to this project's platform → adapters/db → service → routes layering.

---

## Node.js / TypeScript Architecture

### Node.js Layered Architecture (NestJS-inspired patterns)
- **URL:** https://docs.nestjs.com/controllers
- **Relevance:** NestJS formalizes the Controller → Service → Repository pattern in Node.js. This project implements the same three-layer module structure without the NestJS framework overhead.

### Dependency Injection in Node.js without a framework
- **URL:** https://khalilstemmler.com/articles/software-design-architecture/dependency-injection-inversion-of-control/
- **Relevance:** Explains manual DI container construction (the pattern used in `platform/container.ts`): passing adapters as constructor parameters rather than importing them enables test injection and inversion of control.

### Vertical Slice Architecture (as a contrast)
- **URL:** https://jimmybogard.com/vertical-slice-architecture/
- **Relevance:** This project uses a hybrid — module-per-domain (vertical slices) with a strict horizontal layer contract within each module. Understanding the tension between the two clarifies why `_shared/` exists for genuine cross-cutting concerns.

---

## Project-Internal Sources

### `server/README.md`
- **Path:** `dev-digest/server/README.md`
- **Content used:** Full request/response flow diagram (HTTP → plugins → validation → module → service → DI → adapters → external), API endpoint map, and testing split (unit vs. integration).

### `server/CLAUDE.md`
- **Path:** `dev-digest/server/CLAUDE.md`
- **Content used:** Commands, stack overview, key gotchas (migrations not auto-run, secrets location, repo-intel degradation, rate-limiting).

### `server/src/` — Live codebase observation
- The directory map, layer descriptions, and anti-patterns were derived by traversing the actual `src/` tree and reading representative modules (`agents/`, `repos/`, `reviews/`) and infrastructure files (`platform/container.ts`, `platform/errors.ts`, `modules/index.ts`, `app.ts`).
