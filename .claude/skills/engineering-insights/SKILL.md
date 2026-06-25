---
name: engineering-insights
description: Captures session learnings into per-module INSIGHTS.md files to build compounding project knowledge. Triggered at the end of any coding session lasting 30+ minutes, or whenever the user runs /engineering-insights. Extracts patterns, mistakes, decisions, and project-specific context from the current session and appends datestamped entries to the relevant module's INSIGHTS.md. Do not trigger for trivial single-file edits with no discoveries.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Engineering Insights — Session Capture

Captures what you learned this session into the right module's `INSIGHTS.md` so the next session starts smarter.

## Modules and their INSIGHTS.md paths

| Module | Path |
|--------|------|
| API / server | `server/INSIGHTS.md` |
| Web / client | `client/INSIGHTS.md` |
| Review pipeline | `reviewer-core/INSIGHTS.md` |
| E2E tests | `e2e/INSIGHTS.md` |

If a session touched multiple modules, update each one.

## Workflow

Copy this checklist and check off as you go:

```
Capture Progress:
- [ ] Step 1: Identify which modules were touched this session
- [ ] Step 2: Reflect — extract raw learnings (see categories below)
- [ ] Step 3: Quality-check each entry (see standards below)
- [ ] Step 4: Read the existing INSIGHTS.md for each module (if it exists)
- [ ] Step 5: Append new entries; do not overwrite existing ones
- [ ] Step 6: Confirm entries are concrete, dated, and non-redundant
```

### Step 1 — Identify touched modules

Run:
```bash
git diff --name-only HEAD 2>/dev/null || git status --short
```

Group changed files by module folder (`server/`, `client/`, `reviewer-core/`, `e2e/`).

### Step 2 — Reflect and extract

For each module, identify discoveries that belong to one of these four categories:

**PATTERNS** — Approaches that worked reliably; reusable techniques.
> "The `reviewQueue.ts` worker processes items in FIFO order via `pg_notify`. To avoid lost events, always call `LISTEN` before the INSERT that triggers the notify."

**MISTAKES** — Errors made and how they were fixed; what to avoid next time.
> "Used `db.transaction()` inside a Fastify `onSend` hook — this runs after the response is flushed, so the transaction was never committed. Solution: move DB writes to `preHandler`."

**DECISIONS** — Architectural or design choices made and why.
> "Chose `Promise.allSettled()` over `Promise.all()` for batch embedding calls — the API returns 429s intermittently; `allSettled` surfaces partial failures without aborting the whole batch."

**CONTEXT** — Project-specific quirks, constraints, non-obvious wiring.
> "The `secrets.json` file is read once at startup via `server/src/adapters/secrets/local.ts`. Changing it requires restarting the API process — env vars are not re-read at runtime."

### Step 3 — Quality standard

Before writing, validate each candidate entry against this test:

| Bad (vague) | Good (specific) |
|-------------|-----------------|
| "Be careful with async" | "`reviewJob.ts` must `await` the Drizzle insert before calling `notify()` — fire-and-forget drops rows on load spikes" |
| "Migrations can be tricky" | "Migrations never auto-run on boot. Always `cd server && pnpm db:migrate` first — the #1 first-run failure" |
| "Promises can cause issues" | "`Promise.all()` in the ingest pipeline times out past 30 items — use `Promise.allSettled()` with batches of 10" |

**Reject an entry if:** it could apply to any Node.js project, lacks a file path or function name, or is already in `CLAUDE.md`.

### Step 4 — Read existing INSIGHTS.md

```bash
cat server/INSIGHTS.md 2>/dev/null || echo "(file does not exist yet)"
```

Check for duplicates. If an existing entry covers the same point, add a dated correction note instead of a new entry.

### Step 5 — Append entries

**NEVER use the Write tool on an existing INSIGHTS.md — that overwrites the entire file and destroys accumulated history.**

- **File already exists** → use `Edit` to insert the new entry text under the correct section heading (`## Patterns`, `## Mistakes`, etc.). Find the heading, place the new entry immediately below it.
- **File does not exist** → use `Write` (only this case) to create it with this template:

```markdown
# INSIGHTS.md — <Module Name>

Session learnings accumulated over time. Treat as high-confidence guidance.
Read before working in this module. Update at session end via /engineering-insights.

---

## Patterns

## Decisions

## Mistakes

## Context

## Open Questions
```

Each entry format:

```
### YYYY-MM-DD — <one-line summary>
<Concrete observation. Include file path or function name. One to three sentences max.>
```

Example:
```
### 2026-06-23 — allSettled required for batch embedding calls
`reviewer-core/src/embeddings/batch.ts`: `Promise.all()` aborts on first 429.
Switched to `Promise.allSettled()` — partial failures are logged and retried next cycle.
```

### Step 6 — Final check

Before finishing, verify:
- [ ] Every entry includes a file name, function name, or CLI command
- [ ] No entry is a restatement of generic programming knowledge
- [ ] Nothing duplicates an existing entry or a rule already in `CLAUDE.md`
- [ ] Each entry fits in 1–3 sentences

## Cadence

| Session type | Action |
|---|---|
| 30+ min session with discoveries | Always run |
| Trivial single-file fix, no surprises | Skip |
| Bug whose root cause was non-obvious | Always capture in Mistakes |
| Architecture decision made | Always capture in Decisions |

## What NOT to store

- Information already in `CLAUDE.md` or any `README.md`
- Generic language/framework knowledge
- One-time edits with no recurrence risk
- Anything inferable by reading the code

## Quarterly maintenance

When `INSIGHTS.md` exceeds ~50 entries, consolidate: merge related entries, remove outdated workarounds for bugs that have been fixed, and promote stable patterns to `CLAUDE.md`.
