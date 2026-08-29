# Roadmap

Future-looking only. What exists today and the completed milestones live in
[`PLAN.md`](../PLAN.md) — this file does not repeat them.

Nothing below is in progress. These are the candidates for the next piece of work, in rough
priority order, with the bar each one has to clear.

## Next up

### Bench sweep for a default `beamWidth > 1`

The optimiser ships with `beamWidth = 1` (pure greedy), proven sufficient on the 25-build corpus.
Open question: does a wider beam improve solution quality enough on larger builds to justify the
extra runtime?

- **Do:** run `npm run bench-tree-approaches` across a range of widths, compare lift % vs wall time.
- **Effort:** moderate — it is a measurement task, the beam already supports `W > 1`.
- **Blocked on:** nothing.

### RePoE-fork asset source

Bring passive-tree geometry, node art, and stat text in from a RePoE fork so the web canvas can
render real node artwork, gem icons in sockets, and per-node stat text.

- **Spec:** [`intake/web-ui/10-repoe-asset-source.md`](../intake/web-ui/10-repoe-asset-source.md) — written, not built.
- **Decision needed first:** this reverses ADR-010 ("stylised only, no GGG art"). Confirm we want
  that before starting; if adopted, supersede ADR-010 with a new ADR.
- **Blocked on:** nothing technical; the calc engine stays on PoB either way.

## Deferred — pick up only on demand

### Candidate-pruning layers 3 / 4 / 6

The beam-search design sketched three pruning layers to contain candidate explosion. Greedy
re-spend has been fast enough without them. Revisit only if a real run gets too slow.

### `--target-level` — derive the point budget from a character level

Let the user pass a level instead of `--extra-points`, and compute the available passive points.

- **Blocked on:** a verified quest→passive-point mapping, checked against vendored PoE2 data (the
  same discipline as [`docs/gotchas.md`](gotchas.md)).

### From-scratch mode — infinite budget, bare tree

Optimise a completely empty tree. Needs the add-loop to spend zero-delta pathing steps toward a
distant payoff — a generalisation of the current greedy add. Also the blocker for rollback with an
anchor near the class start.

- **Value:** theory-crafting. Not needed for the core respec use case.

### Untrimmed `OptimiseTreeResult` fixture for the canvas contract test

`spike/genCanvasFixture.ts` writes only a trimmed canvas projection. The contract tests
reconstitute a full `OptimiseResultDTO` before parsing, so the fixture test never exercises the
nullable `objectiveAfterRemoval` branch (a dedicated unit test does).

- **Do:** dump an untrimmed `OptimiseTreeResult` blob alongside the projection so the fixture
  test covers the nullable branch end-to-end.
- **Effort:** small — spike script plus fixture regen.
- **Blocked on:** nothing.

## Out of scope

### Skill / support-gem optimisation

Skill and support gems are immutable calculation inputs. The optimiser never edits gem links,
levels, or qualities (ADR-002). Gems have their own balance mechanics (drop rates, level gates,
family uniqueness, socket colours) and are a separate problem. The design sketch is kept in
[`intake/skill-optimiser-design.md`](../intake/skill-optimiser-design.md) in case scope reopens.

---

**Last updated:** 2026-08-29
