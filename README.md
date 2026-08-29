# build_optimiser

Optimises **Path of Exile 2 passive skill tree** allocations for a build you already have.

It does not guess at damage numbers. Every candidate tree is scored by loading it into
**Path of Building's own headless calculation engine** and reading the result back — the same
figures PoB shows you, because they come from PoB. That makes it accurate and slow: roughly
250–310 ms per evaluation, and a full optimise run is minutes, not seconds.

Two ways to use it: a **command line** for scripted or repeatable runs, and a **local web UI**
for exploring a respec visually.

## What it can do

- **Extend** — you have spare points (or will have, on levelling); find the best nodes to spend
  them on.
- **Repair** — relocate up to *N* points from low-value allocated nodes into better ones. This is
  the respec case, and the one the tool is really for.
- **Roll back a branch** — pick an allocated node, free its entire downstream cascade, and
  re-spend those points from scratch.
- **Recommend** — a fast, read-only "what's the best single next node?" pass.

Scope is the **passive tree only**. Skill gems, support gems, and gear are fixed inputs; the
optimiser never edits them.

## Prerequisites

| Requirement | Notes |
| ------------- | ------- |
| **Node.js 22 or newer** | TypeScript run through `ts-node`. No `engines` field is enforced; the toolchain targets 22 and is developed on 24 |
| **LuaJIT** | the PoB engine is Lua. On Windows the default is `C:\msys64\mingw64\bin\luajit.exe`; on macOS/Linux it's `luajit` from your `PATH` (`brew install luajit`, or a distro package). Override either with the `POB_LUAJIT_PATH` environment variable |
| **The PoB submodule** | ~430 MB. `git submodule update --init --recursive` |
| **Native Lua modules (macOS/Linux only)** | the submodule ships prebuilt Windows `.dll`s; elsewhere `npm run build:native` compiles the one module (`lua-utf8`) the engine needs to boot. Windows skips this |
| **A build to work on** | a Path of Building 2 build saved as `.xml` (its `Builds` folder), or — for the web UI only — a PoB export code pasted in |

```bash
git submodule update --init --recursive && npm ci
npm run build:native   # macOS/Linux only; no-op on Windows
```

RAM is worth knowing about: each LuaJIT child holds a full PoB runtime at roughly 700 MB
resident. The CLIs use one. The web server pools two by default.

### Platform support

The bridge was first built on Windows and now runs on macOS and Linux too. Nothing is
platform-specific in the app itself — the bridge detects the OS to pick the LuaJIT executable
(`luajit` from `PATH`, or the msys64 path on Windows) and the Lua C-module extension (`.so` vs
`.dll`). The one native dependency the engine needs to boot, `lua-utf8`, ships prebuilt in the
submodule for Windows; on macOS/Linux `npm run build:native` compiles it from a pinned,
checksum-verified upstream source into `packages/pob-bridge/native/` (kept out of the submodule so
it survives resets). On macOS the build is a universal `arm64 + x86_64` binary; on Linux point
`CC` at a cross-compiler to target another architecture.

## Using the command line

```bash
npm run optimise-tree -- "path/to/build.xml" --respec-budget 6
```

Note the `--` before the arguments — npm needs it to pass them through.

That is the common case: free up to 6 points' worth of low-value nodes and re-spend them,
maximising `TotalDPS`. The run prints what it freed, what it added, and the net change.

Full references:

- **[docs/cli/README.md](docs/cli/README.md)** — start here. Objectives, constraints, how to get a
  build `.xml`, and which mode to reach for.
- **[docs/cli/optimise-tree.md](docs/cli/optimise-tree.md)** — the optimiser: every flag, all
  three modes, reading the output.
- **[docs/cli/recommend-tree.md](docs/cli/recommend-tree.md)** — the fast single-node
  recommender.

## Using the web UI

The UI wraps the same functions. A browser cannot start a LuaJIT process, so it talks to a small
local API server that owns the engine.

**Everything binds `127.0.0.1` and there is no authentication. It is a local tool for one person
— do not expose it.**

### Development

```bash
npm run dev
```

Starts the API on `127.0.0.1:8787` and the Vite dev server on `127.0.0.1:5173` with `/api`
proxied through. Open **<http://127.0.0.1:5173>**.

By default the dev SPA runs against a **fixture-backed mock**, so the UI can be worked on without
LuaJIT or the submodule. To drive the real engine:

```bash
VITE_USE_API=1 npm run dev
```

### Running it for real

```bash
npm run build:web && npm start
```

The API serves the built SPA at **<http://127.0.0.1:8787>**. A production build always uses the
real engine — the mock is dev-only.

Neither command is a background service. Start it when you want it, `Ctrl-C` when you are done.

### What the UI does

A four-step wizard:

1. **Build in** — paste a PoB export code or drop a `.xml` file. You get back class, level,
   points used, and the baseline stats, plus warnings for the awkward cases (a build that scores
   0 DPS headless, an over-allocated import).
2. **Configure** — mode, objective, constraints, frozen nodes, beam width and depth.
3. **Run** — progress streams over SSE as the job works. Cancel stops it within one add-step and
   frees the engine slot rather than leaving a zombie running for another quarter hour.
4. **Results** — the changed nodes drawn on a **stylised passive tree**, with added, dropped, and
   anchor nodes picked out; a node-by-node list beside it; and an **updated PoB code** to copy
   straight back into Path of Building.

The tree canvas is a schematic — shapes sized by node tier, PoE2 category colours, no game art.
If the build's tree version differs from the shipped one, the canvas steps aside and the list
diff carries the result on its own.

A run takes as long as the equivalent CLI run. The engine pool overlaps *concurrent* jobs, which
one person rarely has; making a *single* run faster is planned work, not something the UI already
does.

## Repository layout

```
src/                    core optimiser + the two CLIs
packages/
  pob-bridge/           the LuaJIT bridge and its process pool
  contract/             Zod schemas shared by the API and the UI
  api/                  local HTTP + SSE server
  web/                  the React SPA
docs/                   design notes, plans, and the CLI reference
```

## Contributing / working on it

Read **[CLAUDE.md](CLAUDE.md)** first — it covers the test split (`npm test` is fast and safe to
run constantly; the integration suite boots real LuaJIT children and is run deliberately), the
dependency rules, and how cross-package imports resolve.

`docs/status.md` is the authoritative map of what is built and what is planned.
