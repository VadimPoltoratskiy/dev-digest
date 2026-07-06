import type { DevDigestClient } from './client.js';
import { McpToolError } from './client.js';
import { PullItem, RepoItem } from './types.js';

export async function resolveRepo(client: DevDigestClient, owner: string, repo: string): Promise<string> {
  const repos = RepoItem.array().parse(await client.get<unknown[]>('/repos'));
  const match = repos.find(
    (r) => r.owner.toLowerCase() === owner.toLowerCase() && r.name.toLowerCase() === repo.toLowerCase(),
  );
  if (!match) {
    throw new McpToolError(
      'REPO_NOT_FOUND',
      `Repo ${owner}/${repo} not found in DevDigest. Import it first at http://localhost:3000.`,
    );
  }
  return match.id;
}

export async function resolvePull(client: DevDigestClient, repoId: string, prNumber: number): Promise<string> {
  const pulls = PullItem.array().parse(await client.get<unknown[]>(`/repos/${repoId}/pulls`));
  const match = pulls.find((p) => p.number === prNumber);
  if (!match?.id) {
    throw new McpToolError(
      'PR_NOT_FOUND',
      `PR #${prNumber} not found in DevDigest for this repo. Open the PR list in DevDigest to trigger a sync.`,
    );
  }
  return match.id;
}

export async function resolveOwnerRepoPr(
  client: DevDigestClient,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{ repoId: string; pullId: string }> {
  const repoId = await resolveRepo(client, owner, repo);
  const pullId = await resolvePull(client, repoId, prNumber);
  return { repoId, pullId };
}
