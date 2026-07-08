import { z } from 'zod';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----
export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  risk_areas: z.array(z.string()),
});
export type Intent = z.infer<typeof Intent>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
  // Optional index-health signals. Absent/false on the persistent (full) path;
  // `degraded: true` + `reason` when served from the best-effort fallback or an
  // unindexed repo, so the UI can show a badge instead of a blank screen.
  degraded: z.boolean().optional(),
  reason: z.string().optional(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Blast radius: optional AI explanation ----
// On-demand, one cheap LLM call turning the deterministic map into a paragraph.
// Persisted per PR; the base map itself never calls a model.
export const BlastExplanation = z.object({
  explanation: z.string(),
  model: z.string(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  generated_at: z.string(),
});
export type BlastExplanation = z.infer<typeof BlastExplanation>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

// ---- PR Brief (structured synthesis of intent + blast + smart-diff) ----
export const Brief = z.object({
  what: z.string(),                               // What the PR changes (1 paragraph)
  why: z.string(),                                // Why it is needed (1 paragraph)
  risk_level: z.enum(['low', 'medium', 'high']), // Overall merge-risk verdict
  risks: z.array(Risk),                           // Individual risks — file_refs validated
  review_focus: z.array(z.string()),              // Ordered areas/files to prioritise
  // Optional oversized-PR signals. Absent unless too_big was true at generation time;
  // `degraded: true` + `degraded_reason` when the PR exceeded the diff-size cap,
  // so the UI can show a caveat banner instead of presenting the summary as complete.
  degraded: z.boolean().optional(),       // NEW — absent unless too_big was true at generation time
  degraded_reason: z.string().optional(), // NEW — non-empty string with total_lines when degraded is true
});
export type Brief = z.infer<typeof Brief>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

