import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DEFAULT_BASE_URL, makeClient } from './client.js';
import { registerGetBlastRadius } from './tools/get-blast-radius.js';
import { registerGetConventions } from './tools/get-conventions.js';
import { registerGetFindings } from './tools/get-findings.js';
import { registerGetMemory } from './tools/get-memory.js';
import { registerListAgents } from './tools/list-agents.js';
import { registerRunAgent } from './tools/run-agent.js';

process.on('unhandledRejection', (err) => {
  process.stderr.write(`[devdigest-mcp] unhandled rejection: ${err}\n`);
  process.exit(1);
});

async function main() {
  const baseUrl = process.env['DEVDIGEST_API_URL'] ?? DEFAULT_BASE_URL;
  const client = makeClient(baseUrl);

  const server = new McpServer({ name: 'devdigest', version: '0.0.0' });

  registerListAgents(server, client);
  registerRunAgent(server, client);
  registerGetFindings(server, client);
  registerGetConventions(server, client);
  registerGetMemory(server, client);
  registerGetBlastRadius(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
