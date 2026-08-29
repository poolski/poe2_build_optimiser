# Fork-prep — the commit that makes phases 2–3 parallelisable

One deliberate commit between the end of phase 1 and the start of everything else. It exists so
that three concurrent tracks (`04` API, `05`+`06` frontend+canvas, and optionally phase 1.5) never
have to touch a shared root file again.

Written 2026-08-29. Nothing here changes the plan's *content* — it front-loads the plumbing that
would otherwise be edited concurrently by three sessions.

## Why

The tracks themselves barely overlap: each lands in its own new `packages/*` directory. The
friction is entirely in the files they all need to edit on the way in:

- **`package-lock.json`** — concurrent `npm install` in separate worktrees produces conflicting
  lockfiles that are miserable to merge by hand. This is the #1 practical hazard.
- `tsconfig.base.json` `paths`, `vitest.config.ts` / `vitest.integration.config.ts` aliases, root
  `package.json` scripts — small edits, but all three tracks want them.

Do them once, up front, serially. Then fork.

## Gate

**Do not start until phase 1 is complete** (`01`, `02`). Fork-prep edits exactly the root files
the bridge work is editing. Phase 1 completed 2026-08-29 (`660534d`, `97cbe27`, `5c24241`, `2b52cee`, `a7b358c`) and
**this document was executed as `e9e2c56`**. It is kept as the record of what was done and
why, with the in-line corrections found during execution. Re-read it before the fork.

---

## The tasks

### 1. Install every v1 dependency in one pass

> **Corrected 2026-08-29 during execution: do task 2 first.** `npm install -w <newpkg> <dep>`
> silently no-ops (exit 0, no error) when npm has not yet linked that workspace. Create all
> three skeleton `package.json`s (task 2), run one bare `npm install` so npm links the
> workspaces, *then* do the `-w` installs.

| Workspace | Dependencies |
| ----------- | -------------- |
| `contract` | `zod` |
| `api` | `hono`, `@hono/node-server` |
| `web` | `react`, `react-dom`; dev: `vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`, `jsdom` |

> **Corrected 2026-08-29 at integration: `zustand` should never have been on this list.**
> It was installed on the strength of `06`'s claim that it was "already a candidate dep for
> `packages/web` (`05`)" — but `05` decides the opposite (**no state library**, one
> `useReducer`). Zustand is *upstream's* stack, not ours. Nothing ever imported it.
| root | dev: `concurrently` |

Install from the repo root with `-w <workspace>` so each lands in the right
`packages/*/package.json` and the lockfile is rewritten exactly once.

**Exit:** `package-lock.json` shows a single coherent change; `rm -rf node_modules && npm ci`
completes clean.

### 2. Three package skeletons

Mirror `packages/pob-bridge` exactly — it is the template:

```
packages/{contract,api,web}/
  package.json      # "@poe2/<name>", private, main+types -> src/index.ts, "build": "tsc -p tsconfig.json"
  tsconfig.json     # extends ../../tsconfig.base.json, outDir dist, rootDir src  (see task 4 for web)
  src/index.ts      # placeholder export so tsc doesn't choke on an empty program
```

**Exit:** root `npm run build` (whole-repo `tsc --noEmit`) is green.

### 3. Register the aliases — in all three places

Adding a workspace package currently means editing **three** files, which is easy to half-do:

1. `tsconfig.base.json` `paths` — *two* entries per package (`@poe2/x` and `@poe2/x/*`)
2. `vitest.config.ts` `resolve.alias`
3. `vitest.integration.config.ts` `resolve.alias`

While in there, factor the alias map into a shared `vitest.alias.ts` imported by both vitest
configs. Future packages then touch two files instead of three.

Root `tsconfig.json` needs no change — its `include` already globs `packages/*/src/**/*.ts`.

**Exit:** a throwaway `import ... from "@poe2/contract"` inside `src/` typechecks, and a trivial
test importing it resolves under both `npm test` and `npm run test:integration`.

### 4. Carve `packages/web` out of the commonjs typecheck ⚠️

**Not in the original plan; found while reading the current configs.**

`tsconfig.base.json` is `module: commonjs`, `moduleResolution: node`, `lib: ["ES2022"]` — no DOM,
no `jsx`. That is correct for the Node-side packages and wrong for the SPA, which needs
`module: ESNext`, `moduleResolution: bundler`, `jsx: react-jsx`, and
`lib: ["ES2022", "DOM", "DOM.Iterable"]`.

The trap: root `tsconfig.json` has `include: ["src/**/*.ts", "packages/*/src/**/*.ts"]`. `.tsx`
files escape that glob, so it *looks* fine — but web's plain `.ts` files (the `useReducer` store,
the API client, the render helpers ported in `06`) get pulled into the commonjs/no-DOM program and
fail on the first `document` or `HTMLCanvasElement` reference.

Fix: add `packages/web/**` to the root `tsconfig.json` `exclude`, and give `packages/web` its own
`tsc --noEmit` as its `build` script so it is still typechecked, just under its own options.

**Exit:** root `npm run build` stays green with a `document`-referencing `.ts` file present in
`packages/web/src/`, and `npm run build -w @poe2/web` typechecks that same file successfully.

### 5. Vitest environment split for the web package ⚠️

**Also not in the original plan.**

`vitest.config.ts` includes `packages/*/src/**/*.test.ts` and runs in the default node
environment with no JSX transform. It will happily pick up web's component tests and fail them.

Web tests need `environment: "jsdom"` plus a JSX transform.

> **Corrected 2026-08-29 during execution — do NOT use `vitest.workspace.ts`.** The original
> recommendation here was wrong, and was disproved empirically. A workspace file is *globally
> auto-discovered*, so once it exists both `vitest` (`npm test`) **and**
> `vitest --config vitest.integration.config.ts` run every project — including the LuaJIT
> integration files. `--config` stops isolating, which destroys the suite split that `2b52cee`
> deliberately introduced.
>
> **What was done instead:** `environmentMatchGlobs: [["packages/web/**", "jsdom"]]` plus
> `esbuild.jsx: "automatic"` in `vitest.config.ts`. Keeps one config, keeps `--config`
> isolation, no duplicated alias map.
>
> **Also: `@vitejs/plugin-react` is not usable from the root vitest config.** It requires
> `vite@8`, which npm nests under `packages/web/node_modules` where the root config cannot
> resolve it. esbuild's automatic JSX covers the tests; the frontend track gets the real plugin
> via its own web-local `vite.config.ts` for the dev server. `05` should not promise otherwise.

**Exit:** a trivial React component test passes, and the existing node-environment tests still
pass in the same `npm test` run.

### 6. Generate the canvas fixtures — the decoupler

This is what lets `06` be developed with **no bridge, no LuaJIT, and no submodule checkout**.

- Commit `packages/web/public/tree-0_5.min.json`, derived from
  `packages/pob-bridge/pob-runtime/PathOfBuilding-PoE2/src/TreeData/0_5/tree.json` — geometry
  (`groups`, node `group`/`orbit`/`orbitIndex`, `in`/`out`, orbit-radius constants) plus node
  type/name/stat lines. Drop `sprites`, `imageZoomLevels`, and flavour text. Target well under
  500 KB from the 1.9 MB source.
- Commit one real before/after fixture: run a small `optimise-tree --respec-budget 2` on a corpus
  build and capture `{ before, after, added, removed, anchor }` node ids as JSON.
- **Fix the stale path in `06-tree-canvas.md`** — it still refers to `pob-runtime/…` from before
  the `packages/pob-bridge/` move (`97cbe27`).

**Deviation from `06`, recorded deliberately:** that doc puts the `tree-0_5.min.json` build step
in `packages/api`. Make it a committed artifact generated here instead. A build step would
re-couple the canvas track to the submodule, which is precisely what this task removes. Revisit
only when the tree version bumps.

> **Source superseded (2026-08-29) by [`10-repoe-asset-source.md`](10-repoe-asset-source.md).**
> `tree-0_5.min.json` is now generated from RePoE-fork (`fetch-tree.mjs`), not from the PoB
> submodule via `gen-min-tree.mjs`. This removes the submodule coupling at *regen* time too — a
> fresh web worktree no longer needs `submodule update` to rebuild the tree. It stays a committed
> artifact, not a build step (the point above holds). The calc engine still uses the PoB `tree.json`.

**Exit:** the canvas track can be developed in a worktree with the submodule never initialised.

### 7. Leave root `scripts` alone

Only the `concurrently` *dependency* goes in now. `dev`, `start`, and the SPA `build` wiring land
with the phases that own them (`04`, `05`) — they are one-line additions, the cheapest possible
merge.

This makes root `package.json` `scripts` the single remaining point of contention between tracks,
deliberately and cheaply.

### 8. Fork

`git worktree add` does **not** initialise submodules — which works in our favour after task 6:

| Track | Submodule needed? | Rough disk |
| ------- | ------------------- | ------------ |
| `05` + `06` frontend + canvas | **no** (task 6) | ~200 MB |
| `04` API | yes — the real-pool integration test | ~630 MB |
| phase 1.5 parallel eval | yes | ~630 MB |

Measured 2026-08-29: submodule worktree 430 MB, `.git` 1.49 GB, `node_modules` 52 MB before
react/vite.

**Ownership rule after the fork:** no track edits `tsconfig.base.json`, the vitest configs, or
`package-lock.json`. If a track genuinely needs one changed, it goes back to whoever is
integrating rather than being edited in place.

**Machine contention:** only one track at a time should run `npm run test:integration` or the
bench harness — they boot real PoB children and `vitest.integration.config.ts` already sets
`fileParallelism: false` for exactly that reason.

---

## Sequence

```
phase 1 (01, 02) ──► fork-prep ──► 03 contract (serial) ──┬─ 04 API
                                                          ├─ 05 frontend
                                                          ├─ 06 canvas
                                                          └─ 1.5 parallel eval
```

`03` stays **serial and alone**: its skeleton is created in fork-prep (task 2), but its content is
written before anything consumes it. It is half a day of Zod schemas and it is the one artifact
that forces rework in two tracks if it moves after they start. Freeze it, commit it, then fork.

Phase 1.5 is listed as a parallel track here because it is sequenced after v1 by *priority*, not
by dependency — it touches only `src/core` + `packages/pob-bridge` and its sole collision is with
`02`'s edits inside `beamAddLoop`. Promote it into the fork only if wall-time is the thing that
actually bothers you about the tool; otherwise leave it as the fast-follow `README.md` describes.
