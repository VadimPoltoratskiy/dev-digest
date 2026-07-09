import { z } from 'zod';

/**
 * A single prior pull request that touched a given file path.
 * PriorPr fields map directly to pullRequests columns.
 * opened_at is nullable because pullRequests.openedAt is nullable in the DB.
 */
export const PriorPr = z.object({
  number:    z.number().int(),
  title:     z.string(),
  author:    z.string(),
  status:    z.string(),
  opened_at: z.string().nullable(),
});
export type PriorPr = z.infer<typeof PriorPr>;

/**
 * Response shape for GET /pulls/:id/files/prior-prs.
 * items: newest-first, at most 10.
 * total: full count before the 10-item cap (COUNT(*) OVER() window — no second round-trip).
 */
export const PriorPrList = z.object({
  items: z.array(PriorPr),
  total: z.number().int(),
});
export type PriorPrList = z.infer<typeof PriorPrList>;
