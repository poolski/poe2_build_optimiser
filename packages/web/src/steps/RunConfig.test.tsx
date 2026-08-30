import { describe, expect, it, vi } from "vitest";
import type { BuildSummary } from "@poe2/contract";
import type { OptimiserClient } from "../api";
import RunConfig, { addFreeze, removeFreeze, resolveFreezeNames } from "./RunConfig";
import { initialRequest } from "../state";
import { click, mount } from "../test/dom";
import type { RenderNode } from "../render/types";

function node(id: number, name: string): RenderNode {
  return {
    id,
    x: 0,
    y: 0,
    group: 0,
    orbit: 0,
    orbitIndex: 0,
    kind: "normal",
    name,
    statLines: [],
    isAscendancy: false,
    conns: [],
  };
}

describe("resolveFreezeNames (pure)", () => {
  it("resolves ids to node names via the lookup map", () => {
    const nodesById = new Map([
      [1, node(1, "Acrobatics")],
      [2, node(2, "Iron Reflexes")],
    ]);
    expect(resolveFreezeNames([1, 2], nodesById)).toEqual([
      { id: 1, name: "Acrobatics" },
      { id: 2, name: "Iron Reflexes" },
    ]);
  });

  it("falls back to the raw id when it doesn't resolve", () => {
    expect(resolveFreezeNames([999], new Map())).toEqual([{ id: 999, name: "999" }]);
  });

  it("falls back to the raw id when the lookup map is undefined", () => {
    expect(resolveFreezeNames([5], undefined)).toEqual([{ id: 5, name: "5" }]);
  });

  it("falls back to the raw id when the node has an empty name", () => {
    const nodesById = new Map([[3, node(3, "")]]);
    expect(resolveFreezeNames([3], nodesById)).toEqual([{ id: 3, name: "3" }]);
  });
});

describe("addFreeze (pure)", () => {
  it("appends a new id", () => {
    expect(addFreeze([1, 2], 3)).toEqual([1, 2, 3]);
  });
  it("dedups against an already-frozen id, preserving order", () => {
    expect(addFreeze([1, 2], 2)).toEqual([1, 2]);
  });
  it("dedups against a manually-typed id", () => {
    expect(addFreeze([7], 7)).toEqual([7]);
  });
});

describe("removeFreeze (pure)", () => {
  it("removes only the matching id", () => {
    expect(removeFreeze([1, 2, 3], 2)).toEqual([1, 3]);
  });
  it("is a no-op when the id isn't present", () => {
    expect(removeFreeze([1, 2], 9)).toEqual([1, 2]);
  });
});

const build: BuildSummary = {
  buildId: "b1",
  className: "Ranger",
  ascendancy: "Deadeye",
  treeVersion: "0_5",
  level: 92,
  pointsUsed: 110,
  pointsMax: 118,
  weaponSet1PointsUsed: 0,
  weaponSet2PointsUsed: 0,
  allocatedNodeIds: [10, 20, 30, 40],
  baseline: { TotalDPS: 500000 },
  notes: [],
};

const stubClient = {
  async getCascade(_id: string, anchorNodeId: number) {
    return { anchorNodeId, freedNodeIds: [anchorNodeId] };
  },
} as unknown as OptimiserClient;

function openAdvanced(m: ReturnType<typeof mount>): void {
  m.act(() =>
    click([...m.container.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Advanced"))!),
  );
}

describe("RunConfig freeze list (mounted)", () => {
  it("renders a clickable chip per frozen id, falling back to the raw id before the tree loads", () => {
    const req = { ...initialRequest("b1"), freeze: [10, 20] };
    const m = mount(
      <RunConfig build={build} request={req} onChange={() => {}} onRun={() => {}} onBack={() => {}} client={stubClient} />,
    );
    openAdvanced(m);
    const chips = [...m.container.querySelectorAll(".freeze-list .chip")].map((b) => b.textContent);
    expect(chips).toEqual(["10 ×", "20 ×"]);
    m.unmount();
  });

  it("renders no freeze-list when nothing is frozen", () => {
    const m = mount(
      <RunConfig
        build={build}
        request={initialRequest("b1")}
        onChange={() => {}}
        onRun={() => {}}
        onBack={() => {}}
        client={stubClient}
      />,
    );
    openAdvanced(m);
    expect(m.container.querySelector(".freeze-list")).toBeNull();
    m.unmount();
  });

  it("clicking a chip unfreezes just that id, preserving the rest", () => {
    const onChange = vi.fn();
    const req = { ...initialRequest("b1"), freeze: [10, 20, 30] };
    const m = mount(
      <RunConfig build={build} request={req} onChange={onChange} onRun={() => {}} onBack={() => {}} client={stubClient} />,
    );
    openAdvanced(m);
    const chip = [...m.container.querySelectorAll(".freeze-list .chip")].find((b) => b.textContent === "20 ×")!;
    m.act(() => click(chip));
    expect(onChange).toHaveBeenCalledWith({ freeze: [10, 30] });
    m.unmount();
  });
});
