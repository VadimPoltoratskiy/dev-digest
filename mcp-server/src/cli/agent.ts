import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
} from '@devdigest/server/db/seed-prompts.js';

/**
 * The built-in reviewer agents, reusing the EXACT system prompts the product
 * seeds into the DB (server/src/db/seed-prompts.ts). Standalone has no DB, so
 * we import the prompt constants directly — same agent, different entry point.
 *
 * Note: the product's agents also inject linked skills (onion-architecture,
 * etc.) stored in the DB. Those are unavailable standalone, so the CLI runs the
 * base prompt only (reviewPullRequest simply omits the skills section).
 */
export type AgentName = 'general' | 'security' | 'performance' | 'test';

export const AGENT_NAMES: readonly AgentName[] = ['general', 'security', 'performance', 'test'] as const;

const PROMPTS: Record<AgentName, string> = {
  general: GENERAL_REVIEWER_PROMPT,
  security: SECURITY_REVIEWER_PROMPT,
  performance: PERFORMANCE_REVIEWER_PROMPT,
  test: TEST_QUALITY_REVIEWER_PROMPT,
};

/**
 * Default model — matches the seeded reviewers (DEFAULT_MODEL in
 * server/src/db/seed.ts). OpenRouter is the one provider reviewer-core ships,
 * so the standalone CLI needs only an OPENROUTER_API_KEY. Overridable via --model.
 */
export const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

export function resolveAgent(name: AgentName): { systemPrompt: string } {
  return { systemPrompt: PROMPTS[name] };
}
