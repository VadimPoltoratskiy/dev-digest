# e2e/ — @devdigest/e2e

Deterministic browser flows via Vercel agent-browser (Rust + CDP). No Playwright, no LLM, no API key. Flows are JSON step-lists; pass = all steps exit 0.

## Commands
```sh
./scripts/e2e.sh          # hermetic run (isolated Postgres + API + web) — use this
npm run e2e:hermetic       # same, from inside e2e/
npm test                  # against currently running stack (see gotchas)
```

## Structure
```
specs/
  01-app-boot.flow.json
  02-repo-pulls-detail.flow.json
  03-agents.flow.json
  04-pr-findings.flow.json
  05-pr-diff.flow.json
  06-onboarding.flow.json
  07-settings.flow.json
run.ts                    # runner: executes each flow's steps in sequence
```

## How flows work
Each step is a JSON `{ cmd: [...], label: "..." }` passed verbatim to agent-browser. Exit non-zero = fail.
`{BASE}` in cmd is replaced with `E2E_BASE_URL` (default `http://localhost:3000`).
Assertions are `wait --text` / `wait --url` (timeout → non-zero). Optional `"assert": { "stdoutIncludes": "…" }`.

## Gotchas — critical
- **Flows target seeded data only** (repo `acme/payments-api`, PR #482, seeded agents). They never trigger a model call.
- **Flows 02/04/05 navigate to the *first* repo.** If your dev DB has other repos, they land on the wrong one and fail. Always use `./scripts/e2e.sh` (hermetic, isolated Postgres, seed-only) for reliable runs.
- **Never `docker compose down -v`** — it destroys the `devdigest_pgdata` volume and all your imported repos/reviews.
- **One-time CLI install:** `npm i -g agent-browser && agent-browser install` (downloads Chrome for Testing).
- Failure screenshots → `e2e/test-results/` (git-ignored; uploaded as CI artifact by `e2e-web.yml`).

## Hermetic stack ports (scripts/e2e.sh)
| Service | Default port |
|---|---|
| Postgres | 5433 |
| API | 3101 |
| Web | 3100 |

Safe to run alongside your normal dev stack — separate Postgres container, no shared volume.

## Do not
- Use the agent-browser `chat` (AI) command — flows must be deterministic.
- Add flows that import repos or trigger reviews — they would require API keys and produce non-deterministic state.

## Read when
- Adding a flow → `e2e/README.md` (full spec format)
- Session start → read `INSIGHTS.md`; treat it as high-confidence guidance; before touching code confirm by summarizing the top 3 most relevant points aloud.
- Session end → run `/engineering-insights` to update `INSIGHTS.md`; do not skip this step.
