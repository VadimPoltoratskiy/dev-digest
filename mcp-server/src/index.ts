import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { makeClient } from './client.js';
import { loadConfig } from './config.js';
import { registerGetBlastRadius } from './tools/get-blast-radius.js';
import { registerGetConventions } from './tools/get-conventions.js';
import { registerGetFindings } from './tools/get-findings.js';
import { registerListAgents } from './tools/list-agents.js';
import { registerRunAgent } from './tools/run-agent.js';

process.on('unhandledRejection', (err) => {
  process.stderr.write(`[devdigest-mcp] unhandled rejection: ${err}\n`);
  process.exit(1);
});

function loadConfigOrExit() {
  try {
    return loadConfig();
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues.map((i) => i.message).join('; ') : String(err);
    process.stderr.write(`[devdigest-mcp] invalid config: ${message}\n`);
    process.exit(1);
  }
}

async function main() {
  const { apiBaseUrl } = loadConfigOrExit();
  const client = makeClient(apiBaseUrl);

  const server = new McpServer({ name: 'devdigest', version: '0.0.0' });

  registerListAgents(server, client);
  registerRunAgent(server, client);
  registerGetFindings(server, client);
  registerGetConventions(server, client);
  registerGetBlastRadius(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
