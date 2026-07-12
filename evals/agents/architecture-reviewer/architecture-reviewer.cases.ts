import type { AgentCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

const REVIEW_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("checkout-service.diff")}`;

// A second real diff whose violations map onto DevDigest-SPECIFIC rule names
// (`reviewer-core-zero-io`, `reviewer-core-ground-findings-gate` — now documented in
// reviewer-core/docs/README.md's "Architecture rules" section) that a competent model will
// describe in prose but will not spontaneously name unless the agent's "cite the exact documented
// rule per finding" hard rule forces it. The checkout diff's textbook violations don't test this —
// the model volunteers the onion-architecture rule table's wording either way.
const REVIEWER_CORE_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("reviewer-core-gate.diff")}`;

// A diff that violates NO documented rule (a pure local-variable rename inside a real module, no
// new imports, no cross-layer edges). A grounded reviewer should report zero violations — this
// checks the agent doesn't fabricate a judgment/best-practice finding where none is warranted.
const BENIGN_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("benign-refactor.diff")}`;

export const cases: AgentCase[] = [
  {
    name: "flags both violations in the checkout diff with severity and a citable rule",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    practices: [
      "flags the `import type { FastifyReply } from 'fastify'` added to service.ts as a violation of the rule that Services must not depend on HTTP concepts (the onion-architecture layer table: 'Services | Forbidden: HTTP concepts, routes')",
      "flags the `import { OctokitGitHubClient } from '../../adapters/github/octokit.js'` added to service.ts (or the direct `new OctokitGitHubClient(...)` construction it enables) as a violation of DI discipline — adapters must be injected via the container, never constructed directly inside a service",
      "names the specific documented rule for EVERY finding (e.g. the onion-architecture 'Services | Forbidden: HTTP concepts' row, or server/CLAUDE.md's 'adapters are injected, never imported directly in services' rule) rather than describing the problem only in prose",
      "assigns a severity (critical/high/medium/low/info) to each finding",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      "ends with an explicit PASS/FAIL gate verdict based on whether any critical or high findings exist",
    ],
    threshold: 0.8,
    maxTurns: 25,
  },
  {
    name: "does not fabricate an architecture finding for the out-of-scope security-shaped change",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    practices: [
      "does not invent an architecture-contract violation for the optional `reply?: FastifyReply` parameter beyond the HTTP-concept-in-service issue itself (no runtime bug/security finding fabricated as an architecture rule)",
      "stays scoped to structural/layering/DI findings and does not comment on naming, style, or test coverage",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "cites the DevDigest-specific rule identifier for reviewer-core violations",
    kind: "quality",
    prompt: REVIEWER_CORE_PROMPT,
    // Exact rule-identifier citation is a literal substring check, not a judgment call — gate on
    // it deterministically (patternMatch, no model) rather than asking the judge to verify a
    // verbatim string, which just adds risk of malformed judge JSON for no benefit. Gate runs
    // first and must be 1.0 before the judge (below) even runs.
    grounding: ["reviewer-core-zero-io", "reviewer-core-ground-findings-gate"],
    practices: [
      "flags the `import { readFileSync } from 'node:fs'` added to reviewer-core/src/review/run.ts as a violation (reviewer-core must do no I/O except the injected LLMProvider)",
      "flags that reviewPullRequest now returns `merged.findings` directly (the 'citation grounding skipped for speed' log line) instead of passing them through `groundFindings()`, skipping the mandatory citation-grounding gate before emitting findings",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      "ends with an explicit PASS/FAIL gate verdict based on whether any critical or high findings exist",
    ],
    threshold: 0.8,
    maxTurns: 25,
  },
  {
    name: "does not fabricate a documented-rule violation for a benign rename",
    kind: "quality",
    prompt: BENIGN_PROMPT,
    practices: [
      "reports no violations for the benign rename (or records only `info`-level, non-blocking observations) — it does not invent a critical/high/medium finding",
      "does not fabricate a documented-rule violation where the diff violates none of the checked rules",
      "the final gate verdict is PASS",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
];
