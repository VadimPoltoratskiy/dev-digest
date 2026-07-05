import {
  reviewPullRequest,
  OpenRouterProvider,
  type ReviewEvent,
  type ReviewOutcome,
} from '@devdigest/reviewer-core';
import type { UnifiedDiff } from '@devdigest/shared';
import { parseUnifiedDiff } from '@devdigest/server/adapters/git/diff-parser.js';

export { parseUnifiedDiff };
export type { UnifiedDiff, ReviewOutcome };

/**
 * Run the SAME review engine the product uses (reviewer-core.reviewPullRequest)
 * on a parsed diff, with the OpenRouter provider reviewer-core ships. No DB, no
 * server — the diff and the agent prompt are the only inputs.
 */
export function runReview(opts: {
  diff: UnifiedDiff;
  systemPrompt: string;
  model: string;
  apiKey: string;
  onEvent?: (e: ReviewEvent) => void;
}): Promise<ReviewOutcome> {
  const llm = new OpenRouterProvider(opts.apiKey);
  return reviewPullRequest({
    systemPrompt: opts.systemPrompt,
    model: opts.model,
    diff: opts.diff,
    llm,
    ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
  });
}
