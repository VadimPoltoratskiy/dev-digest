import type { BlastRadius } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { resolveFeatureModel } from '../settings/feature-models.js';

export interface BlastExplainResult {
  explanation: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

interface Logger {
  info(obj: object, msg: string): void;
}

/**
 * BlastExplainer — the feature's ONLY LLM call. One cheap completion that turns
 * the deterministic blast map into a single reviewer-friendly paragraph. Uses
 * the `blast_explain` feature model from workspace settings (default: a fast
 * flash-class model). Mirrors IntentClassifier, but returns free text.
 */
export class BlastExplainer {
  constructor(private container: Container) {}

  async explain(
    workspaceId: string,
    blast: BlastRadius,
    opts: { logger?: Logger } = {},
  ): Promise<BlastExplainResult> {
    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'blast_explain');
    const llm = await this.container.llm(provider as Parameters<typeof this.container.llm>[0]);

    const result = await llm.complete({
      model,
      maxTokens: 400,
      messages: [
        { role: 'system', content: EXPLAIN_SYSTEM },
        { role: 'user', content: buildBlastPrompt(blast) },
      ],
    });

    opts.logger?.info(
      { model, tokensIn: result.tokensIn, tokensOut: result.tokensOut },
      'blast-explainer: explained blast radius',
    );

    return {
      explanation: result.text.trim(),
      model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
    };
  }
}

// ---- prompt helpers --------------------------------------------------------

const EXPLAIN_SYSTEM =
  "You are a senior engineer helping a reviewer understand a pull request's blast radius — " +
  'which symbols it changed, who calls them, and which HTTP endpoints and cron jobs are ' +
  'downstream. Given the structured blast map, write ONE tight paragraph (3-5 sentences) in ' +
  'plain English that a reviewer can skim: what the change touches, the most important reachable ' +
  'callers and endpoints, and where to look hardest before merging. Be concrete — name the key ' +
  'symbols and endpoints. No lists, no headings, no preamble; just the paragraph.';

function buildBlastPrompt(blast: BlastRadius): string {
  const parts: string[] = [`Deterministic summary: ${blast.summary}`];
  if (blast.degraded) {
    parts.push('Note: the repo index is partial, so this map may be incomplete.');
  }
  const symbols = blast.changed_symbols
    .map((s) => `${s.name} (${s.kind}) in ${s.file}`)
    .join('; ');
  parts.push(`Changed symbols: ${symbols || 'none'}`);
  for (const d of blast.downstream) {
    const callers = d.callers.map((c) => `${c.name} @ ${c.file}:${c.line}`).join(', ') || 'none';
    const endpoints = d.endpoints_affected.join(', ') || 'none';
    const crons = d.crons_affected.join(', ') || 'none';
    parts.push(`Symbol ${d.symbol} — callers: ${callers}; endpoints: ${endpoints}; crons: ${crons}`);
  }
  return parts.join('\n');
}
