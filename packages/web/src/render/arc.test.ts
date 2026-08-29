import { describe, expect, it } from "vitest";
import { edgeGeometry } from "./arc";
import type { GroupMap, RenderNode } from "./types";

// Ported from poe2-build-planner src/render/arc.test.ts (MIT). Node shape is our RenderNode.
function node(id: number, x: number, y: number, partial: Partial<RenderNode> = {}): RenderNode {
  return {
    id,
    x,
    y,
    group: 1,
    orbit: 1,
    orbitIndex: 0,
    kind: "normal",
    name: `n${id}`,
    statLines: [],
    isAscendancy: false,
    conns: [],
    ...partial,
  };
}

const groups: GroupMap = new Map([[1, { x: 0, y: 0 }]]);

describe("edgeGeometry", () => {
  it("returns an arc for a same-group, same-orbit edge", () => {
    const geom = edgeGeometry(node(1, 100, 0), node(2, 0, 100), groups);
    expect(geom.kind).toBe("arc");
    if (geom.kind !== "arc") throw new Error("expected arc");
    expect(geom.cx).toBe(0);
    expect(geom.cy).toBe(0);
    expect(geom.r).toBeCloseTo(100, 6);
    expect(geom.a0).toBeCloseTo(0, 6);
    expect(geom.a1).toBeCloseTo(Math.PI / 2, 6);
    expect(geom.anticlockwise).toBe(false);
  });

  it("chooses anticlockwise for a negative angular delta", () => {
    const geom = edgeGeometry(node(1, 100, 0), node(2, 0, -100), groups);
    if (geom.kind !== "arc") throw new Error("expected arc");
    expect(geom.anticlockwise).toBe(true);
  });

  it("returns a line for a different-group edge", () => {
    expect(edgeGeometry(node(1, 100, 0), node(2, 0, 100, { group: 2 }), groups).kind).toBe("line");
  });

  it("returns a line for orbit 0", () => {
    const a = node(1, 100, 0, { orbit: 0 });
    const b = node(2, 0, 100, { orbit: 0 });
    expect(edgeGeometry(a, b, groups).kind).toBe("line");
  });

  it("returns a line when the group centre is unknown", () => {
    const a = node(1, 100, 0, { group: 7 });
    const b = node(2, 0, 100, { group: 7 });
    expect(edgeGeometry(a, b, groups).kind).toBe("line");
  });
});
