---
name: workflow-retro
description: >
  Guides the developer through the per-branch retro process at merge or feature
  completion: collect git-diff statistics, run tests only for touched packages
  (record "—" for untouched ones), and append one ledger table row plus one prose
  section to docs/retros/ledger.md. Triggered when a branch/feature is ready for
  retro (at merge time, or at retro time for long-lived branches), or whenever the
  user runs /workflow-retro. Append-only — never rewrites existing ledger entries.
allowed-tools: Read, Write, Edit, Bash
---

# Workflow Retro — Per-Branch Ledger Capture

Captures a branch/feature retro into `docs/retros/ledger.md` so the team keeps a
consistent, metrics-backed record of what each merged branch did and how. Run this
at merge time — or, for a long-lived branch, at retro time.

## The ledger

`docs/retros/ledger.md` has two parts that stay in sync:

1. A **summary table** — one row per branch. Columns, in order:
   `Branch` · `Files changed` · `+/- lines` · `Server tests` · `Client tests` ·
   `Key mechanism` · `Notes`.
2. A **prose section per branch** below the table — an H2 heading, a feature-summary
   paragraph, and bold sub-sections for the key mechanism(s) and Gaps/follow-ups.

This skill **appends** one new row and one new prose section. It never overwrites,
reorders, or reformats existing entries.

## Workflow

Copy this checklist and check off as you go:

```
Retro Capture:
- [ ] Step 1: Collect branch diff statistics
- [ ] Step 2: Identify touched packages and run their tests
- [ ] Step 3: Append one ledger table row
- [ ] Step 4: Append one prose section
- [ ] Step 5: Self-check (append-only, columns aligned, mechanism cites files)
```

### Step 1 — Collect branch diff statistics

Run against `main` (substitute the real branch name):

```sh
git diff --stat main..<branch>
```

From the summary line record: total **files changed**, total **lines inserted**,
and total **lines deleted**. These fill the `Files changed` column and the
`+/- lines` column (formatted `+<ins> / -<del>`).

### Step 2 — Identify touched packages and run their tests

Inspect the diff paths for which packages changed: `server/`, `client/`,
`reviewer-core/`, `e2e/` (and `evals/`, `mcp-server/`). For **each touched**
package, run its test suite and record the pass count and file count:

```sh
cd server && pnpm test     # e.g. "295 passed (33 files)"
cd client && pnpm test     # e.g. "272 passed (42 files)"
```

For each package the branch did **not** touch, write `—` in its column — **do not**
run its tests. The row may be written once **at least one** package's test results
are recorded (partial retros are valid). The table's dedicated columns are
`Server tests` and `Client tests`; note any other package's results (reviewer-core,
e2e, …) in the `Notes` column or the prose section.

### Step 3 — Append one ledger table row

Add exactly one new row to the bottom of the summary table. Keep the seven columns
in order. Put a concise one-line mechanism summary in `Key mechanism`; use `Notes`
for "See below" (when a prose section follows) or anything not covered by a column.
**Never** edit or reformat an existing row.

### Step 4 — Append one prose section

Add exactly one new section immediately after the last existing prose section,
matching the structure of the existing `emdash/multi-agent-review-mbw10` entry:

- An **H2 heading** with the branch name (e.g. `## <branch>`).
- A **feature-summary paragraph**: what the branch added and what it enables.
- One or more bold **`**Key mechanism**`**-style sub-sections naming the concrete
  files and functions behind the core approach (e.g. `` `groupFindingsByFileAndOverlap`
  (`server/src/modules/multi-runs/helpers.ts`) ``), so a future reader can jump
  straight to the code.
- A bold **`**Gaps / follow-ups**`** sub-section listing known gaps or next steps —
  or "none blocking at time of writing" when there are none, plus a note on which
  files, if changed later, should trigger revisiting the row.

**Never** overwrite or reformat an existing prose section.

### Step 5 — Self-check

- Append-only: every existing row and prose section is byte-for-byte unchanged.
- The new row's seven columns line up with the header; untouched packages show `—`.
- At least one package's real test result is present.
- The prose section's mechanism sub-section cites actual file paths (not vague prose).

## Notes

- Metrics are a snapshot at retro time. Long-lived branches: re-run Steps 1–2 when
  you write the retro rather than trusting stale numbers.
- This is a developer-authored narrative backed by deterministic `git`/test output —
  there is no untrusted input to sanitize.
