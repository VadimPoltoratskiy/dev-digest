import { Intent } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import type { PullRow } from '../../db/rows.js';
import type { Logger } from './run-executor.js';
import * as pullRepo from './repository/pull.repo.js';

/**
 * IntentClassifier — one cheap LLM call per PR.
 *
 * Input: PR title + body + linked issue (if any) + file paths + hunk headers.
 * No diff bodies — this is the whole point. `savedTokensEstimate` records
 * how many tokens we saved vs. sending the full diff.
 *
 * The classifier uses the `review_intent` feature model from workspace settings
 * (default: openrouter/google/gemini-2.0-flash-exp).
 */
export class IntentClassifier {
  constructor(private container: Container) {}

  async classify(
    workspaceId: string,
    pull: PullRow,
    opts: { force?: boolean; logger?: Logger } = {},
  ): Promise<pullRepo.IntentSaveParams> {
    const db = this.container.db;

    // Skip if already classified and not forced.
    if (!opts.force) {
      const existing = await pullRepo.getIntent(db, pull.id);
      if (existing) return existing as pullRepo.IntentSaveParams;
    }

    // Resolve the feature model (provider + model string) from settings.
    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'review_intent');
    const llm = await this.container.llm(provider as Parameters<typeof this.container.llm>[0]);

    // Load changed files from DB (paths + hunk headers only — no full patch bodies).
    const files = await pullRepo.getPrFiles(db, pull.id);

    // Estimate total diff chars for savings calculation.
    const totalDiffChars = files.reduce((n, f) => n + (f.patch?.length ?? 0), 0);

    // Build compact input: hunk headers = lines starting with "@@" in the patch.
    const fileLines = files
      .map((f) => {
        const headers = (f.patch ?? '')
          .split('\n')
          .filter((l) => l.startsWith('@@'))
          .join('\n');
        return headers ? `${f.path}\n${headers}` : f.path;
      })
      .join('\n');

    // Linked issue: resolve from linked_issue column on pullRequests if populated,
    // otherwise parse PR body for "#NNN" / "closes #NNN" references.
    const linkedIssueText = await this.resolveLinkedIssue(workspaceId, pull);

    const userMessage = buildClassifierPrompt(pull.title, pull.body ?? '', linkedIssueText, fileLines);

    const result = await llm.completeStructured<typeof Intent._type>({
      model,
      schema: Intent,
      schemaName: 'Intent',
      messages: [
        { role: 'system', content: CLASSIFIER_SYSTEM },
        { role: 'user', content: userMessage },
      ],
      maxRetries: 1,
    });

    const savedTokensEstimate = Math.max(
      0,
      Math.round(totalDiffChars / 4) - result.tokensIn,
    );

    opts.logger?.info(
      { prId: pull.id, model, tokensIn: result.tokensIn, tokensOut: result.tokensOut, savedTokensEstimate },
      'intent-classifier: classified PR intent',
    );

    return {
      ...result.data,
      classifierModel: model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      savedTokensEstimate,
    };
  }

  private async resolveLinkedIssue(workspaceId: string, pull: PullRow): Promise<string> {
    if (!pull.body) return '';
    const match = pull.body.match(/(?:closes?|fixes?|resolves?)\s+#(\d+)/i)
      ?? pull.body.match(/#(\d+)/);
    if (!match) return '';
    const issueNumber = Number(match[1]);
    try {
      const repo = await pullRepo.getRepo(this.container.db, pull.repoId);
      if (!repo) return '';
      const gh = await this.container.github();
      const issue = await gh.getIssue({ owner: repo.owner, name: repo.name }, issueNumber);
      const parts: string[] = [`Issue #${issue.number}: ${issue.title}`];
      if (issue.body) parts.push(issue.body.slice(0, 2000));
      return parts.join('\n');
    } catch {
      return '';
    }
  }
}

// ---- prompt helpers --------------------------------------------------------

const CLASSIFIER_SYSTEM =
  'You are a senior engineering lead analyzing a pull request. ' +
  'Given the PR title, body, optional linked issue, and a compact list of changed ' +
  'files with hunk headers, extract the PR\'s intent in structured form. ' +
  'Be concise: each item in in_scope, out_of_scope, and risk_areas should be a ' +
  'short phrase (3-10 words). Produce 2-5 items per list. ' +
  'risk_areas are things that could go wrong or deserve extra attention ' +
  '(new dependencies, auth surface changes, data migrations, performance hot paths, etc.).';

function buildClassifierPrompt(
  title: string,
  body: string,
  linkedIssue: string,
  fileLines: string,
): string {
  const parts: string[] = [`PR Title: ${title}`];
  if (body.trim()) parts.push(`PR Body:\n${body.slice(0, 3000)}`);
  if (linkedIssue) parts.push(`Linked Issue:\n${linkedIssue}`);
  parts.push(`Changed files and hunk headers:\n${fileLines}`);
  return parts.join('\n\n');
}
