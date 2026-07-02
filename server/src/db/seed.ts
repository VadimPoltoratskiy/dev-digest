import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
} from './seed-prompts.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, and the three built-in agents (General + Security +
 * Performance), all on the default openrouter/deepseek-v4-flash provider+model.
 *
 * Course lessons populate the other tables (skills, conventions, memory, eval,
 * …) once their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description: 'Checks test coverage: uncovered branches, missed corner cases, excessive mocking, flakes.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      repoIntel: false,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- companion + pr-self-review skills (from .claude/skills/) ----
  // pr-self-review is seeded DISABLED — it is a Claude Code orchestrator, not a prompt injection block.
  // The four companion skills are enabled and bound to General Reviewer so the agent
  // applies both frontend and backend structural rules on every PR diff.
  const companionSkills = [
    {
      name: 'onion-architecture',
      description: 'Layer boundary rules for the Fastify backend — routes → service → repository → platform/adapters.',
      type: 'convention' as const,
      source: 'manual' as const,
      enabled: true,
      body: `# Onion Architecture — Anti-Patterns

Apply these rules to every changed file under \`server/src/\`. Cite file path and line number for each finding.

## CRITICAL

- **Route handler queries the DB directly** — all DB access must go through \`repository.ts\`. Any \`db.select()\`, \`db.insert()\`, or Drizzle call inside \`routes.ts\` is a layer breach.
- **Service imports an adapter directly** — adapters must be resolved via \`container.adapterName()\`. Direct \`import … from '../../adapters/'\` in \`service.ts\` breaks test injection.
- **Hand-editing migration SQL** — files in \`db/migrations/\` are auto-generated by \`pnpm db:generate\`. Any manual edit desyncs Drizzle's snapshot.

## HIGH

- **Repository returns a DTO** — repositories return raw typed DB rows. DTO conversion belongs in \`helpers.ts\`, called from \`service.ts\`.
- **Repository contains business logic** — conditional branching, cost calculation, and data enrichment are the service's responsibility.
- **Service accesses \`req\` or \`res\`** — services must not know about HTTP. Route extracts needed data and passes it explicitly.
- **New module not registered** — creating \`routes.ts\` without adding it to \`modules/index.ts\` and \`app.ts\` is a silent no-op.

## MEDIUM

- **Domain-specific helpers in \`modules/_shared/\`** — helpers used by one module belong in \`modules/<domain>/helpers.ts\`.
- **Missing \`getContext()\` call in a route** — every workspace-scoped route must call \`getContext(container, req)\`.
- **Secrets accessed outside \`platform/config.ts\`** — direct \`process.env\` reads in services or adapters bypass the single read chokepoint.`,
    },
    {
      name: 'fastify-best-practices',
      description: 'Fastify route, plugin, validation, and error-handling anti-patterns for PR review.',
      type: 'convention' as const,
      source: 'manual' as const,
      enabled: true,
      body: `# Fastify Best Practices — Anti-Patterns

Apply these rules to every changed file under \`server/src/modules/*/routes.ts\` and \`server/src/app.ts\`.

## CRITICAL

- **Handler bypasses schema validation** — every route must declare a Zod \`body\`/\`params\`/\`querystring\` schema via \`fastify-type-provider-zod\`. Never call \`Schema.parse(req.body)\` manually inside a handler; invalid input must be rejected 422 before the handler runs.
- **Business logic inside a route handler** — handlers must parse → delegate to service → return. Any \`if/else\` that decides business outcomes or any DB call inside a handler is a violation.
- **Uncaught async throw leaks 500 with stack trace** — all async handlers must be wrapped or use Fastify's built-in async error propagation. Never swallow errors with an empty \`catch {}\`.

## HIGH

- **Plugin registers routes without a prefix** — every feature plugin registered in \`app.ts\` must pass a \`prefix\` option. Unprefixed routes collide across modules.
- **SSE route not exempted from rate limiting** — long-lived streaming routes must be listed in the rate-limit exclusion list; otherwise the connection is closed after the global request cap.
- **Secrets or config read inside a handler** — config must be resolved at startup via \`loadConfig()\` and injected. Reading \`process.env\` or file I/O inside a request handler adds latency on every call.
- **Reply sent after return** — calling \`reply.send()\` and then returning a value (or vice-versa) produces a double-send error. Use \`return reply.send(data)\` or \`return data\` consistently.

## MEDIUM

- **Logging sensitive fields** — \`req.log.info\` must not log passwords, tokens, or PII. Use Pino's \`redact\` option or omit the field.
- **Hardcoded port/host in \`listen()\`** — port and host must come from config, not literals.`,
    },
    {
      name: 'ui-architecture',
      description: 'File placement and colocation rules for the Next.js App Router frontend.',
      type: 'convention' as const,
      source: 'manual' as const,
      enabled: true,
      body: `# UI Architecture — Anti-Patterns

Apply these rules to every changed file under \`client/src/\`. Cite file path and line number for each finding.

## CRITICAL

- **Inline \`fetch\` in a component body** — all HTTP calls must go through exported functions in \`lib/api.ts\`. A component that calls \`fetch()\` directly bypasses the single API entry point.
- **\`useEffect + useState\` for server data** — all async server data must be fetched via TanStack Query hooks in \`lib/hooks/\`. A \`useEffect\`+\`useState\` chain for fetching is always wrong.

## HIGH

- **Feature component placed in \`components/\`** — \`components/\` is for cross-route reuse (used by 2+ routes). A component used by exactly one route belongs in that route's \`_components/<Name>/\` folder.
- **Hardcoded UI strings in components** — all user-visible text must go in \`messages/<locale>/*.json\` and be consumed via \`next-intl\`. No string literals in JSX.
- **Recreating a \`vendor/ui/\` primitive** — always check \`vendor/ui/\` before building a button, badge, input, or dialog from scratch.
- **Feature-specific helpers in \`lib/\`** — \`lib/*.ts\` is for cross-page utilities. Helpers for one component belong in that component's \`helpers.ts\`.

## MEDIUM

- **Component file dropped directly in \`app/<route>/\`** — feature components must be inside \`_components/<Name>/\`; a bare file at the route level breaks colocation.
- **Missing \`index.ts\` barrel** — every component folder must re-export via \`index.ts\` so callers import from \`'./_components/Foo'\`, not \`'./_components/Foo/Foo'\`.`,
    },
    {
      name: 'react-best-practices',
      description: 'React component design, hooks, state management, and rendering anti-patterns.',
      type: 'rubric' as const,
      source: 'manual' as const,
      enabled: true,
      body: `# React Best Practices — Anti-Patterns

Apply these rules to every React component and hook file in the diff.

## CRITICAL

- **Storing derived state** — never store a value in \`useState\` that can be computed from existing props or state. Compute it during render or with \`useMemo\` if expensive.
- **\`renderThing()\` pattern** — camelCase functions returning JSX are not React components. They break reconciliation and dev tools. Always use \`<Thing />\` component syntax with PascalCase.
- **Premature abstraction** — abstractions with only one consumer are premature; inline them. A "reusable" hook or component that is only used once adds indirection with no benefit.
- **Array index as key** — never use array index as \`key\` when lists can be reordered, filtered, or have items added/removed.

## HIGH

- **\`useEffect\` for derived state** — never use \`useEffect\` to sync computed values. If a value depends only on state/props, compute it inline.
- **Missing \`useEffect\` dependencies** — all values used inside a \`useEffect\` must be in the dependency array. Omissions cause stale closures.
- **Inline object/array/function creation in JSX props** — new references created inline break \`React.memo\` on children. Extract to module-level constants or \`useMemo\`/\`useCallback\`.
- **\`{count && <Component />}\` when count can be 0** — renders literal \`0\`. Use \`{count > 0 && <Component />}\` or a ternary.

## MEDIUM

- **Unnecessary \`useMemo\`/\`useCallback\`** — only memoize expensive computations (measured) or functions passed to memoized children. Memoizing cheap operations adds overhead.
- **Deep prop drilling past two levels** — extract a context or restructure components instead of passing props through intermediaries that don't use them.`,
    },
    {
      name: 'pr-self-review',
      description: 'Pre-PR gate orchestrator — routes the diff to the correct companion skills and emits BLOCKED/PASS. Disabled: run via /pr-self-review in Claude Code, not injected into agent prompts.',
      type: 'rubric' as const,
      source: 'manual' as const,
      enabled: false,
      body: `# PR Self-Review (Pre-PR Gate)

Orchestrates companion skills over the full branch diff and emits a BLOCKED or PASS verdict.
Run explicitly before opening a PR — never during active coding.

## Surface routing

| Path prefix | Companion skills |
|---|---|
| \`client/src/\` | ui-architecture + react-best-practices |
| \`server/src/\` | onion-architecture + fastify-best-practices |
| Both | All four skills |

## Severity gate

- **CRITICAL** → BLOCKED (must fix before PR)
- **HIGH / MEDIUM** → PASS (address before merge, not before push)

Every finding must cite file path + line number. Speculative, uncited findings are dropped.

## Verdict format

\`\`\`
## PR Self-Review: <branch>
Surfaces: <list>   Skills applied: <list>

### CRITICAL [BLOCKS PR]
- \`file:line\` — description  → [skill / Anti-Patterns: CRITICAL]

### HIGH
- \`file:line\` — description

---
## Verdict: ❌ BLOCKED  |  ✅ PASS
\`\`\``,
    },
  ];

  const companionSkillIds: Record<string, string> = {};
  for (const s of companionSkills) {
    const [existing] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, s.name)));
    if (existing) {
      companionSkillIds[s.name] = existing.id;
    } else {
      const [inserted] = await db.insert(t.skills).values({ workspaceId, ...s, version: 1 }).returning();
      companionSkillIds[s.name] = inserted!.id;
    }
  }

  // Bind onion-architecture + fastify (backend) + ui-architecture + react (frontend) to General Reviewer.
  const [generalAgent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'General Reviewer')));
  if (generalAgent) {
    const generalSkillOrder = ['onion-architecture', 'fastify-best-practices', 'ui-architecture', 'react-best-practices'];
    for (let i = 0; i < generalSkillOrder.length; i++) {
      const sid = companionSkillIds[generalSkillOrder[i]!];
      if (sid) {
        await db.insert(t.agentSkills).values({ agentId: generalAgent.id, skillId: sid, order: i }).onConflictDoNothing();
      }
    }
  }

  // Bind onion-architecture + fastify to Security Reviewer (layer violations = security surface).
  const [secAgent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));
  if (secAgent) {
    const secSkills = ['onion-architecture', 'fastify-best-practices'];
    for (let i = 0; i < secSkills.length; i++) {
      const sid = companionSkillIds[secSkills[i]!];
      if (sid) {
        await db.insert(t.agentSkills).values({ agentId: secAgent.id, skillId: sid, order: i }).onConflictDoNothing();
      }
    }
  }

  // ---- demo skills for the Test Quality Reviewer control experiment ----
  const demoSkills = [
    {
      name: 'test-coverage-nudge',
      description: 'Flags tests that only cover the happy path and miss branches, edge cases, and error conditions.',
      type: 'rubric' as const,
      source: 'community' as const,
      body: `# Test Coverage Nudge

Review every test file in the diff. Flag tests that cover only the happy path while omitting important branches.

## CRITICAL
- A function with branching logic (if/else, switch, ternary) has zero tests for any non-happy-path branch.
- An async function has no test for the rejection / error case.

## HIGH
- A test suite covers the success case but skips the boundary values (e.g. empty array, zero, max int, null input).
- A function that throws has no \`expect(...).toThrow()\` test.
- A loop body is tested only with a single-element input when empty and multi-element are meaningfully different.

## MEDIUM
- A test description says "returns X" but does not assert on error state or side effects that also occur.
- Every test uses the same fixture data — no property-based or parameterized variant.

For each finding cite the test file, the function under test, and the specific branch or case that is missing.`,
    },
    {
      name: 'api-contract-guard',
      description: 'Detects breaking changes in route signatures, request/response shapes, and API contracts.',
      type: 'convention' as const,
      source: 'community' as const,
      body: `# API Contract Guard

Detect breaking changes to HTTP API contracts in the diff. A breaking change is any modification that would cause existing callers to fail without a corresponding client update.

## CRITICAL
- A route path is renamed or removed (e.g. \`/users/:id\` → \`/users/:userId\`).
- A required request field is added (callers not sending it will get 422/400).
- A response field that callers depend on is removed or renamed.
- An endpoint's HTTP method changes (GET → POST).
- A previously optional field becomes required.

## HIGH
- A field type changes in a way that is not backward-compatible (string → number, object → array).
- An enum gains values in a discriminated union without a default/fallback branch.
- A route that was unauthenticated now requires auth (401 for old callers).

## MEDIUM
- A field is deprecated but no migration comment or header is included.
- Response shape gains a required nested object where \`null\` was previously valid.

For each finding, note the before and after signature so the reviewer can judge impact.`,
    },
  ];

  const skillIds: string[] = [];
  for (const s of demoSkills) {
    const [existing] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, s.name)));
    if (existing) {
      skillIds.push(existing.id);
    } else {
      const [inserted] = await db.insert(t.skills).values({ workspaceId, ...s, enabled: true, version: 1 }).returning();
      skillIds.push(inserted!.id);
    }
  }

  // Bind demo skills to Test Quality Reviewer agent.
  const [tqrAgent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Test Quality Reviewer')));
  if (tqrAgent) {
    for (let i = 0; i < skillIds.length; i++) {
      await db
        .insert(t.agentSkills)
        .values({ agentId: tqrAgent.id, skillId: skillIds[i]!, order: i })
        .onConflictDoNothing();
    }
  }

  // ---- API Contract Reviewer agent + 4 skills ----
  const apiContractSkills = [
    {
      name: 'breaking-change',
      description: 'Detects removal or rename of a public HTTP route, method, or required parameter.',
      type: 'convention' as const,
      source: 'extracted' as const,
      enabled: true,
      body: `# Breaking Change Detection

**When to flag:** Any modification that removes or renames a public HTTP route, changes its method, or removes/renames a required request parameter.

### ✅ Good — additive change, no breakage
\`\`\`diff
- app.get('/users/:id', handler)
+ app.get('/users/:id', handler)
+ app.get('/users/:id/profile', profileHandler)  // NEW endpoint added
\`\`\`

### ❌ Bad — route renamed, all callers break
\`\`\`diff
- app.delete('/users/:id', handler)
+ app.delete('/users/:userId', handler)
\`\`\`

Flag as **CRITICAL** with the old and new signature so the reviewer can assess impact on existing callers.`,
    },
    {
      name: 'response-schema',
      description: 'Flags changes in response shape: removed fields, type changes, or new required fields.',
      type: 'convention' as const,
      source: 'extracted' as const,
      enabled: true,
      body: `# Response Schema Guard

**When to flag:** Any change that removes a field from a response, changes a field's type in a non-backward-compatible way, or wraps an existing response in a new envelope.

### ✅ Good — new optional field, backwards compatible
\`\`\`diff
 return {
   id: user.id,
   name: user.name,
+  avatar_url: user.avatarUrl ?? null,  // optional, existing callers unaffected
 };
\`\`\`

### ❌ Bad — field removed, callers reading it break
\`\`\`diff
 return {
   id: user.id,
-  name: user.name,
   email: user.email,
 };
\`\`\`

### ❌ Bad — response wrapped in envelope, breaking existing clients
\`\`\`diff
-return users;
+return { data: users, total: users.length };
\`\`\`

Flag as **CRITICAL** and show the before/after shape.`,
    },
    {
      name: 'semver-discipline',
      description: 'Flags when a change requires a major or minor version bump but the version was not updated.',
      type: 'convention' as const,
      source: 'extracted' as const,
      enabled: true,
      body: `# SemVer Discipline

**When to flag:** When the diff introduces a breaking API change (removal, rename, type narrowing) without a corresponding major version bump in package.json; or adds significant new public surface without a minor bump.

### ✅ Good — breaking change accompanied by major bump
\`\`\`diff
-  "version": "2.4.1"
+  "version": "3.0.0"
\`\`\`
plus a CHANGELOG entry explaining the migration path.

### ❌ Bad — breaking route change with no version update
\`\`\`diff
-app.get('/orders/:id', handler)
+app.get('/orders/:orderId', handler)
\`\`\`
\`package.json\` version unchanged at \`2.4.1\`.

Flag as **HIGH** and reference the specific route/field change that qualifies as a breaking modification.`,
    },
    {
      name: 'deprecation-policy',
      description: 'Flags silent removal of public API surface without a prior deprecation notice or migration path.',
      type: 'convention' as const,
      source: 'extracted' as const,
      enabled: true,
      body: `# Deprecation Policy

**When to flag:** Any removal of a public endpoint, field, or parameter that was not previously marked as deprecated (via a header, annotation, or CHANGELOG note), or that lacks a migration comment explaining what callers should use instead.

### ✅ Good — deprecation notice added before removal
\`\`\`diff
+// @deprecated — use GET /v2/users instead. Removal planned for v4.0.
 app.get('/users', legacyHandler);
\`\`\`

### ❌ Bad — endpoint silently deleted, no notice
\`\`\`diff
-app.get('/reports/summary', summaryHandler);
\`\`\`
No deprecation warning was added in a prior release, no CHANGELOG entry, no migration path provided.

Flag as **HIGH**. The fix is either to restore and deprecate first, or to add a migration note to the PR description and CHANGELOG.`,
    },
  ];

  const apiContractSkillIds: string[] = [];
  for (const s of apiContractSkills) {
    const [existing] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, s.name)));
    if (existing) {
      apiContractSkillIds.push(existing.id);
    } else {
      const [inserted] = await db
        .insert(t.skills)
        .values({ workspaceId, ...s, version: 1 })
        .returning();
      apiContractSkillIds.push(inserted!.id);
    }
  }

  const apiContractAgentData = {
    workspaceId,
    name: 'API Contract Reviewer',
    description: 'Catches breaking changes in HTTP API contracts: removed routes, renamed fields, type changes, and missing deprecation notices.',
    provider: 'anthropic' as const,
    model: 'claude-haiku-4-5-20251001',
    systemPrompt: `You are an API contract reviewer specializing in backward compatibility. Your role is to catch breaking changes in HTTP APIs before they reach production.

For every changed file in the diff, apply the linked skills in order:
1. breaking-change — flag removed or renamed routes/params
2. response-schema — flag removed/changed response fields
3. semver-discipline — flag missing version bumps for breaking changes
4. deprecation-policy — flag silent removals without prior deprecation

Report each finding with:
- Severity: CRITICAL or HIGH
- Category: api-contract
- The before/after signatures so the reviewer can judge impact
- A concrete suggestion (restore + deprecate, or bump major version)

Focus exclusively on API contract integrity. Do not comment on code style, performance, or business logic unless it directly affects the public contract.`,
    repoIntel: false,
    enabled: true,
    version: 1,
    createdBy: userId,
  };

  let [apiAgent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'API Contract Reviewer')));
  if (!apiAgent) {
    [apiAgent] = await db.insert(t.agents).values(apiContractAgentData).returning();
  }

  if (apiAgent) {
    for (let i = 0; i < apiContractSkillIds.length; i++) {
      await db
        .insert(t.agentSkills)
        .values({ agentId: apiAgent.id, skillId: apiContractSkillIds[i]!, order: i })
        .onConflictDoNothing();
    }
  }

  // ---- demo eval cases for the control experiment ----
  // Skill 0: test-coverage-nudge — happy-path-only test (no error branch)
  const tcnSkillId = skillIds[0];
  const acgSkillId = skillIds[1];

  if (tcnSkillId) {
    const tcnCases = [
      {
        name: 'Happy-path only — missing error branch',
        notes: 'PR adds a chargeCard() function with success + failure paths but test only asserts the success case.',
        inputDiff: `diff --git a/src/payments/charge.ts b/src/payments/charge.ts
index 0000000..1111111 100644
--- a/src/payments/charge.ts
+++ b/src/payments/charge.ts
@@ -0,0 +1,18 @@
+export async function chargeCard(
+  customerId: string,
+  amountCents: number,
+): Promise<{ success: boolean; chargeId?: string; error?: string }> {
+  if (amountCents <= 0) {
+    return { success: false, error: 'Amount must be positive' };
+  }
+  try {
+    const charge = await stripe.charges.create({ customer: customerId, amount: amountCents });
+    return { success: true, chargeId: charge.id };
+  } catch (err) {
+    return { success: false, error: (err as Error).message };
+  }
+}
diff --git a/src/payments/charge.test.ts b/src/payments/charge.test.ts
index 0000000..2222222 100644
--- a/src/payments/charge.test.ts
+++ b/src/payments/charge.test.ts
@@ -0,0 +1,12 @@
+import { chargeCard } from './charge';
+import { stripe } from '../lib/stripe';
+
+vi.mock('../lib/stripe');
+
+describe('chargeCard', () => {
+  it('returns chargeId on success', async () => {
+    vi.mocked(stripe.charges.create).mockResolvedValueOnce({ id: 'ch_123' } as any);
+    const result = await chargeCard('cus_abc', 1000);
+    expect(result.success).toBe(true);
+    expect(result.chargeId).toBe('ch_123');
+  });
+});`,
        expectedOutput: { expected_finding_count: 2, category: 'test', severity: 'HIGH' },
      },
    ];
    for (const c of tcnCases) {
      const [ex] = await db
        .select()
        .from(t.evalCases)
        .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerId, tcnSkillId), eq(t.evalCases.name, c.name)));
      if (!ex) {
        await db.insert(t.evalCases).values({
          workspaceId,
          ownerKind: 'skill',
          ownerId: tcnSkillId,
          name: c.name,
          notes: c.notes,
          inputDiff: c.inputDiff,
          expectedOutput: c.expectedOutput,
        });
      }
    }
  }

  // Skill 1: api-contract-guard — breaking route signature change
  if (acgSkillId) {
    const acgCases = [
      {
        name: 'Breaking: route param renamed + required field added',
        notes: 'PR renames :id to :userId and adds required `reason` field — existing callers break without update.',
        inputDiff: `diff --git a/src/routes/users.ts b/src/routes/users.ts
index 0000000..3333333 100644
--- a/src/routes/users.ts
+++ b/src/routes/users.ts
@@ -1,15 +1,17 @@
 import { FastifyInstance } from 'fastify';

 export async function userRoutes(app: FastifyInstance) {
-  app.delete('/users/:id', async (req, reply) => {
-    const { id } = req.params as { id: string };
-    await db.users.delete(id);
+  app.delete('/users/:userId', async (req, reply) => {
+    const { userId } = req.params as { userId: string };
+    const { reason } = req.body as { reason: string };
+    if (!reason) return reply.status(400).send({ error: 'reason is required' });
+    await db.users.delete(userId, reason);
     return reply.status(204).send();
   });

-  app.get('/users', async (_req, reply) => {
+  app.get('/members', async (_req, reply) => {
     const users = await db.users.findAll();
-    return reply.send(users);
+    return reply.send({ data: users, total: users.length });
   });
 }`,
        expectedOutput: { expected_finding_count: 3, category: 'api', severity: 'CRITICAL' },
      },
    ];
    for (const c of acgCases) {
      const [ex] = await db
        .select()
        .from(t.evalCases)
        .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerId, acgSkillId), eq(t.evalCases.name, c.name)));
      if (!ex) {
        await db.insert(t.evalCases).values({
          workspaceId,
          ownerKind: 'skill',
          ownerId: acgSkillId,
          name: c.name,
          notes: c.notes,
          inputDiff: c.inputDiff,
          expectedOutput: c.expectedOutput,
        });
      }
    }
  }

  return { workspaceId, userId };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
