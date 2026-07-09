import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (CLAUDE.md + skills + subagents,
 * loaded via settingSources:["project"]) behaves as documented. Organized by scenario, not by a
 * single artifact, because these behaviors are cross-cutting.
 *
 * Budget: 5 Claude sessions total.
 *   - 3 × trace     → 1 session each                      = 3
 *   - 1 × activation pair (positive + near-miss negative) = 2
 *
 * `trace` folds several assertions into ONE session (cheaper, coarser) and stops early once its
 * evidence is in — so a dispatch-bearing trace never waits out the nested subagent's full run.
 */
export const cases: WorkflowCase[] = [
  // --- trace (1 session): CLAUDE.md "Read When" routing + subagent dispatch, together -----------
  {
    kind: "trace",
    // Endpoint must NOT already exist, or the model reviews the existing code inline instead of
    // planning-then-dispatching. GET /reviews/:id/export is genuinely absent from routes.ts.
    name: "API-route task reads api-contracts AND pulls the architecture-reviewer",
    prompt:
      "Я планую додати НОВИЙ, ще не реалізований ендпоінт GET /reviews/:id/export (віддає ревʼю як " +
      "markdown). Виконай РІВНО два кроки по черзі: (1) СПОЧАТКУ САМ прочитай server/docs/README.md, " +
      "щоб звіритися з конвенціями API цього репо — не делегуй цей крок. (2) ТІЛЬКИ ПІСЛЯ цього " +
      "запусти сабагента architecture-reviewer, щоб він оцінив мій план на відповідність onion-шарам " +
      "— сам план не рецензуй.",
    expectFilesRead: ["server/docs/README.md"],
    expectSubagents: ["architecture-reviewer"],
    maxTurns: 8,
  },

  // --- trace (1 session): two "Read When" rows at once -----------------------------------------
  {
    kind: "trace",
    // Tests the CLAUDE.md "Read When" routing, so the prompt must push toward CONSULTING the docs,
    // not exploring source. Earlier phrasing ("розберись, як усе влаштовано") sent the model straight
    // into schema.ts / run.ts and it never opened the routed doc. One anchor doc (docs/README.md)
    // keeps this a deterministic routing check — asserting two docs in one session is inherently flaky.
    name: "pipeline task follows CLAUDE.md routing to pipeline.md",
    prompt:
      "Я збираюся змінити review pipeline. Перш ніж торкатися коду — звірся з настановами цього репо " +
      "(CLAUDE.md) щодо того, яку документацію треба прочитати для змін у pipeline, і прочитай саме ці документи.",
    expectFilesRead: ["reviewer-core/docs/README.md"],
    maxTurns: 8,
  },

  // --- trace (1 session): module-level CLAUDE.md's own "Gotchas" section ------------------------
  // Was a contrast case, but the control run (empty tmpdir) could still reach the real repo by
  // absolute path and read the module's CLAUDE.md, making the negative flaky. As a single-session
  // trace it reliably checks the same routing rule: for "unexpected behavior," the model checks the
  // touched module's own CLAUDE.md (reviewer-core/AGENTS.md, the CLAUDE.md symlink target) — it has
  // a dedicated "## Gotchas" section — rather than the append-only INSIGHTS.md.
  {
    kind: "trace",
    name: "CLAUDE.md routes a gotchas lookup to reviewer-core/insights",
    prompt:
      "У reviewer-core я стикнувся з несподіваною поведінкою — щось працює не так, як я очікував. " +
      "За настановами цього репо, де це вже могло бути задокументовано? Прочитай той файл.",
    expectFilesRead: ["reviewer-core/AGENTS.md"],
    maxTurns: 5,
  },

  // --- activation pair (2 sessions): positive + near-miss negative ------------------------------
  {
    kind: "activation",
    // engineering-insights' own trigger condition (SKILL.md) is "end of a 30+ minute session, or
    // /engineering-insights" — a single fresh eval turn can't imply elapsed session time, so the
    // prompt states it explicitly instead of leaving "genuine discovery" to imply it.
    name: "engineering-insights activates on a genuine discovery",
    prompt:
      "Це кінець довгої сесії розробки. Щойно з'ясував, чому pgvector-запит повертав нуль рядків — " +
      "розмірність колонки не збіглася після зміни моделі ембедингів. Хочу зафіксувати цей висновок " +
      "перед завершенням сесії, щоб більше не наступати на ті самі граблі.",
    skill: "engineering-insights",
    shouldActivate: true,
    maxTurns: 4,
  },
  {
    kind: "activation",
    name: "near-miss negative — explaining the same topic must NOT record an insight",
    prompt:
      "Поясни, як у pgvector працюють розмірності колонок і чому невідповідність повертає нуль рядків.",
    skill: "engineering-insights",
    shouldActivate: false,
    maxTurns: 4,
  },
];
