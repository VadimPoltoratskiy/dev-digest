# Onion Architecture — Examples

Correct vs. incorrect patterns for each key architectural rule, grounded in the actual project structure.

---

## Adding a New Feature Module

**Scenario:** Add a `comments` module with CRUD endpoints.

```
# GOOD — full three-layer module
modules/comments/
├── routes.ts        ← HTTP layer only
├── service.ts       ← business logic only
├── repository.ts    ← DB queries only
└── helpers.ts       ← DTO converters

# BAD — skipping the service layer
modules/comments/
├── routes.ts        ← calls repository directly (layer breach)
└── repository.ts

# BAD — all logic in routes.ts
modules/comments/routes.ts
  // route handler does DB query, business logic, and response mapping
  // in one 80-line function
```

---

## Route Handler: Thin vs. Fat

```typescript
// GOOD — thin route, delegates immediately
// modules/comments/routes.ts
app.post('/pulls/:id/comments', { schema: { params: IdParams } }, async (req) => {
  const { workspaceId } = await getContext(container, req);
  const body = CreateCommentBody.parse(req.body);
  return service.createComment(workspaceId, req.params.id, body);
});

// BAD — business logic and DB in the route
app.post('/pulls/:id/comments', async (req) => {
  const comment = await db                            // ← direct DB access in route
    .insert(comments)
    .values({ pullId: req.params.id, ...req.body })
    .returning();
  if (!comment[0]) throw new Error('insert failed');  // ← business logic in route
  return { id: comment[0].id, text: comment[0].text }; // ← manual DTO mapping in route
});
```

---

## Service Layer: DI vs. Direct Import

```typescript
// GOOD — adapter resolved via DI container
// modules/reviews/service.ts
export class ReviewService {
  constructor(private container: Container) {}

  async summarize(pullId: number) {
    const llm = this.container.llm();               // lazy-resolved, swappable in tests
    const repo = new ReviewRepository(this.container.db);
    const diff = await repo.getDiff(pullId);
    return llm.complete({ prompt: buildPrompt(diff) });
  }
}

// BAD — adapter imported directly (breaks test injection + inward rule)
import { OpenAIAdapter } from '../../adapters/llm/openai';  // ← direct import

export class ReviewService {
  private llm = new OpenAIAdapter();                 // ← hardcoded, untestable

  async summarize(pullId: number) {
    return this.llm.complete({ prompt: '...' });
  }
}
```

---

## Repository: Typed Rows vs. DTOs

```typescript
// GOOD — repository returns raw typed rows; service maps to DTOs
// modules/comments/repository.ts
export class CommentRepository {
  constructor(private db: DrizzleDb) {}

  async findByPull(pullId: number) {
    return this.db                                   // ← returns typeof comments.$inferSelect[]
      .select()
      .from(comments)
      .where(eq(comments.pullId, pullId));
  }
}

// modules/comments/service.ts
async getComments(workspaceId: string, pullId: number): Promise<CommentDto[]> {
  const repo = new CommentRepository(this.container.db);
  const rows = await repo.findByPull(pullId);
  return rows.map(toCommentDto);                     // ← DTO conversion in service
}

// BAD — repository builds and returns DTOs
async findByPull(pullId: number): Promise<CommentDto[]> {
  const rows = await this.db.select().from(comments).where(...);
  return rows.map(row => ({                          // ← DTO mapping belongs in service/helpers
    id: row.id,
    text: row.text,
    author: row.createdBy,
    formattedDate: new Date(row.createdAt).toLocaleDateString(), // ← UI formatting in DB layer
  }));
}
```

---

## Service: No `req`/`res` Access

```typescript
// GOOD — route extracts what service needs and passes it explicitly
// modules/comments/routes.ts
app.post('/comments', async (req) => {
  const { workspaceId, user } = await getContext(container, req);
  const body = CreateCommentBody.parse(req.body);
  return service.create(workspaceId, user.id, body); // ← service gets primitives, not req
});

// BAD — service receives the raw request
// modules/comments/service.ts
async create(req: FastifyRequest) {                  // ← service depends on HTTP concept
  const workspaceId = req.headers['x-workspace'];   // ← parsing HTTP headers in service
  const body = req.body as CreateCommentBody;       // ← no Zod validation in service
  return this.repo.insert({ workspaceId, ...body });
}
```

---

## Module Registration: All Three Steps

```typescript
// Step 1 — modules/comments/routes.ts
import type { FastifyPluginAsync } from 'fastify';
import type { Container } from '../../platform/types';

export const commentsRoutes: FastifyPluginAsync<{ container: Container }> = async (app, opts) => {
  const service = new CommentService(opts.container);

  app.get('/pulls/:id/comments', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(opts.container, req);
    return service.listByPull(workspaceId, req.params.id);
  });
};

// Step 2 — modules/index.ts
export { commentsRoutes } from './comments/routes';

// Step 3 — app.ts
import { commentsRoutes } from './modules';
app.register(commentsRoutes, { prefix: '/api', container });

// BAD — missing Step 2 or Step 3 → routes silently don't exist at runtime
```

---

## Split Repository (Large Module)

**Scenario:** The `reviews` module has too many DB entities for one file.

```
# GOOD — split by entity
modules/reviews/
├── routes.ts
├── service.ts
├── repository.ts        ← thin re-export
└── repository/
    ├── run.repo.ts      ← queries agent_runs, run_traces
    ├── review.repo.ts   ← queries reviews, findings
    └── pull.repo.ts     ← PR lookups for review context

# modules/reviews/repository.ts (the re-export file)
export { RunRepository } from './repository/run.repo';
export { ReviewRepository } from './repository/review.repo';
export { PullRepository } from './repository/pull.repo';

# BAD — everything in one 400-line repository.ts
modules/reviews/repository.ts  ← queries 6 tables, 300+ lines, impossible to navigate
```

---

## Adding a New Adapter

**Scenario:** Add a `slack` integration for notifications.

```typescript
// GOOD — new adapter in adapters/, registered in container
// adapters/slack/index.ts
export interface SlackAdapter {
  notify(channel: string, message: string): Promise<void>;
}

export function createSlackAdapter(token: string): SlackAdapter {
  return {
    async notify(channel, message) {
      // call Slack API
    },
  };
}

// platform/container.ts — register lazy resolver
export function buildContainer(config: Config, overrides = {}) {
  return {
    // ...existing adapters
    slack: lazy(() => createSlackAdapter(config.slackToken)),
    ...overrides,
  };
}

// modules/notifications/service.ts — consume via DI
async sendAlert(workspaceId: string, message: string) {
  const slack = this.container.slack();              // ← lazy-resolved
  await slack.notify('#alerts', message);
}

// BAD — adapter created inline in service
import { WebClient } from '@slack/web-api';         // ← external package in service

export class NotificationService {
  private slack = new WebClient(process.env.SLACK_TOKEN); // ← bypasses DI, untestable
}
```
