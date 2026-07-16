/**
 * Memory repository — Drizzle queries only.
 * Returns raw typed rows; no DTO conversion, no business logic.
 *
 * Business-logic conditions (freshness threshold, confidence floor, token
 * budget) are passed in as parameters by MemoryService, not computed here.
 */

import { and, eq, ilike, inArray, isNull, isNotNull, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { memory } from '../../db/schema/knowledge.js';
import { STALE_DAYS } from './constants.js';

export type MemoryRow = typeof memory.$inferSelect;

/** Derive enum types directly from the Drizzle schema to keep them in sync. */
type MemoryScope = MemoryRow['scope']; // 'repo' | 'global' | 'team'
type MemoryKind = MemoryRow['kind'];   // 'decision' | 'convention' | 'preference' | 'fact' | 'learning'

export interface ListMemoryOpts {
  scope?: MemoryScope;
  kind?: MemoryKind;
  repoId?: string;
  /**
   * When 'stale' — skip the freshness predicate and return all records.
   * When undefined (default) — exclude rows inactive for more than STALE_DAYS.
   */
  freshness?: 'stale';
  textQuery?: string;
  limit?: number;
}

export interface SemanticSearchOpts {
  embedding: number[];
  scope?: MemoryScope;
  repoId?: string;
  confidenceFloor: number;
  limit: number;
}

export interface InsertMemoryData {
  repoId?: string;
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  confidence: number;
  sources: unknown[];
  embedding?: number[];
}

/** SQL expression for records that are fresh within STALE_DAYS.
 *  STALE_DAYS is bound as a parameter (not sql.raw) to avoid any raw-string interpolation. */
const freshnessCond = sql`(
  ${memory.lastUsedAt} > now() - (${STALE_DAYS} * interval '1 day')
  OR (
    ${memory.lastUsedAt} IS NULL
    AND ${memory.updatedAt} > now() - (${STALE_DAYS} * interval '1 day')
  )
)`;

export class MemoryRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string, opts: ListMemoryOpts = {}): Promise<MemoryRow[]> {
    const conds = [
      eq(memory.workspaceId, workspaceId),
      opts.scope !== undefined ? eq(memory.scope, opts.scope) : undefined,
      opts.kind !== undefined ? eq(memory.kind, opts.kind) : undefined,
      opts.repoId !== undefined ? eq(memory.repoId, opts.repoId) : undefined,
      opts.textQuery !== undefined ? ilike(memory.content, `%${opts.textQuery}%`) : undefined,
      opts.freshness !== 'stale' ? freshnessCond : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);

    let q = this.db
      .select()
      .from(memory)
      .where(and(...conds))
      .$dynamic();

    if (opts.limit !== undefined) {
      q = q.limit(opts.limit);
    }

    return q;
  }

  async getById(workspaceId: string, id: string): Promise<MemoryRow | null> {
    const [row] = await this.db
      .select()
      .from(memory)
      .where(and(eq(memory.workspaceId, workspaceId), eq(memory.id, id)));
    return row ?? null;
  }

  async insert(workspaceId: string, data: InsertMemoryData): Promise<MemoryRow> {
    const [row] = await this.db
      .insert(memory)
      .values({
        workspaceId,
        repoId: data.repoId ?? null,
        scope: data.scope,
        kind: data.kind,
        content: data.content,
        confidence: data.confidence,
        sources: data.sources,
        embedding: data.embedding,
      })
      .returning();
    return row!;
  }

  async update(
    workspaceId: string,
    id: string,
    patch: Partial<Pick<MemoryRow, 'content' | 'scope' | 'kind' | 'confidence' | 'sources'>>,
  ): Promise<MemoryRow | null> {
    const rows = await this.db
      .update(memory)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(memory.id, id), eq(memory.workspaceId, workspaceId)))
      .returning();
    return rows[0] ?? null;
  }

  async deleteOne(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(memory)
      .where(and(eq(memory.id, id), eq(memory.workspaceId, workspaceId)))
      .returning({ id: memory.id });
    return rows.length > 0;
  }

  async bumpLastUsed(workspaceId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(memory)
      .set({ lastUsedAt: new Date() })
      .where(and(eq(memory.workspaceId, workspaceId), inArray(memory.id, ids)));
  }

  async upsertEmbedding(id: string, embedding: number[]): Promise<void> {
    await this.db
      .update(memory)
      .set({ embedding })
      .where(eq(memory.id, id));
  }

  /**
   * Vector similarity search via pgvector cosine distance (<->).
   * Returns rows ordered by ascending distance (most similar first).
   * Sequential scan is acceptable at low row counts; add HNSW index for scale.
   */
  async searchSemantic(workspaceId: string, opts: SemanticSearchOpts): Promise<MemoryRow[]> {
    // Represent the query vector as a postgres vector literal '[x,y,z,...]'
    const vectorStr = `[${opts.embedding.join(',')}]`;

    const conds = [
      eq(memory.workspaceId, workspaceId),
      isNotNull(memory.embedding),
      // Confidence is stored as nullable doublePrecision; treat null as 0.
      sql`coalesce(${memory.confidence}, 0) >= ${opts.confidenceFloor}`,
      opts.scope !== undefined ? eq(memory.scope, opts.scope) : undefined,
      // When repoId is provided: include records with this repo OR with no repo
      // (global/team-scoped records that apply workspace-wide).
      opts.repoId !== undefined
        ? or(eq(memory.repoId, opts.repoId), isNull(memory.repoId))
        : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);

    return this.db
      .select()
      .from(memory)
      .where(and(...conds))
      .orderBy(sql`${memory.embedding} <-> ${vectorStr}::vector`)
      .limit(opts.limit);
  }

  async exportRows(workspaceId: string, repoId?: string): Promise<MemoryRow[]> {
    const conds = [
      eq(memory.workspaceId, workspaceId),
      // When repoId is supplied: include repo-scoped records for this repo
      // PLUS global/team records (which have repo_id = null and are workspace-wide).
      // This prevents cross-repo leakage while keeping non-repo-scoped memory.
      repoId !== undefined
        ? or(eq(memory.repoId, repoId), inArray(memory.scope, ['global', 'team']))
        : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);

    return this.db
      .select()
      .from(memory)
      .where(and(...conds));
  }

  async findUnembedded(workspaceId?: string): Promise<MemoryRow[]> {
    const conds = [
      isNull(memory.embedding),
      workspaceId !== undefined ? eq(memory.workspaceId, workspaceId) : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);

    return this.db
      .select()
      .from(memory)
      .where(and(...conds));
  }
}
