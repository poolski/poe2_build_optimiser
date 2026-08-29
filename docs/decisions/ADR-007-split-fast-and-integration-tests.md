# ADR-007 — Split fast unit tests from real-bridge integration tests

**Status:** Accepted (2026-08-29, `2b52cee`)

## Context

End-to-end optimiser runs that boot real LuaJIT children leaked into the default `npm test`,
making the routine check take minutes and require a LuaJIT binary on `PATH`.

## Decision

Two suites:

- `npm test` runs `*.test.ts` against **fake** bridges — fast, no LuaJIT, the routine check.
- `npm run test:integration` runs `*.integration.test.ts` only, against **real** LuaJIT children,
  with `fileParallelism: false`. It runs on explicit request, not as a routine check.

## Consequences

- Any new test that boots a real bridge, pool, or spike harness **must** live in an
  `*.integration.test.ts` file.
- Only one session or worktree runs integration tests at a time (RAM + LuaJIT contention); check
  for a live `luajit.exe` first.
- The normal verification loop is `npm test` + `tsc --noEmit`.
