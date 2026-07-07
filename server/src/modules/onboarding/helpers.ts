import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Onboarding, OnboardingSection } from '@devdigest/shared';
import type { RepoIntel } from '../repo-intel/types.js';
import { ONBOARDING_SECTIONS } from './types.js';
import type { FactsBundle } from './types.js';

// -------------------------------------------------------------------------
// Directory scan helpers
// -------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.cache',
]);

interface ScanResult {
  directoryTree: string;
  allDiscoveredFiles: string[];
}

/**
 * Scan directory tree two levels deep, skipping known noise directories.
 * Returns:
 * - `directoryTree`: compact indented string for prompt injection
 * - `allDiscoveredFiles`: flat list of all file relative paths found (the
 *   knownPaths source for link validation — NOT rank-limited)
 */
async function scanDirectoryTree(clonePath: string): Promise<ScanResult> {
  const lines: string[] = [];
  const allFiles: string[] = [];

  async function scan(dir: string, depth: number, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`);
        if (depth < 1) {
          await scan(path.join(dir, entry.name), depth + 1, prefix + '  ');
        }
      } else if (entry.isFile()) {
        lines.push(`${prefix}${entry.name}`);
        const rel = path.join(dir, entry.name).slice(clonePath.length + 1).replace(/\\/g, '/');
        allFiles.push(rel);
      }
    }
  }

  await scan(clonePath, 0, '');

  return { directoryTree: lines.join('\n'), allDiscoveredFiles: allFiles };
}

// -------------------------------------------------------------------------
// Known framework detection
// -------------------------------------------------------------------------

const KNOWN_FRAMEWORKS = new Set([
  'react',
  'next',
  'vue',
  'nuxt',
  'express',
  'fastify',
  'koa',
  'hapi',
  'nestjs',
  '@nestjs/core',
  'angular',
  '@angular/core',
  'svelte',
  'remix',
  '@remix-run/node',
  'astro',
]);

// -------------------------------------------------------------------------
// collectFacts
// -------------------------------------------------------------------------

export interface CollectFactsParams {
  repoId: string;
  clonePath: string;
  repoIntelSvc: RepoIntel;
}

/**
 * Gathers all deterministic facts needed for the LLM prompt or skeleton builder.
 * Does NOT set `indexStatus` — that is set by the service after `getIndexState`.
 */
export async function collectFacts(
  params: CollectFactsParams,
): Promise<Omit<FactsBundle, 'indexStatus'>> {
  const { repoId, clonePath, repoIntelSvc } = params;

  // 1. Read package.json
  let runScripts: Record<string, string> = {};
  let engines: Record<string, string> = {};
  let topLevelDeps: Record<string, string> = {};
  let runtimeName: string | null = null;
  let frameworkNames: string[] = [];

  try {
    const raw = await fs.readFile(path.join(clonePath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;

    runScripts = (pkg.scripts as Record<string, string>) ?? {};
    engines = (pkg.engines as Record<string, string>) ?? {};

    const deps = (pkg.dependencies as Record<string, string>) ?? {};
    const devDeps = (pkg.devDependencies as Record<string, string>) ?? {};
    topLevelDeps = { ...deps, ...devDeps };

    runtimeName = 'node' in engines ? 'node' : null;
    frameworkNames = Object.keys(topLevelDeps).filter((k) => KNOWN_FRAMEWORKS.has(k));
  } catch {
    // Missing or unparseable package.json — use empty defaults
  }

  // 2. Scan directory tree (2 levels deep)
  const { directoryTree, allDiscoveredFiles } = await scanDirectoryTree(clonePath);

  // 3. Get repo-intel data
  const topRankedFiles = await repoIntelSvc.getTopFilesByRank(repoId, 20);
  const criticalPaths = await repoIntelSvc.getCriticalPaths(repoId);

  // 4. routeList is always empty in v1 — no route-list facade method exists yet
  const routeList: string[] = [];

  return {
    runtimeName,
    frameworkNames,
    runScripts,
    engines,
    topLevelDeps,
    directoryTree,
    allDiscoveredFiles,
    topRankedFiles,
    criticalPaths,
    routeList,
  };
}

// -------------------------------------------------------------------------
// buildSkeleton
// -------------------------------------------------------------------------

/**
 * Builds a deterministic 5-section skeleton from available facts without calling the LLM.
 * Used when the index status is degraded or failed.
 */
export function buildSkeleton(bundle: Omit<FactsBundle, 'indexStatus'>): Onboarding {
  const sections: OnboardingSection[] = ONBOARDING_SECTIONS.map(({ kind, title }) => {
    let body: string;

    if (kind === 'architecture_overview') {
      body = `**Directory structure (2 levels):**\n\n\`\`\`\n${bundle.directoryTree || '(no files found)'}\n\`\`\`\n\nFull index data is not available; this section will be richer after the repository is indexed.`;
    } else if (kind === 'how_to_run') {
      const scriptLines = Object.entries(bundle.runScripts)
        .map(([k, v]) => `- \`${k}\`: \`${v}\``)
        .join('\n');
      const engineLines = Object.entries(bundle.engines)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join('\n');

      if (scriptLines || engineLines) {
        body = '';
        if (engineLines) {
          body += `**Runtime requirements:**\n${engineLines}\n\n`;
        }
        if (scriptLines) {
          body += `**Available scripts:**\n${scriptLines}`;
        }
      } else {
        body = 'No `package.json` scripts or engine requirements were found. Check the repository README for run instructions.';
      }
    } else if (kind === 'critical_paths') {
      body = 'Dependency chain data is not available until the repository is indexed. Re-generate after indexing completes.';
    } else if (kind === 'reading_order') {
      body = 'File rank data is not available until the repository is indexed. Re-generate after indexing completes.';
    } else {
      // first_tasks
      body = 'Task suggestions are not available until the repository is indexed. Re-generate after indexing completes.';
    }

    return { kind, title, body, diagram: null, links: [] };
  });

  return { sections };
}

// -------------------------------------------------------------------------
// fillPrompt
// -------------------------------------------------------------------------

/**
 * Fills the system prompt template with facts and returns the assembled
 * system + user messages.
 *
 * All repo-sourced values (scripts, file names, dependency names) are wrapped
 * in `<untrusted>…</untrusted>` blocks per the spec security model.
 */
export function fillPrompt(
  template: string,
  bundle: Omit<FactsBundle, 'indexStatus'>,
): { system: string; user: string } {
  // Build the ordered section list for {{sections}}
  const sectionsText = ONBOARDING_SECTIONS.map((s, i) => `${i + 1}. ${s.kind} — ${s.title}`).join('\n');

  const system = template
    .replace('{{sections}}', sectionsText)
    .replace('{{language}}', 'English');

  // Build user message with labeled fact blocks
  const parts: string[] = [];

  parts.push('## Repository Facts\n');

  if (bundle.runtimeName) {
    parts.push(`**Runtime:** ${bundle.runtimeName}`);
  }

  if (bundle.frameworkNames.length > 0) {
    parts.push(
      `**Detected frameworks/libraries:**\n<untrusted>${bundle.frameworkNames.join(', ')}</untrusted>`,
    );
  }

  if (Object.keys(bundle.engines).length > 0) {
    const engineStr = Object.entries(bundle.engines)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    parts.push(`**Engine requirements:** <untrusted>${engineStr}</untrusted>`);
  }

  if (Object.keys(bundle.runScripts).length > 0) {
    const scriptLines = Object.entries(bundle.runScripts)
      .map(([k, v]) => `  - \`${k}\`: <untrusted>${v}</untrusted>`)
      .join('\n');
    parts.push(`**Run scripts:**\n${scriptLines}`);
  }

  if (Object.keys(bundle.topLevelDeps).length > 0) {
    const depNames = Object.keys(bundle.topLevelDeps).join(', ');
    parts.push(
      `**Top-level dependencies (names only):**\n<untrusted>${depNames}</untrusted>`,
    );
  }

  parts.push(
    `**Directory tree (2 levels, excluding node_modules/.git/build/dist):**\n<untrusted>\n${bundle.directoryTree || '(empty)'}\n</untrusted>`,
  );

  if (bundle.topRankedFiles.length > 0) {
    const ranked = bundle.topRankedFiles.map((f) => `  - <untrusted>${f}</untrusted>`).join('\n');
    parts.push(`**Top-ranked files by PageRank:**\n${ranked}`);
  }

  if (bundle.criticalPaths.length > 0) {
    const chains = bundle.criticalPaths
      .map((chain) => `  - ${chain.map((f) => `<untrusted>${f}</untrusted>`).join(' → ')}`)
      .join('\n');
    parts.push(`**Critical dependency chains:**\n${chains}`);
  }

  const user = parts.join('\n\n');

  return { system, user };
}

// -------------------------------------------------------------------------
// validateAndStripLinks
// -------------------------------------------------------------------------

/**
 * Strips any OnboardingLink whose `path` is NOT present in `knownPaths`.
 * `knownPaths` must be built from `bundle.allDiscoveredFiles` — the COMPLETE
 * 2-level FS scan, NOT the rank-limited `topRankedFiles` list.
 */
export function validateAndStripLinks(
  sections: OnboardingSection[],
  knownPaths: Set<string>,
): OnboardingSection[] {
  return sections.map((section) => ({
    ...section,
    links: section.links.filter((link) => knownPaths.has(link.path)),
  }));
}
