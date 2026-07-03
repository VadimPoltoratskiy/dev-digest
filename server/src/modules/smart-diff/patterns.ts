import type { SmartDiffRole } from '@devdigest/shared';

/**
 * Path patterns for Smart Diff's risk classification. Checked in order —
 * boilerplate first, then wiring, everything else defaults to `core`
 * (see `classifier.ts`). Kept as data here (not inline in the classifier) so
 * thresholds/patterns can be tuned without touching the classification logic.
 */
export const BOILERPLATE_PATTERNS: RegExp[] = [
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/,
  /(^|\/)(dist|build|coverage|\.next|node_modules)\//,
  /\.snap$/,
  /(^|\/)__snapshots__\//,
];

export const WIRING_PATTERNS: RegExp[] = [
  /(^|\/)index\.(t|j)sx?$/,
  /(^|\/)(routes|server|app)\.ts$/,
  /(^|\/)modules\/index\.ts$/,
  /(^|\/)package\.json$/,
  /\.config\.(t|j)s$/,
  /(^|\/)config(\.|\/)/,
];

export const DEFAULT_ROLE: SmartDiffRole = 'core';

/** `split_suggestion.too_big` fires when the PR's total additions+deletions exceed this. */
export const TOTAL_LINES_TOO_BIG_THRESHOLD = 400;
