import { eq, and } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { onboarding } from '../../db/schema/context.js';
import { repos } from '../../db/schema/repos.js';

/**
 * Data access for the `onboarding` table and repo clone-path look-up.
 * Returns raw DB types only — no DTO conversion or business logic.
 */
export class OnboardingRepository {
  constructor(private db: Db) {}

  async findByRepoId(repoId: string): Promise<{ json: unknown; generatedAt: Date } | null> {
    const [row] = await this.db
      .select({ json: onboarding.json, generatedAt: onboarding.generatedAt })
      .from(onboarding)
      .where(eq(onboarding.repoId, repoId));
    if (!row) return null;
    return { json: row.json, generatedAt: row.generatedAt };
  }

  /**
   * INSERT … ON CONFLICT (repo_id) DO UPDATE SET json, generated_at.
   * Returns the persisted generatedAt timestamp.
   */
  async upsert(repoId: string, json: unknown): Promise<Date> {
    const generatedAt = new Date();
    await this.db
      .insert(onboarding)
      .values({ repoId, json, generatedAt })
      .onConflictDoUpdate({
        target: onboarding.repoId,
        set: { json, generatedAt },
      });
    return generatedAt;
  }

  /**
   * Returns the clone_path for a repo scoped to a workspace.
   * Returns null when the repo does not exist or belongs to a different workspace.
   */
  async getClonePath(repoId: string, workspaceId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ clonePath: repos.clonePath })
      .from(repos)
      .where(and(eq(repos.id, repoId), eq(repos.workspaceId, workspaceId)));
    if (!row) return null;
    return row.clonePath ?? null;
  }
}
