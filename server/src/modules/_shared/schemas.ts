import { z } from 'zod';

/**
 * Shared route param schemas. Most `/:id` routes address a DB row whose primary
 * key is a uuid (see db/schema/*), so validate that shape at the edge — an
 * invalid id becomes a clean 422 instead of a downstream DB/500.
 *
 * NOTE: not every `:id` is a uuid (e.g. `/providers/:id` where id is a provider
 * name like "openai"); those routes use their own schema.
 */
export const IdParams = z.object({ id: z.string().uuid() });
export type IdParams = z.infer<typeof IdParams>;

/**
 * Shared query-string schema for period-based analytics endpoints.
 * Validates preset strings and custom date ranges (YYYY-MM-DD).
 * Returns 422 automatically via Zod type provider on invalid input.
 */
export const PeriodParams = z.object({
  period: z.enum(['30d', '7d', '1d', 'custom']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine(
  (p) => p.period !== 'custom' || (p.from !== undefined && p.to !== undefined),
  { message: 'from and to are required when period=custom' },
).refine(
  (p) => {
    if (p.period !== 'custom' || !p.from || !p.to) return true;
    return p.from <= p.to;  // lexicographic compare works for YYYY-MM-DD
  },
  { message: 'from must be <= to' },
).refine(
  (p) => {
    if (p.period !== 'custom' || !p.from || !p.to) return true;
    const from = new Date(p.from + 'T00:00:00.000Z');
    const to   = new Date(p.to   + 'T23:59:59.999Z');
    const maxMs = 366 * 24 * 60 * 60 * 1000;   // bounded max span: ~1 year
    return (to.getTime() - from.getTime()) <= maxMs;
  },
  { message: 'custom range must not exceed one year' },
);
export type PeriodParams = z.infer<typeof PeriodParams>;
