import { inArray } from 'drizzle-orm';
import { createDb, type Db } from '../db/client.js';
import * as t from '../db/schema.js';

/**
 * One-off maintenance script: finds `skills` rows that share the same
 * (workspace_id, name) — a state that predates the unique index on that
 * pair — and deletes the ones with no `agent_skills` references, keeping
 * whichever duplicate is actually in use. Skips (and warns on) any group
 * where more than one duplicate is referenced, since picking a winner there
 * would be a guess.
 *
 * Usage:
 *   pnpm exec tsx src/scripts/dedupe-skills.ts            # dry run
 *   pnpm exec tsx src/scripts/dedupe-skills.ts --execute   # actually delete
 */
export async function dedupeSkills(db: Db, opts?: { dryRun?: boolean }): Promise<{ deleted: string[]; skippedGroups: number }> {
  const dryRun = opts?.dryRun ?? true;

  const allSkills = await db
    .select({ id: t.skills.id, workspaceId: t.skills.workspaceId, name: t.skills.name })
    .from(t.skills);

  const groups = new Map<string, { id: string; workspaceId: string; name: string }[]>();
  for (const row of allSkills) {
    const key = `${row.workspaceId}::${row.name}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const duplicateGroups = [...groups.values()].filter((g) => g.length > 1);
  if (duplicateGroups.length === 0) {
    console.log('No duplicate skills found.');
    return { deleted: [], skippedGroups: 0 };
  }

  const allIds = duplicateGroups.flatMap((g) => g.map((r) => r.id));
  const links = await db
    .select({ skillId: t.agentSkills.skillId })
    .from(t.agentSkills)
    .where(inArray(t.agentSkills.skillId, allIds));
  const referencedIds = new Set(links.map((l) => l.skillId));

  const toDelete: string[] = [];
  let skippedGroups = 0;

  for (const group of duplicateGroups) {
    const referenced = group.filter((r) => referencedIds.has(r.id));
    const unreferenced = group.filter((r) => !referencedIds.has(r.id));

    if (referenced.length > 1) {
      console.warn(
        `Skipping ambiguous group "${group[0]!.name}" (workspace ${group[0]!.workspaceId}): ` +
          `${referenced.length} duplicates are each linked to agents — cannot auto-pick a winner.`,
      );
      skippedGroups += 1;
      continue;
    }

    for (const row of unreferenced) toDelete.push(row.id);
    console.log(
      `Group "${group[0]!.name}" (workspace ${group[0]!.workspaceId}): ` +
        `${group.length} rows, keeping ${referenced.length || 1}, deleting ${unreferenced.length}.`,
    );
  }

  if (dryRun) {
    console.log(`Dry run — would delete ${toDelete.length} orphaned duplicate row(s). Re-run with --execute to apply.`);
    return { deleted: [], skippedGroups };
  }

  if (toDelete.length > 0) {
    await db.delete(t.skills).where(inArray(t.skills.id, toDelete));
  }
  console.log(`Deleted ${toDelete.length} orphaned duplicate row(s).`);
  return { deleted: toDelete, skippedGroups };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const execute = process.argv.includes('--execute');
  const handle = createDb(url);
  dedupeSkills(handle.db, { dryRun: !execute })
    .then(async (r) => {
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ dedupe failed:', err);
      await handle.close();
      process.exit(1);
    });
}
