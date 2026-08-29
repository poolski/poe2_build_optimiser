# build_optimiser — working guidance

Optimises PoE2 passive-tree allocations using Path of Building's headless LuaJIT calc engine as
the fitness oracle. Start with `PLAN.md` — it is the authoritative map.

## Tests — the split is deliberate

| Command | What it runs | When |
|---------|--------------|------|
| `npm test` | fast unit tests against **fake** bridges, no LuaJIT | freely, as the routine check |
| `npm run test:integration` | `*.integration.test.ts` only — **real LuaJIT children** | **only when explicitly asked** |

**Do not run the integration suite as a routine check.** It takes ~4 minutes of wall clock, spawns
`luajit.exe` children at roughly 700 MB resident each, and runs with `fileParallelism: false`
because they contend. Running it "just to be safe" after an edit is not worth that cost — `npm test`
plus `tsc --noEmit` is the normal verification loop. Ask first, or wait to be asked.

The same applies to anything else that boots a real bridge: the bench harness
(`npm run bench-tree-approaches`), `npm run verify-dealloc-cascade`, and the `spike/` scripts.

Two corollaries:

- **Only one session or worktree may run integration tests at a time.** They contend for RAM and
  for the LuaJIT children. Check for a live `luajit.exe` before starting one.
- **Any new test that boots a real bridge or pool belongs in an `*.integration.test.ts` file**, so
  it stays out of the default suite. This split was introduced deliberately (`2b52cee`) after
  end-to-end optimiser runs leaked into the fast suite.

## Verification loop

- After any change, the routine check is `npm test` (fast, fake bridges) **plus** `npx tsc
  --noEmit`. Nothing else is required to call a change verified.
- Everything that boots real LuaJIT — `npm run test:integration`, `npm run bench-tree-approaches`,
  `npm run verify-dealloc-cascade`, the `spike/` scripts — runs **only when explicitly asked**.
- For changes that affect the calc result (scoring, objectives, the bridge, tree/alloc code),
  also validate against real PoB output using the recipe in `docs/beam-search/repro.md` before
  claiming it is done.

## Dependencies

- **Never run `npm audit fix --force`.** Five dev-toolchain advisories (vite / vitest / esbuild)
  are left in place on purpose — remediation requires breaking `vitest@4`, and none of that code
  ships. The warning on every `npm install` is expected.
- Cross-package imports resolve through `tsconfig.base.json` `paths` plus the vitest aliases.
  There is **no build step and no TS project references**, so a new workspace dep usually needs no
  `npm install` at all — check whether the alias already covers it before touching the lockfile.

## Layout

npm workspaces. `src/` holds the core optimiser and the two CLIs; `packages/` holds
`pob-bridge`, `contract`, `api`, and `web`. `src/core` receives a bridge and never constructs one —
the constructors live at the edges (the CLIs, and `packages/api/src/server.ts`).
`packages/api/src/core.ts` is the single module that crosses from `packages/` into repo-root
`src/`, which is why the API package is `noEmit`.

## Working style

- Reproduce a bug with a failing test before fixing it; debug from that repro, not from
  guesswork. The bridge is deterministic — a `spike/` script or a fixture will reproduce it.
- Keep diffs small and single-purpose. Clean up what you touched, not the surrounding file.
- Never invent PoB stats, node data, or mechanics. If the data the calc needs is missing or
  looks wrong, stop and surface it — `docs/gotchas.md` records the PoE1 leftovers to distrust.

## Git & review

- Branch off `main`. Keep each PR small and about one thing.
- Run `/code-review` (or `/code-review ultra` for a larger diff) before asking for human review.
- Commit at logical boundaries with Conventional Commit subjects; don't bundle unrelated work.
- Squash-merge feature branches so `main` history stays linear.
