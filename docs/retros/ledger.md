# Retro ledger

One row per branch/feature retro. Metrics are pulled at merge time (or at the
time of the retro, for long-lived branches) via `git diff --stat main..<branch>`
and each package's test runner.

| Branch | Files changed | +/- lines | Server tests | Client tests | Key mechanism | Notes |
|---|---|---|---|---|---|---|
| `emdash/multi-agent-review-mbw10` | 115 | +19336 / -525 | 295 passed (33 files) | 272 passed (42 files) | `Promise.allSettled` fan-out in `run-executor.ts`; `groupFindingsByFileAndOverlap` dedup in `multi-runs/helpers.ts`; SSE replay-buffer bus in `platform/sse.ts` | See below |

## emdash/multi-agent-review-mbw10

Adds parallel multi-agent PR review: launch N agents against one PR, dedupe
their findings into cross-agent groups, stream live progress per run, and
compose an accepted subset into one real GitHub PR review.

**Concurrency** — `ReviewRunExecutor.executeRuns` (`server/src/modules/reviews/run-executor.ts`)
loads the diff/intent once per PR, then fans every agent job out via
`Promise.allSettled`, so a single agent's failure or crash doesn't block or
cancel the others; each is isolated to its own `agent_runs` row.

**Dedup engine** — `groupFindingsByFileAndOverlap` (`server/src/modules/multi-runs/helpers.ts`)
groups findings by exact file path, then greedily clusters overlapping
`[start_line, end_line]` ranges per AC-12 (`A.start <= B.end && B.start <= A.end`),
recording per-agent verdicts (including `null` for "did not flag") per cluster.
Consumed by `MultiRunsService.getFindings` and rendered by the client's
`ConflictsSection` — agents that flag the same location surface as one row
with per-agent agree/disagree, not N duplicate comments.

**Live updates** — `GET /runs/:id/events` (`server/src/modules/reviews/routes.ts`)
streams `RunEvent`s off the in-memory `RunBus` (`server/src/platform/sse.ts`).
New subscribers replay the run's buffered events first (so a client that
connects mid-run isn't missing history), then get live events until the run's
`done` signal closes the stream.

**Gaps / follow-ups**: none blocking at time of writing — this retro entry was
added retroactively after auditing the branch for concurrency/dedup/SSE gaps
that turned out to already be implemented (see PR discussion). Revisit this
row if `run-executor.ts`, `multi-runs/helpers.ts`, or `platform/sse.ts` change
shape.
