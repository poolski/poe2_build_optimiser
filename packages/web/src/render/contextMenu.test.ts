import { describe, expect, it } from "vitest";
import { menuActionsFor } from "./contextMenu";

describe("menuActionsFor (pure)", () => {
  it("offers Freeze (not Unfreeze) for an unfrozen node", () => {
    expect(menuActionsFor(1, new Set(), true)).toEqual([
      { action: "freeze", label: "Freeze" },
      { action: "anchor", label: "Anchor for rollback" },
    ]);
  });

  it("offers Unfreeze (not Freeze) for a frozen node", () => {
    expect(menuActionsFor(1, new Set([1]), true)).toEqual([
      { action: "unfreeze", label: "Unfreeze" },
      { action: "anchor", label: "Anchor for rollback" },
    ]);
  });

  it("omits Anchor for rollback when no anchor handler is available", () => {
    expect(menuActionsFor(1, new Set(), false)).toEqual([{ action: "freeze", label: "Freeze" }]);
  });

  it("only consults whether this node's id is frozen, not other frozen ids", () => {
    expect(menuActionsFor(2, new Set([1, 3]), false)).toEqual([{ action: "freeze", label: "Freeze" }]);
  });
});
