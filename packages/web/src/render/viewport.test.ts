import { describe, expect, it } from "vitest";
import {
  clampScale,
  fitToBounds,
  scaleRange,
  screenToWorld,
  visibleWorldRect,
  worldToScreen,
} from "./viewport";

// Transform cases ported from poe2-build-planner src/render/viewport.test.ts (MIT).
const vp = { x: 100, y: 200, zoom: 2 };
const size = { width: 800, height: 600 };

describe("viewport transforms", () => {
  it("maps the viewport centre to the canvas centre", () => {
    expect(worldToScreen(vp, size, 100, 200)).toEqual({ sx: 400, sy: 300 });
  });
  it("offsets by world delta scaled by zoom", () => {
    expect(worldToScreen(vp, size, 110, 200)).toEqual({ sx: 420, sy: 300 });
  });
  it("round-trips screen <-> world", () => {
    const w = screenToWorld(vp, size, 420, 300);
    expect(w.wx).toBeCloseTo(110);
    expect(w.wy).toBeCloseTo(200);
  });
  it("computes the visible world rectangle", () => {
    expect(visibleWorldRect(vp, size)).toEqual({
      minX: -100,
      minY: 50,
      maxX: 300,
      maxY: 350,
    });
  });
});

describe("fitToBounds", () => {
  it("centres the bounds and zooms to fit with margin", () => {
    const fit = fitToBounds({ minX: 0, minY: 0, maxX: 1000, maxY: 500 }, size, 0);
    expect(fit.x).toBe(500);
    expect(fit.y).toBe(250);
    expect(fit.zoom).toBeCloseTo(0.8); // limiting axis is width: 800/1000
  });
});

describe("scaleRange / clampScale (added on the port)", () => {
  const bounds = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };
  it("min is near the fit-out zoom, max is a multiple of it", () => {
    const r = scaleRange(bounds, size);
    const fit = fitToBounds(bounds, size, 40).zoom;
    expect(r.min).toBeLessThanOrEqual(fit);
    expect(r.max / r.min).toBeCloseTo(60);
  });
  it("clampScale keeps a value inside [min, max]", () => {
    const r = { min: 0.01, max: 0.6 };
    expect(clampScale(0.001, r)).toBe(0.01);
    expect(clampScale(5, r)).toBe(0.6);
    expect(clampScale(0.2, r)).toBe(0.2);
  });
});
