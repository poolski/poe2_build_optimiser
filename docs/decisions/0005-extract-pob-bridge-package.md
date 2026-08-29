<!-- generated-by: groundrules v1.10.0 -->
# 0005 — Extract `packages/pob-bridge`; repo moves to npm workspaces

**Date**: 2026-08-28
**Status**: Accepted (implemented 2026-08-29)

## Context

The bridge (`pob-runtime/` + `bridge.ts`) lived in the repo root. The web UI needs a long-lived
bridge behind a service boundary — a browser cannot shell out to LuaJIT.

## Decision

Extract `packages/pob-bridge` immediately and convert the repo to npm workspaces: `src/` holds the
core optimiser and the two CLIs; `packages/` holds `pob-bridge`, `contract`, `api`, and `web`.
Cross-package resolution is source-level aliases — see ADR-0006.

## Alternatives considered

- **Pool inside the API server, extract later** — rejected: the CLIs and the tests would each keep
  their own copy of the pool lifecycle, and "later" would land mid-web-UI track with three
  consumers already depending on the shape.

## Consequences

### Positive
- `PobBridgePool` (FIFO, crash-respawn, `lease(n)`) lives in the package and is reused by the
  CLIs, the API, and tests.

### Neutral
- `src/core` still receives a bridge and never constructs one; constructors live at the edges (the
  CLIs, `packages/api/src/server.ts`).
- `packages/api/src/core.ts` is the single module that crosses from `packages/` into repo-root
  `src/`, which is why the API package is `noEmit`.
