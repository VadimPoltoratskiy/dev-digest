/**
 * Case types + the runners that turn a data array into vitest tests. This module owns the ONE
 * true measure → (log) → assert body, so case authors never rewrite it — which is exactly what
 * keeps the "assert before record" bug from recurring once record() lands (T2 slots into the
 * marked spot below, in this one file).
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { DEFAULT_THRESHOLD, EVAL_MODEL } from "../config.js";
import { skillTask, agentTask, workflowTask } from "../tasks.js";
import { runClaude, type Result, type RunOptions } from "../runtime/run-claude.js";
import { patternMatch } from "../scoring/pattern-match.js";
import { llmJudge, type Verdict } from "../scoring/llm-judge.js";
import { logTrace, logVerdict } from "../logging/log.js";
import { record } from "../records/record.js";

// --- Case shapes ------------------------------------------------------------

/** A judge-and-grounding case. Same shape for skills and agents; only the task differs. */
export interface QualityCase {
  name: string;
  kind?: "quality" | "grounding";
  prompt: string;
  /** Practices the judge scores (quality). Omit for a pure grounding case. */
  practices?: string[];
  /** Substrings that must ALL appear before the judge runs (cheap-tier gate). */
  grounding?: string[];
  /** Judge score gate (default 0.6). */
  threshold?: number;
  maxTurns?: number;
}
export type SkillCase = QualityCase;
export type AgentCase = QualityCase;

/** A trace-asserted workflow case — a discriminated union routed by `kind`. */
export type WorkflowCase =
  | { kind: "dispatch"; name: string; prompt: string; expectSubagent: string; maxTurns?: number }
  | {
      kind: "activation";
      name: string;
      prompt: string;
      skill: string;
      shouldActivate: boolean;
      maxTurns?: number;
    }
  | {
      kind: "contrast";
      name: string;
      prompt: string;
      expectFileRead: string;
      tools?: string[];
      maxTurns?: number;
    }
  | {
      // A single-session composite: run ONE workflowTask and assert several trace facets at once.
      // Cheaper than separate dispatch/activation/contrast cases (one session, not N) at the cost
      // of coarser diagnostics and no control run — use contrast when you must isolate CLAUDE.md's
      // contribution. Every provided expectation must hold; omitted fields are not checked.
      kind: "trace";
      name: string;
      prompt: string;
      expectSubagents?: string[];
      expectSkills?: string[];
      expectFilesRead?: string[];
      maxTurns?: number;
    };

/** Did a skill engage? Either an explicit Skill tool-call, or reading its SKILL.md. */
export function activated(result: Result, skill: string): boolean {
  const bySkill = result.skillsInvoked.some((s) => s === skill || s.endsWith(`:${skill}`));
  const byRead = result.filesRead.some((f) => f.includes(`skills/${skill}/SKILL.md`));
  return bySkill || byRead;
}

// evals/README.md documents that a capable non-Anthropic model may perform a skill's underlying
// action directly instead of invoking the Skill tool — "indicative, not blocking" on those
// backends. Anthropic ID format is either the bare subscription slug ("claude-sonnet-5") or the
// OpenRouter Skin slug ("anthropic/claude-sonnet-5").
const IS_ANTHROPIC_MODEL = EVAL_MODEL.startsWith("claude-") || EVAL_MODEL.startsWith("anthropic/");

/**
 * A positive "did the model take action X" expectation (read a routed doc, engage a skill).
 * On non-Anthropic CI models this is indicative-not-blocking per evals/README.md — a capable
 * model may answer directly, or (observed on gemini-2.5-flash) ask for the path instead of
 * invoking the Read tool. Warn instead of failing on those backends; stay a hard assert on
 * Anthropic (the real on-disk harness the tier actually gates).
 */
function assertActionOrWarn(condition: boolean, caseName: string, message: string): void {
  if (!IS_ANTHROPIC_MODEL && !condition) {
    // eslint-disable-next-line no-console
    console.warn(`[indicative, not blocking] ${caseName}: ${message}`);
    return;
  }
  expect(condition, message).toBe(true);
}

// --- Runners ----------------------------------------------------------------

type Task = (prompt: string, artifact: string, opts?: RunOptions) => Promise<Result>;

function runQualityCases(artifact: string, cases: QualityCase[], task: Task): void {
  for (const c of cases) {
    test(c.name, async () => {
      const threshold = c.threshold ?? DEFAULT_THRESHOLD;
      const result = await task(c.prompt, artifact, { maxTurns: c.maxTurns });
      logTrace(c.name, result);

      // measure → record → assert. Everything measurable runs in the try; record() fires in the
      // finally with whatever accumulated; the asserts happen strictly after. A failing config
      // (e.g. baseline: grounding gate fails, judge skipped) still leaves a record.
      let grounded: number | undefined;
      let verdict: Verdict | undefined;
      try {
        // Cheap deterministic tier first — the grounding gate. When it fails the judge is skipped.
        if (c.grounding?.length) grounded = patternMatch(result.text, c.grounding);
        if (c.practices?.length && (grounded === undefined || grounded === 1)) {
          verdict = await llmJudge(result.text, c.practices);
          logVerdict(c.name, verdict);
        }
      } finally {
        record(c.name, { result, verdict, grounded, threshold });
      }

      if (grounded !== undefined) {
        expect(grounded, `missing concrete evidence; output:\n${result.text}`).toBe(1);
      }
      if (verdict) {
        expect(verdict.score, JSON.stringify(verdict.results)).toBeGreaterThanOrEqual(threshold);
      }
    });
  }
}

export const runSkillCases = (skill: string, cases: SkillCase[]) => runQualityCases(skill, cases, skillTask);
export const runAgentCases = (agent: string, cases: AgentCase[]) => runQualityCases(agent, cases, agentTask);

export function runWorkflowCases(cases: WorkflowCase[]): void {
  for (const c of cases) {
    test(c.name, async () => {
      if (c.kind === "dispatch") {
        // Stop the moment the subagent is launched — no need to wait out its nested session.
        const expect1 = c.expectSubagent;
        const result = await workflowTask(c.prompt, {
          maxTurns: c.maxTurns,
          stopWhen: (p) => p.subagents.includes(expect1),
        });
        logTrace(c.name, result);
        try {
          expect(result.subagents, `subagents: ${result.subagents.join(", ")}`).toContain(c.expectSubagent);
        } finally {
          record(c.name, { result });
        }
      } else if (c.kind === "activation") {
        const result = await workflowTask(c.prompt, { maxTurns: c.maxTurns });
        logTrace(c.name, result);
        const didActivate = activated(result, c.skill);
        try {
          if (c.shouldActivate && !IS_ANTHROPIC_MODEL) {
            // Positive case, non-Anthropic model: known indicative-not-blocking limitation
            // (evals/README.md) — a capable model may act directly instead of dispatching the
            // Skill tool. Warn instead of failing; the near-miss negative below stays a hard
            // assert on every backend, since over-triggering isn't a documented model gap.
            if (!didActivate) {
              // eslint-disable-next-line no-console
              console.warn(
                `[indicative, not blocking] ${c.name}: "${c.skill}" did not activate on ${EVAL_MODEL} — ` +
                  `skills: ${result.skillsInvoked.join(", ")} | reads: ${result.filesRead.join(", ")}`,
              );
            }
          } else {
            expect(
              didActivate,
              `skills: ${result.skillsInvoked.join(", ")} | reads: ${result.filesRead.join(", ")}`,
            ).toBe(c.shouldActivate);
          }
        } finally {
          record(c.name, { result });
        }
      } else if (c.kind === "trace") {
        // One session, many asserts — every provided expectation is checked against the same trace.
        // Stop as soon as ALL expectations are satisfied (e.g. doc read + subagent launched), so a
        // dispatch-bearing trace doesn't pay for the nested subagent's full run.
        const subs = c.expectSubagents ?? [];
        const skls = c.expectSkills ?? [];
        const files = c.expectFilesRead ?? [];
        const skillEngaged = (p: { skillsInvoked: string[]; filesRead: string[] }, skill: string) =>
          p.skillsInvoked.some((s) => s === skill || s.endsWith(`:${skill}`)) ||
          p.filesRead.some((f) => f.includes(`skills/${skill}/SKILL.md`));
        const result = await workflowTask(c.prompt, {
          maxTurns: c.maxTurns,
          stopWhen: (p) =>
            subs.every((s) => p.subagents.includes(s)) &&
            skls.every((s) => skillEngaged(p, s)) &&
            files.every((f) => p.filesRead.some((r) => r.includes(f))),
        });
        logTrace(c.name, result);
        try {
          for (const sub of c.expectSubagents ?? []) {
            expect(result.subagents, `subagents: ${result.subagents.join(", ")}`).toContain(sub);
          }
          // Positive doc-read / skill-engagement checks are soft on non-Anthropic CI models
          // (indicative-not-blocking, evals/README.md) — same treatment as the `activation` case.
          // Subagent dispatch stays a hard assert (the CI model drives it reliably per README).
          for (const skill of c.expectSkills ?? []) {
            assertActionOrWarn(
              activated(result, skill),
              c.name,
              `skill ${skill} not engaged | skills: ${result.skillsInvoked.join(", ")} | reads: ${result.filesRead.join(", ")}`,
            );
          }
          for (const file of c.expectFilesRead ?? []) {
            assertActionOrWarn(
              result.filesRead.some((f) => f.includes(file)),
              c.name,
              `${file} not read | reads: ${result.filesRead.join(", ")}`,
            );
          }
          expect(result.isError).toBe(false);
        } finally {
          record(c.name, { result });
        }
      } else {
        // contrast: treatment (real harness) vs control (empty tmpdir, no on-disk config).
        const tools = c.tools ?? ["Read", "Grep", "Glob"];
        const treatment = await workflowTask(c.prompt, { allowedTools: tools, maxTurns: c.maxTurns });
        const emptyCwd = mkdtempSync(join(tmpdir(), "eval-control-"));
        const control = await runClaude(c.prompt, {
          allowedTools: tools,
          maxTurns: c.maxTurns,
          cwd: emptyCwd,
          settingSources: [],
        });
        logTrace(`${c.name} [treatment]`, treatment);
        logTrace(`${c.name} [control]`, control);
        try {
          const treatmentRead = treatment.filesRead.some((f) => f.includes(c.expectFileRead));
          const controlRead = control.filesRead.some((f) => f.includes(c.expectFileRead));
          expect(treatmentRead, `treatment reads: ${treatment.filesRead.join(", ")}`).toBe(true);
          expect(controlRead, `control reads: ${control.filesRead.join(", ")}`).toBe(false);
        } finally {
          record(`${c.name} [treatment]`, { result: treatment });
          record(`${c.name} [control]`, { result: control });
        }
      }
    });
  }
}
