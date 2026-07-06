import { execFileSync } from 'node:child_process';

/**
 * Review modes. Only `working` is implemented; `staged`/`branch` are reserved
 * so the `--mode` flag leaves room for them without a breaking change later.
 */
export type Mode = 'working' | 'staged' | 'branch';

export const MODES: readonly Mode[] = ['working', 'staged', 'branch'] as const;

/**
 * git-diff arguments per mode. `null` = reserved-but-not-implemented.
 *   working → everything not yet committed (staged + unstaged) vs HEAD.
 *   staged  → (reserved) `diff --cached`.
 *   branch  → (reserved) `diff <base>...HEAD`.
 */
export const MODE_ARGS: Record<Mode, string[] | null> = {
  working: ['diff', 'HEAD'],
  staged: null,
  branch: null,
};

/** Raised for expected git problems (not a repo, unimplemented mode). */
export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

/**
 * Capture the raw unified diff for `mode` from the repo at `cwd` (defaults to
 * the process cwd — the repo the user ran `devdigest` in).
 */
export function getDiff(mode: Mode, cwd: string = process.cwd()): string {
  const args = MODE_ARGS[mode];
  if (args === null) {
    throw new GitError(`--mode ${mode} is not yet supported (only --mode working is implemented).`);
  }
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      // Capture stderr into the error (below) instead of leaking it to the terminal.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const msg = (err as { stderr?: Buffer | string }).stderr?.toString().trim() || (err as Error).message;
    throw new GitError(`git ${args.join(' ')} failed — are you inside a git repository?\n${msg}`);
  }
}
