#!/usr/bin/env node
/**
 * PreToolUse hook — commit test gate.
 *
 * Blocks `git commit` (invoked via the Bash tool) unless the tests for packages with staged
 * changes are green. Reads the PreToolUse hook payload from stdin (`tool_name`,
 * `tool_input.command`), matches only Bash calls whose command contains "git commit", and exits
 * with code 2 (block, per the Claude Code hook contract — stderr is fed back as the reason) when
 * a touched package's tests fail. Any other tool call, or a Bash call that isn't a commit, exits
 * 0 immediately so the tool call proceeds unaffected.
 *
 * The package → test-command map deliberately excludes evals/ (LLM-based, slow/costly per call)
 * and e2e/ (browser-driven, slow) — those tiers are not appropriate for a synchronous commit
 * gate; server uses the documented hermetic-only command (no Docker/testcontainers dependency)
 * so the gate stays fast and doesn't fail merely because Docker isn't running locally.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PACKAGE_TEST_CMD = {
  server: "pnpm exec vitest run --exclude '**/*.it.test.ts'",
  client: "pnpm test",
  "reviewer-core": "pnpm test",
};

function readPayload() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

const payload = readPayload();
const command = payload?.tool_input?.command ?? "";

// Only gate `git commit` invocations via the Bash tool — everything else passes through untouched.
if (payload?.tool_name !== "Bash" || !/\bgit\s+commit\b/.test(command)) {
  process.exit(0);
}

const repoRoot = process.env.CLAUDE_PROJECT_DIR || payload?.cwd || process.cwd();

let staged;
try {
  staged = execSync("git diff --cached --name-only", { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
} catch {
  // Can't inspect the index — don't block on a plumbing failure, let the commit proceed.
  process.exit(0);
}

const touchedPackages = Object.keys(PACKAGE_TEST_CMD).filter((pkg) =>
  staged.some((f) => f.startsWith(`${pkg}/`)),
);

if (touchedPackages.length === 0) process.exit(0);

const failures = [];
for (const pkg of touchedPackages) {
  try {
    execSync(PACKAGE_TEST_CMD[pkg], { cwd: `${repoRoot}/${pkg}`, stdio: "pipe" });
  } catch (err) {
    const output = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? err.message ?? "");
    failures.push({ pkg, output });
  }
}

if (failures.length > 0) {
  for (const f of failures) {
    console.error(`\n[commit-gate] ${f.pkg} tests FAILED — commit blocked.\n${f.output.slice(-2000)}`);
  }
  console.error(`\n[commit-gate] Fix the failing tests above (or unstage the unrelated files) before committing.`);
  process.exit(2);
}

process.exit(0);
