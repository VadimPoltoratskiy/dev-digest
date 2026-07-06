import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalSecretsProvider } from '@devdigest/server/adapters/secrets/local.js';

/**
 * Path to the shared secrets file (mode 0600). Same location the server uses
 * (server/src/platform/config.ts → secretsPath).
 */
export const SECRETS_PATH = join(homedir(), '.devdigest', 'secrets.json');

/** dev-digest repo root (this file is at <root>/mcp-server/src/cli/secrets.ts). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * `.env` fallbacks, in order: the project root (as requested) then server/.env,
 * where the key currently lives (loaded by the server via dotenv). These are a
 * CLI convenience for developers who keep keys in .env rather than the secrets
 * file — checked only after the LocalSecretsProvider chain below.
 */
export const ENV_FILES = [join(REPO_ROOT, '.env'), join(REPO_ROOT, 'server', '.env')];

/** Minimal `.env` reader — returns `key`'s value from the first file that has it. */
export function keyFromEnvFiles(key: string, files: readonly string[] = ENV_FILES): string | undefined {
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue; // missing/unreadable → try the next candidate.
    }
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const withoutExport = line.startsWith('export ') ? line.slice(7) : line;
      const eq = withoutExport.indexOf('=');
      if (eq === -1) continue;
      if (withoutExport.slice(0, eq).trim() !== key) continue;
      const value = withoutExport.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (value) return value;
    }
  }
  return undefined;
}

/**
 * Resolve OPENROUTER_API_KEY. Order:
 *   1. LocalSecretsProvider — the shared chokepoint (~/.devdigest/secrets.json,
 *      then process.env), exactly as the server reads it.
 *   2. `.env` fallback (project root, then server/.env) for devs who keep the
 *      key there instead of the secrets file.
 */
export async function getOpenRouterKey(): Promise<string | undefined> {
  const secrets = new LocalSecretsProvider(SECRETS_PATH);
  const fromChokepoint = await secrets.get('OPENROUTER_API_KEY');
  return fromChokepoint ?? keyFromEnvFiles('OPENROUTER_API_KEY');
}
