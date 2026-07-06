#!/usr/bin/env node
/**
 * `devdigest` launcher.
 *
 * The CLI (src/cli/index.ts) consumes reviewer-core + shared as TypeScript
 * SOURCE via tsconfig path aliases, so it must run through tsx — exactly like
 * the MCP stdio server is launched via tsx in the repo's .mcp.json. The built
 * `dist/` does not resolve those aliases, so we never run the compiled CLI.
 *
 * This shim runs `src/cli/index.ts` through tsx while:
 *   - pinning TSX_TSCONFIG_PATH to THIS package's tsconfig (so `@devdigest/*`
 *     path aliases resolve no matter where the user invokes `devdigest`), and
 *   - inheriting the caller's cwd (so `git diff` targets the user's repo).
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));

// Resolve tsx's CLI via its package.json `bin` (the `./dist/cli.mjs` subpath is
// not directly importable through tsx's `exports`). package.json IS exported.
const tsxPkgJson = require.resolve('tsx/package.json');
const tsxCli = join(dirname(tsxPkgJson), require(tsxPkgJson).bin);
const entry = join(pkgDir, 'src', 'cli', 'index.ts');

const result = spawnSync(process.execPath, [tsxCli, entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, TSX_TSCONFIG_PATH: join(pkgDir, 'tsconfig.json') },
});

process.exit(result.status ?? 1);
