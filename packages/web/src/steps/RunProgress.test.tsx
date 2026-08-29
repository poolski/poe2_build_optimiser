import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProgressEvent } from "@poe2/contract";
import RunProgress from "./RunProgress";

const base: ProgressEvent = {
  jobId: "j1",
  phase: "add-loop",
  buildOutputs: 100,
  bestObjective: 12000,
  elapsedMs: 5000,
};

const render = (p: Partial<ProgressEvent>, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <RunProgress
      progress={{ ...base, ...p }}
      onCancel={() => {}}
      onBack={() => {}}
      {...extra}
    />,
  );

describe("<RunProgress>", () => {
  it("maps a known phase to a friendly label", () => {
    expect(render({ phase: "k-sweep" })).toContain("Sweeping respec depth");
  });
  it("falls back to the raw phase string for an unknown phase (open z.string)", () => {
    expect(render({ phase: "parallel-eval-batch" })).toContain("parallel-eval-batch");
  });
  it("shows a progress bar when estimatedTotal is present", () => {
    expect(render({ buildOutputs: 216, estimatedTotal: 432 })).toContain("progress-bar");
  });
  it("shows a plain count when estimatedTotal is absent", () => {
    const html = render({ estimatedTotal: undefined, buildOutputs: 77 });
    expect(html).not.toContain("progress-bar");
    expect(html).toContain("77 recomputes");
  });
  it("shows the delta vs baseline when given one", () => {
    const html = render({ bestObjective: 15000 }, { baselineObjective: 12000 });
    expect(html).toContain("vs baseline");
  });
  it("renders an error state with a back button", () => {
    const html = renderToStaticMarkup(
      <RunProgress error="LuaJIT worker died" onCancel={() => {}} onBack={() => {}} />,
    );
    expect(html).toContain("LuaJIT worker died");
    expect(html).toContain("Back to config");
  });
});
