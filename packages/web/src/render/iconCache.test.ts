// packages/web/src/render/iconCache.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetIconCache, getIcon, onIconLoad } from "./iconCache";

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

beforeEach(() => {
  created = [];
  vi.stubGlobal("Image", FakeImage);
  __resetIconCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getIcon", () => {
  it("returns null and kicks off a load on first request", () => {
    expect(getIcon("Art/foo.dds")).toBeNull();
    expect(created).toHaveLength(1);
    expect(created[0].src).toBe("/icons/tree/Art/foo.png");
  });

  it("returns null for an empty path without creating an Image", () => {
    expect(getIcon("")).toBeNull();
    expect(created).toHaveLength(0);
  });

  it("returns the cached image on a later call once it has loaded", () => {
    getIcon("Art/foo.dds");
    created[0].complete = true;
    created[0].onload?.();
    expect(getIcon("Art/foo.dds")).toBe(created[0]);
    expect(created).toHaveLength(1); // no second Image created for the same path
  });

  it("a load error does not throw and the path stays un-resolvable", () => {
    getIcon("Art/bad.dds");
    expect(() => created[0].onerror?.()).not.toThrow();
    expect(getIcon("Art/bad.dds")).toBeNull();
    expect(created).toHaveLength(1); // doesn't retry on every call
  });
});

describe("onIconLoad", () => {
  it("notifies subscribers when an in-flight icon finishes loading", () => {
    const listener = vi.fn();
    const unsubscribe = onIconLoad(listener);
    getIcon("Art/foo.dds");
    expect(listener).not.toHaveBeenCalled();
    created[0].onload?.();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    getIcon("Art/other.dds");
    created[1].onload?.();
    expect(listener).toHaveBeenCalledTimes(1); // not called again after unsubscribe
  });
});
