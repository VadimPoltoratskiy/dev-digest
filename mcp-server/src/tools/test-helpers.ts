import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { vi } from 'vitest';
import type { DevDigestClient } from '../client.js';

/**
 * Captures the callback a `register*` function hands to `server.registerTool`,
 * without needing a real McpServer + transport. Lets tool tests call the
 * handler directly and inspect its CallToolResult.
 */
export function captureTool(register: (server: McpServer, client: DevDigestClient) => void, client: DevDigestClient) {
  let captured: { name: string; config: unknown; cb: (args: unknown) => Promise<{ content: { type: string; text: string }[] }> } | undefined;
  const fakeServer = {
    registerTool: (name: string, config: unknown, cb: (args: unknown) => Promise<unknown>) => {
      captured = { name, config, cb: cb as never };
    },
  } as unknown as McpServer;

  register(fakeServer, client);
  if (!captured) throw new Error('register function did not call server.registerTool');
  return captured;
}

export function mockClient(overrides: Partial<DevDigestClient> = {}): DevDigestClient {
  return {
    get: vi.fn() as DevDigestClient['get'],
    post: vi.fn() as DevDigestClient['post'],
    ...overrides,
  };
}

export async function invokeAndParse(
  captured: { cb: (args: unknown) => Promise<{ content: { type: string; text: string }[] }> },
  args: unknown = {},
) {
  const result = await captured.cb(args);
  return JSON.parse(result.content[0]!.text);
}
