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

import { describe, it, expect, vi } from 'vitest';

const listFilesFn = vi.fn();
const mockPulls = {
  get: vi.fn(),
  listFiles: listFilesFn,
  listCommits: vi.fn(),
};
const paginateMock = vi.fn();

vi.mock('octokit', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    rest: { pulls: mockPulls },
    paginate: paginateMock,
  })),
}));

import { OctokitGitHubClient } from './octokit.js';

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
