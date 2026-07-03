import type { ReviewDto, ReviewDtoFinding } from '../reviews/helpers.js';

const BATCH_WINDOW_MS = 5 * 60 * 1000;

/**
 * The "last review"'s findings for Smart Diff's badges. Mirrors
 * `latestBatchFindings` in `client/src/components/FindingsCounter/FindingsCounter.tsx`
 * (kind === 'review', newest batch within a 5-minute window, dismissed
 * findings excluded) so this endpoint's counts agree with what
 * `FindingsCounter` already shows elsewhere on the same PR page. Keep the two
 * in sync if either changes.
 */
export function latestBatchFindings(reviews: ReviewDto[]): ReviewDtoFinding[] {
  const reviewOnly = reviews.filter((r) => r.kind === 'review' && r.findings.length > 0);
  if (reviewOnly.length === 0) return [];
  const latestMs = Math.max(...reviewOnly.map((r) => Date.parse(r.created_at)));
  return reviewOnly
    .filter((r) => latestMs - Date.parse(r.created_at) <= BATCH_WINDOW_MS)
    .flatMap((r) => r.findings)
    .filter((f) => !f.dismissed_at);
}
