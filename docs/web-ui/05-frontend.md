# Phase 3 — frontend (`packages/web`)

A Vite + React single-page app: paste/upload a build → pick mode + objective + constraints → run
→ watch progress → read the node-list diff → copy the updated PoB code. No tree canvas (`06` is a
separate, deferred phase).

Depends on phase 2 (API + contract).

```
packages/web/
  package.json        # deps: react, react-dom, @poe2/contract; dev: vite, @vitejs/plugin-react
  vite.config.ts      # dev proxy: /api → http://127.0.0.1:8787
  index.html
  src/
    main.tsx
    api.ts            # fetch wrappers + EventSource helper, typed via @poe2/contract
    state.ts          # useReducer store (see below)
    steps/
      BuildInput.tsx
      RunConfig.tsx
      RunProgress.tsx
      Results.tsx
    components/
      ObjectiveBuilder.tsx
      ConstraintsEditor.tsx
      NodeDiff.tsx
    styles.css        # plain CSS, one file for v1
```

## Stack choices

- **React + Vite + TS.** Vite dev server on `:5173`, HMR, `/api` proxied to the Hono server.
  `vite build` emits `packages/web/dist`, which the API `serveStatic`s in prod.
- **No router.** The app is a 4-step wizard on one page; state is a `step` enum. If deep-linking
  to a finished job is ever wanted, add hash routes (`#/job/:id`) then — not now.
- **No state library.** One `useReducer` in `state.ts`. The shape is small:
  ```ts
  type AppState = {
    step: "input" | "config" | "running" | "results";
    build?: BuildSummary;
    request: OptimiseRequest;        // the form model, seeded with contract defaults
    job?: { jobId: string; status: JobStatus };
    progress?: ProgressEvent;
    result?: OptimiseResultDTO;
    error?: string;
  };
  ```
- **No UI kit** for v1 — native `<select>` / `<input>` / `<fieldset>`, ~150 lines of CSS. A kit
  (Radix, shadcn) is a fine later swap; it isn't load-bearing.

## Screens

### 1. `BuildInput`

- Tabs: **Paste code** (textarea for `base64(zlib(xml))`) / **Upload `.xml`** (file input +
  drag-drop).
- Submit → `POST /api/builds` → on success store `build`, advance to `config`.
- Show the returned `BuildSummary`: class · ascendancy · level · `pointsUsed / pointsMax`, and
  any `notes` as a warning strip (0-DPS build, over-allocated → "extend mode needs an explicit
  point budget").

### 2. `RunConfig`

The form model is `OptimiseRequest` from the contract, so validation mirrors the server.

- **Mode** (segmented): `extend` · `repair` · `rollback`.
  - `extend` → shows **Extra points** (or absolute **Point budget**, xor).
  - `repair` → shows **Respec budget** (points ceiling).
  - `rollback` → shows **Anchor node id** (required) + optional **Respec budget** for extra
    survivors. A helper: "the node to roll back to; its whole downstream subtree is freed".
- **Objective** (`ObjectiveBuilder`): radio between
  - *Single metric* → text/autocomplete (`TotalDPS`, `TotalEHP`, …)
  - *DPS/EHP blend* → `dps-ehp:` + a `0–1` slider (`W`)
  - *Custom blend* → `blend:` + metric A + metric B + weight
  Emits the spec string the contract regex accepts.
- **Constraints** (`ConstraintsEditor`): repeatable `metric = number` rows + a **Preserve**
  multiselect (floor each at baseline) + a **Min resist** shortcut.
- **Advanced** (collapsed): proximity, node types / all-node-types, keywords / exclude-keywords,
  beam width, beam depth, freeze ids (comma list).
- **Run** → `POST /api/jobs` → store `job`, advance to `running`, open the SSE stream.

### 3. `RunProgress`

- Subscribe to `GET /api/jobs/:id/events` via `EventSource`.
- Render from `ProgressEvent`:
  - **Phase** label (`baseline` → `regret-probe` → `add-loop` → `k-sweep` → `finalising`).
  - **Recomputes**: `buildOutputs` (and `/ estimatedTotal` as a bar when present, else a count +
    a spinner). Add-loop dominates wall time.
  - **Best objective so far** with a delta vs baseline, so the user sees it climbing.
  - `k / kTotal` and `depth` when set.
  - Elapsed (from `elapsedMs`), rough rate (`buildOutputs / elapsed`).
- **Cancel** → `POST /api/jobs/:id/cancel`; UI returns to `config`. Server-side the job stops
  within one add-step (seconds) via `shouldContinue` and frees its bridge slot (see `04`), so the
  user can immediately re-submit a corrected config.
- On `error` event → show `JobError.message`, offer "back to config".
- On `done` event → store `result`, advance to `results`.
- Reconnect: if the `EventSource` errors, re-`GET /api/jobs/:id`; if settled, jump to results.

### 4. `Results` (`NodeDiff`)

- **Headline**: `objective baseline → final` with `%` change; `net points` (repair: `freed N /
  re-spent M`); `mode`, `beam width`, `rollback to <id>` when relevant; `stoppedBecause`
  translated to plain text (`repair-not-worthwhile` → "the loaded tree already wins — no change
  recommended").
- **Freed** (repair): list `removed[]` — name (type), `frees P pts` (mark `cascade` /
  `anchor cascade`), `value lost`, `objective … → … without it`.
- **Added / re-spend steps**: ordered `steps[]` — `name (type, P pt, path L)`, `objective before
  → after (+Δ/pt)`, indented `statLines`.
- **Updated PoB code**: read-only textarea + **Copy** button (`result.updatedPobCode`). This is
  the deliverable — paste back into PoB.
- **Raw JSON** toggle for the whole `OptimiseResultDTO`.
- **Recompute stats** footer: `buildOutputCount`, `cacheHitRate`, wall.

## `api.ts`

Thin typed wrappers — `createBuild(input)`, `getBuild(id)`, `submitJob(req)`, `getJob(id)`,
`cancelJob(id)`, and `streamJob(id, { onProgress, onDone, onError })` around `EventSource`. All
payload types come from `@poe2/contract`; no types redeclared here.

## Tests

Optional for v1 (single-user tool). If added: React Testing Library under the existing `vitest`,
covering `ObjectiveBuilder` spec-string output and `ConstraintsEditor` row add/remove. E2E is not
worth standing up for one user.

## Deferred

- Tree canvas (`06`).
- Persisting the last-used `RunConfig` in `localStorage`.
- Side-by-side compare of two result runs.
- A recommender-only quick view (the API already supports `kind: "recommend"` jobs; wiring a
  fifth screen is small when wanted).
