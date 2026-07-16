/**
 * Nightly memory curate script (AC-27, AC-28).
 *
 * Finds all memory records without an embedding and embeds each one using
 * the configured OpenAI embedder. When EMBEDDINGS_ENABLED=false (the default),
 * MemoryService.curate() catches the ConfigError from container.embedder() and
 * returns immediately — the script still exits 0, satisfying AC-28.
 *
 * Usage:
 *   cd server && npx tsx src/scripts/curate-memory.ts
 *
 * Scheduling: invoke this via a system cron entry or a GitHub Actions
 * `schedule:` workflow. Adding/modifying a CI workflow requires explicit
 * approval per CLAUDE.md — scheduling is intentionally out of scope here.
 */

import { createDb } from '../db/client.js';
import { loadConfig } from '../platform/config.js';
import { Container } from '../platform/container.js';
import { MemoryService } from '../modules/memory/service.js';

async function main() {
  const config = loadConfig();
  const handle = createDb(config.databaseUrl);
  const container = new Container(config, handle.db);
  const svc = new MemoryService(container);

  try {
    await svc.curate();
    console.log('[curate-memory] done');
  } finally {
    await handle.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[curate-memory] error:', err);
    process.exit(1);
  });
