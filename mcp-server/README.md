# @devdigest/mcp-server

Local MCP server exposing DevDigest's review pipeline as 5 tools over stdio: `list_agents`,
`run_agent`, `get_findings`, `get_conventions`, `get_blast_radius` (stub — see below).

It is a thin HTTP client against the already-running Fastify API (`server/`, `:3001`). It has
no DB, no GitHub adapter, and no DI container of its own — every tool ultimately calls an
existing DevDigest REST route. See `../server/src/modules/*/routes.ts` for the routes it wraps.

## Setup

```sh
pnpm install
pnpm typecheck
pnpm test      # hermetic — no running server needed
pnpm build     # produces dist/index.js
```

This package is standalone (its own lockfile, no workspace). It is **never** started by
`../scripts/dev.sh` or `docker compose up` — it's a separate, on-demand process you launch
yourself only when you want to use the MCP tools.

## Precondition: the DevDigest API must be running

```sh
docker compose up -d              # from repo root — Postgres
cd server && pnpm db:migrate       # first run only
cd server && pnpm db:seed          # optional — seeds acme/payments-api + PR #482 + 5 agents
cd server && pnpm dev              # :3001, leave running
```

If the API is unreachable, every tool returns a clear error instead of crashing:
`DevDigest API unreachable at http://localhost:3001. Start the server: cd server && pnpm dev`

Configure the base URL via `DEVDIGEST_API_URL` (default `http://localhost:3001`).

## Running & testing

**Don't run `tsx src/index.ts` / `node dist/index.js` standalone** — it's a stdio server; it
blocks silently waiting for an MCP client on stdin/stdout. Use one of:

**MCP Inspector (fastest manual test):**
```sh
npx @modelcontextprotocol/inspector npx tsx src/index.ts
```
Opens a local web UI listing all 5 tools where you can invoke each by hand and see the raw
JSON response. There's also a non-interactive `--cli` mode, e.g.:
```sh
npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call --tool-name get_conventions --tool-arg owner=acme --tool-arg repo=payments-api
```

**Real MCP client (Claude Code / Claude Desktop):** add to `.mcp.json` at the repo root:
```json
{
  "mcpServers": {
    "devdigest": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/dev-digest/mcp-server/src/index.ts"],
      "env": { "DEVDIGEST_API_URL": "http://localhost:3001" }
    }
  }
}
```
For a built/production run, swap to `"command": "node", "args": ["/absolute/path/to/dev-digest/mcp-server/dist/index.js"]`.

## Tools

| Tool | Input | Notes |
|---|---|---|
| `list_agents` | _(none)_ | Strips `system_prompt`/`output_schema`; caps at 50 |
| `run_agent` | `owner, repo, pr_number, agent_id?` | Kicks off a review; returns run IDs only (the review runs in the background) |
| `get_findings` | `owner, repo, pr_number, run_id?, limit?` | Reports run status; findings once done, severity-sorted, capped at `limit` (default 20, max 50) |
| `get_conventions` | `owner, repo, accepted_only?` | Strips `evidence_snippet`; caps at 50 |
| `get_blast_radius` | `owner, repo, files` | **Stub.** Returns `{implemented: false, message: "..."}` immediately, no network call. A real implementation already exists server-side (`RepoIntelService.getBlastRadius`) but has no route yet — wiring it up is future work. |

`owner`/`repo`/`pr_number` are resolved internally to DevDigest's internal repo/pull ids
(`src/resolve.ts`) — there's no need to know DevDigest's internal UUIDs.

## Structure

```
src/
  types.ts        # local Zod subset of server's shared contracts (no cross-package import)
  client.ts       # HTTP client: get<T>/post<T>, DEVDIGEST_API_URL, error handling
  resolve.ts      # owner/repo/prNumber -> {repoId, pullId}
  tools/          # one file per tool, each exports register<Name>(server, client)
  index.ts        # stdio bootstrap — registers all 5 tools
```

Layering mirrors (but doesn't literally follow) the server's onion architecture: `tools/*`
never calls `fetch` directly, and `client.ts` never knows about MCP tool schemas.
