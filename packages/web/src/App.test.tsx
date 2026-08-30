import { describe, expect, it, vi } from "vitest";
import App from "./App";
import type { OptimiserClient } from "./api";
import { mockResult } from "./mock/mockClient";
import { click, mount, setInput } from "./test/dom";

// Mock localStorage if it's not available (vitest jsdom setup issue -- same workaround as
// recentBuilds.test.ts).
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      Object.keys(store).forEach((key) => {
        delete store[key];
      });
    },
    length: 0,
    key: () => null,
  });
}

// A synchronous fake client -- drives the whole 4-step wizard without timers or a real server.
function fakeClient(): OptimiserClient {
  return {
    async createBuild() {
      return {
        buildId: "b1",
        className: "Monk",
        ascendancy: "Invoker",
        treeVersion: "0_5",
        level: 90,
        pointsUsed: 100,
        pointsMax: 112,
        weaponSet1PointsUsed: 0,
        weaponSet2PointsUsed: 0,
        allocatedNodeIds: [10, 20, 30, 40],
        baseline: { TotalDPS: 100000 },
        notes: [],
      };
    },
    async getBuild() {
      throw new Error("unused");
    },
    async getCascade(_id, anchorNodeId) {
      return { anchorNodeId, freedNodeIds: [anchorNodeId] };
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

// Same as fakeClient() but streamJob never calls onDone -- lets a test observe the wizard while
// still on the "running" step, instead of jumping straight through to "results".
function fakeClientNoAutoFinish(): OptimiserClient {
  return { ...fakeClient(), streamJob: () => () => {} };
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

  it("pushes a history entry on each forward step transition", async () => {
    const pushSpy = vi.spyOn(window.history, "pushState");
    const m = mount(<App client={fakeClient()} />);
    pushSpy.mockClear(); // ignore the initial-mount replaceState-driven render

    const textarea = m.container.querySelector("textarea")!;
    m.act(() => setInput(textarea, "some-pob-code"));
    m.act(() =>
      click(
        [...m.container.querySelectorAll("button")].find((b) => /load build/i.test(b.textContent ?? ""))!,
      ),
    );
    await m.flush();

    expect(pushSpy).toHaveBeenCalledWith({ step: "config" }, "", "#config");
    pushSpy.mockRestore();
    m.unmount();
  });

  it("replaces the history entry on the initial mount, not push", () => {
    const pushSpy = vi.spyOn(window.history, "pushState");
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const m = mount(<App client={fakeClient()} />);

    expect(replaceSpy).toHaveBeenCalledWith({ step: "input" }, "", "#input");
    expect(pushSpy).not.toHaveBeenCalled();

    pushSpy.mockRestore();
    replaceSpy.mockRestore();
    m.unmount();
  });

  it("steps back to input on a popstate event without re-pushing history", async () => {
    const m = mount(<App client={fakeClient()} />);
    const textarea = m.container.querySelector("textarea")!;
    m.act(() => setInput(textarea, "some-pob-code"));
    m.act(() =>
      click(
        [...m.container.querySelectorAll("button")].find((b) => /load build/i.test(b.textContent ?? ""))!,
      ),
    );
    await m.flush();
    expect(m.container.querySelector("textarea")).toBeFalsy(); // now on config, no paste box

    const pushSpy = vi.spyOn(window.history, "pushState");
    m.act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { step: "input" } }));
    });
    await m.flush();

    expect(m.container.querySelector("textarea")).toBeTruthy(); // back on the input step
    expect(pushSpy).not.toHaveBeenCalled(); // popstate-driven change doesn't loop back into history
    pushSpy.mockRestore();
    m.unmount();
  });

  it("falls back safely when a popstate event targets a step with no data", async () => {
    const m = mount(<App client={fakeClient()} />);
    m.act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { step: "results" } }));
    });
    await m.flush();

    expect(m.container.querySelector("textarea")).toBeTruthy(); // fell back to input, no crash
    m.unmount();
  });

  it("still pushes the next forward transition after a popstate that resolves to the current step", async () => {
    // Regression: a popstate event requesting a step with no data falls back (via syncStep) to
    // "input" -- which, on a fresh mount, is already the currently-displayed step. That must not
    // leave the history-sync bookkeeping stuck thinking the *next* real transition is a no-op.
    const m = mount(<App client={fakeClient()} />);

    const pushSpy = vi.spyOn(window.history, "pushState");
    m.act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { step: "results" } }));
    });
    await m.flush();
    expect(m.container.querySelector("textarea")).toBeTruthy(); // still on input (fallback, unchanged)

    const textarea = m.container.querySelector("textarea")!;
    m.act(() => setInput(textarea, "some-pob-code"));
    m.act(() =>
      click(
        [...m.container.querySelectorAll("button")].find((b) => /load build/i.test(b.textContent ?? ""))!,
      ),
    );
    await m.flush();

    expect(pushSpy).toHaveBeenCalledWith({ step: "config" }, "", "#config");
    pushSpy.mockRestore();
    m.unmount();
  });

  it("replaces (not pushes) history when restarting from the results step", async () => {
    const m = mount(<App client={fakeClient()} />);
    const textarea = m.container.querySelector("textarea")!;
    m.act(() => setInput(textarea, "some-pob-code"));
    m.act(() =>
      click(
        [...m.container.querySelectorAll("button")].find((b) => /load build/i.test(b.textContent ?? ""))!,
      ),
    );
    await m.flush();
    const runBtn = [...m.container.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "Run",
    )!;
    m.act(() => click(runBtn));
    await m.flush();

    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const restartBtn = [...m.container.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "Start over",
    )!;
    m.act(() => click(restartBtn));
    await m.flush();

    expect(replaceSpy).toHaveBeenCalledWith({ step: "input" }, "", "#input");
    replaceSpy.mockRestore();
    m.unmount();
  });

  it("does not cancel the job when navigating away from 'running' via popstate", async () => {
    const client = fakeClientNoAutoFinish();
    const cancelSpy = vi.spyOn(client, "cancelJob");
    const m = mount(<App client={client} />);

    const textarea = m.container.querySelector("textarea")!;
    m.act(() => setInput(textarea, "some-pob-code"));
    m.act(() =>
      click(
        [...m.container.querySelectorAll("button")].find((b) => /load build/i.test(b.textContent ?? ""))!,
      ),
    );
    await m.flush();
    const runBtn = [...m.container.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "Run",
    )!;
    m.act(() => click(runBtn));
    await m.flush();
    expect(m.container.textContent).toContain("Starting…"); // sanity: still on "running", stream never ticked

    m.act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { step: "config" } }));
    });
    await m.flush();

    expect(cancelSpy).not.toHaveBeenCalled();
    m.unmount();
  });

  it("saves a loaded build to recent builds and reloads it via the recent list", async () => {
    localStorage.clear();
    const client = fakeClient();
    const m = mount(<App client={client} />);

    const textarea = m.container.querySelector("textarea")!;
    m.act(() => setInput(textarea, "some-pob-code"));
    m.act(() =>
      click(
        [...m.container.querySelectorAll("button")].find((b) => /load build/i.test(b.textContent ?? ""))!,
      ),
    );
    await m.flush();
    expect(m.container.textContent).toContain("Monk"); // now on config

    // Go back to input (via the in-app Back button already wired in RunConfig) to see the list.
    const backBtn = [...m.container.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "Back",
    )!;
    m.act(() => click(backBtn));
    await m.flush();

    expect(m.container.textContent).toContain("Recent builds");
    const recentRow = [...m.container.querySelectorAll("button")].find((b) =>
      /Monk.*lvl 90/.test(b.textContent ?? ""),
    )!;
    m.act(() => click(recentRow));
    await m.flush();

    expect(m.container.textContent).toContain("Monk"); // reloaded straight back to config
    m.unmount();
  });
});
