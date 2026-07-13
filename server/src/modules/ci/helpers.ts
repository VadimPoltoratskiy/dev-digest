import * as jsYaml from 'js-yaml';
import type { AgentManifest, CiFile, CiInstallation, CiRun, CiTarget, RepoRef } from '@devdigest/shared';
import { AgentManifest as AgentManifestSchema } from '@devdigest/shared';
import type { AgentRow, CiInstallationRow, CiRunRow } from './types.js';

/**
 * Pure generation helpers for the ci/ module.
 * No DB access, no adapter calls, no side effects.
 * DTO converters live at the bottom of this file.
 */

// ---------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------

/**
 * Derive a filesystem-safe slug from an agent name:
 * lowercase → spaces to hyphens → strip non-[a-z0-9-] → collapse double hyphens.
 */
export function agentSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-');
}

// ---------------------------------------------------------------------------
// AgentManifest builder
// ---------------------------------------------------------------------------

export function buildAgentManifest(params: {
  agent: AgentRow;
  skillSlugs: string[];
  postAs: 'github_review' | 'pr_comment' | 'exit_code_only';
}): AgentManifest {
  const { agent, skillSlugs, postAs } = params;
  // Throws on parse failure — malformed agent data is a server invariant violation.
  return AgentManifestSchema.parse({
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    system_prompt: agent.systemPrompt,
    skills: skillSlugs,
    strategy: agent.strategy,
    ci_fail_on: agent.ciFailOn,
    post_as: postAs,
  });
}

// ---------------------------------------------------------------------------
// YAML serialization
// ---------------------------------------------------------------------------

/**
 * Serialize an AgentManifest to YAML, then validate the round-trip.
 * Throws if the resulting YAML does not parse back through AgentManifest.
 */
export function manifestToYaml(manifest: AgentManifest): string {
  const yaml = jsYaml.dump(manifest, { lineWidth: -1, quotingType: '"', forceQuotes: false });
  const check = AgentManifestSchema.safeParse(jsYaml.load(yaml));
  if (!check.success) {
    throw new Error(`Manifest YAML round-trip validation failed: ${check.error.message}`);
  }
  return yaml;
}

/**
 * Generate a security-hardened GitHub Actions workflow YAML string.
 *
 * Security invariants (AC-8 through AC-11):
 *  - permissions: contents: read + pull-requests: write ONLY
 *  - trigger: on: pull_request ONLY (no pull_request_target, no issue_comment)
 *  - OPENROUTER_API_KEY referenced exclusively via ${{ secrets.OPENROUTER_API_KEY }}
 *
 * Uses js-yaml.dump — never hand-built template literals — to avoid escaping mistakes.
 */
export function buildWorkflowYaml(params: {
  slug: string;
  triggers: string[];
  postAs: string;
}): string {
  const { triggers, postAs } = params;

  // NOTE: `on` is a valid JavaScript object key and a valid YAML key in YAML 1.2.
  // js-yaml v4 (YAML 1.2 core schema) does not treat `on` as a boolean.
  const workflowObj = {
    name: 'DevDigest Review',
    on: {
      pull_request: {
        types: triggers,
      },
    },
    permissions: {
      contents: 'read',
      // Quoted key — the hyphen in 'pull-requests' is preserved by js-yaml.
      'pull-requests': 'write',
    },
    jobs: {
      review: {
        'runs-on': 'ubuntu-latest',
        steps: [
          { uses: 'actions/checkout@v4' },
          {
            name: 'Run DevDigest Review',
            run: 'node .devdigest/runner/index.js',
            env: {
              // API key is ONLY referenced as a secret reference — never a literal value.
              OPENROUTER_API_KEY: '${{ secrets.OPENROUTER_API_KEY }}',
              // GITHUB_TOKEN is auto-provided but must be in env for the runner to read it.
              GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
              DEVDIGEST_POST_AS: postAs,
              GITHUB_REPOSITORY: '${{ github.repository }}',
              PR_NUMBER: '${{ github.event.pull_request.number }}',
            },
          },
          {
            // Upload the devdigest-result.json artifact so the studio can ingest it.
            name: 'Upload DevDigest result',
            uses: 'actions/upload-artifact@v4',
            // Run even when the review step exits 1 (gate triggered → exit code 1).
            if: 'always()',
            with: {
              name: 'devdigest-result',
              path: 'devdigest-result.json',
            },
          },
        ],
      },
    },
  };

  return jsYaml.dump(workflowObj, { lineWidth: -1 });
}

// ---------------------------------------------------------------------------
// Bundle assembler
// ---------------------------------------------------------------------------

/**
 * Assemble the full CI file bundle from its parts.
 *
 * AC-2 file categories:
 *  (a) .devdigest/agents/<slug>.yaml          — agent manifest
 *  (b) .devdigest/skills/<skill-slug>.md      — one per linked skill
 *  (c) .devdigest/memory.jsonl               — empty (memory population is future work)
 *  (d) .devdigest/runner/index.js            — ncc-compiled agent-runner binary
 *  (e) .github/workflows/devdigest-review.yml — workflow (omitted for non-GHA targets)
 */
export function buildCiBundle(params: {
  slug: string;
  manifestYaml: string;
  skills: Array<{ slug: string; body: string }>;
  workflowYaml: string | null;
  runnerBinary: Buffer | null;
}): CiFile[] {
  const { slug, manifestYaml, skills, workflowYaml, runnerBinary } = params;

  const files: CiFile[] = [
    { path: `.devdigest/agents/${slug}.yaml`, contents: manifestYaml, editable: false },
    ...skills.map((skill) => ({
      path: `.devdigest/skills/${skill.slug}.md`,
      contents: skill.body,
      editable: false,
    })),
    { path: '.devdigest/memory.jsonl', contents: '', editable: false },
    {
      path: '.devdigest/runner/index.js',
      // Buffer.toString('binary') is latin1; the ncc bundle is ASCII-safe text.
      // Falls back to empty string when the build artifact is absent.
      contents: runnerBinary?.toString('binary') ?? '',
      editable: false,
    },
  ];

  // Workflow file is only included for GHA targets (null = non-GHA, AC-7).
  if (workflowYaml !== null) {
    files.push({
      path: '.github/workflows/devdigest-review.yml',
      contents: workflowYaml,
      editable: true,
    });
  }

  return files;
}

// ---------------------------------------------------------------------------
// Repo ref parser
// ---------------------------------------------------------------------------

/**
 * Split a validated "owner/name" string into a RepoRef.
 * Input is trusted — Zod regex validation at the route boundary guarantees format.
 */
export function parseRepoRef(repo: string): RepoRef {
  const parts = repo.split('/');
  return { owner: parts[0]!, name: parts[1]! };
}

// ---------------------------------------------------------------------------
// DTO converters (DB row → API contract shape)
// ---------------------------------------------------------------------------

export function toCiInstallationDto(row: CiInstallationRow): CiInstallation {
  return {
    id: row.id,
    agent_id: row.agentId,
    repo: row.repo,
    target_type: row.targetType as CiTarget,
    installed_at: row.installedAt.toISOString(),
  };
}

export function toCiRunDto(
  row: CiRunRow,
  agentName?: string | undefined,
  repo?: string | undefined,
): CiRun {
  return {
    id: row.id,
    ci_installation_id: row.ciInstallationId ?? null,
    pr_number: row.prNumber ?? null,
    ran_at: row.ranAt?.toISOString() ?? null,
    status: row.status ?? null,
    findings_count: row.findingsCount ?? null,
    cost_usd: row.costUsd ?? null,
    github_url: row.githubUrl ?? null,
    source: row.source ?? null,
    agent: agentName ?? null,
    duration_s: row.durationMs != null ? row.durationMs / 1000 : null,
    repo: repo ?? null,
  };
}
