/// <reference types="vitest" />
/// <reference lib="dom" />
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BuildInput, BuildSummary } from "@poe2/contract";
import { loadRecentBuilds, saveRecentBuild } from "./recentBuilds";

function summary(over: Partial<BuildSummary> = {}): BuildSummary {
  return {
    buildId: "b1",
    className: "Ranger",
    ascendancy: "Deadeye",
    treeVersion: "0_5",
    level: 92,
    pointsUsed: 110,
    pointsMax: 118,
    weaponSet1PointsUsed: 0,
    weaponSet2PointsUsed: 0,
    allocatedNodeIds: [],
    baseline: {},
    notes: [],
    ...over,
  };
}

const codeInput = (code: string): BuildInput => ({ kind: "pobCode", code });

// Mock localStorage if it's not available (vitest jsdom setup issue)
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

beforeEach(() => {
  localStorage.clear();
});

describe("recentBuilds", () => {
  it("returns an empty list when nothing is stored", () => {
    expect(loadRecentBuilds()).toEqual([]);
  });

  it("round-trips a saved build with a derived label", () => {
    saveRecentBuild(codeInput("abc"), summary());
    const list = loadRecentBuilds();
    expect(list).toHaveLength(1);
    expect(list[0].input).toEqual(codeInput("abc"));
    expect(list[0].label).toBe("Ranger (Deadeye) · lvl 92");
    expect(typeof list[0].savedAt).toBe("number");
  });

  it("omits the ascendancy parens when ascendancy is null", () => {
    saveRecentBuild(codeInput("abc"), summary({ ascendancy: null }));
    expect(loadRecentBuilds()[0].label).toBe("Ranger · lvl 92");
  });

  it("caps the list at 5 entries, evicting the oldest", () => {
    for (let i = 0; i < 6; i++) saveRecentBuild(codeInput(`code-${i}`), summary());
    const list = loadRecentBuilds();
    expect(list).toHaveLength(5);
    expect(list.map((r) => (r.input as { code: string }).code)).toEqual([
      "code-5",
      "code-4",
      "code-3",
      "code-2",
      "code-1",
    ]);
  });

  it("dedups by exact input match, bumping the existing entry to the top", () => {
    saveRecentBuild(codeInput("a"), summary());
    saveRecentBuild(codeInput("b"), summary());
    saveRecentBuild(codeInput("a"), summary());
    const list = loadRecentBuilds();
    expect(list).toHaveLength(2);
    expect((list[0].input as { code: string }).code).toBe("a");
    expect((list[1].input as { code: string }).code).toBe("b");
  });

  it("treats corrupt JSON in storage as an empty list", () => {
    localStorage.setItem("poe2-recent-builds", "{not json");
    expect(loadRecentBuilds()).toEqual([]);
  });

  it("treats a non-array value in storage as an empty list", () => {
    localStorage.setItem("poe2-recent-builds", JSON.stringify({ not: "an array" }));
    expect(loadRecentBuilds()).toEqual([]);
  });

  it("does not throw when localStorage.setItem throws (quota exceeded)", () => {
    const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    expect(() => saveRecentBuild(codeInput("a"), summary())).not.toThrow();
    spy.mockRestore();
  });
});
