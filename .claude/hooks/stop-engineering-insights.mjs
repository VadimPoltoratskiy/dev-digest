#!/usr/bin/env node
/**
 * Stop hook — engineering-insights nudge.
 *
 * Runs at session end and nudges the agent to run /engineering-insights so that
 * session learnings are captured into the relevant module's INSIGHTS.md (per CLAUDE.md).
 *
 * Guards:
 * 1. Loop guard: if `payload.stop_hook_active` is truthy, exits 0 immediately to
 *    prevent infinite recursion when the hook itself triggers further Stop hooks.
 * 2. Real-work gate: nudges when the session did real work, signalled by EITHER
 *    a dirty working tree (`git status --porcelain`) OR the dev-digest MCP marker
 *    written by posttooluse-devdigest-mcp.mjs (the session used dev-digest
 *    functionality — run_agent, get_findings, …). If neither holds, exits 0
 *    silently. If git is unavailable it's treated as "not dirty", so a
 *    dev-digest-MCP-only session still nudges.
 * 3. Once-per-session sentinel: writes a flag file in os.tmpdir() keyed by
 *    `payload.session_id` so the nudge fires at most once per Claude session.
 *    If the sentinel already exists, exits 0.
 *
 * When all guards pass, writes a short reason to stderr and exits with code 2.
 * Exit code 2 on a Stop hook feeds stderr back to Claude and lets it continue,
 * giving it the opportunity to run /engineering-insights.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

// 1. Loop guard — stop_hook_active means we're already inside a Stop hook cycle.
if (payload.stop_hook_active) {
  process.exit(0);
}

const repoRoot = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
const sessionId = payload.session_id || "nosession";

// 2. Real-work gate — proceed if the working tree is dirty OR the session used
//    dev-digest MCP functionality (marker dropped by posttooluse-devdigest-mcp.mjs).
let dirty = false;
try {
  dirty = execSync("git status --porcelain", { cwd: repoRoot, encoding: "utf8" }).trim().length > 0;
} catch {
  // git unavailable or plumbing error — treat as "not dirty" but still allow the
  // dev-digest-MCP signal below to trigger a nudge.
  dirty = false;
}

const mcpMarkerPath = join(tmpdir(), `devdigest-mcp-used-${sessionId}.flag`);
const usedDevDigest = existsSync(mcpMarkerPath);

if (!dirty && !usedDevDigest) {
  // No file changes and no dev-digest usage — nothing worth capturing, skip.
  process.exit(0);
}

// 3. Once-per-session sentinel — fire at most once per session_id.
const sentinelPath = join(tmpdir(), `devdigest-insights-${sessionId}.done`);

if (existsSync(sentinelPath)) {
  process.exit(0);
}

try {
  writeFileSync(sentinelPath, new Date().toISOString(), "utf8");
} catch {
  // Write failure is non-fatal — proceed to nudge anyway.
}

// 4. Nudge — feed the message back to Claude via stderr + exit code 2.
const reason = usedDevDigest
  ? "this session used dev-digest functionality"
  : "this session changed files";
process.stderr.write(
  `Session end: run /engineering-insights to capture session learnings into the relevant module's INSIGHTS.md (per CLAUDE.md) — ${reason}. If the session was trivial with no discoveries, you may skip it.\n`
);
process.exit(2);
