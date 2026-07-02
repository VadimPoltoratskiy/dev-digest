import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { conventions } from '../../db/schema/knowledge.js';

export type ConventionRow = typeof conventions.$inferSelect;

export interface InsertConventionCandidate {
  rule: string;
  evidencePath: string | null;
  evidenceSnippet: string | null;
  confidence: number | null;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  async listByRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(conventions)
      .where(and(eq(conventions.workspaceId, workspaceId), eq(conventions.repoId, repoId)));
  }

  async insertMany(
    workspaceId: string,
    repoId: string,
    candidates: InsertConventionCandidate[],
  ): Promise<ConventionRow[]> {
    if (candidates.length === 0) return [];
    return this.db
      .insert(conventions)
      .values(
        candidates.map((c) => ({
          workspaceId,
          repoId,
          rule: c.rule,
          evidencePath: c.evidencePath,
          evidenceSnippet: c.evidenceSnippet,
          confidence: c.confidence,
          accepted: false,
        })),
      )
      .returning();
  }

  async update(
    workspaceId: string,
    id: string,
    patch: { accepted?: boolean; rule?: string },
  ): Promise<ConventionRow | null> {
    const rows = await this.db
      .update(conventions)
      .set(patch)
      .where(and(eq(conventions.id, id), eq(conventions.workspaceId, workspaceId)))
      .returning();
    return rows[0] ?? null;
  }

  async deleteByRepo(workspaceId: string, repoId: string): Promise<void> {
    await this.db
      .delete(conventions)
      .where(and(eq(conventions.workspaceId, workspaceId), eq(conventions.repoId, repoId)));
  }

  async deleteOne(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(conventions)
      .where(and(eq(conventions.id, id), eq(conventions.workspaceId, workspaceId)))
      .returning({ id: conventions.id });
    return rows.length > 0;
  }
}
