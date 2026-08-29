# @poe2/api

Hono + Zod HTTP server that turns requests into `optimiseTree` / `recommendTree` calls on a
`PobBridgePool`, with an in-memory job registry and an SSE progress stream.

> **Local-first, single-user, not hosted.** No auth, no multi-tenant handling. The server binds
> `127.0.0.1` only. **Do not deploy or expose this.** It shells LuaJIT children on the host and
> trusts every caller.

## Run

From the repo root:

```
npm start            # ts-node packages/api/src/server.ts, http://127.0.0.1:8787
```

It is a tool you start when you want it and Ctrl-C when done, not a background service.

## Endpoints (all under `/api`)

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/builds` | `BuildInput` (`{kind:"pobCode",code}` \| `{kind:"xml",xml}`) | `BuildSummary` |
| `GET`  | `/builds/:id` | — | `BuildSummary` |
| `POST` | `/jobs` | `{kind:"optimise", ...OptimiseRequest}` \| `{kind:"recommend", ...RecommendRequest}` | `JobRef` |
| `GET`  | `/jobs/:id` | — | `JobRef` + `result?` + `error?` |
| `GET`  | `/jobs/:id/events` | — | SSE: `progress`* then one of `done` \| `error` \| `cancelled` |
| `POST` | `/jobs/:id/cancel` | — | `JobRef` |
| `GET`  | `/health` | — | `{ ok, contractVersion, pool, jobs }` |

Schemas live in `@poe2/contract`. A validation failure is `400 { kind: "bad-request", message }`.

A v1 optimise job is as slow as the CLI (minutes) — every flow is submit → poll/stream → result;
there is no synchronous "optimise now".

## Config (env)

| Env | Default | |
|-----|---------|--|
| `PORT` | `8787` | binds `127.0.0.1` only |
| `POB_LUAJIT_PATH` | bridge default | passed to the pool |
| `POOL_SIZE` | `2` | one LuaJIT child ≈ one PoB runtime of RAM |
| `MAX_ACTIVE_JOBS` | `= POOL_SIZE` | clamped ≤ pool so a running job never waits in `acquire()` |

Spec: `docs/web-ui/04-api-server.md`.
