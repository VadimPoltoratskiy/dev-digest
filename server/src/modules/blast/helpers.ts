import type { BlastRadius, DownstreamImpact } from '@devdigest/shared';
import type { BlastResult } from '../repo-intel/types.js';

/**
 * Map the repo-intel facade's `BlastResult` (camelCase, flat caller list) onto
 * the `BlastRadius` API contract (snake_case, callers grouped by the changed
 * symbol they reach). Pure — no I/O, deterministic, no model call.
 *
 * Endpoint/cron attribution:
 *  - persistent path → `factsByFile` present: attribute per caller file, so each
 *    downstream group lists only the endpoints/crons its callers actually touch.
 *  - degraded path → `factsByFile` absent: attach the flat `impactedEndpoints`
 *    union to every group (best-effort; the response is flagged `degraded`).
 */
export function toBlastRadius(result: BlastResult): BlastRadius {
  const changed_symbols = result.changedSymbols.map((s) => ({
    name: s.name,
    file: s.file,
    kind: s.kind,
  }));

  const groups = new Map<string, DownstreamImpact>();
  for (const c of result.callers) {
    let group = groups.get(c.viaSymbol);
    if (!group) {
      group = { symbol: c.viaSymbol, callers: [], endpoints_affected: [], crons_affected: [] };
      groups.set(c.viaSymbol, group);
    }
    group.callers.push({ name: c.symbol, file: c.file, line: c.line });
  }

  const globalEndpoints = [...new Set(result.impactedEndpoints)];
  for (const group of groups.values()) {
    if (result.factsByFile) {
      const endpoints = new Set<string>();
      const crons = new Set<string>();
      for (const caller of group.callers) {
        const facts = result.factsByFile[caller.file];
        if (!facts) continue;
        for (const e of facts.endpoints) endpoints.add(e);
        for (const cron of facts.crons) crons.add(cron);
      }
      group.endpoints_affected = [...endpoints];
      group.crons_affected = [...crons];
    } else {
      group.endpoints_affected = globalEndpoints;
      group.crons_affected = [];
    }
  }

  const downstream = [...groups.values()];
  const endpointCount = new Set(downstream.flatMap((d) => d.endpoints_affected)).size;

  const radius: BlastRadius = {
    changed_symbols,
    downstream,
    summary: buildSummary({
      symbols: changed_symbols.length,
      callers: result.callers.length,
      endpoints: endpointCount,
      degraded: result.degraded ?? false,
    }),
  };
  if (result.degraded) {
    radius.degraded = true;
    if (result.reason) radius.reason = result.reason;
  }
  return radius;
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

function buildSummary(x: {
  symbols: number;
  callers: number;
  endpoints: number;
  degraded: boolean;
}): string {
  if (x.symbols === 0) {
    return x.degraded
      ? 'Blast radius unavailable — the repo index is incomplete, so impact could not be computed.'
      : 'No indexed symbols were found in the changed files, so there is no downstream impact.';
  }
  const sym = `${x.symbols} changed ${plural(x.symbols, 'symbol')}`;
  const cal = x.callers === 0 ? 'no callers' : `${x.callers} ${plural(x.callers, 'caller')}`;
  const ep = `${x.endpoints} ${plural(x.endpoints, 'endpoint')}`;
  let summary = `${sym} reach ${cal} across ${ep}.`;
  if (x.degraded) {
    summary += ' Index is incomplete — results are best-effort and may be partial.';
  }
  return summary;
}
