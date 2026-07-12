# Mutation testing — stretch goal for L06 (Eval pipeline)

## Why

A green test suite only proves the tests don't fail on the code as written — it
doesn't prove they'd *catch* a bug if one were introduced. Coverage tools tell
you a line ran; they can't tell you whether any assertion actually pinned its
behavior. Mutation testing closes that gap: a tool systematically corrupts the
source ("mutants" — flip `<` to `<=`, drop a `?? 0`, swap `&&` for `||`, ...)
and reruns the tests against each corruption. A mutant that **survives** (tests
still pass) marks a spot where the tests aren't actually verifying anything —
they're just not failing. This is the same "check the verifier" instinct
behind this repo's `plan-verifier` and `/verify` conventions, applied to the
test suite itself instead of to a PR.

## Scope

Target: [`src/output/to-review.ts`](../src/output/to-review.ts) — the
`toReview()` CI payload helper this lesson (L06) adds. It's pure logic
(severity ranking, CI-gate thresholds, nearest-diff-line resolution for inline
comments), hermetic, and already had 14 tests in
[`test/to-review.test.ts`](../test/to-review.test.ts), so a low mutation score
here means real gaps, not just "nobody wrote tests yet."

Tool: [Stryker Mutator](https://stryker-mutator.io/) (`@stryker-mutator/core`
+ `@stryker-mutator/vitest-runner`), configured in
[`stryker.conf.json`](../stryker.conf.json), scoped to mutate only this one
file. Run manually — not wired into CI:

```sh
cd reviewer-core && pnpm mutation-test
```

The HTML report lands at `reviewer-core/reports/mutation/index.html`
(gitignored, regenerated on every run).

## A monorepo-shaped gotcha

The first run reported **0% mutation score with all 113 mutants survived** —
not a real result. Stryker sandboxes each mutation run by copying the package
directory (`reviewer-core/`) into a temp dir and running the tests there. But
`test/to-review.test.ts` imported from the barrel `../src/index.ts`, which
re-exports `review/run.ts`, which has a runtime import of `@devdigest/shared`
at `../server/src/vendor/shared` — a path *outside* `reviewer-core/`, so it
doesn't exist in the sandbox. That silently failed test-file collection for
`to-review.test.ts` and `run.test.ts` in the sandbox (Stryker doesn't treat a
collection failure as a dry-run failure), leaving only `prompt.test.ts`'s 5
tests actually running — nothing exercised `to-review.ts` at all, so every
mutant trivially survived.

Fix: `test/to-review.test.ts` now imports directly from
`../src/output/to-review.js` instead of the barrel, since `to-review.ts`'s own
dependency chain (including `grounding.ts`) only uses `@devdigest/shared` via
`import type`, which is erased at build time and never needs to exist at
runtime. No behavior change — same exports, same runtime code.

## Results

| | Before | After |
|---|---|---|
| Mutants | 113 | 113 |
| Killed | 65 | **67** |
| Survived | 44 | **42** |
| No coverage | 4 | 4 |
| Mutation score | 57.52% | **59.29%** |

## The mutant we killed

Two related survivors sat in `resolveCommentLine` — the function that picks
which real diff line to anchor a GitHub inline comment to (getting this wrong
means GitHub rejects the *entire* review with a 422):

```ts
// src/output/to-review.ts:113-120
for (const n of lines) {
  if (n < lo || n > hi) continue;
  const dist = Math.abs(n - end);      // ← survived: Math.abs(n + end)
  if (dist < bestDist) {               // ← survived: if (true)
    bestDist = dist;
    best = n;
  }
}
```

All 14 original tests only ever supplied **one** valid diff line in range, so
the "closest wins" search was never actually exercised — any code that just
returned "the one candidate" would have passed identically. Added one test
(`test/to-review.test.ts`, "picks the closest of several in-range diff lines,
regardless of encounter order") with three candidate lines (`[20, 28, 12]`)
where the true nearest (28) is neither first nor last in iteration order. That
kills both survivors:

- `Math.abs(n - end)` → `Math.abs(n + end)`: the wrong formula would pick line
  12 (smallest sum) instead of 28 (smallest true distance).
- `if (dist < bestDist)` → `if (true)`: unconditional overwrite would end up
  keeping the *last*-iterated candidate (12) instead of the nearest.

## A mutant that can't be killed (and why that's fine)

A third survivor at the same spot, `if (dist < bestDist)` → `if (dist <=
bestDist)`, is an **equivalent mutant** — provably unreachable, not a test
gap. `end` (the distance reference) is always one of the two range endpoints
`lo`/`hi` by construction (`lo = min(start, end)`, `hi = max(start, end)`), and
any `n` for which `lines.has(n)` reaches the loop is, by the earlier fast-path
check, never equal to `end`. So every candidate's distance from `end` is
`|n - end|` with `n` strictly on one side of `end` — distances are strictly
monotonic in `n`, meaning two *different* candidates can never produce the
exact same distance. A tie is mathematically impossible, so `<` and `<=`
behave identically for every reachable input; no test can ever distinguish
them. Recognizing this (instead of chasing an unkillable mutant) is itself
part of doing mutation testing rigorously — not every survivor is a gap.

## What's still open

42 mutants still survive, mostly in two places, left as known/accepted for now
rather than chased down as part of this exercise:

- **`composeBody`'s exact markdown** (headers, bullet formatting, the
  `severityCounts` string, the `SEV_EMOJI` fallback `'•'`) — tests assert on
  *substrings* (`toContain('Changes requested')`), not the full rendered
  text, so literal-swap mutants in untouched parts of the template survive.
- **`resolveCommentLine`'s boundary inclusion** (`n < lo` → `n <= lo`, `n > hi`
  → `n >= hi`) — no existing test puts a candidate diff line exactly at the
  range boundary itself (`start_line`/`end_line`) as the *only* candidate, so
  whether the boundary is inclusive is untested.

Both are legitimate next mutants to kill if this exercise continues.
