/**
 * Memory module — static configuration constants.
 * All policy knobs live here so service.ts and repository.ts have
 * a single read-chokepoint and no magic numbers.
 */

/** Maximum number of records returned by semantic/text retrieval (top-K). */
export const RETRIEVAL_K = 8;

/** Minimum confidence score for a record to be pulled into prompt context. */
export const CONFIDENCE_FLOOR = 0.5;

/**
 * Approximate character budget for injected memory strings.
 * ≈1500 tokens × 4 chars/token.  Prevents token-budget overruns in
 * the reviewer prompt when many high-confidence records match.
 */
export const MEMORY_TOKEN_BUDGET_CHARS = 6000;

/** Records not used/updated in this many days are considered stale. */
export const STALE_DAYS = 60;
