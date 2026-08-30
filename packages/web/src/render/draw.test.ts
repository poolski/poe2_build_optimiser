// packages/web/src/render/draw.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSpatialIndex } from "./spatialIndex";
import { drawTree } from "./draw";
import { __resetIconCache, getIcon } from "./iconCache";
import type { MinTree, RenderNode } from "./types";

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  complete = false;
  src = "";
  constructor() {
    created.push(this);
  }
}
let created: FakeImage[] = [];

function node(id: number, x: number, y: number, overrides: Partial<RenderNode> = {}): RenderNode {
  return {
    id, x, y, group: 0, orbit: 0, orbitIndex: 0,
    kind: "normal", name: `Node ${id}`, statLines: [],
    isAscendancy: false, conns: [], icon: "",
    ...overrides,
  };
}

function tree(nodes: RenderNode[]): MinTree {
  return {
    treeVersion: "test",
    nodesById: new Map(nodes.map((n) => [n.id, n])),
    adjacency: new Map(),
    groups: new Map(),
    bounds: { minX: -500, minY: -500, maxX: 500, maxY: 500 },
    ids: nodes.map((n) => n.id),
  };
}

function fakeCtx() {
  return {
    fillStyle: "", strokeStyle: "", lineWidth: 0, globalAlpha: 1,
    fillRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    stroke: vi.fn(), fill: vi.fn(), drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

const size = { width: 800, height: 600 };
// zoom 0.3 -> lodFor(0.3) === "full" (past the icons threshold), matching lod.test.ts.
const vp = { x: 0, y: 0, zoom: 0.3 };
const diff = { before: new Set<number>(), after: new Set([1]), anchor: null };

describe("drawTree icon rendering", () => {
  beforeEach(() => {
    created = [];
    vi.stubGlobal("Image", FakeImage);
    __resetIconCache();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("calls drawImage for a node whose icon has already loaded, not the fallback arc fill", () => {
    const t = tree([node(1, 0, 0, { icon: "Art/foo.dds" })]);
    getIcon("Art/foo.dds"); // kicks off the load
    created[0].complete = true;
    created[0].onload?.(); // now resolvable from the cache
    const ctx = fakeCtx();
    drawTree(ctx, { tree: t, index: buildSpatialIndex(t), vp, size, diff, hover: null });
    expect(ctx.drawImage).toHaveBeenCalledWith(created[0], expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number));
  });

  it("falls back to the arc fill for a node whose icon has not finished loading", () => {
    const t = tree([node(1, 0, 0, { icon: "Art/foo.dds" })]);
    const ctx = fakeCtx();
    drawTree(ctx, { tree: t, index: buildSpatialIndex(t), vp, size, diff, hover: null });
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  it("still draws the diff-overlay ring on top of a loaded icon", () => {
    const t = tree([node(1, 0, 0, { icon: "Art/foo.dds", kind: "notable" })]); // notable -> ring
    getIcon("Art/foo.dds");
    created[0].complete = true;
    created[0].onload?.();
    const ctx = fakeCtx();
    drawTree(ctx, { tree: t, index: buildSpatialIndex(t), vp, size, diff, hover: null });
    expect(ctx.drawImage).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled(); // the ring, drawn after the image
  });

  it("never constructs an Image at the dots LOD (fully zoomed out)", () => {
    const t = tree([node(1, 0, 0, { icon: "Art/foo.dds" })]);
    const ctx = fakeCtx();
    drawTree(ctx, { tree: t, index: buildSpatialIndex(t), vp: { x: 0, y: 0, zoom: 0.02 }, size, diff, hover: null });
    expect(created).toHaveLength(0);
  });
});
