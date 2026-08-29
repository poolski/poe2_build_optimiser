# ADR-010 — Result rendering: stylised tree canvas + node-list diff, both in v1

**Status:** Accepted (2026-08-28) — canvas promoted out of "deferred" the same day

## Context

The optimiser's output is an allocation diff. A node-list diff is trivial to render; a tree visual
is what users actually read. A PoB-faithful render needs the DDS texture pipeline and GGG art.

## Decision

Ship both in v1. The node-list diff is the fallback and the tree-version-mismatch view. The tree
canvas is the headline: **stylised only** — shapes not sprites, dot-size by tier, PoE2 colours, no
orbit rotation — porting the MIT Canvas2D renderer from `poe2-tools/poe2-build-planner` onto our
PoB `tree.json`. A PoB-faithful DDS render is out of scope.

## Consequences

- No GGG art in the repo; `LICENSE.upstream` + per-file provenance for the ported renderer.
- The canvas track needs neither LuaJIT nor the submodule — it runs off committed fixtures
  (`packages/web/public/tree-0_5.min.json` + `packages/web/fixtures/`).
- `intake/web-ui/10-repoe-asset-source.md` proposes real node art from a RePoE fork; adopting it
  would reverse this ADR's "no art". Spec only, not built.
