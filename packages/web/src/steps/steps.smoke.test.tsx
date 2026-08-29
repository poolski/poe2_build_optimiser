import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BuildSummary } from "@poe2/contract";
import BuildInput from "./BuildInput";
import RunConfig from "./RunConfig";
import Results from "./Results";
import { initialRequest } from "../state";
import { mockResult } from "../mock/mockClient";
import { click, mount, setInput } from "../test/dom";

const build: BuildSummary = {
  buildId: "b1",
  className: "Ranger",
  ascendancy: "Deadeye",
  level: 92,
  pointsUsed: 110,
  pointsMax: 118,
  weaponSet1PointsUsed: 0,
  weaponSet2PointsUsed: 0,
  baseline: { TotalDPS: 500000 },
  notes: ["scores 0 DPS headless"],
};

describe("BuildInput", () => {
  it("submits a pobCode discriminated-union value from the paste tab", () => {
    const onSubmit = vi.fn();
    const m = mount(<BuildInput onSubmit={onSubmit} />);
    m.act(() => setInput(m.container.querySelector("textarea")!, "abc123"));
    m.act(() =>
      click(
        [...m.container.querySelectorAll("button")].find((b) =>
          /load build/i.test(b.textContent ?? ""),
        )!,
      ),
    );
    expect(onSubmit).toHaveBeenCalledWith({ kind: "pobCode", code: "abc123" });
    m.unmount();
  });

  it("disables submit until there is input", () => {
    const m = mount(<BuildInput onSubmit={vi.fn()} />);
    const btn = [...m.container.querySelectorAll("button")].find((b) =>
      /load build/i.test(b.textContent ?? ""),
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    m.unmount();
  });
});

describe("RunConfig", () => {
  it("renders the build summary, notes strip, and mode switch", () => {
    const html = renderToStaticMarkup(
      <RunConfig
        build={build}
        request={initialRequest("b1")}
        onChange={() => {}}
        onRun={() => {}}
        onBack={() => {}}
      />,
    );
    expect(html).toContain("Ranger");
    expect(html).toContain("scores 0 DPS headless");
    expect(html).toContain("repair");
    expect(html).toContain("rollback");
  });

  it("shows the anchor-id field only in rollback mode", () => {
    const req = { ...initialRequest("b1"), mode: "rollback" as const };
    const html = renderToStaticMarkup(
      <RunConfig build={build} request={req} onChange={() => {}} onRun={() => {}} onBack={() => {}} />,
    );
    expect(html).toContain("Anchor node id");
  });

  it("emits a mode patch when a mode button is clicked", () => {
    const onChange = vi.fn();
    const m = mount(
      <RunConfig
        build={build}
        request={initialRequest("b1")}
        onChange={onChange}
        onRun={() => {}}
        onBack={() => {}}
      />,
    );
    m.act(() =>
      click(
        [...m.container.querySelectorAll("button")].find(
          (b) => (b.textContent ?? "").trim() === "repair",
        )!,
      ),
    );
    expect(onChange).toHaveBeenCalledWith({ mode: "repair" });
    m.unmount();
  });
});

describe("Results", () => {
  it("renders the headline, node-list diff and updated code without a tree render", () => {
    // useMinTree starts in `loading` (effects don't run under renderToStaticMarkup), so the
    // canvas is not mounted -- the list diff + code are still shown.
    const html = renderToStaticMarkup(
      <Results result={mockResult()} build={build} onRestart={() => {}} />,
    );
    expect(html).toContain("Updated PoB code");
    expect(html).toContain("Avatar of Fire"); // from NodeDiff
    expect(html).toContain("repair"); // mode in the headline kv
  });
});
