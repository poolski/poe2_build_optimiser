import { describe, expect, it } from "vitest";
import { nodeVisual } from "./nodeVisual";
import { NODE_WORLD_RADIUS } from "./lod";
import { diffStateOf, type DiffSets, type RenderNode } from "./types";

function node(partial: Partial<RenderNode> = {}): RenderNode {
  return {
    id: 1,
    x: 0,
    y: 0,
    group: 0,
    orbit: 0,
    orbitIndex: 0,
    kind: "normal",
    name: "n",
    statLines: [],
    isAscendancy: false,
    icon: "",
    conns: [],
    ...partial,
  };
}

describe("diffStateOf precedence", () => {
  const sets = (o: Partial<DiffSets>): DiffSets => ({
    before: new Set(),
    after: new Set(),
    anchor: null,
    ...o,
  });

  it("anchor wins over everything", () => {
    expect(diffStateOf(1, sets({ anchor: 1, before: new Set([1]), after: new Set([1]) }))).toBe(
      "anchor",
    );
  });
  it("in before only -> dropped", () => {
    expect(diffStateOf(1, sets({ before: new Set([1]) }))).toBe("dropped");
  });
  it("in after only -> added", () => {
    expect(diffStateOf(1, sets({ after: new Set([1]) }))).toBe("added");
  });
  it("in both -> allocated", () => {
    expect(diffStateOf(1, sets({ before: new Set([1]), after: new Set([1]) }))).toBe("allocated");
  });
  it("in neither -> unallocated", () => {
    expect(diffStateOf(1, sets({}))).toBe("unallocated");
  });
});

describe("nodeVisual", () => {
  it("keystone renders larger than a normal node at the same state", () => {
    const k = nodeVisual(node({ kind: "keystone" }), "allocated");
    const n = nodeVisual(node({ kind: "normal" }), "allocated");
    expect(k.radius).toBeGreaterThan(n.radius);
    expect(n.radius).toBe(NODE_WORLD_RADIUS.normal);
  });
  it("notables and keystones get the decorative ring, normals do not", () => {
    expect(nodeVisual(node({ kind: "notable" }), "allocated").ring).toBe(true);
    expect(nodeVisual(node({ kind: "keystone" }), "allocated").ring).toBe(true);
    expect(nodeVisual(node({ kind: "normal" }), "allocated").ring).toBe(false);
  });
  it("diff states override the category fill (jade/blood/blue)", () => {
    expect(nodeVisual(node(), "added").fill).toBe("#5aa85a");
    expect(nodeVisual(node(), "dropped").fill).toBe("#d76050");
    expect(nodeVisual(node(), "anchor").fill).toBe("#6a9ec8");
  });
  it("added/dropped/anchor pop slightly larger than allocated", () => {
    const base = nodeVisual(node(), "allocated").radius;
    expect(nodeVisual(node(), "added").radius).toBeGreaterThan(base);
    expect(nodeVisual(node(), "dropped").radius).toBeGreaterThan(base);
  });
  it("unallocated nodes are dimmed and shrunk", () => {
    const u = nodeVisual(node(), "unallocated");
    expect(u.fill).toBe("#4a4230");
    expect(u.radius).toBeLessThan(NODE_WORLD_RADIUS.normal);
  });
  it("attribute nodes tint by the attribute named in their stat text", () => {
    expect(nodeVisual(node({ kind: "attribute", statLines: ["+10 to Strength"] }), "allocated").fill).toBe(
      "#d76050",
    );
    expect(
      nodeVisual(node({ kind: "attribute", statLines: ["+10 to Dexterity"] }), "allocated").fill,
    ).toBe("#5aa85a");
    expect(
      nodeVisual(node({ kind: "attribute", statLines: ["+10 to Intelligence"] }), "allocated").fill,
    ).toBe("#6a9ec8");
  });
});
