import { describe, expect, it } from "vitest";
import { lodFor, NODE_WORLD_RADIUS } from "./lod";

describe("lodFor", () => {
  it("draws dots when zoomed far out", () => {
    expect(lodFor(0.02)).toBe("dots");
  });
  it("draws icons at medium zoom", () => {
    expect(lodFor(0.1)).toBe("icons");
  });
  it("draws full detail when zoomed in", () => {
    expect(lodFor(0.3)).toBe("full");
  });
});

describe("NODE_WORLD_RADIUS -- dot size by tier (06)", () => {
  it("keystone > notable > normal > attribute", () => {
    expect(NODE_WORLD_RADIUS.keystone).toBeGreaterThan(NODE_WORLD_RADIUS.notable);
    expect(NODE_WORLD_RADIUS.notable).toBeGreaterThan(NODE_WORLD_RADIUS.normal);
    expect(NODE_WORLD_RADIUS.normal).toBeGreaterThan(NODE_WORLD_RADIUS.attribute);
  });
});
