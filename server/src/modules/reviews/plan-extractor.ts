import type { Container } from '../../platform/container.js';
import type { PullRow } from '../../db/rows.js';
import type { Logger } from './run-executor.js';
import * as pullRepo from './repository/pull.repo.js';

/**
 * PlanExtractor — deterministic plan/spec detection from PR content.
 *
 * No LLM call. Scans the PR body (and linked GitHub issue as fallback) for
 * markdown sections whose headings signal design intent: plan, spec, acceptance
 * criteria, etc. The extracted text is passed to the reviewer prompt as an
 * untrusted `## Plan / specification` section so agents can check whether the
 * diff actually delivers what was designed.
 *
 * Best-effort: all failures return null; never throws.
 */
export class PlanExtractor {
  constructor(private container: Container) {}

  async extract(workspaceId: string, pull: PullRow, logger?: Logger): Promise<string | null> {
    // 1. Try the PR body first (no network).
    if (pull.body) {
      const fromBody = extractPlanSections(pull.body);
      if (fromBody) {
        logger?.info(
          { prId: pull.id, source: 'pr-body', chars: fromBody.length },
          'plan-extractor: plan/spec found in PR body',
        );
        return fromBody;
      }
    }

    // 2. Fallback: check a linked GitHub issue.
    const issueText = await this.resolveLinkedIssue(workspaceId, pull, logger);
    if (issueText) {
      const fromIssue = extractPlanSections(issueText);
      if (fromIssue) {
        logger?.info(
          { prId: pull.id, source: 'linked-issue', chars: fromIssue.length },
          'plan-extractor: plan/spec found in linked issue',
        );
        return fromIssue;
      }
    }

    return null;
  }

  private async resolveLinkedIssue(
    _workspaceId: string,
    pull: PullRow,
    logger?: Logger,
  ): Promise<string | null> {
    if (!pull.body) return null;

    const match =
      pull.body.match(/(?:closes?|fixes?|resolves?)\s+#(\d+)/i) ??
      pull.body.match(/#(\d+)/);
    if (!match) return null;

    const issueNumber = parseInt(match[1] ?? '', 10);
    if (!Number.isFinite(issueNumber) || issueNumber < 1 || issueNumber > 2_147_483_647) return null;
    try {
      const repo = await pullRepo.getRepo(this.container.db, pull.repoId);
      if (!repo) return null;
      const gh = await this.container.github();
      const issue = await gh.getIssue({ owner: repo.owner, name: repo.name }, issueNumber);
      if (!issue.body) return null;
      // Cap issue body generously — we want the full plan, not just a snippet.
      return issue.body.slice(0, 8000);
    } catch (err) {
      logger?.info(
        { prId: pull.id, issueNumber, err: (err as Error).message },
        'plan-extractor: failed to fetch linked issue (best-effort)',
      );
      return null;
    }
  }
}

// ---- pure extraction helpers -----------------------------------------------

/**
 * Keywords that indicate a markdown heading introduces a plan or spec section.
 * Checked as substring matches (case-insensitive) against the heading text.
 */
const PLAN_KEYWORDS = [
  'plan',
  'spec',
  'specification',
  'design',
  'acceptance criteria',
  'approach',
  'requirements',
  'task list',
  'scope',
  'implementation',
  'technical',
  'proposal',
];

/**
 * Extract plan/spec sections from a markdown string.
 *
 * Scans for H1–H4 headings that contain a plan keyword, then captures all
 * content under that heading until the next same-or-higher-level heading.
 * Also detects PR bodies that are purely a checklist (≥ 3 task items).
 *
 * Returns null when nothing plan-like is found or the extracted text is too
 * short to be meaningful (< 100 chars).
 */
export function extractPlanSections(markdown: string): string | null {
  const lines = markdown.split('\n');
  const captured: string[] = [];
  let capturing = false;
  let captureLevel = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = (headingMatch[1] ?? '').length;
      const title = (headingMatch[2] ?? '').trim().toLowerCase();
      const isPlanHeading = PLAN_KEYWORDS.some((kw) => title.includes(kw));

      if (isPlanHeading) {
        // Start (or restart) capturing at this heading.
        capturing = true;
        captureLevel = level;
        captured.push(line);
        continue;
      }

      if (capturing && level <= captureLevel) {
        // A same-or-higher-level heading that isn't a plan heading — stop.
        break;
      }
    }

    if (capturing) captured.push(line);
  }

  const text = captured.join('\n').trim();
  if (text.length >= 100) return text;

  // Fallback: detect PR bodies that are primarily a task checklist (no plan
  // heading, but ≥ 3 checkbox items). The entire body is returned here — it is
  // still subject to the MAX_PLAN_CONTENT_CHARS cap in assemblePrompt and
  // wrapped in <untrusted> tags, so INJECTION_GUARD applies.
  const taskItems = (markdown.match(/^\s*-\s+\[[ xX]\]/gm) ?? []).length;
  if (taskItems >= 3) {
    const trimmed = markdown.trim();
    return trimmed.length >= 100 ? trimmed : null;
  }

  return null;
}
