import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import TreeCanvas from "./TreeCanvas";
import type { MinTree, RenderNode } from "./types";
import { mount, rightClick, stubCanvas, type Mounted } from "../test/dom";

beforeAll(() => {
  stubCanvas();
});

function node(id: number, x: number, y: number): RenderNode {
  return {
    id,
    x,
    y,
    group: 0,
    orbit: 0,
    orbitIndex: 0,
    kind: "normal",
    name: `Node ${id}`,
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
    bounds: { minX: -500, minY: -500, maxX: 500, maxY: 500 },
    ids: nodes.map((n) => n.id),
  };
}

// The default viewport (before a jsdom-zero-size ResizeObserver fit) is {x:0,y:0,zoom:0.05}
// with size {0,0} -- world (0,0) maps to screen (0,0), so a right-click at clientX/Y 0 hits it.
const minTree = tree([node(1, 0, 0), node(2, 5000, 5000)]);

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe("TreeCanvas right-click context menu", () => {
  it("opens with Freeze + Anchor for an unfrozen, anchor-eligible node", () => {
    mounted = mount(
      <TreeCanvas minTree={minTree} before={[1]} after={[1]} contextMenuNodes={new Set([1])} onAnchorForRollback={() => {}} />,
    );
        mounted.act(() => rightClick(mounted.container.querySelector("canvas")!, { clientX: 0, clientY: 0 }));
    const items = [...mounted.container.querySelectorAll(".canvas-context-menu button")].map((b) => b.textContent);
    expect(items).toEqual(["Freeze", "Anchor for rollback"]);
  });

  it("offers Unfreeze for a frozen node", () => {
    mounted = mount(
      <TreeCanvas
        minTree={minTree}
        before={[1]}
        after={[1]}
        contextMenuNodes={new Set([1])}
        frozenNodes={new Set([1])}
      />,
    );
        mounted.act(() => rightClick(mounted.container.querySelector("canvas")!, { clientX: 0, clientY: 0 }));
    const items = [...mounted.container.querySelectorAll(".canvas-context-menu button")].map((b) => b.textContent);
    expect(items).toEqual(["Unfreeze"]);
  });

  it("does not open for a node outside contextMenuNodes", () => {
    mounted = mount(<TreeCanvas minTree={minTree} before={[]} after={[]} contextMenuNodes={new Set([2])} />);
        mounted.act(() => rightClick(mounted.container.querySelector("canvas")!, { clientX: 0, clientY: 0 }));
    expect(mounted.container.querySelector(".canvas-context-menu")).toBeNull();
  });

  it("does nothing when contextMenuNodes is not supplied (read-only canvas)", () => {
    mounted = mount(<TreeCanvas minTree={minTree} before={[]} after={[]} />);
        mounted.act(() => rightClick(mounted.container.querySelector("canvas")!, { clientX: 0, clientY: 0 }));
    expect(mounted.container.querySelector(".canvas-context-menu")).toBeNull();
  });

  it("Freeze item calls onFreeze with the node id and closes the menu", () => {
    const onFreeze = vi.fn();
    mounted = mount(
      <TreeCanvas minTree={minTree} before={[1]} after={[1]} contextMenuNodes={new Set([1])} onFreeze={onFreeze} />,
    );
        mounted.act(() => rightClick(mounted.container.querySelector("canvas")!, { clientX: 0, clientY: 0 }));
    const btn = mounted.container.querySelector(".canvas-context-menu button") as HTMLButtonElement;
    mounted.act(() => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onFreeze).toHaveBeenCalledWith(1);
    expect(mounted.container.querySelector(".canvas-context-menu")).toBeNull();
  });

  it("Unfreeze item calls onUnfreeze with the node id", () => {
    const onUnfreeze = vi.fn();
    mounted = mount(
      <TreeCanvas
        minTree={minTree}
        before={[1]}
        after={[1]}
        contextMenuNodes={new Set([1])}
        frozenNodes={new Set([1])}
        onUnfreeze={onUnfreeze}
      />,
    );
        mounted.act(() => rightClick(mounted.container.querySelector("canvas")!, { clientX: 0, clientY: 0 }));
    const btn = mounted.container.querySelector(".canvas-context-menu button") as HTMLButtonElement;
    mounted.act(() => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onUnfreeze).toHaveBeenCalledWith(1);
  });

  it("Anchor for rollback item calls onAnchorForRollback with the node id", () => {
    const onAnchor = vi.fn();
    mounted = mount(
      <TreeCanvas
        minTree={minTree}
        before={[1]}
        after={[1]}
        contextMenuNodes={new Set([1])}
        onAnchorForRollback={onAnchor}
      />,
    );
        mounted.act(() => rightClick(mounted.container.querySelector("canvas")!, { clientX: 0, clientY: 0 }));
    const buttons = [...mounted.container.querySelectorAll(".canvas-context-menu button")];
    const anchorBtn = buttons.find((b) => b.textContent === "Anchor for rollback") as HTMLButtonElement;
    mounted.act(() => anchorBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onAnchor).toHaveBeenCalledWith(1);
  });

  it("dismisses on an outside mousedown", () => {
    mounted = mount(<TreeCanvas minTree={minTree} before={[1]} after={[1]} contextMenuNodes={new Set([1])} />);
        mounted.act(() => rightClick(mounted.container.querySelector("canvas")!, { clientX: 0, clientY: 0 }));
    expect(mounted.container.querySelector(".canvas-context-menu")).not.toBeNull();
    mounted.act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(mounted.container.querySelector(".canvas-context-menu")).toBeNull();
  });

  it("dismisses on Escape", () => {
    mounted = mount(<TreeCanvas minTree={minTree} before={[1]} after={[1]} contextMenuNodes={new Set([1])} />);
        mounted.act(() => rightClick(mounted.container.querySelector("canvas")!, { clientX: 0, clientY: 0 }));
    expect(mounted.container.querySelector(".canvas-context-menu")).not.toBeNull();
    mounted.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(mounted.container.querySelector(".canvas-context-menu")).toBeNull();
  });
});
