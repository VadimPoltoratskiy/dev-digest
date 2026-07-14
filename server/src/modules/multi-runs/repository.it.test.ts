/**
 * Integration tests for server/src/modules/multi-runs/repository.ts
 *
 * Test intentions:
 * 1. insertMultiRun
 *    - happy path: inserts row → returns a UUID string id
 * 2. findMultiRunById
 *    - found (same workspace) → returns data including prNumber from LEFT JOIN
 *    - wrong workspace → returns undefined (workspace-scoping)
 *    - wrong id → returns undefined
 * 3. getAgentRunsByMultiRunId
 *    - 2 agent_runs linked to multi-run → returns both
 *    - no agent_runs → returns []
 * 4. getLastNRunsPerAgent
 *    - only returns status='done' rows with non-null cost_usd AND duration_ms
 *    - rows ordered DESC by ran_at (latest first)
 *    - status='running' or null cost/duration rows are excluded
 * 5. getLastFindingSummaryPerAgent
 *    - returns most recent review summary for each agent
 *    - agent with no reviews → absent from result
 * 6. getReviewsAndFindingsByAgentRunIds
 *    - run with findings → returns findings in mapped rows
 *    - run with no findings → returns one row per review with finding=null
 *    - mocks needed: real postgres via testcontainers (startPg)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';
import {
  insertMultiRun,
  findMultiRunById,
  getAgentRunsByMultiRunId,
  getLastNRunsPerAgent,
  getLastFindingSummaryPerAgent,
  getReviewsAndFindingsByAgentRunIds,
  findMultiRuns,
  getAgentRunsForMultiRunIds,
} from './repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

type Db = PgFixture['handle']['db'];

// ---------------------------------------------------------------------------
// Shared test-fixture helpers
// ---------------------------------------------------------------------------

let seq = 0;

async function makeWorkspaceAndRepo(db: Db) {
  const [ws] = await db.insert(t.workspaces).values({ name: `ws-mr-${seq++}` }).returning();
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId: ws!.id, owner: 'acme', name: `repo-${seq}`, fullName: `acme/repo-${seq}` })
    .returning();
  return { workspaceId: ws!.id, repo: repo! };
}

async function makePr(db: Db, workspaceId: string, repoId: string, prNumber = 100) {
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId,
      number: prNumber,
      title: 'Test PR',
      author: 'alice',
      branch: 'feat/test',
      base: 'main',
      headSha: 'abc123',
      additions: 10,
      deletions: 5,
      filesCount: 2,
      status: 'needs_review',
      body: 'A test PR.',
    })
    .returning();
  return pr!;
}

async function makeAgent(db: Db, workspaceId: string, name = `agent-${seq++}`) {
  const [agent] = await db
    .insert(t.agents)
    .values({
      workspaceId,
      name,
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'You are a reviewer.',
      enabled: true,
    })
    .returning();
  return agent!;
}

async function makeAgentRun(
  db: Db,
  opts: {
    workspaceId: string;
    agentId?: string | null;
    prId?: string | null;
    status?: string;
    costUsd?: string | null;
    durationMs?: number | null;
    multiAgentRunId?: string | null;
    ranAt?: Date;
  },
) {
  const [run] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId: opts.workspaceId,
      agentId: opts.agentId ?? null,
      prId: opts.prId ?? null,
      status: opts.status ?? 'running',
      costUsd: opts.costUsd ?? null,
      durationMs: opts.durationMs ?? null,
      multiAgentRunId: opts.multiAgentRunId ?? null,
      ranAt: opts.ranAt ?? new Date(),
    })
    .returning();
  return run!;
}

// ---------------------------------------------------------------------------
// Integration suite (Testcontainers)
// ---------------------------------------------------------------------------

d('multi-runs repository (Testcontainers pg)', () => {
  let pg: PgFixture;
  let wsId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [seededWs] = await pg.handle.db.select().from(t.workspaces);
    wsId = seededWs!.id;
    const [seededRepo] = await pg.handle.db.select().from(t.repos);
    repoId = seededRepo!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  // -------------------------------------------------------------------------
  // 1. insertMultiRun
  // -------------------------------------------------------------------------
  describe('insertMultiRun', () => {
    it('inserts a multi_agent_runs row and returns its UUID id', async () => {
      const { workspaceId, repo } = await makeWorkspaceAndRepo(pg.handle.db);
      const pr = await makePr(pg.handle.db, workspaceId, repo.id);

      const id = await insertMultiRun(pg.handle.db, { workspaceId, prId: pr.id });

      expect(typeof id).toBe('string');
      // UUID v4 format
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

      // Verify row actually exists in DB
      const [row] = await pg.handle.db
        .select()
        .from(t.multiAgentRuns);
      expect(row).toBeDefined();
      expect(id).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // 2. findMultiRunById
  // -------------------------------------------------------------------------
  describe('findMultiRunById', () => {
    it('returns the multi-run row with prNumber when found in the same workspace', async () => {
      const { workspaceId, repo } = await makeWorkspaceAndRepo(pg.handle.db);
      const pr = await makePr(pg.handle.db, workspaceId, repo.id, 42);
      const multiRunId = await insertMultiRun(pg.handle.db, { workspaceId, prId: pr.id });

      const result = await findMultiRunById(pg.handle.db, workspaceId, multiRunId);

      expect(result).toBeDefined();
      expect(result!.id).toBe(multiRunId);
      expect(result!.prId).toBe(pr.id);
      expect(result!.prNumber).toBe(42);
      expect(result!.ranAt).toBeInstanceOf(Date);
    });

    it('returns undefined when workspaceId belongs to a different workspace (workspace-scoping)', async () => {
      const { workspaceId: wsA, repo: repoA } = await makeWorkspaceAndRepo(pg.handle.db);
      const { workspaceId: wsB } = await makeWorkspaceAndRepo(pg.handle.db);

      const pr = await makePr(pg.handle.db, wsA, repoA.id);
      const multiRunId = await insertMultiRun(pg.handle.db, { workspaceId: wsA, prId: pr.id });

      // Query from workspace B — must not see workspace A's multi-run
      const result = await findMultiRunById(pg.handle.db, wsB, multiRunId);
      expect(result).toBeUndefined();
    });

    it('returns undefined when the multi-run id does not exist', async () => {
      const result = await findMultiRunById(
        pg.handle.db,
        wsId,
        '00000000-0000-0000-0000-000000000000',
      );
      expect(result).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 3. getAgentRunsByMultiRunId
  // -------------------------------------------------------------------------
  describe('getAgentRunsByMultiRunId', () => {
    it('returns all agent_runs linked to a multi-run with their agent names', async () => {
      const { workspaceId, repo } = await makeWorkspaceAndRepo(pg.handle.db);
      const pr = await makePr(pg.handle.db, workspaceId, repo.id);
      const agentA = await makeAgent(pg.handle.db, workspaceId, 'AgentAlpha');
      const agentB = await makeAgent(pg.handle.db, workspaceId, 'AgentBeta');

      const multiRunId = await insertMultiRun(pg.handle.db, { workspaceId, prId: pr.id });

      await makeAgentRun(pg.handle.db, {
        workspaceId,
        agentId: agentA.id,
        prId: pr.id,
        status: 'done',
        multiAgentRunId: multiRunId,
      });
      await makeAgentRun(pg.handle.db, {
        workspaceId,
        agentId: agentB.id,
        prId: pr.id,
        status: 'failed',
        multiAgentRunId: multiRunId,
      });

      const rows = await getAgentRunsByMultiRunId(pg.handle.db, multiRunId);

      expect(rows).toHaveLength(2);
      const names = rows.map((r) => r.agentName).sort();
      expect(names).toEqual(['AgentAlpha', 'AgentBeta']);
      const statuses = rows.map((r) => r.status).sort();
      expect(statuses).toEqual(['done', 'failed']);
    });

    it('returns [] when no agent_runs exist for the multi-run', async () => {
      const { workspaceId, repo } = await makeWorkspaceAndRepo(pg.handle.db);
      const pr = await makePr(pg.handle.db, workspaceId, repo.id);
      const multiRunId = await insertMultiRun(pg.handle.db, { workspaceId, prId: pr.id });

      const rows = await getAgentRunsByMultiRunId(pg.handle.db, multiRunId);
      expect(rows).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 4. getLastNRunsPerAgent
  // -------------------------------------------------------------------------
  describe('getLastNRunsPerAgent', () => {
    it('returns only status=done rows with non-null cost_usd AND duration_ms', async () => {
      const { workspaceId, repo } = await makeWorkspaceAndRepo(pg.handle.db);
      const pr = await makePr(pg.handle.db, workspaceId, repo.id);
      const agent = await makeAgent(pg.handle.db, workspaceId);

      // 1 done run with cost + duration (should be included)
      await makeAgentRun(pg.handle.db, {
        workspaceId,
        agentId: agent.id,
        prId: pr.id,
        status: 'done',
        costUsd: '0.01',
        durationMs: 3000,
      });
      // running status (should be excluded)
      await makeAgentRun(pg.handle.db, {
        workspaceId,
        agentId: agent.id,
        prId: pr.id,
        status: 'running',
        costUsd: '0.01',
        durationMs: 2000,
      });
      // done but null cost (should be excluded)
      await makeAgentRun(pg.handle.db, {
        workspaceId,
        agentId: agent.id,
        prId: pr.id,
        status: 'done',
        costUsd: null,
        durationMs: 2000,
      });
      // done but null duration (should be excluded)
      await makeAgentRun(pg.handle.db, {
        workspaceId,
        agentId: agent.id,
        prId: pr.id,
        status: 'done',
        costUsd: '0.02',
        durationMs: null,
      });

      const rows = await getLastNRunsPerAgent(pg.handle.db, workspaceId, [agent.id]);

      expect(rows).toHaveLength(1);
      expect(rows[0]!.agentId).toBe(agent.id);
      expect(rows[0]!.costUsd).toBe('0.01000000');
      expect(rows[0]!.durationMs).toBe(3000);
    });

    it('returns rows ordered DESC by ran_at (latest first)', async () => {
      const { workspaceId, repo } = await makeWorkspaceAndRepo(pg.handle.db);
      const pr = await makePr(pg.handle.db, workspaceId, repo.id);
      const agent = await makeAgent(pg.handle.db, workspaceId);

      const older = new Date('2026-01-01T00:00:00Z');
      const newer = new Date('2026-06-01T00:00:00Z');

      await makeAgentRun(pg.handle.db, {
        workspaceId,
        agentId: agent.id,
        prId: pr.id,
        status: 'done',
        costUsd: '0.01',
        durationMs: 1000,
        ranAt: older,
      });
      await makeAgentRun(pg.handle.db, {
        workspaceId,
        agentId: agent.id,
        prId: pr.id,
        status: 'done',
        costUsd: '0.02',
        durationMs: 2000,
        ranAt: newer,
      });

      const rows = await getLastNRunsPerAgent(pg.handle.db, workspaceId, [agent.id]);

      expect(rows).toHaveLength(2);
      // First row should be the newer one (DESC order)
      expect(rows[0]!.durationMs).toBe(2000);
      expect(rows[1]!.durationMs).toBe(1000);
    });

    it('returns [] when agentIds is empty', async () => {
      const { workspaceId } = await makeWorkspaceAndRepo(pg.handle.db);
      const rows = await getLastNRunsPerAgent(pg.handle.db, workspaceId, []);
      expect(rows).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 5. getLastFindingSummaryPerAgent
  // -------------------------------------------------------------------------
  describe('getLastFindingSummaryPerAgent', () => {
    it('returns summary from the most recent review for the agent', async () => {
      const { workspaceId, repo } = await makeWorkspaceAndRepo(pg.handle.db);
      const pr = await makePr(pg.handle.db, workspaceId, repo.id);
      const agent = await makeAgent(pg.handle.db, workspaceId);

      // Create two agent_runs, one older and one newer
      const runOld = await makeAgentRun(pg.handle.db, {
        workspaceId,
        agentId: agent.id,
        prId: pr.id,
        status: 'done',
        ranAt: new Date('2026-01-01T00:00:00Z'),
      });
      const runNew = await makeAgentRun(pg.handle.db, {
        workspaceId,
        agentId: agent.id,
        prId: pr.id,
        status: 'done',
        ranAt: new Date('2026-06-01T00:00:00Z'),
      });

      // Insert reviews for both
      await pg.handle.db.insert(t.reviews).values({
        workspaceId,
        prId: pr.id,
        agentId: agent.id,
        runId: runOld.id,
        kind: 'review',
        verdict: 'comment',
        summary: 'Old summary',
        score: 50,
        model: 'gpt-4.1',
      });
      await pg.handle.db.insert(t.reviews).values({
        workspaceId,
        prId: pr.id,
        agentId: agent.id,
        runId: runNew.id,
        kind: 'review',
        verdict: 'comment',
        summary: 'Newer summary',
        score: 60,
        model: 'gpt-4.1',
      });

      const rows = await getLastFindingSummaryPerAgent(pg.handle.db, workspaceId, [agent.id]);

      expect(rows.length).toBeGreaterThanOrEqual(1);
      // The first row (ordered DESC) should have the newer summary
      const agentRows = rows.filter((r) => r.agentId === agent.id);
      expect(agentRows[0]!.summary).toBe('Newer summary');
    });

    it('returns [] when agentIds is empty', async () => {
      const { workspaceId } = await makeWorkspaceAndRepo(pg.handle.db);
      const rows = await getLastFindingSummaryPerAgent(pg.handle.db, workspaceId, []);
      expect(rows).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 6. getReviewsAndFindingsByAgentRunIds
  // -------------------------------------------------------------------------
  describe('getReviewsAndFindingsByAgentRunIds', () => {
    it('returns finding rows mapped to agentRunId when findings exist', async () => {
      const { workspaceId, repo } = await makeWorkspaceAndRepo(pg.handle.db);
      const pr = await makePr(pg.handle.db, workspaceId, repo.id);
      const agent = await makeAgent(pg.handle.db, workspaceId, 'FindingAgent');

      const run = await makeAgentRun(pg.handle.db, {
        workspaceId,
        agentId: agent.id,
        prId: pr.id,
        status: 'done',
      });

      const [review] = await pg.handle.db
        .insert(t.reviews)
        .values({
          workspaceId,
          prId: pr.id,
          agentId: agent.id,
          runId: run.id,
          kind: 'review',
          verdict: 'request_changes',
          summary: 'Critical finding',
          score: 20,
          model: 'gpt-4.1',
        })
        .returning();

      await pg.handle.db.insert(t.findings).values({
        reviewId: review!.id,
        file: 'src/index.ts',
        startLine: 10,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'SQL injection',
        rationale: 'User input not sanitized.',
        confidence: 0.9,
        kind: 'finding',
      });

      const rows = await getReviewsAndFindingsByAgentRunIds(pg.handle.db, [run.id]);

      expect(rows.length).toBeGreaterThanOrEqual(1);
      const withFinding = rows.filter((r) => r.finding !== null);
      expect(withFinding).toHaveLength(1);
      expect(withFinding[0]!.agentRunId).toBe(run.id);
      expect(withFinding[0]!.agentName).toBe('FindingAgent');
      expect(withFinding[0]!.finding!.file).toBe('src/index.ts');
      expect(withFinding[0]!.finding!.title).toBe('SQL injection');
    });

    it('returns a row with finding=null when the review has no findings', async () => {
      const { workspaceId, repo } = await makeWorkspaceAndRepo(pg.handle.db);
      const pr = await makePr(pg.handle.db, workspaceId, repo.id);
      const agent = await makeAgent(pg.handle.db, workspaceId, 'NoFindingAgent');

      const run = await makeAgentRun(pg.handle.db, {
        workspaceId,
        agentId: agent.id,
        prId: pr.id,
        status: 'done',
      });

      // Review with no findings
      await pg.handle.db.insert(t.reviews).values({
        workspaceId,
        prId: pr.id,
        agentId: agent.id,
        runId: run.id,
        kind: 'review',
        verdict: 'approve',
        summary: 'LGTM',
        score: 100,
        model: 'gpt-4.1',
      });

      const rows = await getReviewsAndFindingsByAgentRunIds(pg.handle.db, [run.id]);

      expect(rows.length).toBeGreaterThanOrEqual(1);
      // All rows for this run have finding=null
      const runRows = rows.filter((r) => r.agentRunId === run.id);
      expect(runRows.every((r) => r.finding === null)).toBe(true);
    });

    it('returns [] when agentRunIds is empty', async () => {
      const rows = await getReviewsAndFindingsByAgentRunIds(pg.handle.db, []);
      expect(rows).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 7. findMultiRuns
  // -------------------------------------------------------------------------
  describe('findMultiRuns', () => {
    it('returns an empty array for a repo with no multi-runs', async () => {
      const { workspaceId, repo } = await makeWorkspaceAndRepo(pg.handle.db);

      const rows = await findMultiRuns(pg.handle.db, workspaceId, repo.id, { limit: 20, offset: 0 });
      expect(rows).toHaveLength(0);
    });

    it('returns rows ordered by ranAt DESC (newest first)', async () => {
      const { workspaceId, repo } = await makeWorkspaceAndRepo(pg.handle.db);
      const pr = await makePr(pg.handle.db, workspaceId, repo.id);

      // Insert two multi-runs. The DB sets ranAt to now() on insert;
      // to guarantee ordering, insert them sequentially and rely on DESC order.
      const idA = await insertMultiRun(pg.handle.db, { workspaceId, prId: pr.id });
      // Small pause to ensure different ranAt timestamps
      await new Promise((r) => setTimeout(r, 50));
      const idB = await insertMultiRun(pg.handle.db, { workspaceId, prId: pr.id });

      const rows = await findMultiRuns(pg.handle.db, workspaceId, repo.id, { limit: 20, offset: 0 });

      // idB was inserted later → should appear first in DESC order
      expect(rows.length).toBeGreaterThanOrEqual(2);
      const ownedRows = rows.filter((r) => r.id === idA || r.id === idB);
      expect(ownedRows[0]!.id).toBe(idB);
      expect(ownedRows[1]!.id).toBe(idA);
    });

    it('total reflects full count when result set is larger than the page', async () => {
      const { workspaceId, repo } = await makeWorkspaceAndRepo(pg.handle.db);
      const pr = await makePr(pg.handle.db, workspaceId, repo.id);

      // Insert 3 runs
      await insertMultiRun(pg.handle.db, { workspaceId, prId: pr.id });
      await insertMultiRun(pg.handle.db, { workspaceId, prId: pr.id });
      await insertMultiRun(pg.handle.db, { workspaceId, prId: pr.id });

      // Fetch with limit=1 — only 1 row returned but total should be 3
      const rows = await findMultiRuns(pg.handle.db, workspaceId, repo.id, { limit: 1, offset: 0 });

      expect(rows).toHaveLength(1);
      // COUNT(*) OVER() returns a bigint string at runtime — coerce to verify
      expect(Number(rows[0]!.total)).toBe(3);
    });

    it('filters by repoId — runs for a different repo in the same workspace are excluded', async () => {
      const { workspaceId, repo: repoA } = await makeWorkspaceAndRepo(pg.handle.db);
      const [repoB] = await pg.handle.db
        .insert(t.repos)
        .values({ workspaceId, owner: 'acme', name: `repo-b-${seq++}`, fullName: `acme/repo-b-${seq}` })
        .returning();

      const prA = await makePr(pg.handle.db, workspaceId, repoA.id, 200);
      const prB = await makePr(pg.handle.db, workspaceId, repoB!.id, 201);

      await insertMultiRun(pg.handle.db, { workspaceId, prId: prA.id });
      await insertMultiRun(pg.handle.db, { workspaceId, prId: prB!.id });

      const rowsA = await findMultiRuns(pg.handle.db, workspaceId, repoA.id, { limit: 20, offset: 0 });
      const rowsB = await findMultiRuns(pg.handle.db, workspaceId, repoB!.id, { limit: 20, offset: 0 });

      // repoA rows should only contain the run for prA
      expect(rowsA.every((r) => r.prId === prA.id)).toBe(true);
      // repoB rows should only contain the run for prB
      expect(rowsB.every((r) => r.prId === prB!.id)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 8. getAgentRunsForMultiRunIds
  // -------------------------------------------------------------------------
  describe('getAgentRunsForMultiRunIds', () => {
    it('returns [] when multiRunIds is empty', async () => {
      const rows = await getAgentRunsForMultiRunIds(pg.handle.db, []);
      expect(rows).toHaveLength(0);
    });

    it('returns agent_runs rows for the given multiRunIds', async () => {
      const { workspaceId, repo } = await makeWorkspaceAndRepo(pg.handle.db);
      const pr = await makePr(pg.handle.db, workspaceId, repo.id);
      const agent = await makeAgent(pg.handle.db, workspaceId);
      const multiRunId = await insertMultiRun(pg.handle.db, { workspaceId, prId: pr.id });

      await makeAgentRun(pg.handle.db, {
        workspaceId,
        agentId: agent.id,
        prId: pr.id,
        status: 'done',
        costUsd: '0.01',
        durationMs: 3000,
        multiAgentRunId: multiRunId,
      });

      const rows = await getAgentRunsForMultiRunIds(pg.handle.db, [multiRunId]);

      expect(rows.length).toBeGreaterThanOrEqual(1);
      const ownedRows = rows.filter((r) => r.multiRunId === multiRunId);
      expect(ownedRows).toHaveLength(1);
      expect(ownedRows[0]!.status).toBe('done');
      expect(ownedRows[0]!.costUsd).toBe('0.01000000');
      expect(ownedRows[0]!.durationMs).toBe(3000);
    });
  });
});
