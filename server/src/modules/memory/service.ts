/**
 * Memory service — orchestrates repository + embedder adapter.
 * Business logic layer: CRUD, write-time curation, embedding-on-write,
 * semantic/text search, retrieval policy, JSONL export, nightly curate.
 *
 * All embedder calls go through container.embedder() (DI — never direct import).
 * container.embedder() throws ConfigError when EMBEDDINGS_ENABLED=false;
 * every embed path wraps the call in try/catch and degrades gracefully.
 */

import type { MemoryRecord, MemoryItem, MemoryScope, MemoryKind } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { MemoryRepository } from './repository.js';
import {
  toMemoryRecord,
  curateContent,
  formatForInjection,
  buildMemoryJsonlLine,
} from './helpers.js';
import { CONFIDENCE_FLOOR, MEMORY_TOKEN_BUDGET_CHARS, RETRIEVAL_K } from './constants.js';

export interface ListMemoryFilters {
  scope?: MemoryScope;
  kind?: MemoryKind;
  repo?: string;
  freshness?: 'stale';
  q?: string;
}

export class MemoryService {
  private repo: MemoryRepository;

  constructor(private container: Container) {
    this.repo = new MemoryRepository(container.db);
  }

  /**
   * Create a memory record.
   * Runs the curate gate on content, inserts, then attempts embedding.
   * Embedding failure (ConfigError or network) degrades silently — the record
   * is persisted without an embedding and will be picked up by the nightly
   * curate job once embeddings are enabled.
   */
  async create(
    workspaceId: string,
    data: MemoryItem & { repoId?: string },
  ): Promise<MemoryRecord> {
    const content = curateContent(data.content);
    const row = await this.repo.insert(workspaceId, {
      repoId: data.repoId,
      scope: data.scope,
      kind: data.kind,
      content,
      confidence: data.confidence,
      sources: data.sources,
    });

    // Attempt embedding on write; catch ConfigError (disabled) and any other
    // embedder error — never fail the create because of a missing embedding.
    try {
      const embedder = await this.container.embedder();
      const [vec] = await embedder.embed([content]);
      if (vec) await this.repo.upsertEmbedding(row.id, vec);
    } catch {
      // ConfigError → embeddings disabled; any other error → degrade silently.
    }

    return toMemoryRecord(row);
  }

  /**
   * Partially update a memory record.
   * Re-curates content when it changes, re-embeds if content or any field changes.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: Partial<MemoryItem>,
  ): Promise<MemoryRecord | null> {
    const curatedPatch = {
      ...patch,
      ...(patch.content !== undefined ? { content: curateContent(patch.content) } : {}),
    };

    const row = await this.repo.update(workspaceId, id, curatedPatch);
    if (!row) return null;

    // Re-embed when content changes.
    if (curatedPatch.content !== undefined) {
      try {
        const embedder = await this.container.embedder();
        const [vec] = await embedder.embed([curatedPatch.content]);
        if (vec) await this.repo.upsertEmbedding(row.id, vec);
      } catch {
        // Degrade silently.
      }
    }

    return toMemoryRecord(row);
  }

  /** Delete a memory record. Returns false when not found / wrong workspace. */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteOne(workspaceId, id);
  }

  /**
   * List memory records with optional filters.
   * When ?q is present: attempts semantic search (ConfigError → text fallback).
   * Returns `search_mode` only when a query string was provided.
   */
  async list(
    workspaceId: string,
    filters: ListMemoryFilters,
  ): Promise<{ records: MemoryRecord[]; search_mode?: 'semantic' | 'text' }> {
    const hasQuery = filters.q !== undefined && filters.q.length > 0;

    if (hasQuery) {
      // Attempt semantic search; fall back to text on embedder absence/failure.
      try {
        const embedder = await this.container.embedder();
        const [embedding] = await embedder.embed([filters.q!]);
        if (!embedding) throw new Error('No embedding returned');
        const rows = await this.repo.searchSemantic(workspaceId, {
          embedding,
          scope: filters.scope,
          repoId: filters.repo,
          confidenceFloor: CONFIDENCE_FLOOR,
          limit: RETRIEVAL_K,
        });
        return { records: rows.map(toMemoryRecord), search_mode: 'semantic' };
      } catch {
        // ConfigError or embed failure — text search fallback.
        const rows = await this.repo.list(workspaceId, {
          scope: filters.scope,
          kind: filters.kind,
          repoId: filters.repo,
          freshness: filters.freshness,
          textQuery: filters.q,
        });
        return { records: rows.map(toMemoryRecord), search_mode: 'text' };
      }
    }

    const rows = await this.repo.list(workspaceId, {
      scope: filters.scope,
      kind: filters.kind,
      repoId: filters.repo,
      freshness: filters.freshness,
    });
    return { records: rows.map(toMemoryRecord) };
  }

  /**
   * Retrieve relevant memory for prompt injection (run-executor).
   * Policy: semantic search (top-K, confidence floor); ConfigError → text fallback.
   * Accumulates formatted strings until the token budget is reached.
   */
  async retrieve(
    workspaceId: string,
    repoId: string,
    diffText: string,
  ): Promise<{ strings: string[]; pulledIds: string[] }> {
    const empty = { strings: [] as string[], pulledIds: [] as string[] };
    let rows;

    try {
      const embedder = await this.container.embedder();
      const [embedding] = await embedder.embed([diffText]);
      if (!embedding) throw new Error('No embedding returned');
      rows = await this.repo.searchSemantic(workspaceId, {
        embedding,
        repoId,
        confidenceFloor: CONFIDENCE_FLOOR,
        limit: RETRIEVAL_K,
      });
    } catch {
      // ConfigError or embed failure — fall back to text search.
      const textQuery = diffText.slice(0, 200);
      if (!textQuery.trim()) return empty;
      rows = await this.repo.list(workspaceId, {
        textQuery,
        repoId,
      });
    }

    if (!rows || rows.length === 0) return empty;

    // Apply token budget: accumulate formatted strings up to MEMORY_TOKEN_BUDGET_CHARS.
    const strings: string[] = [];
    const pulledIds: string[] = [];
    let totalChars = 0;

    for (const row of rows) {
      const formatted = formatForInjection(row);
      if (totalChars + formatted.length > MEMORY_TOKEN_BUDGET_CHARS) break;
      strings.push(formatted);
      pulledIds.push(row.id);
      totalChars += formatted.length;
    }

    return { strings, pulledIds };
  }

  /**
   * Export all memory records for a workspace/repo as JSONL.
   * Each line is a MemoryItem-shaped JSON object (no id/timestamps).
   * Returns empty string when there are no rows.
   */
  async exportJsonl(workspaceId: string, repoId?: string): Promise<string> {
    const rows = await this.repo.exportRows(workspaceId, repoId);
    if (rows.length === 0) return '';
    return rows.map(buildMemoryJsonlLine).join('\n');
  }

  /**
   * Advance last_used_at on pulled memory records (AC-18).
   * Called fire-and-forget from the run executor after successful retrieval.
   * Workspace-scoped to prevent cross-workspace side-effects.
   */
  async bumpLastUsed(workspaceId: string, ids: string[]): Promise<void> {
    return this.repo.bumpLastUsed(workspaceId, ids);
  }

  /**
   * Nightly curate job (AC-27, AC-28).
   * Finds records without embeddings and embeds each one.
   * ConfigError → skips embedding for all rows but continues without error.
   * Callers (the cron script) log a summary; this method is fire-and-forget.
   */
  async curate(workspaceId?: string): Promise<void> {
    const rows = await this.repo.findUnembedded(workspaceId);
    if (rows.length === 0) return;

    let embedder;
    try {
      embedder = await this.container.embedder();
    } catch {
      // ConfigError — embeddings disabled; nothing to do.
      return;
    }

    for (const row of rows) {
      try {
        const [vec] = await embedder.embed([row.content]);
        if (vec) await this.repo.upsertEmbedding(row.id, vec);
      } catch {
        // Individual embedding failure; skip and continue.
      }
    }
  }
}
