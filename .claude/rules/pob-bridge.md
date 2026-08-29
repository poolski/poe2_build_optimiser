---
paths:
  - "packages/pob-bridge/**"
---
<!-- generated-by: groundrules v1.10.0 -->

# pob-bridge — LuaJIT subprocess lifecycle

`packages/pob-bridge` wraps PoB-PoE2's headless calc engine in a long-lived LuaJIT child
process. It is the only place in the repo that talks to LuaJIT.

- **Pooled, never per-request.** `PobBridgePool` is FIFO with crash-respawn; `lease(n)` hands
  out `n` slots atomically for parallel candidate evaluation. Do not spawn a bridge per call.
- **Each child is ~700 MB resident.** `POOL_SIZE` and `JOB_PARALLELISM` default to half the
  host core count (floor 1). Assume RAM, not CPU, is the ceiling.
- **`src/core` never constructs a bridge** — it receives one. Constructors live at the edges
  (the CLIs and `packages/api/src/server.ts`). Keep it that way.
- **Real-child tests are `*.integration.test.ts` only.** Anything that actually boots LuaJIT
  stays out of the default `npm test` suite (see `../../CLAUDE.md` §Tests).
- **Before changing tree / allocation / calc code, read `docs/gotchas.md`.** The PoB-PoE2 fork
  carries PoE1 leftovers; verify mechanics against vendored data rather than assuming.
