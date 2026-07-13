import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  CiExport,
  CiExportInput,
  CiInstallation,
  CiRun,
  CiResultArtifact as CiResultArtifactType,
} from '@devdigest/shared';
import { CiResultArtifact } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { CiRepository } from './repository.js';
import {
  agentSlug,
  buildAgentManifest,
  buildCiBundle,
  buildWorkflowYaml,
  manifestToYaml,
  parseRepoRef,
  toCiInstallationDto,
  toCiRunDto,
} from './helpers.js';

/**
 * CiService — orchestrates export-to-CI, CI run ingest, and CI installation management.
 *
 * Follows the onion model: all DB queries go through CiRepository; all GitHub calls
 * go through the GitHubClient from the DI container. No raw SQL or direct adapter
 * imports here.
 */
export class CiService {
  /**
   * agent-runner binary singleton — read once at construction, reused on every
   * export call (Recommendation 3 from the plan). Null when the build artifact
   * is absent (the runner file in the bundle will be empty).
   */
  private readonly runnerBinary: Buffer | null;

  constructor(private readonly container: Container) {
    // Resolve the ncc-compiled agent-runner relative to this source file.
    // 5 `..` segments navigate from service.ts up through:
    //   ci/ → modules/ → src/ → server/ → repo-root → agent-runner/dist/index.js
    const binaryPath = resolve(
      new URL(import.meta.url).pathname,
      '../../../../../agent-runner/dist/index.js',
    );
    try {
      this.runnerBinary = readFileSync(binaryPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        console.warn(
          '[ci/service] agent-runner binary not found at',
          binaryPath,
          '— runner file in bundle will be empty. Build with `cd agent-runner && pnpm build`.',
        );
        this.runnerBinary = null;
      } else {
        throw err;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  async exportCi(
    agentId: string,
    input: CiExportInput,
    _workspaceId: string,
  ): Promise<CiExport> {
    const repo = new CiRepository(this.container.db);

    // 1. Load agent
    const agent = await repo.findAgentById(agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    // 2. Load linked skills (in configured order)
    const skills = await repo.findSkillsByAgentId(agentId);

    // 3. Build and validate the AgentManifest
    const slug = agentSlug(agent.name);
    const manifest = buildAgentManifest({
      agent,
      skillSlugs: skills.map((s) => agentSlug(s.name)),
      postAs: input.post_as,
    });

    // 4. Serialize manifest to YAML (with round-trip validation)
    const manifestYaml = manifestToYaml(manifest);

    // 5. Generate workflow YAML only for GHA targets
    const workflowYaml =
      input.target === 'gha'
        ? buildWorkflowYaml({ slug, triggers: input.triggers, postAs: input.post_as })
        : null;

    // 6. Assemble the full file bundle
    const files = buildCiBundle({
      slug,
      manifestYaml,
      skills: skills.map((s) => ({ slug: agentSlug(s.name), body: s.body })),
      workflowYaml,
      runnerBinary: this.runnerBinary,
    });

    // 7. "files" action — return bundle without any DB writes or GitHub calls
    if (input.action === 'files') {
      return {
        installation: stubInstallation(agentId, input.repo, input.target),
        files,
        pr_url: null,
      };
    }

    // 8. Non-GHA "open_pr" — ZIP-only path, no GitHub API calls (AC-7)
    if (input.target !== 'gha') {
      return {
        installation: stubInstallation(agentId, input.repo, input.target),
        files,
        pr_url: null,
      };
    }

    // 9. GHA "open_pr" — commit files + open (or reuse) PR
    const repoRef = parseRepoRef(input.repo);
    const github = await this.container.github();

    // Check for an existing open PR before committing (avoid duplicate PRs — AC-3)
    const existingPr = await github.findOpenPr(repoRef, 'devdigest/ci');

    // Commit all files to the devdigest/ci branch (always, even if PR already exists)
    try {
      await github.commitFiles(repoRef, {
        branch: 'devdigest/ci',
        base: input.base,
        message: `chore: export DevDigest agent "${agent.name}" to CI`,
        files: files.map((f) => ({ path: f.path, contents: f.contents })),
      });
    } catch (err) {
      const e = err as { status?: number };
      if (e.status === 403) {
        throw new ValidationError(
          'GitHub token lacks write access to this repository',
          422,
        );
      }
      throw err;
    }

    // Persist the installation record
    const installation = await repo.upsertInstallation({
      agentId,
      repo: input.repo,
      targetType: input.target,
    });
    const installationDto = toCiInstallationDto(installation);

    // Determine PR URL
    let prUrl: string;
    if (existingPr) {
      prUrl = existingPr.url;
    } else {
      const newPr = await github.openPullRequest(repoRef, {
        title: `Add DevDigest agent: ${agent.name}`,
        head: 'devdigest/ci',
        base: input.base,
        body: [
          `This PR adds the DevDigest agent **${agent.name}** to CI via the Export Wizard.`,
          '',
          'Review the generated files and merge to activate automated code review on pull requests.',
          '',
          '> Generated by [DevDigest](https://github.com/devdigest).',
        ].join('\n'),
      });
      prUrl = newPr.url;
    }

    return { installation: installationDto, files, pr_url: prUrl };
  }

  // ---------------------------------------------------------------------------
  // Write-access preflight (AC-22)
  // ---------------------------------------------------------------------------

  async checkWriteAccess(repo: string): Promise<boolean> {
    try {
      const repoRef = parseRepoRef(repo);
      const github = await this.container.github();
      return await github.checkWriteAccess(repoRef);
    } catch {
      return false;
    }
  }

  /**
   * Report which of the wizard's expected GitHub Actions secrets already
   * exist in the target repo, by NAME only — GitHub's API never exposes
   * secret values. GITHUB_TOKEN is not a stored repo secret (it's injected
   * automatically by Actions), so it is always reported ready. On any
   * failure (no token, insufficient scope, repo not found) every secret is
   * reported not-ready rather than throwing — the wizard treats "can't
   * confirm" the same as "not set".
   */
  async checkSecrets(repo: string): Promise<{ openrouter_api_key: boolean; github_token: boolean }> {
    try {
      const repoRef = parseRepoRef(repo);
      const github = await this.container.github();
      const names = await github.listRepoSecretNames(repoRef);
      return {
        openrouter_api_key: names.includes('OPENROUTER_API_KEY'),
        github_token: true,
      };
    } catch {
      return { openrouter_api_key: false, github_token: true };
    }
  }

  // ---------------------------------------------------------------------------
  // CI Installations
  // ---------------------------------------------------------------------------

  async getCiInstallations(agentId: string): Promise<CiInstallation[]> {
    const repo = new CiRepository(this.container.db);
    const rows = await repo.findInstallationsByAgent(agentId);
    return rows.map(toCiInstallationDto);
  }

  // ---------------------------------------------------------------------------
  // CI Runs
  // ---------------------------------------------------------------------------

  async getCiRuns(workspaceId: string, agentId?: string): Promise<CiRun[]> {
    const repo = new CiRepository(this.container.db);

    const installations = agentId
      ? await repo.findInstallationsByAgent(agentId)
      : await repo.findInstallationsByWorkspace(workspaceId);

    if (installations.length === 0) return [];

    const installationIds = installations.map((i) => i.id);
    const runs = await repo.findRunsByInstallationIds(installationIds);

    // Build lookup maps for efficient enrichment
    const installationMap = new Map(installations.map((i) => [i.id, i]));
    const uniqueAgentIds = [...new Set(installations.map((i) => i.agentId))];
    const agents = await repo.findAgentsByIds(uniqueAgentIds);
    const agentNameMap = new Map(agents.map((a) => [a.id, a.name]));

    return runs.map((run) => {
      const installation = run.ciInstallationId
        ? installationMap.get(run.ciInstallationId)
        : undefined;
      const agentName = installation ? agentNameMap.get(installation.agentId) : undefined;
      return toCiRunDto(run, agentName, installation?.repo);
    });
  }

  async getCiRun(id: string, workspaceId: string): Promise<CiRun> {
    const repo = new CiRepository(this.container.db);

    const run = await repo.findRunById(id);
    if (!run) throw new NotFoundError('CI run not found');

    // Verify the run's installation belongs to this workspace (treats mismatch as 404)
    if (!run.ciInstallationId) throw new NotFoundError('CI run not found');

    const installation = await repo.findInstallationById(run.ciInstallationId);
    if (!installation) throw new NotFoundError('CI run not found');

    const agent = await repo.findAgentById(installation.agentId);
    if (!agent || agent.workspaceId !== workspaceId) {
      throw new NotFoundError('CI run not found');
    }

    return toCiRunDto(run, agent.name, installation.repo);
  }

  // ---------------------------------------------------------------------------
  // Refresh (ingest from GitHub Actions artifacts — AC-17)
  // ---------------------------------------------------------------------------

  async refreshCiRuns(workspaceId: string): Promise<{ inserted: number; skipped: number }> {
    const repo = new CiRepository(this.container.db);
    const installations = await repo.findInstallationsByWorkspace(workspaceId);

    let inserted = 0;
    let skipped = 0;

    // Resolve GitHub client once; subsequent calls are cached on the container.
    let github: Awaited<ReturnType<typeof this.container.github>>;
    try {
      github = await this.container.github();
    } catch {
      // No GitHub token configured — skip ingest.
      return { inserted: 0, skipped: 0 };
    }

    // Process installations sequentially (spec performance budget: 30 s / 10 installations).
    for (const installation of installations) {
      const repoRef = parseRepoRef(installation.repo);

      let runs: Awaited<ReturnType<typeof github.listWorkflowRuns>>;
      try {
        runs = await github.listWorkflowRuns(repoRef, 'devdigest-review.yml');
      } catch {
        // GH API error for this repo — skip and continue with others.
        skipped++;
        continue;
      }

      for (const run of runs) {
        // Deduplication: skip runs already recorded (Edge case 7).
        const existing = await repo.findRunByInstallationAndUrl(installation.id, run.html_url);
        if (existing) {
          // Already ingested; not counted as skipped (it's a known duplicate, not a failure).
          continue;
        }

        // Download the devdigest-result.json artifact (may be null if not yet uploaded).
        const raw = await github.downloadArtifact(repoRef, run.id, 'devdigest-result');
        if (raw === null) {
          skipped++;
          continue;
        }

        // Parse the raw artifact JSON (untrusted content from GitHub — must validate).
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch (err) {
          console.warn('[ci/service] refreshCiRuns: artifact JSON parse error', {
            installationId: installation.id,
            githubUrl: run.html_url,
            err,
          });
          skipped++;
          continue;
        }

        const parsed = CiResultArtifact.safeParse(json);
        if (!parsed.success) {
          console.warn('[ci/service] refreshCiRuns: artifact schema validation failed', {
            installationId: installation.id,
            githubUrl: run.html_url,
            error: parsed.error.message,
          });
          skipped++;
          continue;
        }

        const artifact: CiResultArtifactType = parsed.data;

        await repo.insertRun({
          ciInstallationId: installation.id,
          prNumber: artifact.pr_number ?? null,
          ranAt: new Date(run.created_at),
          status: run.status,
          findingsCount: artifact.findings_count,
          costUsd: artifact.cost_usd,
          githubUrl: run.html_url,
          source: 'ci',
          durationMs: artifact.duration_ms ?? null,
        });
        inserted++;
      }
    }

    return { inserted, skipped };
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Build a stub CiInstallation for responses where no DB row is created
 * (action='files' or non-GHA action='open_pr').
 */
function stubInstallation(
  agentId: string,
  repo: string,
  target: CiExportInput['target'],
): CiInstallation {
  return {
    id: '',
    agent_id: agentId,
    repo,
    target_type: target,
    installed_at: new Date().toISOString(),
  };
}
