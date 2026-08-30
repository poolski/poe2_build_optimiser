import { describe, expect, it } from "vitest";
import { buildSpatialIndex, nodeAt, queryRect } from "./spatialIndex";
import type { MinTree, RenderNode } from "./types";

// Adapted from poe2-build-planner src/render/spatialIndex.test.ts (MIT) -- keyed off MinTree.
function node(id: number, x: number, y: number): RenderNode {
  return {
    id,
    x,
    y,
    group: 0,
    orbit: 0,
    orbitIndex: 0,
    kind: "normal",
    name: `n${id}`,
    statLines: [],
    isAscendancy: false,
    icon: "",
    conns: [],
  };
}

function tree(nodes: RenderNode[]): MinTree {
  return {
    treeVersion: "test",
    nodesById: new Map(nodes.map((n) => [n.id, n])),
    adjacency: new Map(),
    groups: new Map(),
    bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
    ids: nodes.map((n) => n.id),
  };
}

const t = tree([node(1, 0, 0), node(2, 100, 100), node(3, 900, 900)]);

describe("queryRect", () => {
  it("returns only nodes whose cells overlap the rectangle", () => {
    const index = buildSpatialIndex(t, 100);
    expect(queryRect(index, { minX: -10, minY: -10, maxX: 150, maxY: 150 }).sort()).toEqual([1, 2]);
  });
  it("excludes far-away nodes", () => {
    const index = buildSpatialIndex(t, 100);
    expect(queryRect(index, { minX: -10, minY: -10, maxX: 50, maxY: 50 })).toEqual([1]);
  });
});

describe("nodeAt", () => {
  it("returns the nearest node within the radius", () => {
    const index = buildSpatialIndex(t, 100);
    expect(nodeAt(index, t, 5, 5, 30)).toBe(1);
  });
  it("returns null when nothing is within the radius", () => {
    const index = buildSpatialIndex(t, 100);
    expect(nodeAt(index, t, 500, 500, 30)).toBeNull();
  });
});

describe("ids gating", () => {
  it("does not index a node absent from `ids`", () => {
    const hidden = node(99, 0, 0); // co-located with node 1
    const t2: MinTree = { ...tree([node(1, 0, 0), hidden]), ids: [1] };
    const index = buildSpatialIndex(t2, 100);
    expect(queryRect(index, { minX: -10, minY: -10, maxX: 10, maxY: 10 })).toEqual([1]);
    expect(nodeAt(index, t2, 0, 0, 30)).toBe(1);
  });
});
