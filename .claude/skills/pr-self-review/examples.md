# PR Self-Review — Examples

Three complete self-review sessions showing diff input → surface detection → routing → findings → verdict.

---

## Session 1: Frontend-Only PR — PASS

**Branch:** `feature/agent-card-component`

**Changed files:**
```
client/src/app/agents/_components/AgentCard/AgentCard.tsx       (new)
client/src/app/agents/_components/AgentCard/index.ts            (new)
client/src/app/agents/_components/AgentCard/AgentCard.test.tsx  (new)
client/src/lib/hooks/agents.ts                                  (modified)
```

**Surface detection:**
- `client/src/app/agents/_components/` → Frontend — Routes & Pages
- `client/src/lib/hooks/agents.ts` → Frontend — Data Hooks
- `client/src/app/.../*.test.tsx` → Frontend — Component Tests

**Companion skills applied:** `ui-architecture`, `react-best-practices`, `react-testing-library`

**Review output:**

```
## PR Self-Review: feature/agent-card-component
Surfaces detected: frontend (routes, data hooks, tests)
Companion skills applied: ui-architecture, react-best-practices, react-testing-library

### CRITICAL [BLOCKS PR]
(none)

### HIGH
(none)

### MEDIUM
(none)

### PASS ✓
- `client/src/app/agents/_components/AgentCard/` — Correct colocation under _components/; index.ts barrel present; test file colocated. (ui-architecture)
- `client/src/lib/hooks/agents.ts` — TanStack Query hook in correct domain file; no useEffect+useState for server data. (react-best-practices)
- `client/src/app/agents/_components/AgentCard/AgentCard.test.tsx` — Test colocated next to component; no separate __tests__/ directory. (react-testing-library)

---
## Verdict: ✅ PASS
0 high / 0 medium findings. PR may be opened.
```

---

## Session 2: Backend-Only PR — BLOCKED

**Branch:** `feature/add-comment-endpoint`

**Changed files:**
```
server/src/modules/reviews/routes.ts    (modified — added POST /pulls/:id/comments)
server/src/db/schema/reviews.ts         (modified — added comments table)
server/src/db/migrations/0015_comments.sql  (new)
```

**Surface detection:**
- `server/src/modules/reviews/routes.ts` → Backend — Feature Modules
- `server/src/db/schema/reviews.ts` → Backend — DB Schema
- `server/src/db/migrations/` → Backend — Migrations

**Companion skills applied:** `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`

**Diff excerpt from `routes.ts` (lines 38–55):**
```typescript
app.post('/pulls/:id/comments', { schema: { params: IdParams } }, async (req) => {
  const { workspaceId } = await getContext(container, req);
  const body = CreateCommentBody.parse(req.body);
  // direct DB query in route handler:
  const [comment] = await db
    .insert(comments)
    .values({ pullId: req.params.id, text: body.text, workspaceId })
    .returning();
  return { id: comment.id, text: comment.text };
});
```

**Diff excerpt from `migrations/0015_comments.sql` (lines 1–8):**
```sql
-- Hand-edited to add index manually
CREATE TABLE comments (...);
CREATE INDEX idx_comments_pull ON comments(pull_id);  -- added by hand
```

**Review output:**

```
## PR Self-Review: feature/add-comment-endpoint
Surfaces detected: backend (modules, schema, migrations)
Companion skills applied: onion-architecture, fastify-best-practices, drizzle-orm-patterns

### CRITICAL [BLOCKS PR]
- `server/src/modules/reviews/routes.ts:42` — Route handler calls db.insert() directly.
  All DB queries must go in repository.ts. Move insert logic to a new CommentRepository.
  → [onion-architecture / Anti-Patterns: CRITICAL]

- `server/src/db/migrations/0015_comments.sql:3` — Migration SQL was hand-edited (index added manually).
  Migrations must be generated via `pnpm db:generate`. Hand-editing desynchs the Drizzle snapshot
  and will corrupt future migrations.
  → [drizzle-orm-patterns / Anti-Patterns: CRITICAL]

### HIGH
(none)

### MEDIUM
(none)

### PASS ✓
- `server/src/db/schema/reviews.ts` — Table definition uses correct column conventions; timestamps via _shared.ts helpers. (drizzle-orm-patterns)

---
## Verdict: ❌ BLOCKED
2 CRITICAL finding(s) must be resolved before this PR can be opened.
Run /pr-self-review again after fixing to confirm PASS.
```

---

## Session 3: Mixed PR (Both Surfaces) — PASS with HIGH

**Branch:** `feature/sync-agent-contract`

**Changed files:**
```
server/src/vendor/shared/contracts/agents.ts    (modified — added agentVersion field)
server/src/modules/agents/routes.ts             (modified — exposes version in response)
server/src/modules/agents/service.ts            (modified — passes version to DTO)
server/src/modules/agents/repository.ts         (modified — queries agent_versions)
client/src/lib/api.ts                           (modified — updated fetch call)
client/src/lib/hooks/agents.ts                  (modified — updated return type)
```

**Surface detection:**
- `server/src/vendor/shared/` → Backend — Shared Contracts
- `server/src/modules/agents/` → Backend — Feature Modules
- `client/src/lib/api.ts` → Frontend — API Entry Point
- `client/src/lib/hooks/agents.ts` → Frontend — Data Hooks

**Companion skills applied:** `ui-architecture`, `react-best-practices`, `onion-architecture`, `fastify-best-practices`

**Diff excerpt — `client/src/lib/api.ts`:**
```typescript
// client vendor/shared NOT updated — still uses old AgentDto type
import type { AgentDto } from '../vendor/shared';  // missing agentVersion field
```

**Review output:**

```
## PR Self-Review: feature/sync-agent-contract
Surfaces detected: backend (modules, shared contracts), frontend (API entry, data hooks)
Companion skills applied: ui-architecture, react-best-practices, onion-architecture, fastify-best-practices

### CRITICAL [BLOCKS PR]
(none)

### HIGH
- `client/src/lib/api.ts:3` — server/src/vendor/shared/ was updated (agentVersion field added) but
  client/src/vendor/shared/ was not updated to match. Shared Zod contracts must be kept in sync
  across both vendor directories.
  → [onion-architecture / Vendor Zones] + [ui-architecture / Vendor Zones]

### MEDIUM
(none)

### PASS ✓
- `server/src/modules/agents/routes.ts` — Route delegates to service; no DB access in handler. (onion-architecture)
- `server/src/modules/agents/repository.ts` — Returns typed rows; no DTO conversion in repo layer. (onion-architecture)
- `client/src/lib/hooks/agents.ts` — TanStack Query hook; no useEffect+useState for server data. (react-best-practices)

---
## Verdict: ✅ PASS
0 critical / 1 high / 0 medium findings. PR may be opened.
Address the vendor/shared sync (HIGH) before requesting merge.
```
