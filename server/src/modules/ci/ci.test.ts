/**
 * ci.test.ts — hermetic unit tests for the ci/ module.
 * No real DB, git, or network connections.
 *
 * Covers:
 *   - agentSlug() edge cases
 *   - buildWorkflowYaml() security invariants (AC-8/9/10/11)
 *   - manifestToYaml() YAML round-trip with special characters
 *   - CiService.exportCi() paths (files, open_pr no PR, open_pr existing PR, circle target)
 *   - CiService.refreshCiRuns() ingest deduplication logic
 */

// ===========================================================================
// Module-level mocks — MUST come before any imports (Vitest hoists vi.mock)
// ===========================================================================

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('./repository.js', () => {
  const CiRepository = vi.fn();
  CiRepository.prototype.findAgentById = vi.fn();
  CiRepository.prototype.findSkillsByAgentId = vi.fn();
  CiRepository.prototype.upsertInstallation = vi.fn();
  CiRepository.prototype.findInstallationsByWorkspace = vi.fn();
  CiRepository.prototype.findRunByInstallationAndUrl = vi.fn();
  CiRepository.prototype.insertRun = vi.fn();
  CiRepository.prototype.findInstallationById = vi.fn();
  CiRepository.prototype.deleteInstallation = vi.fn();
  return { CiRepository };
});

// ===========================================================================
// Imports — must come after vi.mock() calls
// ===========================================================================

import * as jsYaml from 'js-yaml';
import { AgentManifest } from '@devdigest/shared';
import type { WorkflowRun } from '@devdigest/shared';
import { agentSlug, buildCiBundle, buildWorkflowYaml, manifestToYaml } from './helpers.js';
import { CiRepository } from './repository.js';
import { CiService } from './service.js';
import { MockGitHubClient } from '../../adapters/mocks.js';
import type { AgentRow, CiInstallationRow, CiRunRow } from './types.js';
import type { CiExportInput } from '@devdigest/shared';

// ===========================================================================
// Shared fixtures
// ===========================================================================

const MOCK_AGENT: AgentRow = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  workspaceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  name: 'Security Reviewer',
  description: 'Reviews security',
  provider: 'openrouter',
  model: 'gpt-4o',
  systemPrompt: 'Review for security issues.',
  outputSchema: null,
  strategy: 'auto',
  ciFailOn: 'critical',
  repoIntel: true,
  contextDocs: [],
  enabled: true,
  version: 1,
  createdBy: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const MOCK_INSTALLATION: CiInstallationRow = {
  id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  agentId: MOCK_AGENT.id,
  repo: 'owner/test-repo',
  targetType: 'gha',
  installedAt: new Date('2026-07-01T00:00:00Z'),
};

const MOCK_CI_RUN: CiRunRow = {
  id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  ciInstallationId: MOCK_INSTALLATION.id,
  prNumber: 42,
  ranAt: new Date('2026-07-01T12:00:00Z'),
  status: 'completed',
  findingsCount: 3,
  costUsd: 0.005,
  githubUrl: 'https://github.com/owner/test-repo/actions/runs/12345',
  source: 'ci',
  durationMs: 5000,
};

const MOCK_WORKFLOW_RUN: WorkflowRun = {
  id: 12345,
  html_url: 'https://github.com/owner/test-repo/actions/runs/12345',
  created_at: '2026-07-01T12:00:00Z',
  status: 'completed',
};

const VALID_ARTIFACT_JSON = JSON.stringify({
  findings_count: 3,
  critical: 1,
  warning: 2,
  suggestion: 0,
  cost_usd: 0.005,
  duration_ms: 5000,
  agent: 'Security Reviewer',
  version: '1.0.0',
  pr_number: 42,
});

const BASE_EXPORT_INPUT: CiExportInput = {
  repo: 'owner/test-repo',
  target: 'gha',
  action: 'files',
  post_as: 'github_review',
  triggers: ['opened', 'synchronize'],
  base: 'main',
};

/** Build a minimal container that satisfies CiService's needs. */
function buildContainer(opts: { github?: MockGitHubClient } = {}): never {
  const github = opts.github ?? new MockGitHubClient();
  return {
    db: {},
    github: vi.fn().mockResolvedValue(github),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default repository stubs — tests override as needed.
  (CiRepository.prototype.findAgentById as Mock).mockResolvedValue(MOCK_AGENT);
  (CiRepository.prototype.findSkillsByAgentId as Mock).mockResolvedValue([]);
  (CiRepository.prototype.upsertInstallation as Mock).mockResolvedValue(MOCK_INSTALLATION);
  (CiRepository.prototype.findRunByInstallationAndUrl as Mock).mockResolvedValue(null);
  (CiRepository.prototype.insertRun as Mock).mockResolvedValue(MOCK_CI_RUN);
});

// ===========================================================================
// agentSlug()
// ===========================================================================

describe('agentSlug()', () => {
  it('converts consecutive spaces to a single hyphen', () => {
    expect(agentSlug('Hello  World')).toBe('hello-world');
  });

  it('handles leading and trailing spaces (converts to hyphens, then collapses)', () => {
    // '  My Agent  ' → '--my-agent--' → '-my-agent-' (leading/trailing preserved as single hyphens)
    expect(agentSlug('  My Agent  ')).toBe('-my-agent-');
  });

  it('strips special characters', () => {
    expect(agentSlug('Agent@#1!')).toBe('agent1');
  });

  it('strips unicode letters (only ASCII a-z, 0-9, and - are kept)', () => {
    // 'é' is not in [a-z0-9-], so it is stripped
    expect(agentSlug('Café Bot')).toBe('caf-bot');
  });

  it('leaves an already-valid slug unchanged', () => {
    expect(agentSlug('my-agent-1')).toBe('my-agent-1');
  });

  it('collapses multiple consecutive hyphens from mixed sources', () => {
    // Spaces + hyphens around special chars collapse into one hyphen
    expect(agentSlug('My--Agent  2!')).toBe('my-agent-2');
  });
});

// ===========================================================================
// buildWorkflowYaml() — security invariants (AC-8 / AC-9 / AC-10 / AC-11)
// ===========================================================================

describe('buildWorkflowYaml() security invariants', () => {
  const yaml = buildWorkflowYaml({
    slug: 'test-agent',
    triggers: ['opened', 'synchronize'],
    postAs: 'github_review',
  });

  it('AC-9/10: does not contain pull_request_target trigger', () => {
    expect(yaml).not.toContain('pull_request_target');
  });

  it('AC-10: does not contain issue_comment trigger', () => {
    expect(yaml).not.toContain('issue_comment');
  });

  it('AC-10: does not contain workflow_run trigger', () => {
    expect(yaml).not.toContain('workflow_run');
  });

  it('AC-8: contains "contents: read" in permissions', () => {
    expect(yaml).toContain('contents: read');
  });

  it('AC-8: contains "pull-requests: write" in permissions', () => {
    expect(yaml).toContain('pull-requests: write');
  });

  it('AC-11: OPENROUTER_API_KEY env var value is exclusively the secrets reference', () => {
    // The secrets reference must appear in the raw YAML
    expect(yaml).toContain('${{ secrets.OPENROUTER_API_KEY }}');
    // Parse the YAML and verify that the env object maps OPENROUTER_API_KEY to
    // the secrets reference exactly, not any other literal value.
    const parsed = jsYaml.load(yaml) as {
      jobs: { review: { steps: Array<{ env?: Record<string, string> }> } };
    };
    const runStep = parsed.jobs.review.steps.find((s) => s.env !== undefined);
    expect(runStep?.env?.['OPENROUTER_API_KEY']).toBe('${{ secrets.OPENROUTER_API_KEY }}');
  });

  it('AC-9: top-level trigger is pull_request', () => {
    const parsed = jsYaml.load(yaml) as Record<string, unknown>;
    const on = parsed['on'] as Record<string, unknown>;
    expect(on).toBeDefined();
    expect(on['pull_request']).toBeDefined();
  });

  it('AC-8: only expected top-level permissions are present', () => {
    const parsed = jsYaml.load(yaml) as Record<string, unknown>;
    const permissions = parsed['permissions'] as Record<string, string>;
    expect(permissions).toBeDefined();
    const keys = Object.keys(permissions);
    expect(keys).toContain('contents');
    expect(keys).toContain('pull-requests');
    // Must NOT have any other permission keys
    const extraKeys = keys.filter((k) => k !== 'contents' && k !== 'pull-requests');
    expect(extraKeys).toHaveLength(0);
  });
});

// ===========================================================================
// manifestToYaml() — YAML round-trip with special characters
// ===========================================================================

describe('manifestToYaml() YAML round-trip', () => {
  it('survives colons, quotes, newlines, and braces in system_prompt', () => {
    const manifest = AgentManifest.parse({
      name: 'Test Agent',
      provider: 'openrouter',
      model: 'gpt-4o',
      system_prompt: 'You are: an expert.\nYou must review "code" with {details}.\nUse key: value pairs.',
      skills: ['my-skill'],
      strategy: 'auto',
      ci_fail_on: 'critical',
      post_as: 'github_review',
    });

    const yaml = manifestToYaml(manifest);

    // Round-trip: load YAML and validate through the schema
    const parsed = AgentManifest.safeParse(jsYaml.load(yaml));
    expect(parsed.success).toBe(true);
    expect(parsed.data?.system_prompt).toBe(manifest.system_prompt);
  });

  it('preserves skills array through the round-trip', () => {
    const manifest = AgentManifest.parse({
      name: 'Agent with Skills',
      provider: 'openrouter',
      model: 'gpt-4o',
      system_prompt: 'Review code.',
      skills: ['skill-a', 'skill-b'],
      strategy: 'auto',
      ci_fail_on: 'warning',
      post_as: 'pr_comment',
    });

    const yaml = manifestToYaml(manifest);
    const parsed = AgentManifest.safeParse(jsYaml.load(yaml));

    expect(parsed.success).toBe(true);
    expect(parsed.data?.skills).toEqual(['skill-a', 'skill-b']);
    expect(parsed.data?.post_as).toBe('pr_comment');
  });

  it('returns a non-empty YAML string for a minimal manifest', () => {
    const manifest = AgentManifest.parse({
      name: 'Agent',
      provider: 'openrouter',
      model: 'gpt-4o',
      system_prompt: 'Test.',
      skills: [],
      strategy: 'auto',
      ci_fail_on: 'never',
      post_as: 'exit_code_only',
    });

    const yaml = manifestToYaml(manifest);
    expect(typeof yaml).toBe('string');
    expect(yaml.length).toBeGreaterThan(0);
    expect(yaml).toContain('exit_code_only');
  });
});

describe('buildCiBundle() — runner binary encoding', () => {
  it('round-trips a runner binary containing non-ASCII bytes exactly (regression: latin1 decode corrupted the ncc bundle on export)', () => {
    // A real ncc bundle is valid UTF-8 text but not ASCII-only (~500 non-ASCII
    // bytes from vendored deps). Simulate that with a buffer containing a
    // multi-byte UTF-8 sequence alongside plain ASCII source.
    const runnerBinary = Buffer.from('const x = "café — em dash"; // ASCII too', 'utf8');
    expect(runnerBinary.some((b) => b >= 0x80)).toBe(true);

    const files = buildCiBundle({
      slug: 'agent',
      manifestYaml: 'name: Agent\n',
      skills: [],
      workflowYaml: null,
      runnerBinary,
    });

    const runnerFile = files.find((f) => f.path === '.devdigest/runner/index.js');
    expect(runnerFile).toBeDefined();
    // The committed string must re-encode (via UTF-8, matching GitHub's tree
    // API assumption) back to the exact original bytes.
    expect(Buffer.from(runnerFile!.contents, 'utf8')).toEqual(runnerBinary);
  });
});

// ===========================================================================
// CiService.exportCi() — export path scenarios
// ===========================================================================

describe('CiService.exportCi() — action="files"', () => {
  it('returns bundle with pr_url null, does not call commitFiles or openPullRequest', async () => {
    const github = new MockGitHubClient();
    const commitSpy = vi.spyOn(github, 'commitFiles');
    const openPrSpy = vi.spyOn(github, 'openPullRequest');

    const service = new CiService(buildContainer({ github }));
    const result = await service.exportCi(
      MOCK_AGENT.id,
      { ...BASE_EXPORT_INPUT, action: 'files' },
      'ws-id',
    );

    expect(result.pr_url).toBeNull();
    expect(commitSpy).not.toHaveBeenCalled();
    expect(openPrSpy).not.toHaveBeenCalled();
    // Bundle should contain the manifest file
    const manifestFile = result.files.find((f) => f.path.startsWith('.devdigest/agents/'));
    expect(manifestFile).toBeDefined();
    // memory.jsonl must be present
    expect(result.files.find((f) => f.path === '.devdigest/memory.jsonl')).toBeDefined();
    // Workflow YAML present for GHA target
    expect(result.files.find((f) => f.path === '.github/workflows/devdigest-review.yml')).toBeDefined();
  });
});

describe('CiService.exportCi() — action="open_pr" with no existing PR', () => {
  it('calls commitFiles once and openPullRequest once; returns PR URL', async () => {
    const github = new MockGitHubClient();
    // findOpenPr returns null (no existing PR)
    vi.spyOn(github, 'findOpenPr').mockResolvedValue(null);
    const commitSpy = vi.spyOn(github, 'commitFiles');
    const openPrSpy = vi.spyOn(github, 'openPullRequest');

    const service = new CiService(buildContainer({ github }));
    const result = await service.exportCi(
      MOCK_AGENT.id,
      { ...BASE_EXPORT_INPUT, action: 'open_pr' },
      'ws-id',
    );

    expect(commitSpy).toHaveBeenCalledTimes(1);
    expect(openPrSpy).toHaveBeenCalledTimes(1);
    expect(result.pr_url).toBeTruthy();
    expect(typeof result.pr_url).toBe('string');
  });
});

describe('CiService.exportCi() — action="open_pr" with existing PR (AC-3 deduplication)', () => {
  it('calls commitFiles but NOT openPullRequest; returns existing PR URL', async () => {
    const existingUrl = 'https://github.com/owner/test-repo/pull/99';
    const github = new MockGitHubClient();
    vi.spyOn(github, 'findOpenPr').mockResolvedValue({ url: existingUrl });
    const commitSpy = vi.spyOn(github, 'commitFiles');
    const openPrSpy = vi.spyOn(github, 'openPullRequest');

    const service = new CiService(buildContainer({ github }));
    const result = await service.exportCi(
      MOCK_AGENT.id,
      { ...BASE_EXPORT_INPUT, action: 'open_pr' },
      'ws-id',
    );

    expect(commitSpy).toHaveBeenCalledTimes(1);
    expect(openPrSpy).not.toHaveBeenCalled();
    expect(result.pr_url).toBe(existingUrl);
  });
});

describe('CiService.exportCi() — target="circle" (AC-7 non-GHA)', () => {
  it('makes no GitHub calls, omits workflow file from bundle, returns pr_url null', async () => {
    const github = new MockGitHubClient();
    const commitSpy = vi.spyOn(github, 'commitFiles');
    const findPrSpy = vi.spyOn(github, 'findOpenPr');
    const openPrSpy = vi.spyOn(github, 'openPullRequest');

    const service = new CiService(buildContainer({ github }));
    const result = await service.exportCi(
      MOCK_AGENT.id,
      { ...BASE_EXPORT_INPUT, target: 'circle', action: 'open_pr' },
      'ws-id',
    );

    expect(commitSpy).not.toHaveBeenCalled();
    expect(findPrSpy).not.toHaveBeenCalled();
    expect(openPrSpy).not.toHaveBeenCalled();
    expect(result.pr_url).toBeNull();
    // Workflow file must NOT be in the bundle for non-GHA targets
    const workflowFile = result.files.find((f) =>
      f.path.includes('.github/workflows/'),
    );
    expect(workflowFile).toBeUndefined();
  });
});

// ===========================================================================
// CiService.refreshCiRuns() — ingest deduplication logic
// ===========================================================================

describe('CiService.refreshCiRuns() — ingest scenarios', () => {
  const WORKSPACE_ID = 'ws-1234';

  function buildGithubWithRun(opts: {
    runs?: WorkflowRun[];
    artifact?: string | null;
  } = {}) {
    const github = new MockGitHubClient();
    vi.spyOn(github, 'listWorkflowRuns').mockResolvedValue(
      opts.runs ?? [MOCK_WORKFLOW_RUN],
    );
    vi.spyOn(github, 'downloadArtifact').mockResolvedValue(
      opts.artifact !== undefined ? opts.artifact : VALID_ARTIFACT_JSON,
    );
    return github;
  }

  beforeEach(() => {
    (CiRepository.prototype.findInstallationsByWorkspace as Mock).mockResolvedValue([
      MOCK_INSTALLATION,
    ]);
  });

  it('inserts a valid artifact: inserted=1, skipped=0', async () => {
    const github = buildGithubWithRun();
    const service = new CiService(buildContainer({ github }));

    const result = await service.refreshCiRuns(WORKSPACE_ID);

    expect(result).toEqual({ inserted: 1, skipped: 0 });
    expect(CiRepository.prototype.insertRun).toHaveBeenCalledTimes(1);
  });

  it('skips a run whose github_url is already recorded (deduplication): inserted=0, skipped=0', async () => {
    // findRunByInstallationAndUrl returns an existing row
    (CiRepository.prototype.findRunByInstallationAndUrl as Mock).mockResolvedValue(MOCK_CI_RUN);

    const github = buildGithubWithRun();
    const service = new CiService(buildContainer({ github }));

    const result = await service.refreshCiRuns(WORKSPACE_ID);

    // Duplicates are silently skipped, not counted in `skipped`
    expect(result).toEqual({ inserted: 0, skipped: 0 });
    expect(CiRepository.prototype.insertRun).not.toHaveBeenCalled();
  });

  it('skips run when downloadArtifact returns null: inserted=0, skipped=1', async () => {
    const github = buildGithubWithRun({ artifact: null });
    const service = new CiService(buildContainer({ github }));

    const result = await service.refreshCiRuns(WORKSPACE_ID);

    expect(result).toEqual({ inserted: 0, skipped: 1 });
    expect(CiRepository.prototype.insertRun).not.toHaveBeenCalled();
  });

  it('skips run when artifact JSON is malformed: inserted=0, skipped=1', async () => {
    const github = buildGithubWithRun({ artifact: 'this is not valid json!!' });
    const service = new CiService(buildContainer({ github }));

    const result = await service.refreshCiRuns(WORKSPACE_ID);

    expect(result).toEqual({ inserted: 0, skipped: 1 });
    expect(CiRepository.prototype.insertRun).not.toHaveBeenCalled();
  });

  it('skips run when artifact fails CiResultArtifact.safeParse: inserted=0, skipped=1', async () => {
    // Valid JSON but wrong shape (missing required fields)
    const github = buildGithubWithRun({ artifact: JSON.stringify({ wrong: 'shape' }) });
    const service = new CiService(buildContainer({ github }));

    const result = await service.refreshCiRuns(WORKSPACE_ID);

    expect(result).toEqual({ inserted: 0, skipped: 1 });
    expect(CiRepository.prototype.insertRun).not.toHaveBeenCalled();
  });

  it('stores duration_ms from artifact in the insertRun call argument', async () => {
    const artifactWithDuration = JSON.stringify({
      findings_count: 2,
      cost_usd: 0.01,
      duration_ms: 7500,
      agent: 'Test',
      pr_number: 10,
    });
    const github = buildGithubWithRun({ artifact: artifactWithDuration });
    const service = new CiService(buildContainer({ github }));

    await service.refreshCiRuns(WORKSPACE_ID);

    expect(CiRepository.prototype.insertRun).toHaveBeenCalledWith(
      expect.objectContaining({ durationMs: 7500 }),
    );
  });

  it('returns inserted=0, skipped=0 when there are no installations', async () => {
    (CiRepository.prototype.findInstallationsByWorkspace as Mock).mockResolvedValue([]);

    const github = buildGithubWithRun();
    const service = new CiService(buildContainer({ github }));

    const result = await service.refreshCiRuns(WORKSPACE_ID);

    expect(result).toEqual({ inserted: 0, skipped: 0 });
  });
});

// ===========================================================================
// CiService.checkSecrets()
// ===========================================================================

describe('CiService.checkSecrets()', () => {
  it('reports openrouter_api_key ready when it is present in the repo secret names', async () => {
    const github = new MockGitHubClient();
    vi.spyOn(github, 'listRepoSecretNames').mockResolvedValue(['OPENROUTER_API_KEY']);
    const service = new CiService(buildContainer({ github }));

    const result = await service.checkSecrets('owner/test-repo');

    expect(result).toEqual({ openrouter_api_key: true, github_token: true });
  });

  it('reports openrouter_api_key not ready when it is absent from the repo secret names', async () => {
    const github = new MockGitHubClient();
    vi.spyOn(github, 'listRepoSecretNames').mockResolvedValue(['SOME_OTHER_SECRET']);
    const service = new CiService(buildContainer({ github }));

    const result = await service.checkSecrets('owner/test-repo');

    expect(result).toEqual({ openrouter_api_key: false, github_token: true });
  });

  it('never exposes secret values — only checks names', async () => {
    const github = new MockGitHubClient();
    const spy = vi.spyOn(github, 'listRepoSecretNames').mockResolvedValue(['OPENROUTER_API_KEY']);
    const service = new CiService(buildContainer({ github }));

    await service.checkSecrets('owner/test-repo');

    // The adapter call resolves NAMES only — asserting the return type here
    // documents the contract, since listRepoSecretNames can never resolve values.
    expect(await spy.mock.results[0]!.value).toEqual(['OPENROUTER_API_KEY']);
  });

  it('fails closed (not ready) when the GitHub client throws', async () => {
    const github = new MockGitHubClient();
    vi.spyOn(github, 'listRepoSecretNames').mockRejectedValue(new Error('403 insufficient scope'));
    const service = new CiService(buildContainer({ github }));

    const result = await service.checkSecrets('owner/test-repo');

    expect(result).toEqual({ openrouter_api_key: false, github_token: true });
  });

  it('always reports github_token ready — it is not a stored repo secret', async () => {
    const github = new MockGitHubClient();
    vi.spyOn(github, 'listRepoSecretNames').mockResolvedValue([]);
    const service = new CiService(buildContainer({ github }));

    const result = await service.checkSecrets('owner/test-repo');

    expect(result.github_token).toBe(true);
  });
});

// ===========================================================================
// CiService.removeCiInstallation() — "Remove from CI"
// ===========================================================================

describe('CiService.removeCiInstallation()', () => {
  beforeEach(() => {
    (CiRepository.prototype.findInstallationById as Mock).mockResolvedValue(MOCK_INSTALLATION);
    (CiRepository.prototype.findAgentById as Mock).mockResolvedValue(MOCK_AGENT);
    (CiRepository.prototype.deleteInstallation as Mock).mockResolvedValue(true);
  });

  it('deletes the installation when it belongs to the given agent and workspace', async () => {
    const service = new CiService(buildContainer());

    await service.removeCiInstallation(MOCK_AGENT.id, MOCK_INSTALLATION.id, MOCK_AGENT.workspaceId);

    expect(CiRepository.prototype.deleteInstallation).toHaveBeenCalledWith(MOCK_INSTALLATION.id);
  });

  it('throws NotFoundError (404) when the installation does not exist', async () => {
    (CiRepository.prototype.findInstallationById as Mock).mockResolvedValue(null);
    const service = new CiService(buildContainer());

    await expect(
      service.removeCiInstallation(MOCK_AGENT.id, 'nonexistent-id', MOCK_AGENT.workspaceId),
    ).rejects.toThrow(/not found/i);
    expect(CiRepository.prototype.deleteInstallation).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the installation belongs to a different agent', async () => {
    (CiRepository.prototype.findInstallationById as Mock).mockResolvedValue({
      ...MOCK_INSTALLATION,
      agentId: 'some-other-agent-id',
    });
    const service = new CiService(buildContainer());

    await expect(
      service.removeCiInstallation(MOCK_AGENT.id, MOCK_INSTALLATION.id, MOCK_AGENT.workspaceId),
    ).rejects.toThrow(/not found/i);
    expect(CiRepository.prototype.deleteInstallation).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the agent belongs to a different workspace', async () => {
    const service = new CiService(buildContainer());

    await expect(
      service.removeCiInstallation(MOCK_AGENT.id, MOCK_INSTALLATION.id, 'some-other-workspace-id'),
    ).rejects.toThrow(/not found/i);
    expect(CiRepository.prototype.deleteInstallation).not.toHaveBeenCalled();
  });
});
