import { describe, it, expect } from 'vitest';
import { toBlastRadius } from './helpers.js';
import type { BlastResult } from '../repo-intel/types.js';

describe('toBlastRadius', () => {
  it('groups callers by viaSymbol and attributes per-file facts (persistent path)', () => {
    const result: BlastResult = {
      changedSymbols: [{ file: 'src/shared/helper.ts', name: 'rateLimit', kind: 'function' }],
      callers: [
        { file: 'src/api/public/index.ts', symbol: 'handler', viaSymbol: 'rateLimit', line: 23, rank: 5 },
        { file: 'src/api/public/webhooks.ts', symbol: 'webhook', viaSymbol: 'rateLimit', line: 45, rank: 3 },
      ],
      impactedEndpoints: ['GET /api/public/items', 'POST /api/public/webhooks'],
      factsByFile: {
        'src/api/public/index.ts': { endpoints: ['GET /api/public/items'], crons: [] },
        'src/api/public/webhooks.ts': {
          endpoints: ['POST /api/public/webhooks'],
          crons: ['reset-rate-buckets (hourly)'],
        },
      },
      degraded: false,
    };

    const blast = toBlastRadius(result);

    expect(blast.changed_symbols).toEqual([
      { name: 'rateLimit', file: 'src/shared/helper.ts', kind: 'function' },
    ]);
    expect(blast.downstream).toHaveLength(1);
    const group = blast.downstream[0]!;
    expect(group.symbol).toBe('rateLimit');
    expect(group.callers).toHaveLength(2);
    expect(group.callers).toEqual([
      { name: 'handler', file: 'src/api/public/index.ts', line: 23 },
      { name: 'webhook', file: 'src/api/public/webhooks.ts', line: 45 },
    ]);
    expect(group.endpoints_affected.sort()).toEqual([
      'GET /api/public/items',
      'POST /api/public/webhooks',
    ]);
    expect(group.crons_affected).toEqual(['reset-rate-buckets (hourly)']);
    expect(blast.degraded).toBeUndefined();
    expect(blast.summary).toBe('1 changed symbol reach 2 callers across 2 endpoints.');
  });

  it('splits callers into separate downstream groups per changed symbol', () => {
    const result: BlastResult = {
      changedSymbols: [
        { file: 'src/shared/helper.ts', name: 'rateLimit', kind: 'function' },
        { file: 'src/shared/helper.ts', name: 'bucketKey', kind: 'function' },
      ],
      callers: [
        { file: 'a.ts', symbol: 'x', viaSymbol: 'rateLimit', line: 1, rank: 0 },
        { file: 'b.ts', symbol: 'y', viaSymbol: 'bucketKey', line: 2, rank: 0 },
      ],
      impactedEndpoints: [],
      factsByFile: {},
      degraded: false,
    };

    const blast = toBlastRadius(result);
    expect(blast.downstream.map((d) => d.symbol).sort()).toEqual(['bucketKey', 'rateLimit']);
  });

  it('flags degraded and falls back to the flat endpoint union (no factsByFile)', () => {
    const result: BlastResult = {
      changedSymbols: [{ file: 'src/x.ts', name: 'foo', kind: 'function' }],
      callers: [{ file: 'y.ts', symbol: 'bar', viaSymbol: 'foo', line: 10, rank: 0 }],
      impactedEndpoints: ['GET /a'],
      degraded: true,
      reason: 'no_data',
    };

    const blast = toBlastRadius(result);
    expect(blast.degraded).toBe(true);
    expect(blast.reason).toBe('no_data');
    expect(blast.downstream[0]!.endpoints_affected).toEqual(['GET /a']);
    expect(blast.downstream[0]!.crons_affected).toEqual([]);
    expect(blast.summary).toContain('best-effort');
  });

  it('returns an empty-but-valid radius when there are no changed symbols', () => {
    const result: BlastResult = {
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: false,
    };
    const blast = toBlastRadius(result);
    expect(blast.changed_symbols).toEqual([]);
    expect(blast.downstream).toEqual([]);
    expect(blast.summary).toContain('no downstream impact');
  });
});
