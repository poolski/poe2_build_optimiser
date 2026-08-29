<!-- generated-by: groundrules v1.10.0 -->
# 0008 — Web stack: Vite + React SPA, Hono API, Zod, no job-queue library

**Date**: 2026-08-28
**Status**: Accepted

## Context

The web UI is local-first — a `localhost` app wrapping the local bridge, single user, not hosted.
It is a third consumer of `src/core/` after the two CLIs, with the same "parse in / data out"
contract.

## Decision

- **Frontend:** Vite + React SPA.
- **API:** Hono (`@hono/node-server`, `streamSSE`, `serveStatic`) on `127.0.0.1:8787`.
- **Validation + shared types:** Zod schemas in `packages/contract`, DTOs inferred from them.
- **No job-queue library:** in-memory job registry + `EventEmitter`; the bench harness's
  `runWithConcurrency` is ported for the pool.

## Alternatives considered

- **A real job queue (BullMQ / Redis-backed)** — rejected: it adds a service to run for a
  single-user localhost app whose jobs never outlive the process.
- **A full-stack framework (Next.js and similar)** — rejected: no SSR need, and it would obscure
  the plain Node process that owns the LuaJIT pool.

## Consequences

### Positive
- Nothing to install or run beyond Node; jobs live and die with the server process.

### Negative / Tradeoffs
- Job state is lost on restart — acceptable for local single-user use, and a blocker if the app is
  ever hosted.

### Neutral
- `packages/contract` is the serial dependency — it landed alone before `api` and `web`/`canvas`
  forked into parallel worktrees (see `intake/web-ui/08-fork-prep.md`).
- Job admission is slot-based, not job-count-based, once a job can lease `N > 1` slots — see
  ADR-0011.
- `zustand` was installed during fork-prep and later dropped; state is `useReducer`.
