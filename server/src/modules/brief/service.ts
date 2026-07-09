import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Brief } from '@devdigest/shared';
import type { BlastRadius, SmartDiff, BriefTimeline } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ExternalServiceError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { BlastService } from '../blast/service.js';
import { SmartDiffService } from '../smart-diff/service.js';
import { ProjectContextService } from '../project-context/service.js';
import { getIntent, type IntentRecord } from '../reviews/repository/pull.repo.js';
import { getBrief, upsertBrief, listBriefHistory } from './repository.js';
import { BRIEF_SYSTEM_PROMPT } from './prompts.js';

// ---- Narrow LLM output schema (SPEC-02 bug fix) ----------------------------
// The full `Brief` schema includes optional `degraded`/`degraded_reason` fields
// that MUST be set server-side only (SPEC-02 AC-2/AC-3). Passing the full `Brief`
// to the LLM as its expected response schema would cause a real model to fill those
// fields in unprompted. Use this narrower schema for the LLM call so Zod strips
// any model-invented values before the deterministic stamp logic runs.
const BriefLlmOutput = Brief.omit({ degraded: true, degraded_reason: true });
type BriefLlmOutput = z.infer<typeof BriefLlmOutput>;

// ---- Budget constants (AC-7) -----------------------------------------------
// Maximum characters for the assembled user-message.
const MAX_USER_MESSAGE_CHARS = 8192;
// Per-file and total caps for context doc excerpts.
const MAX_CTX_CHARS_PER_FILE = 2000;
const MAX_CTX_TOTAL_CHARS = 4000;
// Hard cap on PR body included in the prompt.
const MAX_PR_BODY_CHARS = 500;

// ---- Logger interface -------------------------------------------------------
export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}

// ---- Internal types --------------------------------------------------------
type PullRow = typeof t.pullRequests.$inferSelect;

/**
 * BriefService — one structured LLM call per PR; cached in `pr_brief`.
 *
 * Layer boundaries:
 * - Accesses adapters (llm) only through the DI container.
 * - Never imports or touches req/res objects.
 * - Uses BlastService/SmartDiffService/ProjectContextService for domain data.
 */
export class BriefService {
  constructor(private container: Container) {}

  /**
   * Return the cached brief for a PR, or null if none has been generated.
   * Enforces workspace scope (404 if the PR doesn't belong to the workspace).
   */
  async get(workspaceId: string, prId: string): Promise<Brief | null> {
    await this.loadPull(workspaceId, prId); // 404 guard + workspace scope
    return getBrief(this.container.db, prId);
  }

  /**
   * BriefTimeline — every previously generated brief for a PR, newest first,
   * one entry per distinct head SHA. Empty `entries: []` when none exist yet
   * (not a 404 — an empty history is a normal state, unlike the single-brief
   * GET which 404s to mean "never generated").
   */
  async getHistory(workspaceId: string, prId: string): Promise<BriefTimeline> {
    await this.loadPull(workspaceId, prId); // 404 guard + workspace scope
    const entries = await listBriefHistory(this.container.db, prId);
    return { entries };
  }

  /**
   * Generate (or return cached) brief for a PR.
   *
   * Flow:
   *  1. Workspace guard (AC-4)
   *  2. Cache check — return cached if not forced (AC-1, AC-3)
   *  3. Load intent, blast, smart-diff, context docs, linked-issue ref
   *  4. Assemble user-message with 8192-char budget (AC-7)
   *  5. Resolve feature model + call LLM (AC-5)
   *  6. Validate file_refs (AC-6)
   *  7. Upsert + return (AC-5, AC-8)
   */
  async generate(
    workspaceId: string,
    prId: string,
    opts: { force?: boolean; logger?: Logger } = {},
  ): Promise<Brief> {
    const db = this.container.db;
    const pull = await this.loadPull(workspaceId, prId); // AC-4

    // --- Cache/force check (AC-1, AC-3) ------------------------------------
    if (!opts.force) {
      const existing = await getBrief(db, prId);
      if (existing) return existing;
    }

    // --- Load supporting data -----------------------------------------------

    // Intent: best-effort — proceed without it if no row (AC-9).
    // Cross-module read: use the reviews module's repository function rather
    // than querying the prIntent table directly (architecture boundary rule).
    const intentRow: IntentRecord | null = (await getIntent(db, prId)) ?? null;

    // Blast radius (degraded path is silent — service handles it internally)
    const blast = await new BlastService(this.container).buildForPull(workspaceId, prId);

    // Smart diff (same degraded tolerance)
    const smartDiff = await new SmartDiffService(this.container).buildForPull(workspaceId, prId);

    // Context docs — best-effort; catch anything (not cloned, no docs, etc.)
    const contextDocExcerpts = await this.loadContextDocs(workspaceId, pull.repoId);

    // Linked-issue: regex only, NO GitHub API call (Architecture Decision)
    const linkedIssueMatch = pull.body?.match(/(?:closes?|fixes?|resolves?)\s+#(\d+)/i);
    const linkedIssueRef = linkedIssueMatch ? `Linked issue: #${linkedIssueMatch[1]}` : null;

    // --- Assemble user-message (AC-7) ----------------------------------------
    const userMessage = this.assembleUserMessage({
      pull,
      intentRow,
      blast,
      smartDiff,
      contextDocExcerpts,
      linkedIssueRef,
      logger: opts.logger,
    });

    // --- Resolve feature model -----------------------------------------------
    const { provider, model } = await resolveFeatureModel(
      this.container,
      workspaceId,
      'risk_brief',
    );
    const llm = await this.container.llm(provider as Parameters<typeof this.container.llm>[0]);

    // --- LLM call (AC-5) -------------------------------------------------------
    // Use the narrower BriefLlmOutput schema (excludes degraded/degraded_reason)
    // so the model is never shown those fields and cannot fill them in itself.
    // Zod strips any extra keys the model might still emit. (SPEC-02 bug fix)
    let result: Awaited<ReturnType<typeof llm.completeStructured<BriefLlmOutput>>>;
    try {
      result = await llm.completeStructured({
        model,
        schema: BriefLlmOutput,
        schemaName: 'BriefLlmOutput',
        messages: [
          { role: 'system', content: BRIEF_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        maxRetries: 1,
      });
    } catch (err) {
      // On LLM failure: throw without touching the cache (Architecture Decision)
      throw new ExternalServiceError('LLM generation failed for PR brief', {
        cause: (err as Error).message,
      });
    }

    // --- file_refs validation (AC-6) -----------------------------------------
    const validFileSet = this.buildValidFileSet(blast, smartDiff);
    const validatedBrief = this.filterFileRefs(
      result.data,
      validFileSet,
      prId,
      opts.logger,
    );

    // Stamp with degraded signal if the PR was too large to fully summarise (SPEC-02 AC-1/AC-2)
    const finalBrief: Brief = smartDiff.split_suggestion.too_big
      ? {
          ...validatedBrief,
          degraded: true,
          degraded_reason: `PR too large (${smartDiff.split_suggestion.total_lines} lines) — this summary may not reflect all changes`,
        }
      : validatedBrief;

    // --- Persist (AC-5, AC-8) ------------------------------------------------
    // Keyed by (prId, pull.headSha) — regenerating at an unchanged head SHA
    // updates that SHA's row in place; a new commit inserts a new row,
    // retaining prior generations as BriefTimeline history.
    await upsertBrief(db, prId, pull.headSha, {
      json: finalBrief,
      model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
    });

    // --- Observability (AC-5) ------------------------------------------------
    opts.logger?.info(
      {
        prId,
        model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: result.costUsd,
        promptChars: userMessage.length,
      },
      'brief: generated PR brief',
    );

    return finalBrief;
  }

  // ---- Private helpers -------------------------------------------------------

  /**
   * Workspace-scoped PR lookup. Mirrors BlastService.loadPull() exactly.
   * Throws NotFoundError when the PR doesn't belong to the workspace (AC-4).
   */
  private async loadPull(workspaceId: string, prId: string): Promise<PullRow> {
    const [pr] = await this.container.db
      .select()
      .from(t.pullRequests)
      .where(
        and(
          eq(t.pullRequests.workspaceId, workspaceId),
          eq(t.pullRequests.id, prId),
        ),
      );
    if (!pr) throw new NotFoundError('Pull request not found');
    return pr;
  }

  /**
   * Load context doc excerpts from the repo clone.
   * Best-effort: returns [] on any error (repo not cloned, no docs, etc.)
   * Per-file cap: MAX_CTX_CHARS_PER_FILE; total cap: MAX_CTX_TOTAL_CHARS.
   */
  private async loadContextDocs(workspaceId: string, repoId: string): Promise<string[]> {
    try {
      const svc = new ProjectContextService(this.container);
      const specFiles = await svc.list(workspaceId, repoId);

      const excerpts: string[] = [];
      let totalChars = 0;

      for (const file of specFiles) {
        if (totalChars >= MAX_CTX_TOTAL_CHARS) break;
        if (!file.content) continue;

        const capped =
          file.content.length > MAX_CTX_CHARS_PER_FILE
            ? file.content.slice(0, MAX_CTX_CHARS_PER_FILE) + '\n... (truncated)'
            : file.content;

        const remaining = MAX_CTX_TOTAL_CHARS - totalChars;
        const excerpt = capped.length > remaining ? capped.slice(0, remaining) : capped;

        excerpts.push(`### ${file.path}\n${excerpt}`);
        totalChars += excerpt.length;
      }

      return excerpts;
    } catch {
      // Any failure (repo not cloned, no clone path, etc.) degrades gracefully.
      return [];
    }
  }

  /**
   * Build the set of valid file paths from blast + smart-diff data.
   * Used for AC-6 file_refs validation.
   */
  private buildValidFileSet(blast: BlastRadius, smartDiff: SmartDiff): Set<string> {
    const validFiles = new Set<string>();

    for (const sym of blast.changed_symbols) {
      validFiles.add(sym.file);
    }
    for (const d of blast.downstream) {
      for (const c of d.callers) {
        validFiles.add(c.file);
      }
    }
    for (const group of smartDiff.groups) {
      for (const f of group.files) {
        validFiles.add(f.path);
      }
    }

    return validFiles;
  }

  /**
   * Remove hallucinated file_refs entries from every risk in the Brief (AC-6).
   * Risks with an empty file_refs after filtering are KEPT (not dropped).
   * Emits a WARN log per removed path.
   *
   * Accepts BriefLlmOutput (the narrowed LLM schema without degraded fields)
   * and returns the same type. The `too_big` stamp applied afterward widens
   * the result to a full `Brief` when needed.
   */
  private filterFileRefs(
    brief: BriefLlmOutput,
    validFileSet: Set<string>,
    prId: string,
    logger?: Logger,
  ): BriefLlmOutput {
    const risks = brief.risks.map((risk) => {
      const filteredRefs: string[] = [];
      for (const ref of risk.file_refs) {
        if (validFileSet.has(ref)) {
          filteredRefs.push(ref);
        } else {
          logger?.warn(
            { prId, riskTitle: risk.title, excludedPath: ref },
            'brief: removed hallucinated file_refs entry',
          );
        }
      }
      return { ...risk, file_refs: filteredRefs };
    });
    return { ...brief, risks };
  }

  /**
   * Assemble the LLM user-message from available slots (AC-7).
   * Slot order is defined in Architecture Decisions. Total budget: 8192 chars.
   * Trim strategy: context docs first, then PR body.
   */
  private assembleUserMessage(params: {
    pull: PullRow;
    intentRow: IntentRecord | null;
    blast: BlastRadius;
    smartDiff: SmartDiff;
    contextDocExcerpts: string[];
    linkedIssueRef: string | null;
    logger?: Logger;
  }): string {
    const { pull, intentRow, blast, smartDiff, contextDocExcerpts, linkedIssueRef, logger } =
      params;

    // ---- Fixed slots (never trimmed) ----------------------------------------
    const fixedParts: string[] = [];

    // Slot 1: PR title — wrapped as an untrusted data section (INJECTION_GUARD).
    // PR author controls the title, so it must be enclosed in === delimiters
    // so the system prompt's trust model treats it as data, not instructions.
    fixedParts.push(
      `=== PR TITLE (untrusted author content) ===\n${pull.title}\n=== END PR TITLE ===`,
    );

    // Slot 2: Intent fields (if cache row exists — AC-9 degrade if null)
    if (intentRow) {
      const intentParts: string[] = [`Intent: ${intentRow.intent}`];
      if (intentRow.in_scope.length > 0) {
        intentParts.push(`In scope: ${intentRow.in_scope.join('; ')}`);
      }
      if (intentRow.out_of_scope.length > 0) {
        intentParts.push(`Out of scope: ${intentRow.out_of_scope.join('; ')}`);
      }
      if (intentRow.risk_areas.length > 0) {
        intentParts.push(`Risk areas: ${intentRow.risk_areas.join('; ')}`);
      }
      fixedParts.push(intentParts.join('\n'));
    }

    // Slot 3: Blast-radius summary
    if (blast.summary) {
      fixedParts.push(`=== BLAST RADIUS ===\nSummary: ${blast.summary}`);
    }

    // Slot 4: Smart-diff file groups (role + file paths only; no pseudocode/finding_lines)
    const nonEmptyGroups = smartDiff.groups.filter((g) => g.files.length > 0);
    if (nonEmptyGroups.length > 0) {
      const groupLines = nonEmptyGroups.map((g) => {
        const paths = g.files.map((f) => `  - ${f.path}`).join('\n');
        return `${g.role}:\n${paths}`;
      });
      fixedParts.push(`=== SMART-DIFF FILE GROUPS ===\n${groupLines.join('\n')}`);
    }

    // Slot 5: Linked-issue reference (never trimmed)
    if (linkedIssueRef) {
      fixedParts.push(linkedIssueRef);
    }

    const fixedPart = fixedParts.join('\n\n');

    // ---- Trimable slots ------------------------------------------------------

    // Slot 6: PR body — hard cap at MAX_PR_BODY_CHARS (trimmed second)
    let prBodySlot = '';
    if (pull.body && pull.body.trim().length > 0) {
      const excerpt = pull.body.slice(0, MAX_PR_BODY_CHARS);
      prBodySlot = `=== PR BODY (untrusted author content) ===\n${excerpt}\n=== END PR BODY ===`;
    }

    // Slot 7: Context docs (trimmed first)
    let ctxSlot = '';
    if (contextDocExcerpts.length > 0) {
      ctxSlot =
        `=== CONTEXT DOCS (untrusted repo content) ===\n` +
        contextDocExcerpts.join('\n\n') +
        `\n=== END CONTEXT DOCS ===`;
    }

    // ---- Budget enforcement (AC-7) ------------------------------------------
    const SEP = '\n\n';

    const buildMessage = (fp: string, body: string, ctx: string): string =>
      [fp, body, ctx].filter(Boolean).join(SEP);

    let assembled = buildMessage(fixedPart, prBodySlot, ctxSlot);

    if (assembled.length > MAX_USER_MESSAGE_CHARS) {
      const excess = assembled.length - MAX_USER_MESSAGE_CHARS;

      // Trim context docs first
      if (ctxSlot.length > 0) {
        const ctxCut = Math.min(ctxSlot.length, excess);
        ctxSlot = ctxSlot.slice(0, ctxSlot.length - ctxCut);
        assembled = buildMessage(fixedPart, prBodySlot, ctxSlot);
      }

      // If still over budget, trim PR body second
      if (assembled.length > MAX_USER_MESSAGE_CHARS) {
        const excess2 = assembled.length - MAX_USER_MESSAGE_CHARS;
        if (prBodySlot.length > 0) {
          prBodySlot = prBodySlot.slice(0, Math.max(0, prBodySlot.length - excess2));
          assembled = buildMessage(fixedPart, prBodySlot, ctxSlot);
        }
      }

      logger?.warn(
        { prId: pull.id, originalLength: assembled.length + excess, trimmedLength: assembled.length },
        'brief: trimmed user-message to fit 8192-char budget',
      );
    }

    return assembled;
  }
}
