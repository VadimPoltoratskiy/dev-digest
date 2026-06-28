import { readFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { glob } from 'node:fs/promises';
import { z } from 'zod';
import type { Container } from '../../platform/container.js';
import { ValidationError, NotFoundError } from '../../platform/errors.js';
import { RepoIntelRepository } from '../repo-intel/repository.js';
import { SkillsRepository } from '../skills/repository.js';
import { ConventionsRepository, type ConventionRow } from './repository.js';
import type { Skill } from '@devdigest/shared';

const MAX_FILE_CHARS = 1600; // ~400 tokens each
const MAX_CONFIG_FILES = 3;
const EXTRACTION_MODEL = 'claude-haiku-4-5-20251001';

const RawCandidateSchema = z.object({
  category: z.string(),
  rule: z.string(),
  evidence_file: z.string(),
  evidence_line_start: z.number().int().min(1),
  evidence_line_end: z.number().int().min(1).optional(),
  evidence_snippet: z.string(),
  confidence: z.number().min(0).max(1),
});

const ExtractionResponseSchema = z.object({
  candidates: z.array(RawCandidateSchema),
});

const CONFIG_GLOBS = [
  'eslint.config.*',
  '.eslintrc.*',
  'tsconfig.json',
  'prettier.config.*',
  '.prettierrc*',
];

export class ConventionsService {
  private repo: ConventionsRepository;
  private repoIntelRepo: RepoIntelRepository;
  private skillsRepo: SkillsRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
    this.repoIntelRepo = new RepoIntelRepository(container.db);
    this.skillsRepo = new SkillsRepository(container.db);
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.repo.listByRepo(workspaceId, repoId);
  }

  async extract(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    const repoBasics = await this.repoIntelRepo.getRepoBasics(repoId);
    if (!repoBasics) throw new NotFoundError('Repository not found');
    if (!repoBasics.clonePath) {
      throw new ValidationError('Repository is not cloned yet. Please wait for the clone to finish.');
    }

    const { clonePath, owner, name, defaultBranch } = repoBasics;

    // 1. Sample top ranked source files; fall back to direct directory walk when
    //    the repo-intel index has not been built yet (no file_rank rows).
    let samplePaths = await this.container.repoIntel.getConventionSamples(repoId, 12);
    if (samplePaths.length === 0) {
      samplePaths = await discoverSourceFiles(clonePath, 12);
    }

    // 2. Find config files.
    const configPaths = await findConfigFiles(clonePath, MAX_CONFIG_FILES);

    // 3. Build file content blocks for the prompt.
    const allPaths = [...configPaths, ...samplePaths];
    const fileBlocks: string[] = [];
    for (const filePath of allPaths) {
      const content = await readFileSafe(clonePath, filePath);
      if (!content) continue;
      const truncated = content.length > MAX_FILE_CHARS ? content.slice(0, MAX_FILE_CHARS) + '\n... (truncated)' : content;
      fileBlocks.push(`### ${filePath}\n\`\`\`\n${truncated}\n\`\`\``);
    }

    if (fileBlocks.length === 0) {
      return [];
    }

    // 4. Call the LLM. Let errors propagate so the route returns a 500 with a
    //    meaningful message (e.g. missing ANTHROPIC_API_KEY).
    const llm = await this.container.llm('anthropic');
    const prompt = buildExtractionPrompt(fileBlocks);

    const result = await llm.completeStructured({
      model: EXTRACTION_MODEL,
      schemaName: 'ConventionExtractionResult',
      schema: ExtractionResponseSchema,
      messages: [
        {
          role: 'system',
          content:
            'You are a code conventions analyst. Extract recurring coding conventions from source files. Return ONLY conventions that appear consistently in multiple files or are explicitly declared in config files. Avoid one-off patterns.',
        },
        { role: 'user', content: prompt },
      ],
      maxTokens: 2048,
      temperature: 0,
    });
    const rawCandidates = result.data.candidates;

    // 5. Verify each candidate's evidence actually exists in the file.
    const verified: Array<{
      rule: string;
      evidencePath: string;
      evidenceSnippet: string;
      confidence: number;
    }> = [];

    for (const c of rawCandidates) {
      const fileContent = await readFileSafe(clonePath, c.evidence_file);
      if (!fileContent) continue;

      const lines = fileContent.split('\n');
      const snippetLines = c.evidence_snippet.trim().split('\n');
      const firstSnippetLine = snippetLines[0]?.trim() ?? '';

      // Verify snippet appears in the file (simple substring check on the relevant lines).
      const lineStart = Math.max(0, c.evidence_line_start - 3);
      const lineEnd = Math.min(lines.length, (c.evidence_line_end ?? c.evidence_line_start) + 2);
      const region = lines.slice(lineStart, lineEnd).join('\n');

      if (firstSnippetLine.length > 0 && !region.includes(firstSnippetLine)) continue;

      const endLine = c.evidence_line_end ?? c.evidence_line_start;
      const lineRef =
        endLine > c.evidence_line_start
          ? `L${c.evidence_line_start}-L${endLine}`
          : `L${c.evidence_line_start}`;
      const githubUrl = `https://github.com/${owner}/${name}/blob/${defaultBranch}/${c.evidence_file}#${lineRef}`;

      verified.push({
        rule: c.rule,
        evidencePath: githubUrl,
        evidenceSnippet: c.evidence_snippet,
        confidence: c.confidence,
      });
    }

    // 6. Replace existing candidates for this repo.
    await this.repo.deleteByRepo(workspaceId, repoId);
    if (verified.length === 0) return [];

    return this.repo.insertMany(workspaceId, repoId, verified);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: { accepted?: boolean; rule?: string },
  ): Promise<ConventionRow | null> {
    return this.repo.update(workspaceId, id, patch);
  }

  async deleteOne(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteOne(workspaceId, id);
  }

  async convertToSkill(workspaceId: string, repoId: string): Promise<Skill> {
    const repoBasics = await this.repoIntelRepo.getRepoBasics(repoId);
    if (!repoBasics) throw new NotFoundError('Repository not found');

    const all = await this.repo.listByRepo(workspaceId, repoId);
    const accepted = all.filter((c) => c.accepted);

    if (accepted.length === 0) {
      throw new ValidationError('No accepted conventions to convert. Accept at least one candidate first.');
    }

    const repoName = repoBasics.name;
    const body = buildSkillBody(repoName, accepted);

    const row = await this.skillsRepo.insert({
      workspaceId,
      name: `${repoName}-conventions`,
      description: `Auto-extracted coding conventions for the ${repoName} repository.`,
      type: 'convention',
      source: 'extracted',
      body,
      enabled: true,
    });

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      type: row.type,
      source: row.source,
      body: row.body,
      enabled: row.enabled,
      version: row.version,
      evidence_files: null,
    };
  }
}

function buildSkillBody(repoName: string, candidates: ConventionRow[]): string {
  const rules = candidates
    .map((c) => {
      const evidenceLine = c.evidencePath
        ? `\n  > Evidence: [${formatEvidencePath(c.evidencePath)}](${c.evidencePath})`
        : '';
      const snippet = c.evidenceSnippet
        ? `\n\`\`\`\n${c.evidenceSnippet.trim()}\n\`\`\``
        : '';
      return `### ${c.rule}${evidenceLine}${snippet}`;
    })
    .join('\n\n');

  return `# ${repoName} — Coding Conventions

Apply these conventions when reviewing changes in this repository. Each rule was extracted from the codebase and verified against real code evidence.

${rules}

## Enforcement

Flag violations as MEDIUM findings with the convention name in the category field. Include the specific line that violates the rule.`;
}

function formatEvidencePath(githubUrl: string): string {
  try {
    const url = new URL(githubUrl);
    const parts = url.pathname.split('/');
    // /owner/repo/blob/branch/...path → extract path + hash
    const blobIndex = parts.indexOf('blob');
    if (blobIndex !== -1) {
      const filePath = parts.slice(blobIndex + 2).join('/');
      const hash = url.hash ? url.hash : '';
      return `${filePath}${hash}`;
    }
    return githubUrl;
  } catch {
    return githubUrl;
  }
}

function buildExtractionPrompt(fileBlocks: string[]): string {
  return `Analyze these source files and extract recurring coding conventions.

For each convention you find, provide:
- A short, directive rule statement (e.g. "Always use async/await instead of .then() chains")
- The specific file and line numbers where evidence was found
- A code snippet from the file demonstrating the convention
- A confidence score (0.0-1.0) based on how consistently the pattern appears

Focus on conventions that:
1. Appear in multiple files OR are explicitly declared in config files
2. Reflect intentional architectural choices, not incidental code
3. Would be actionable for a code reviewer to check

Ignore: trivial style choices, one-off patterns, test-only patterns.

## Source Files

${fileBlocks.join('\n\n')}`;
}

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'out', '.cache']);
const JUNK_SUBSTRINGS = ['.test.', '.spec.', '.d.ts', '__tests__', '__mocks__', '/migrations/'];

/**
 * Fallback file discovery when the repo-intel index has no ranked paths.
 * Walks the clone directory shallowly (up to 3 levels) collecting source files,
 * preferring files closer to the root (more likely to be core modules).
 */
async function discoverSourceFiles(clonePath: string, maxCount: number): Promise<string[]> {
  const collected: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (collected.length >= maxCount * 3) return; // over-fetch before filtering
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.eslintrc.js') continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || depth >= 3) continue;
        await walk(join(dir, entry.name), depth + 1);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (!SOURCE_EXTS.has(ext)) continue;
        const relPath = join(dir, entry.name)
          .slice(clonePath.length + 1)
          .replace(/\\/g, '/');
        if (JUNK_SUBSTRINGS.some((j) => relPath.includes(j))) continue;
        collected.push(relPath);
      }
    }
  }

  await walk(clonePath, 0);

  // Prefer shallower paths (fewer slashes = closer to root).
  collected.sort((a, b) => a.split('/').length - b.split('/').length);
  return collected.slice(0, maxCount);
}

async function findConfigFiles(clonePath: string, maxCount: number): Promise<string[]> {
  const found: string[] = [];
  for (const pattern of CONFIG_GLOBS) {
    if (found.length >= maxCount) break;
    try {
      for await (const entry of glob(pattern, { cwd: clonePath })) {
        if (found.length >= maxCount) break;
        found.push(entry);
      }
    } catch {
      // glob throws on unsupported patterns in some Node versions; skip silently
    }
  }
  return found;
}

async function readFileSafe(clonePath: string, filePath: string): Promise<string | null> {
  try {
    return await readFile(join(clonePath, filePath), 'utf8');
  } catch {
    return null;
  }
}
