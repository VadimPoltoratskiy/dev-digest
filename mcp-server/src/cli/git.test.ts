import { describe, expect, it } from 'vitest';
import { GitError, MODE_ARGS, MODES, getDiff } from './git.js';

describe('MODE_ARGS', () => {
  it('maps working mode to `git diff HEAD` (staged + unstaged vs last commit)', () => {
    expect(MODE_ARGS.working).toEqual(['diff', 'HEAD']);
  });

  it('reserves staged/branch modes but does not implement them yet', () => {
    expect(MODE_ARGS.staged).toBeNull();
    expect(MODE_ARGS.branch).toBeNull();
  });

  it('lists all three modes', () => {
    expect(MODES).toEqual(['working', 'staged', 'branch']);
  });
});

describe('getDiff', () => {
  it('throws a clear error for reserved (unimplemented) modes', () => {
    expect(() => getDiff('staged')).toThrow(GitError);
    expect(() => getDiff('staged')).toThrow(/not yet supported/);
  });

  it('throws GitError when cwd is not a git repository', () => {
    // A guaranteed non-repo path (temp dir root of the OS).
    expect(() => getDiff('working', '/')).toThrow(GitError);
  });
});
