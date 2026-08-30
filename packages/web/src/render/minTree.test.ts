import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { nodePosition, parseMinTree } from "./minTree";

// The real committed artifact (intake/web-ui/08-fork-prep.md task 6). Loaded from disk rather
// than imported so tsc (rootDir: src) doesn't choke on a JSON module outside src -- same
// pattern the contract's optimise.test.ts uses for its fixture.
const raw = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../public/tree-0_5.min.json"), "utf-8"),
);

describe("nodePosition (PoB convention: orbitIndex 0 = straight up)", () => {
  const radii = [0, 82, 162];
  const per = [1, 12, 24];
  it("orbit 0 sits on the group centre", () => {
    expect(nodePosition(100, 200, 0, 0, radii, per)).toEqual({ x: 100, y: 200 });
  });
  it("index 0 on a non-zero orbit is directly above the centre", () => {
    const p = nodePosition(0, 0, 1, 0, radii, per);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(-82, 6);
  });
  it("a quarter of the way round orbit 1 (3 of 12) is due right", () => {
    const p = nodePosition(0, 0, 1, 3, radii, per);
    expect(p.x).toBeCloseTo(82, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });
});

describe("parseMinTree on the shipped tree-0_5.min.json", () => {
  const tree = parseMinTree(raw);

  it("exposes the tree version", () => {
    expect(tree.treeVersion).toBe("0_5");
  });
  it("parses a few thousand rendered nodes and ids are sorted ascending", () => {
    expect(tree.ids.length).toBeGreaterThan(2000);
    expect(tree.nodesById.size).toBe(tree.ids.length);
    for (let i = 1; i < tree.ids.length; i++) expect(tree.ids[i]).toBeGreaterThan(tree.ids[i - 1]);
  });
  it("excludes ascendancy nodes from the render set", () => {
    for (const n of tree.nodesById.values()) expect(n.isAscendancy).toBe(false);
  });
  it("adjacency is symmetric and only references rendered nodes", () => {
    let checked = 0;
    for (const [id, neighbours] of tree.adjacency) {
      for (const nb of neighbours) {
        expect(tree.nodesById.has(nb)).toBe(true);
        expect(tree.adjacency.get(nb) ?? []).toContain(id);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
  it("every rendered node sits within the computed bounds", () => {
    for (const n of tree.nodesById.values()) {
      expect(n.x).toBeGreaterThanOrEqual(tree.bounds.minX);
      expect(n.x).toBeLessThanOrEqual(tree.bounds.maxX);
      expect(n.y).toBeGreaterThanOrEqual(tree.bounds.minY);
      expect(n.y).toBeLessThanOrEqual(tree.bounds.maxY);
    }
  });
  it("classifies at least one node of every structural kind", () => {
    const kinds = new Set([...tree.nodesById.values()].map((n) => n.kind));
    expect(kinds.has("normal")).toBe(true);
    expect(kinds.has("notable")).toBe(true);
    expect(kinds.has("keystone")).toBe(true);
  });
  it("the R_Thor fixture's before/after ids are almost all known to the render set", () => {
    const fixture = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "../../fixtures/canvas-diff.R_Thor-L84-weak.json"),
        "utf-8",
      ),
    ) as { before: number[]; afterConnected: number[] };
    const known = (ids: number[]) => ids.filter((id) => tree.nodesById.has(id)).length / ids.length;
    expect(known(fixture.before)).toBeGreaterThan(0.9);
    expect(known(fixture.afterConnected)).toBeGreaterThan(0.9);
  });
});

describe("parseMinTree stays backward-tolerant of a tuple without iconIdx", () => {
  it("defaults RenderNode.icon to empty string", () => {
    const old = {
      meta: { treeVersion: "0_5" },
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      constants: { orbitRadii: [0], skillsPerOrbit: [1], PSSCentreInnerRadius: 0 },
      strings: ["A Node"],
      groups: { "1": [0, 0] },
      nodes: { "1": [1, 0, 0, 0, 0, []] }, // 6 elements, no statIdx/ascNameIdx/iconIdx
    };
    const tree = parseMinTree(old);
    expect(tree.nodesById.get(1)?.icon).toBe("");
  });

  it("falls back to a zero rect when there are zero nodes and no src.bounds", () => {
    const empty = {
      meta: { treeVersion: "0_5" },
      constants: { orbitRadii: [0], skillsPerOrbit: [1], PSSCentreInnerRadius: 0 },
      strings: [],
      groups: {},
      nodes: {},
    };
    const tree = parseMinTree(empty);
    expect(tree.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});
