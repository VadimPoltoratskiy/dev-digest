#!/usr/bin/env -S npx tsx
/**
 * `devdigest review --mode working` — the pre-push CLI.
 *
 * Reviews the LOCAL working copy (before `git push`, before any PR exists) with
 * the SAME reviewer engine + agent prompt the product runs on the PR page. It
 * captures the working-tree git diff, feeds it to reviewer-core's
 * reviewPullRequest, prints the structured findings, and exits non-zero on
 * blockers so it can gate a git pre-push hook.
 *
 * Normally launched via the `devdigest` bin (bin/devdigest.mjs, which pins the
 * tsconfig so `@devdigest/*` aliases resolve) or `pnpm review`.
 */
import { argv } from 'node:process';
import { pathToFileURL } from 'node:url';
import { CiFailOn } from '@devdigest/shared';
import { AGENT_NAMES, DEFAULT_MODEL, resolveAgent, type AgentName } from './agent.js';
import { GitError, MODES, getDiff, type Mode } from './git.js';
import { renderReview, exitCodeFor } from './render.js';
import { parseUnifiedDiff, runReview } from './review-runner.js';
import { SECRETS_PATH, getOpenRouterKey } from './secrets.js';

/** Bad CLI usage (unknown command/flag/value) → usage message + exit 2. */
class UsageError extends Error {}

const FAIL_ON_VALUES = CiFailOn.options; // ['never','critical','warning','any']

export interface Args {
  mode: Mode;
  agent: AgentName;
  model: string;
  failOn: CiFailOn;
}

const USAGE = `devdigest review — review your working copy before you push

Usage:
  devdigest review [--mode working] [--agent general] [--fail-on critical] [--model <id>]

Options:
  --mode <working|staged|branch>   What to review (default: working = git diff HEAD).
                                   Only 'working' is implemented today.
  --agent <general|security|performance|test>
                                   Which built-in reviewer prompt to use (default: general).
  --fail-on <never|critical|warning|any>
                                   Severity that makes the command exit 1 (default: critical).
  --model <id>                     OpenRouter model id (default: ${DEFAULT_MODEL}).
  -h, --help                       Show this help.

Requires an OpenRouter key in ${SECRETS_PATH} (or the OPENROUTER_API_KEY env var).`;

/** Parse `review` subcommand args. Throws UsageError on anything unexpected. */
export function parseArgs(argv: string[]): Args {
  const [command, ...rest] = argv;
  if (command !== 'review') {
    throw new UsageError(command ? `Unknown command: ${command}` : 'Missing command');
  }

  const args: Args = { mode: 'working', agent: 'general', model: DEFAULT_MODEL, failOn: 'critical' };

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    const eq = token.indexOf('=');
    const flag = eq === -1 ? token : token.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : token.slice(eq + 1);
    const value = inlineValue ?? rest[++i];

    switch (flag) {
      case '--mode':
        if (!isOneOf(value, MODES)) throw new UsageError(`--mode must be one of: ${MODES.join(', ')}`);
        args.mode = value;
        break;
      case '--agent':
        if (!isOneOf(value, AGENT_NAMES)) throw new UsageError(`--agent must be one of: ${AGENT_NAMES.join(', ')}`);
        args.agent = value;
        break;
      case '--fail-on':
        if (!isOneOf(value, FAIL_ON_VALUES)) throw new UsageError(`--fail-on must be one of: ${FAIL_ON_VALUES.join(', ')}`);
        args.failOn = value;
        break;
      case '--model':
        if (!value) throw new UsageError('--model requires a value');
        args.model = value;
        break;
      default:
        throw new UsageError(`Unknown option: ${flag}`);
    }
  }
  return args;
}

function isOneOf<T extends string>(value: string | undefined, allowed: readonly T[]): value is T {
  return value !== undefined && (allowed as readonly string[]).includes(value);
}

async function main(): Promise<number> {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes('-h') || rawArgs.includes('--help')) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  let args: Args;
  try {
    args = parseArgs(rawArgs);
  } catch (err) {
    if (err instanceof UsageError) {
      if (err.message) process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(`${USAGE}\n`);
      return 2;
    }
    throw err;
  }

  // 1. Capture the working-tree diff from the repo we were invoked in.
  let raw: string;
  try {
    raw = getDiff(args.mode);
  } catch (err) {
    if (err instanceof GitError) {
      process.stderr.write(`${err.message}\n`);
      return 2;
    }
    throw err;
  }

  const diff = parseUnifiedDiff(raw);
  if (diff.files.length === 0) {
    process.stderr.write('No working-tree changes to review.\n');
    return 0;
  }

  // 2. Resolve the OpenRouter key via the shared secrets chokepoint.
  const apiKey = await getOpenRouterKey();
  if (!apiKey) {
    process.stderr.write(
      `OPENROUTER_API_KEY is not configured.\n` +
        `Add it to ${SECRETS_PATH} (e.g. {"OPENROUTER_API_KEY": "sk-or-..."}),\n` +
        `set the OPENROUTER_API_KEY env var, or put it in the project's .env (or server/.env).\n`,
    );
    return 2;
  }

  // 3. Run the same engine + agent prompt the product uses on PRs.
  const { systemPrompt } = resolveAgent(args.agent);
  process.stderr.write(
    `Reviewing ${diff.files.length} changed file(s) with "${args.agent}" reviewer (${args.model})…\n`,
  );
  const outcome = await runReview({
    diff,
    systemPrompt,
    model: args.model,
    apiKey,
    onEvent: (e) => process.stderr.write(`  · ${e.msg}\n`),
  });

  // 4. Print findings; exit non-zero if the gate trips.
  process.stdout.write(renderReview(outcome.review, outcome.grounding));
  return exitCodeFor(outcome.review.findings, args.failOn);
}

/** Run only when executed as the entrypoint — importing (e.g. in tests) must not. */
const isEntry = argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href;
if (isEntry) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`Review failed: ${(err as Error).message}\n`);
      process.exit(3);
    });
}
