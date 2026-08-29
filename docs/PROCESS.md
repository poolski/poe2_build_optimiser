<!-- generated-by: groundrules v1.10.0 -->
# Development Process

How the project is built, tested, and shipped.

## Testing

There are **two test suites**, intentionally split:

### `npm test` — Fast unit tests (routine check)

Runs all `*.test.ts` files against **fake** bridges. No LuaJIT needed; completes in seconds.

**When to run:** Freely, after every edit. This is the normal verification loop.

```bash
npm test
tsc --noEmit  # Also run type check
```

### `npm run test:integration` — Real LuaJIT suite (on request only)

Runs only `*.integration.test.ts` files against **real** LuaJIT child processes. Takes ~4 minutes, spawns children at ~700 MB each.

**When to run:** Only when explicitly asked, or before shipping. Not a routine check.

```bash
npm run test:integration
```

**Why the split?** Running integration tests "just to be safe" after every edit is not worth 4 minutes + high RAM. The fast suite plus `tsc` is the normal loop; integration tests catch real-bridge issues.

**Critical:** Any new test that boots a real bridge (or pool, or spike harness) **must** go in an `*.integration.test.ts` file, not the default suite. This was a deliberate decision after end-to-end optimiser runs leaked into the fast suite (`2b52cee`).

**Concurrency:** Only one session/worktree may run integration tests at a time — they contend for RAM and LuaJIT children. Check for live `luajit.exe` before starting.

## Building & running

### Development

```bash
# Install deps + build submodule natives
git submodule update --init --recursive
npm ci
npm run build:native  # macOS/Linux only; no-op on Windows

# Run the recommender
npm run recommend-tree [PoB code or .xml path]

# Run the optimiser
npm run optimise-tree [flags]

# Start the API server (dev mode)
npm run dev:api    # restarts on file changes

# Start the full dev stack (API + web UI)
npm run dev        # (alias: npm run dev:api & npm run dev:web)

# Build the web bundle for production
npm run build:web
```

### Verify

```bash
npm test                    # Fast unit tests
tsc --noEmit                # Type check
npm run test:integration    # Real bridge tests (slow, on request only)
```

### Benchmarking & spikes

```bash
# Benchmark the three main optimization approaches on the corpus
npm run bench-tree-approaches [objective] [extraPoints] [--concurrency=N] [--preserve=A,B]

# Other spike tools
npm run gut-build                    # Synthetic corpus generation
npm run verify-dealloc-cascade       # Verify cascade-safety
npm run fetch-ninja-builds           # Fetch real builds from poe.ninja
```

## Dependencies & constraints

### `npm audit`

**Never run `npm audit fix --force`.** Five dev-toolchain advisories (vite / vitest / esbuild) are left in place on purpose. Fixing them requires breaking `vitest@4`; the flagged code doesn't ship.

The warning on every `npm install` is expected.

### Cross-package imports

Imports between workspaces (`src/`, `packages/*`) resolve through:

- `tsconfig.base.json` — `paths` aliases (e.g., `@poe2/contract`, `@optimiser/core`)
- `vitest.alias.ts` — vitest-specific aliases for tests

**There is no build step and no TS project references.** A new workspace dep usually needs no `npm install` — check whether the alias already covers it first.

## Git & versioning

### Commits

- Commit early and often. Revert is cheap; incomplete amends can corrupt history.
- Include context in commit messages: what changed and why (not just "update X").
- **AI attribution:** The project accepts Claude-authored code. Commit messages should reflect this (e.g., `Co-Authored-By: Claude`). See `CLAUDE.md` if this is restricted.

### Branches

- **`main`** — stable, shipped code. Must pass all tests.
- **`phase*/`** — feature branches for phases (phases 1–3 have shipped; phase 1.5 was parallel eval; phase 10 is spec-only).
- **Worktrees** — for parallel work. Fork-prep commit `08-fork-prep.md` serialized `03` (contract), then `04` and `05`+`06` ran in parallel worktrees.

## Deployment

### Local web UI

```bash
npm run dev              # Vite dev server + API on localhost:8787
npm run dev:web          # Web UI alone (default mocks the API)
npm run build:web        # Production bundle to packages/web/dist
```

### API only

```bash
npm run dev:api          # Hono server on 127.0.0.1:8787
npm run start            # (alias, production)
```

The API serves the built web bundle at `/` if `packages/web/dist` exists; otherwise it's API-only.

## Documentation

- **`PLAN.md`** — authoritative roadmap and status. Keep current.
- **`docs/decisions/`** — ADRs. When you make a load-bearing decision, add one and trim the prose
  that carried it elsewhere to a pointer.
- **`intake/beam-search-design.md`** — full optimisation algorithm design + implementation checklist.
- **`intake/web-ui/`** — phase-by-phase development specs.
- **`docs/gotchas.md`** — PoB-PoE2 quirks and traps.
- **User-facing:** `docs/cli/` for CLI docs, `README.md` for the web UI.

`docs/` is curated and kept current as code changes; `intake/` holds the design specs those docs
were synthesised from and changes only when a design changes.

---

**Last updated:** 2026-08-29

The repo is the single source of truth. As code changes, keep docs aligned (they rot otherwise). Use git history for "how did this happen"; docs explain "how does this work and why".
