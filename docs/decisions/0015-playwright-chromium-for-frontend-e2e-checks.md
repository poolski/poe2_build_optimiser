<!-- generated-by: groundrules v1.10.0 -->
# 0015 — Playwright + Chromium for frontend E2E checks, against the mock API

**Date**: 2026-08-30
**Status**: Accepted

## Context

The Configure-step pickers PRD's last build-plan step
(`docs/prd/web-ui-configure-step-pickers.md`) was a manual pass with no automated stop
condition — pick a constraint metric via suggestion and via free text, pick an objective metric,
freeze/unfreeze/anchor a node via the `TreeCanvas` right-click menu, and confirm the resulting
request state. No browser automation tool was set up in this repo, and no MCP browser tool was
available in the environment either. Driving the real app against the real API would also mean
booting the real LuaJIT bridge (~700 MB resident per child) just to click through a form — the
kind of cost `CLAUDE.md`'s test-split rules exist to avoid.

`packages/web` already ships a fixture-backed mock client (`VITE_USE_MOCK=1`,
`packages/web/src/mock/mockClient.ts`) built for exactly this: running the SPA with no API
process and no bridge. That made a real-browser check both possible and cheap once a runner was
in place.

## Decision

Use Playwright driving headless Chromium, against the app served with `VITE_USE_MOCK=1`, as the
project's frontend E2E checking tool. Config lives at `packages/web/playwright.config.ts` (starts
the Vite dev server itself, with the mock env var set); specs live in `packages/web/e2e/`. Node
coordinates for canvas right-click interactions are computed from the same tree data and viewport
math the app uses (`parseMinTree` + `fitToBounds` + `worldToScreen`) rather than hard-coded pixel
offsets, so a spec doesn't silently stop matching real node positions after a fixture or render
change.

## Alternatives considered

- **An MCP browser-automation tool.** None was available in the environment at the time; would
  also add a runtime dependency outside the repo's own toolchain.
- **Driving the real API/bridge.** Rejected per `CLAUDE.md`'s test-split rules — booting a
  ~700 MB LuaJIT child for a UI click-through is the exact cost that split exists to avoid, and
  the mock client already exists for this.
- **Component/unit tests only (Vitest + Testing Library, already in use).** These already cover
  the individual pieces (`ConstraintsEditor.test.tsx`, `TreeCanvas.test.tsx`, etc.) but can't
  exercise the real canvas hit-testing math end to end (jsdom's stubbed 2D context has no real
  layout) or catch cross-component wiring regressions the way a real-browser pass can.

## Consequences

### Positive
- The Configure-step manual pass is now a committed regression test
  (`packages/web/e2e/configure-step.spec.ts`), not a one-time screenshot in a PR.
- No bridge involved — `npm run test:e2e:web` stays fast and safe to run freely, unlike
  `npm run test:integration`.
- Establishes a reusable pattern (mock-backed dev server + Playwright + real-math coordinate
  derivation) for future frontend E2E checks.

### Negative / Tradeoffs
- Playwright + Chromium is a real download (~200 MB browser binary) and a new devDependency
  (`@playwright/test`) — heavier than the existing Vitest/jsdom component tests.
- E2E specs are slower and more brittle than component tests (real timers, real layout); reserve
  them for cross-component flows the component tests can't reach, not a replacement for them.
- Coordinate derivation duplicates knowledge of the render pipeline's coordinate math in the spec
  file — a `viewport.ts`/`minTree.ts` API change needs the spec updated too.

### Neutral
- Not wired into any CI pipeline yet (there isn't one) — `npm run test:e2e:web` is a manual/local
  command, same tier as `npm run test:integration`.

## Notes

- `docs/LEARNINGS.md` — "Frontend checks: Playwright + Chromium against the mock API, not the
  real bridge".
- `docs/prd/web-ui-configure-step-pickers.md` build-plan step 4, now closed out by
  `packages/web/e2e/configure-step.spec.ts`.
