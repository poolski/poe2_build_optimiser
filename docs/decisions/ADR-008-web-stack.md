# ADR-008 — Web stack: Vite + React SPA, Hono API, Zod, no job-queue library

**Status:** Accepted (2026-08-28)

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

## Consequences

- `packages/contract` is the serial dependency — it landed alone before `api` and `web`/`canvas`
  forked into parallel worktrees (see `intake/web-ui/08-fork-prep.md`).
- Job admission is slot-based, not job-count-based, once a job can lease `N > 1` slots — see
  ADR-011.
- `zustand` was installed during fork-prep and later dropped; state is `useReducer`.
