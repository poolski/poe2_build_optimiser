<!-- generated-by: groundrules v1.10.0 -->
# 0007 — Split fast unit tests from real-bridge integration tests

**Date**: 2026-08-29
**Status**: Accepted

## Context

End-to-end optimiser runs that boot real LuaJIT children leaked into the default `npm test`,
making the routine check take minutes and require a LuaJIT binary on `PATH`.

## Decision

Two suites:

- `npm test` runs `*.test.ts` against **fake** bridges — fast, no LuaJIT, the routine check.
- `npm run test:integration` runs `*.integration.test.ts` only, against **real** LuaJIT children,
  with `fileParallelism: false`. It runs on explicit request, not as a routine check.

## Alternatives considered

- **One suite, tagged tests skipped by env var** — rejected: the default stays slow for anyone who
  forgets the flag, and a leaked real-bridge test is invisible until CI time.
- **Keep everything fast by mocking LuaJIT entirely** — rejected: real-bridge behaviour (crash
  respawn, cascade semantics, memory) is exactly what those tests exist to cover.

## Consequences

### Positive
- The normal verification loop is `npm test` + `tsc --noEmit`, and it stays in seconds.

### Negative / Tradeoffs
- Any new test that boots a real bridge, pool, or spike harness **must** live in an
  `*.integration.test.ts` file — a convention that has to be enforced by review.
- Only one session or worktree runs integration tests at a time (RAM + LuaJIT contention); check
  for a live `luajit.exe` first.

## Notes

Introduced in `2b52cee`.
