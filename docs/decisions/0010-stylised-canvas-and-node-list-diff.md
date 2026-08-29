<!-- generated-by: groundrules v1.10.0 -->
# 0010 — Result rendering: stylised tree canvas + node-list diff, both in v1

**Date**: 2026-08-28
**Status**: Accepted — the "stylised only, no GGG art" clause is superseded by ADR-0012
(2026-08-29); everything else here stands

## Context

The optimiser's output is an allocation diff. A node-list diff is trivial to render; a tree visual
is what users actually read. A PoB-faithful render needs the DDS texture pipeline and GGG art.

## Decision

Ship both in v1. The node-list diff is the fallback and the tree-version-mismatch view. The tree
canvas is the headline: **stylised only** — shapes not sprites, dot-size by tier, PoE2 colours, no
orbit rotation — porting the MIT Canvas2D renderer from `poe2-tools/poe2-build-planner` onto our
PoB `tree.json`.

## Alternatives considered

- **Node-list diff only, canvas deferred** — rejected the same day it was written: the diff alone
  does not answer "where on the tree did this go", which is the question users open the result to
  ask.
- **A PoB-faithful DDS render** — rejected: the texture pipeline and the GGG art it needs are out
  of proportion to a v1 result view.

## Consequences

### Positive
- The canvas track needs neither LuaJIT nor the submodule — it runs off committed fixtures
  (`packages/web/public/tree-0_5.min.json` + `packages/web/fixtures/`).

### Negative / Tradeoffs
- Stylised dots make a normal node and a notable the same shape at different sizes — the readability
  cost that ADR-0012 later reversed.

### Neutral
- No GGG art in the repo at the time of this decision; `LICENSE.upstream` + per-file provenance for
  the ported renderer. Real node art from a RePoE fork was adopted on 2026-08-29 — see ADR-0012;
  GGG art now ships in the repo.
