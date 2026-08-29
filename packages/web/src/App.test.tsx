import { describe, expect, it } from "vitest";
import App from "./App";
import type { OptimiserClient } from "./api";
import { mockResult } from "./mock/mockClient";
import { click, mount, setInput } from "./test/dom";

// A synchronous fake client -- drives the whole 4-step wizard without timers or a real server.
function fakeClient(): OptimiserClient {
  return {
    async createBuild() {
      return {
        buildId: "b1",
        className: "Monk",
        ascendancy: "Invoker",
        level: 90,
        pointsUsed: 100,
        pointsMax: 112,
        weaponSet1PointsUsed: 0,
        weaponSet2PointsUsed: 0,
        baseline: { TotalDPS: 100000 },
        notes: [],
      };
    },
    async getBuild() {
      throw new Error("unused");
    },
    async submitJob() {
      return { jobId: "j1", status: "queued" };
    },
    async getJob() {
      return { jobId: "j1", status: "done", result: mockResult() };
    },
    async cancelJob() {
      return { jobId: "j1", status: "cancelled" };
    },
    streamJob(_id, h) {
      h.onProgress({
        jobId: "j1",
        phase: "add-loop",
        buildOutputs: 42,
        bestObjective: 120000,
        elapsedMs: 1000,
      });
      h.onDone(mockResult());
      return () => {};
    },
  };
}

describe("<App> wizard flow", () => {
  it("walks input -> config -> running -> results with a fake client", async () => {
    const m = mount(<App client={fakeClient()} />);

    // Step 1: paste a code, load the build.
    const textarea = m.container.querySelector("textarea")!;
    m.act(() => setInput(textarea, "some-pob-code"));
    const loadBtn = [...m.container.querySelectorAll("button")].find((b) =>
      /load build/i.test(b.textContent ?? ""),
    )!;
    m.act(() => click(loadBtn));
    await m.flush();

    // Step 2: config screen shows the build summary + a Run button.
    expect(m.container.textContent).toContain("Monk");
    const runBtn = [...m.container.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "Run",
    )!;
    expect(runBtn).toBeTruthy();
    m.act(() => click(runBtn));
    await m.flush();

    // Step 4: the fake stream resolves straight to results (headline + updated code).
    expect(m.container.textContent).toContain("Updated PoB code");
    expect(m.container.querySelector("textarea")!.value).toContain("MOCK_updated_pob_code");

    m.unmount();
  });
});
