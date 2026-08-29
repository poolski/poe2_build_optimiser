<!-- generated-by: groundrules realize, 2026-08-30 -->
# Loop backlog

Tasks the maker/verifier loop may pick up. Each has a pre-written, red, behavioural acceptance
test committed alongside this file — the maker's job is to turn it green without editing the
test. See `docs/prd/web-ui-live-progress-view.md` for full context.

## Tasks

- [ ] **Add optional `workers[]` and `topNodes[]` fields to `ProgressEvent`
      (`packages/contract/src/progress.ts`) and `OptimiseProgress`
      (`src/core/optimiseTree.ts`).** Acceptance test:
      `npx vitest run packages/contract/src/progress.test.ts` → exit 0 = green.
      Behaviour: `ProgressEvent` gains `workers: { slot: number; done: number; total: number }[]`
      (optional) and `topNodes: { id: string; name: string; scoreDelta: number }[]` (optional,
      max 5 entries), both round-tripping through `.parse()` unchanged when present, and the
      schema still parses an event that omits them entirely. Mirror the same two optional fields
      onto the `OptimiseProgress` interface in `src/core/optimiseTree.ts` (not yet populated by
      any emitter — that's a separate task). Out of scope: populating the fields from real data,
      `RecommendProgress`, the API mapper, and the frontend.

- [ ] **Forward `workers[]` / `topNodes[]` through `normalizeProgress`
      (`packages/api/src/jobs/mappers.ts`).** Acceptance test:
      `npx vitest run packages/api/src/jobs/mappers.test.ts` → exit 0 = green.
      Behaviour: when the core progress object passed to `normalizeProgress` carries `workers`
      and/or `topNodes`, the returned `ProgressEvent` includes them unchanged (same pattern as
      the existing `depth`/`k`/`kTotal`/`candidatesScored` copy-through in that function); when
      absent, the returned event omits them (no `0`/`[]` sentinel). Out of scope: the contract
      schema itself (prior task), populating the fields on the core side, SSE wiring beyond this
      mapper function.
