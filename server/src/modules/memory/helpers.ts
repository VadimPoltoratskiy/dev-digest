/**
 * Memory module — pure helper functions.
 * No side effects, no DB or adapter access. Testable in isolation.
 */

import type { MemoryRecord, MemorySource } from '@devdigest/shared';
import type { MemoryRow } from './repository.js';
import { STALE_DAYS } from './constants.js';

/**
 * Map a DB row to the MemoryRecord contract DTO.
 * Converts camelCase Date fields to ISO strings, casts jsonb sources.
 */
export function toMemoryRecord(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    content: row.content,
    scope: row.scope as MemoryRecord['scope'],
    kind: row.kind as MemoryRecord['kind'],
    confidence: row.confidence ?? 0,
    sources: (row.sources ?? []) as MemorySource[],
    updated_at: row.updatedAt.toISOString(),
    last_used_at: row.lastUsedAt?.toISOString() ?? null,
  };
}

// Regex patterns for the write-time curate gate (AC-7).
const INJECTION_TAG_RE = /<\/untrusted>|<untrusted/gi;

// Defense-in-depth: neutralizes common prompt-injection openers on a per-line basis.
// This slot is TRUSTED by design — local memory written via the studio UI goes
// through this gate, NOT the untrusted CI path. Changing that trust model requires
// a deliberate product decision, not a code change here.
// This denylist is best-effort sanitization only; it is not a complete security
// guarantee. Residual risk is accepted for the single-writer studio model and
// should be revisited before multi-user rollout.
const INJECTION_OPENER_RE =
  /^(ignore|disregard|forget|you are now|act as|from now on|pretend|override|new instructions?|system:|assistant:|<system)/i;

/**
 * Write-time sanitize gate (AC-7).
 * Strips </untrusted> / <untrusted tag attempts to prevent delimiter escaping,
 * and removes lines that match common prompt-injection openers (case-insensitive),
 * including: ignore/disregard/forget, you are now, act as, from now on, pretend,
 * override, new instructions, system:, assistant:, <system.
 * Returns the sanitised content — the record is persisted, not rejected.
 */
export function curateContent(text: string): string {
  const noTags = text.replace(INJECTION_TAG_RE, '');
  const lines = noTags.split('\n');
  const filtered = lines.filter((line) => !INJECTION_OPENER_RE.test(line.trim()));
  return filtered.join('\n').trim();
}

/**
 * Render a single memory row as an injection string for the reviewer prompt.
 * Format: `[kind/scope conf:N.NN] content`
 */
export function formatForInjection(record: MemoryRow): string {
  return `[${record.kind}/${record.scope} conf:${record.confidence ?? 0}] ${record.content}`;
}

/**
 * Returns true when the record has not been used or updated in STALE_DAYS.
 * Uses lastUsedAt if available, otherwise falls back to updatedAt.
 */
export function isStale(row: MemoryRow): boolean {
  const lastActivity = row.lastUsedAt ?? row.updatedAt;
  return lastActivity.getTime() < Date.now() - STALE_DAYS * 86_400 * 1_000;
}

/**
 * Serialise a memory row to a MemoryItem-shaped JSON line (for JSONL export).
 * Picks only the fields that belong to MemoryItem; no id/timestamps.
 */
export function buildMemoryJsonlLine(row: MemoryRow): string {
  const item = {
    content: row.content,
    scope: row.scope,
    kind: row.kind,
    confidence: row.confidence ?? 0,
    sources: (row.sources ?? []) as MemorySource[],
  };
  return JSON.stringify(item);
}
