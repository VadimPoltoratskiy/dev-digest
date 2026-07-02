# reviewer-core/ — @devdigest/reviewer-core

Pure review engine: **diff → prompt → LLM → grounded findings**. No DB, no filesystem, no GitHub. Only side effect: one LLM call via injected `LLMProvider`.

## Commands
```sh
pnpm test        # vitest hermetic units (stubbed LLMProvider — no keys, no network)
pnpm typecheck   # also acts as build (this package never emits JS)
```

## Structure
```
src/
  index.ts        # public API — everything exported from here
  prompt.ts       # assemblePrompt() + wrapUntrusted() + INJECTION_GUARD
  grounding.ts    # groundFindings() — drops findings without valid diff line refs
  review/
    run.ts        # orchestrates single-pass review (main entry)
    reduce.ts     # map-reduce path (multi-agent, added in L07)
  llm/
    openrouter.ts # LLMProvider implementation (OpenRouter)
    structured.ts # toJsonSchema() · extractJson() · parseWithRepair()
  output/         # toReview() — CI payload helper (used from L06)
```

## Pipeline
`assemblePrompt` → `wrapUntrusted` + `INJECTION_GUARD` → `LLMProvider` → `parseWithRepair` → `groundFindings` → `Review`

## Non-obvious rules — the ones that trip devs
- **Grounding is mandatory and irreversible.** A finding dropped by `groundFindings` is gone. The score is then recomputed from surviving findings only — the model's self-reported score is thrown away.
- **This package is consumed as TypeScript source only.** The server imports it via tsconfig path alias. Never run `tsc --build` expecting a `dist/`.
- **`INJECTION_GUARD` is always appended** to the system prompt by `assemblePrompt`. Do NOT add keyword-scanning of diff text as an alternative — it only catches one phrasing.
- **Extra prompt slots** (`skills`, `memory`, `specs`, `callers`) are accepted by `assemblePrompt` but unused in the starter. When omitted, those sections are simply left out of the prompt.
- **`LLMProvider` is injected** — never instantiate `OpenRouterLLMProvider` directly inside this package. Tests pass a stub.

## Gotchas
- `parseWithRepair` handles malformed JSON from the model — don't replace it with `JSON.parse`.
- `reduce()` / `toReview()` exist in the starter code but are activated by later lessons (L06, L07).

## Read when
- Changing prompt assembly → `prompt.ts` is the single source; also read `docs/agent-prompts/`
- Changing grounding logic → `grounding.ts` + its tests
- Session start → read `INSIGHTS.md`; treat it as high-confidence guidance; before touching code confirm by summarizing the top 3 most relevant points aloud.
- Session end → run `/engineering-insights` to update `INSIGHTS.md`; do not skip this step.
