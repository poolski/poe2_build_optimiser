// Automates the Configure-step manual check from
// docs/prd/web-ui-configure-step-pickers.md (build plan step 4): pick a constraint metric once
// via suggestion and once via free text, pick an objective metric, freeze a node via right-click,
// unfreeze it, anchor a different node for rollback, and confirm the visible request state
// matches what the equivalent manual entry would have produced.
//
// Runs against the fixture-backed mock client (VITE_USE_MOCK=1) per
// docs/LEARNINGS.md "Frontend checks: Playwright + Chromium against the mock API" -- no real API
// process, no LuaJIT bridge.
//
// Node coordinates for the right-click actions are computed from the same tree data and viewport
// math the app itself uses (parseMinTree + fitToBounds + worldToScreen), read directly off the
// committed fixture/tree files rather than guessed pixel offsets.

import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { parseMinTree } from "../src/render/minTree";
import { fitToBounds, worldToScreen } from "../src/render/viewport";

const WEB_ROOT = path.resolve(__dirname, "..");

function loadAllocatedNodeIds(): number[] {
  const fx = JSON.parse(
    readFileSync(path.join(WEB_ROOT, "fixtures/canvas-diff.R_Thor-L84-weak.json"), "utf8"),
  ) as { before: number[] };
  return [...fx.before].sort((a, b) => a - b);
}

function loadTree() {
  const raw = JSON.parse(readFileSync(path.join(WEB_ROOT, "public/tree-0_5.min.json"), "utf8"));
  return parseMinTree(raw);
}

test("Configure step: metric pickers + freeze/unfreeze/anchor", async ({ page }) => {
  const tree = loadTree();
  const allocated = loadAllocatedNodeIds().filter((id) => tree.nodesById.has(id));
  expect(allocated.length).toBeGreaterThanOrEqual(2);
  const freezeNode = tree.nodesById.get(allocated[0])!;
  const anchorNode = tree.nodesById.get(allocated[1])!;

  await page.goto("/");

  // Step 1 -- Build: the mock client ignores the input, any non-empty paste loads MOCK_BUILD.
  await page.getByPlaceholder(/eNp1kMtOwzAQ/).fill("dummy-pob-code");
  await page.getByRole("button", { name: "Load build" }).click();
  await expect(page.getByRole("button", { name: "Run" })).toBeVisible();

  // -- Constraint metric: once via suggestion, once via free text --
  const metricOptions = await page.locator("#constraint-metric-options option").evaluateAll(
    (opts) => opts.map((o) => (o as HTMLOptionElement).value),
  );
  expect(metricOptions.length).toBeGreaterThan(0);
  expect(metricOptions).toContain("TotalEHP");
  expect(metricOptions).not.toContain("CombinedDPS");
  expect(metricOptions).not.toContain("FullDPS");

  await page.getByRole("button", { name: "+ Add constraint" }).click();
  await page.getByLabel("constraint metric 1").fill(metricOptions[0]);
  await page.getByLabel("constraint value 1").fill("40000");
  await page.getByRole("button", { name: "+ Add constraint" }).click();
  await page.getByLabel("constraint metric 2").fill("SomeUnlistedMetric");
  await page.getByLabel("constraint value 2").fill("10");
  await expect(page.getByLabel("constraint metric 1")).toHaveValue(metricOptions[0]);
  await expect(page.getByLabel("constraint metric 2")).toHaveValue("SomeUnlistedMetric");

  // -- Objective metric: select an option from the shared list, confirm the emitted spec --
  const objectiveOptions = await page.locator("#metric-suggestions option").evaluateAll(
    (opts) => opts.map((o) => (o as HTMLOptionElement).value),
  );
  expect(objectiveOptions).toEqual(metricOptions); // same shared known-metrics module
  const objectiveField = page.getByRole("combobox", { name: "Metric", exact: true });
  await objectiveField.fill("TotalEHP");
  await expect(page.locator("p.note .mono")).toHaveText("TotalEHP");

  // -- Freeze / unfreeze / anchor via the tree-canvas right-click menu --
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("tree canvas has no bounding box");
  const size = { width: box.width, height: box.height };
  const vp = fitToBounds(tree.bounds, size, 40);
  const toPage = (wx: number, wy: number) => {
    const { sx, sy } = worldToScreen(vp, size, wx, wy);
    return { x: box.x + sx, y: box.y + sy };
  };

  const freezePt = toPage(freezeNode.x, freezeNode.y);
  await canvas.click({ button: "right", position: { x: freezePt.x - box.x, y: freezePt.y - box.y } });
  await page.getByRole("button", { name: "Freeze", exact: true }).click();

  await page.getByRole("button", { name: /Advanced/ }).click();
  const freezeChip = page.locator(".freeze-list .chip");
  await expect(freezeChip).toHaveCount(1);
  await expect(freezeChip.first()).toContainText(freezeNode.name || String(freezeNode.id));

  // Unfreeze via the same chip.
  await freezeChip.first().click();
  await expect(page.locator(".freeze-list .chip")).toHaveCount(0);

  // Anchor a *different* node for rollback.
  const anchorPt = toPage(anchorNode.x, anchorNode.y);
  await canvas.click({
    button: "right",
    position: { x: anchorPt.x - box.x, y: anchorPt.y - box.y },
  });
  await page.getByRole("button", { name: "Anchor for rollback" }).click();

  await expect(page.locator(".segmented button.on")).toHaveText("rollback");
  await expect(page.getByText(new RegExp(`Anchor: node ${anchorNode.id}\\b`))).toBeVisible();

  // The request is now well-formed end to end: rollback mode has its anchor, the objective spec
  // is valid -- Run is enabled, matching what the equivalent manual entry would have produced.
  await expect(page.getByRole("button", { name: "Run" })).toBeEnabled();
});
