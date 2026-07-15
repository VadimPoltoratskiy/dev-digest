/**
 * octokit.test.ts — hermetic unit test for OctokitGitHubClient.
 *
 * Regression test: getPullRequest() must paginate pulls.listFiles instead of
 * reading only the first page. A PR with >100 changed files (e.g. a 158-file
 * PR) would otherwise silently lose every file past #100 from `pr_files`,
 * making createFindingEvalCase() reject those files with a false "no diff
 * patch available" (AC-3a) error even though the file is genuinely in the
 * diff — see SPEC-02-eval-pipeline.md AC-3a.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const listFilesFn = vi.fn();
const mockPulls = {
  get: vi.fn(),
  listFiles: listFilesFn,
  listCommits: vi.fn(),
};
const paginateMock = vi.fn();

const mockGit = {
  getRef: vi.fn(),
  getCommit: vi.fn(),
  createTree: vi.fn(),
  createCommit: vi.fn(),
  updateRef: vi.fn(),
  createRef: vi.fn(),
};

const mockRepos = {
  get: vi.fn(),
};

vi.mock('octokit', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    rest: { pulls: mockPulls, git: mockGit, repos: mockRepos },
    paginate: paginateMock,
  })),
}));

import { OctokitGitHubClient } from './octokit.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OctokitGitHubClient.getPullRequest', () => {
  it('paginates pulls.listFiles so a PR with >100 changed files returns every file', async () => {
    mockPulls.get.mockResolvedValue({
      data: {
        number: 7,
        title: 'Add evals CI workflow',
        user: { login: 'me' },
        head: { ref: 'feature/lab06', sha: 'abc' },
        base: { ref: 'main' },
        additions: 22075,
        deletions: 458,
        changed_files: 120,
        state: 'open',
        merged_at: null,
        created_at: '2026-07-01T00:00:00Z',
        updated_at: '2026-07-11T00:00:00Z',
        body: '',
      },
    });
    mockPulls.listCommits.mockResolvedValue({ data: [] });

    const page1 = Array.from({ length: 100 }, (_, i) => ({
      filename: `file-${i}.ts`,
      additions: 1,
      deletions: 0,
      patch: 'p',
    }));
    const page2 = Array.from({ length: 20 }, (_, i) => ({
      filename: `file-${100 + i}.ts`,
      additions: 1,
      deletions: 0,
      patch: 'p',
    }));
    paginateMock.mockImplementation(async (route: unknown) => {
      if (route === mockPulls.listFiles) return [...page1, ...page2];
      return [];
    });

    const client = new OctokitGitHubClient('token');
    const detail = await client.getPullRequest({ owner: 'o', name: 'r' }, 7);

    expect(detail.files).toHaveLength(120);
    expect(detail.files[119]!.path).toBe('file-119.ts');
    expect(paginateMock).toHaveBeenCalledWith(
      mockPulls.listFiles,
      expect.objectContaining({ pull_number: 7, per_page: 100 }),
    );
    expect(mockPulls.listFiles).not.toHaveBeenCalled();
  });
});

describe('OctokitGitHubClient.deleteFiles', () => {
  const REPO = { owner: 'owner', name: 'repo' };
  const PAYLOAD = {
    branch: 'devdigest/ci-remove',
    base: 'main',
    message: 'chore: remove DevDigest CI',
    paths: ['.devdigest/agents/agent.yaml', '.github/workflows/devdigest-review.yml'],
  };

  it('branch exists: calls updateRef (not createRef) and creates deletion tree with sha: null entries', async () => {
    mockGit.getRef.mockResolvedValue({ data: { object: { sha: 'parent-sha' } } });
    mockGit.getCommit.mockResolvedValue({ data: { tree: { sha: 'base-tree-sha' } } });
    mockGit.createTree.mockResolvedValue({ data: { sha: 'new-tree-sha' } });
    mockGit.createCommit.mockResolvedValue({ data: { sha: 'new-commit-sha' } });
    mockGit.updateRef.mockResolvedValue({ data: {} });

    const client = new OctokitGitHubClient('token');
    const result = await client.deleteFiles(REPO, PAYLOAD);

    expect(result).toEqual({ branch: 'devdigest/ci-remove' });

    // createTree called with null-sha entries for all paths
    expect(mockGit.createTree).toHaveBeenCalledWith(
      expect.objectContaining({
        tree: expect.arrayContaining([
          expect.objectContaining({ sha: null }),
        ]),
      }),
    );
    const treeCall = mockGit.createTree.mock.calls[0]![0] as { tree: Array<{ sha: unknown }> };
    expect(treeCall.tree.every((e) => e.sha === null)).toBe(true);

    // updateRef called with the branch (branch existed)
    expect(mockGit.updateRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'heads/devdigest/ci-remove', sha: 'new-commit-sha' }),
    );
    expect(mockGit.createRef).not.toHaveBeenCalled();
  });

  it('branch does not exist: falls back to base getRef and calls createRef (not updateRef)', async () => {
    // First getRef call (for the target branch) throws → fall back to base
    mockGit.getRef
      .mockRejectedValueOnce(new Error('Branch not found'))
      .mockResolvedValueOnce({ data: { object: { sha: 'base-parent-sha' } } });
    mockGit.getCommit.mockResolvedValue({ data: { tree: { sha: 'base-tree-sha' } } });
    mockGit.createTree.mockResolvedValue({ data: { sha: 'new-tree-sha' } });
    mockGit.createCommit.mockResolvedValue({ data: { sha: 'new-commit-sha' } });
    mockGit.createRef.mockResolvedValue({ data: {} });

    const client = new OctokitGitHubClient('token');
    const result = await client.deleteFiles(REPO, PAYLOAD);

    expect(result).toEqual({ branch: 'devdigest/ci-remove' });

    // createRef called (branch did not exist)
    expect(mockGit.createRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'refs/heads/devdigest/ci-remove', sha: 'new-commit-sha' }),
    );
    expect(mockGit.updateRef).not.toHaveBeenCalled();
  });
});

describe('OctokitGitHubClient.getDefaultBranch', () => {
  it('returns the default_branch from the repos.get response', async () => {
    mockRepos.get.mockResolvedValue({ data: { default_branch: 'trunk' } });

    const client = new OctokitGitHubClient('token');
    const result = await client.getDefaultBranch({ owner: 'owner', name: 'repo' });

    expect(result).toBe('trunk');
    expect(mockRepos.get).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' });
  });
});
