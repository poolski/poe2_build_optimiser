<!-- generated-by: groundrules v1.10.0 -->
# PRD — Configure step: node freeze/unfreeze/anchor menu, constraint/objective metric pickers

> Product Requirements Document for a single feature. Written **before** building, so the agent
> builds the right thing — not a coherent surprise. Validate it (and answer the open questions)
> before any code. Update it if the scope shifts.

**Date**: 2026-08-30 · **Status**: draft, open questions resolved — bundled per
[ADR-0014](../decisions/0014-bundle-configure-step-ui-ideas-into-one-feature-release.md) from
three backlog ideas in `PLAN.md`.

## Problem

The Configure step (`RunConfig.tsx`) asks users to type three things blind, with no picker or
cross-reference to what's actually available:

- **Freeze ids** (`RunConfig.tsx:275-279`) — a comma-separated node-id text field ("never freed by
  repair"), and the list itself renders as raw numeric ids with no name resolution. Users must
  already know a node's numeric id; there's no way to click a node on `TreeCanvas` and freeze it
  directly, and the current selection is unreadable at a glance. An id→name lookup already exists
  elsewhere in the app (`NodeDiff.tsx` renders node names from the same kind of node data), so
  this isn't a from-scratch problem — just not wired into `RunConfig`.
- **Constraint metric names** (`ConstraintsEditor.tsx`) — each constraint row is a free-text
  `metric` field (`rowsToConstraints`, `ConstraintsEditor.tsx:18-27`); a typo or an unknown metric
  name silently produces a constraint that never fires, with no feedback.
- **Objective metric** (`ObjectiveBuilder.tsx:101-107`) — *correction, 2026-08-30*: this field
  already has a `datalist` hybrid picker (`list="metric-suggestions"`, shipped in `fdc7fcc`), not
  pure free text as originally scoped here. But its option list is a component-local, hand-rolled
  array containing `CombinedDPS` and `FullDPS` — neither attested anywhere else in this repo,
  `docs/gotchas.md`, or `src/core` — i.e. invented PoB stat names, per `CLAUDE.md`'s "no invented
  PoB stats" rule. It's also not shared with `ConstraintsEditor`, so the two pickers would drift.

**For whom**: the web-UI user configuring an optimise/recommend run, who doesn't have the metric
name list or node ids memorised.

## Success criteria

<!-- Where you can, phrase a criterion so it's expressible as an acceptance test — its executable form. -->

- **Freeze / unfreeze / anchor nodes from tree explorer** — right-clicking a node on `TreeCanvas`
  opens a context menu with three actions: "Freeze" (appends the node's id to `RunConfig`'s
  freeze list, dedup against ids already present, including ones typed manually), "Unfreeze"
  (removes it from the freeze list — only offered for nodes already frozen), and "Anchor for
  rollback" (sets `request.mode = "rollback"` and `request.anchorNodeId`, reusing the same fields
  `TreeCanvas`'s existing `onPickAnchor` left-click flow already writes to). The freeze list
  displays each entry's human-readable node name, not its raw id — the underlying
  `request.freeze` payload stays `number[]` (id→name resolution is display-only). Acceptance:
  right-click → Freeze on two different nodes produces both ids in `request.freeze`, no
  duplicates, existing typed ids preserved, the rendered list shows names not ids; right-click →
  Unfreeze on a frozen node removes only that id; right-click → Anchor for rollback sets
  `mode`/`anchorNodeId` identically to the existing left-click-in-rollback-mode flow.
- **Dropdown metric picker in constraint builder** — each constraint row's metric field is a
  hybrid picker (suggestions from a static+build-merged metric list, still accepts free text) —
  see Open questions for the resolved source. Acceptance: the picker's option list is non-empty
  and sourced from that real merged source, not a hand-typed guess; selecting an option, or
  typing a value not in the list, both produce the same `rowsToConstraints` output as typing that
  exact string today (no behavioural change to the emitted constraint shape).
- **Selectable objective metric** — *revised, 2026-08-30*: the objective builder's `single`-kind
  metric field already has a hybrid picker; this criterion is now "refactor it onto the shared
  metric-list module and drop the invented names," not "build a picker from scratch." Acceptance:
  the field's `datalist` options equal the shared module's list exactly (no `CombinedDPS` /
  `FullDPS`); selecting an option, or typing a free-text value, both still produce the same
  `buildObjectiveSpec` output as today.

## Scope

**In scope**

- A right-click / context-menu affordance on `TreeCanvas` nodes offering Freeze, Unfreeze, and
  Anchor for rollback — wired to `RunConfig`'s existing `freeze`, `mode`, and `anchorNodeId`
  fields (no new contract field).
- Rendering the freeze list (however entries got there — context menu or manual typing) as node
  names via id→name resolution, reusing the same node-data source `NodeDiff.tsx` already gets,
  threaded into `RunConfig` as needed. Unresolvable ids fall back to displaying the raw id.
- Replacing (or augmenting) `ConstraintsEditor`'s free-text metric input with a hybrid
  autocomplete-or-free-text picker.
- Replacing (or augmenting) `ObjectiveBuilder`'s free-text `single`-kind metric input with the
  same hybrid picker.
- The metric option list: a small vendored static list of well-known metrics, merged with
  whatever the loaded build's baseline stats add.

**Out of scope** (explicit)

- Any change to `rowsToConstraints`, `buildObjectiveSpec`, or the request shapes they produce —
  pickers change *input ergonomics* only, not the emitted contract values.
- Any change to `optimiseTree` / `recommendTree` / the freeze/constraint/objective semantics
  themselves.
- A general node-selection / multi-select mode on `TreeCanvas` beyond the right-click Freeze /
  Unfreeze / Anchor-for-rollback actions.
- Any change to what "rollback mode" *does* once anchored — the context-menu action only sets
  the same `mode`/`anchorNodeId` fields the existing left-click-in-rollback-mode flow already
  sets; rollback semantics themselves are untouched.

## Constraints

- **No contract change.** `freeze: number[]`, `mode`, `anchorNodeId`, `constraints: Record<string,
  number>`, and `objective: string` are all pre-existing request fields; this is purely a
  Configure-step input UX change.
- Picker option lists must reflect **real** metric names (vendored list + measured stats), not an
  invented/guessed set — per this repo's "no invented PoB stats" rule (`CLAUDE.md`). The vendored
  portion of the list is itself real, sourced from vendored data, not authored freehand.

## Build plan

Ordered steps, each with a validation point.

1. **Build the vendored metric list + merge logic** — a small static list of well-known metrics
   (`docs/gotchas.md`-adjacent, vendored not invented), merged with the current build's baseline
   stats keys when a build is loaded. *Validation*: unit test — merge is stable, deduped, and
   degrades gracefully to just the static list before a build loads.
2. **Constraint + objective pickers** — swap the free-text metric inputs in `ConstraintsEditor`
   and `ObjectiveBuilder` for a hybrid autocomplete-or-free-text picker over the step-1 source,
   keeping `rowsToConstraints` / `buildObjectiveSpec` output identical for the same value whether
   selected or typed. *Validation*: existing + new component tests assert unchanged output shape
   for both a selected option and a typed value not in the list.
3. **Tree-canvas node menu + freeze-list name resolution** — right-click context menu on a
   `TreeCanvas` node offering Freeze / Unfreeze (frozen nodes only) / Anchor for rollback, wired
   to `RunConfig`'s `freeze` / `mode` / `anchorNodeId` fields; thread the node-data source
   `NodeDiff.tsx` already uses into `RunConfig` so the freeze list renders names, falling back to
   the raw id when a (typically manually-typed) id doesn't resolve.
   *Validation*: component tests — right-click Freeze/Unfreeze update `request.freeze` correctly
   without disturbing manually-typed ids; right-click Anchor sets `mode`/`anchorNodeId`
   identically to the existing left-click-in-rollback-mode flow; freeze list renders names, and
   an unresolvable id renders as its raw id.
4. **End-to-end check** — Configure step manual pass: pick a constraint metric (once via
   suggestion, once via free text), pick an objective metric, freeze a node via right-click,
   unfreeze it, anchor a different node for rollback, confirm the request payload matches what
   the equivalent manual entry would have produced. *Validation*: manual, screenshot in the PR.

## Risks

<!-- Premortem: assume this shipped and FAILED — why? Ranked by probability × impact. -->

- **Metric picker's static half goes stale.** The vendored static list can drift from what the
  bridge actually reports over time, same failure mode the picker was meant to fix — just hidden
  behind a dropdown that looks authoritative. *Mitigation*: the merge with live baseline stats
  means a stale static entry is additive noise, not a wrong answer, and the hybrid free-text
  fallback (resolved below) means a missing entry never blocks input outright.
- **Context menu conflicts with existing canvas interactions.** `TreeCanvas` already handles
  pan/zoom/click for node inspection and `onPickAnchor` selection in rollback mode; a new
  right-click handler (now with 3 actions instead of 1) could fight with those or with the
  browser's native context menu. *Mitigation*: explicit `preventDefault` on the custom menu,
  tested against the existing zoom/pan/anchor-pick interactions in `TreeCanvas.test.tsx`.
- **"Anchor for rollback" silently switches `mode`.** Right-clicking a node while the user has
  `extend` or `repair` mode configured (with its own fields filled in) flips `request.mode` to
  `"rollback"`, which changes which fields `RunConfig` renders — a user could lose track of why
  their screen just changed. *Early signal*: a manual pass where a user right-clicks Anchor
  without first switching to rollback mode notices the mode-switch is unannounced.
  *Mitigation*: the action label itself should read "Anchor for rollback" (not just "Anchor"),
  making the mode switch explicit in the menu item text; confirm this reads clearly in step 4's
  manual pass.

## Open questions

<!-- Resolve before building. -->

- **Metric source** — *answered, 2026-08-30.* Vendored static list of well-known metrics, merged
  with the current build's baseline stats keys when a build is loaded. Neither alone: the static
  list stays useful before a build loads; the build-specific keys keep it accurate to what the
  bridge actually reports.
- **Free-text fallback** — *answered, 2026-08-30.* Hybrid: the pickers suggest from the merged
  list but still accept a typed value outside it, so a valid metric missing from the current
  option source is never blocked.
- **Freeze menu scope** — *answered, 2026-08-30.* Broader than the original idea: Freeze,
  Unfreeze (frozen nodes only), and Anchor for rollback, all reusing existing `RunConfig` fields
  (`freeze`, `mode`, `anchorNodeId`) — no new contract surface.
- **Freeze-list name resolution source** — *answered, 2026-08-30.* Reuse the same node-data
  source `NodeDiff.tsx` already has, threaded into `RunConfig`. An id that doesn't resolve
  (typo, or an id from a different tree) falls back to displaying the raw id.
