#!/usr/bin/env node
/**
 * PostToolUse hook — mark that dev-digest functionality was used this session.
 *
 * Fires after any dev-digest MCP tool call (`mcp__devdigest__*`: run_agent,
 * get_findings, list_agents, get_conventions, get_blast_radius, …). Drops a
 * per-session marker file in os.tmpdir() keyed by `payload.session_id`. The Stop
 * hook (stop-engineering-insights.mjs) reads this marker so a session that
 * exercised dev-digest functionality is nudged to run /engineering-insights at
 * session end — even if it never dirtied the working tree.
 *
 * This hook NEVER blocks: it always exits 0. The settings.json matcher already
 * scopes it to mcp__devdigest__* tools, but the script re-checks tool_name so a
 * broader matcher (or none) stays safe.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function readPayload() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}

const payload = readPayload();
const toolName = payload.tool_name || "";

// Only mark for dev-digest MCP tools; ignore everything else.
if (!toolName.startsWith("mcp__devdigest__")) {
  process.exit(0);
}

const sessionId = payload.session_id || "nosession";
const markerPath = join(tmpdir(), `devdigest-mcp-used-${sessionId}.flag`);

try {
  writeFileSync(markerPath, `${toolName} @ ${new Date().toISOString()}\n`, "utf8");
} catch {
  // Non-fatal — a missing marker just means the Stop hook falls back to its
  // dirty-working-tree signal. Never block the tool call.
}

process.exit(0);
