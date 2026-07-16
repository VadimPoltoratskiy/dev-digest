import { z } from 'zod';
import { DEFAULT_BASE_URL } from './client.js';

/**
 * Zod-validated environment config for the MCP server. Loaded once at startup so
 * a malformed value fails fast with a clear message instead of surfacing later as
 * an obscure fetch failure. Mirrors the server package's platform/config.ts.
 *
 * DEVDIGEST_API_URL is optional: unset falls through to DEFAULT_BASE_URL; a value
 * that is present but not a valid URL is rejected here.
 */
const EnvSchema = z.object({
  DEVDIGEST_API_URL: z.string().url().optional(),
});

export type McpConfig = {
  /** Base URL of the DevDigest API the MCP tools talk to. */
  apiBaseUrl: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const parsed = EnvSchema.parse(env);
  return {
    apiBaseUrl: parsed.DEVDIGEST_API_URL ?? DEFAULT_BASE_URL,
  };
}
