import { describe, expect, it } from "vitest";
import { clickPick } from "./pick";

const SLOP = 4;
const pickable = new Set([10, 20, 30]);

describe("clickPick", () => {
  it("picks a pickable node when the pointer barely moved", () => {
    expect(clickPick(0, SLOP, 20, pickable)).toBe(20);
    expect(clickPick(3.9, SLOP, 20, pickable)).toBe(20);
  });

  it("does not pick after a drag past the slop", () => {
    expect(clickPick(4, SLOP, 20, pickable)).toBeNull();
    expect(clickPick(50, SLOP, 20, pickable)).toBeNull();
  });

  it("does not pick a node outside the pickable set", () => {
    expect(clickPick(0, SLOP, 99, pickable)).toBeNull();
  });

  it("does not pick when nothing was hit or nothing is pickable", () => {
    expect(clickPick(0, SLOP, null, pickable)).toBeNull();
    expect(clickPick(0, SLOP, 20, undefined)).toBeNull();
  });
});
