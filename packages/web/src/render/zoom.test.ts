import { describe, expect, it } from "vitest";
import { scaleToSlider, sliderToScale, wheelZoom, WHEEL_STEP } from "./zoom";

const range = { min: 0.01, max: 0.6 };

describe("log slider <-> scale", () => {
  it("endpoints map to 0 and 1", () => {
    expect(sliderToScale(0, range)).toBeCloseTo(range.min);
    expect(sliderToScale(1, range)).toBeCloseTo(range.max);
    expect(scaleToSlider(range.min, range)).toBe(0);
    expect(scaleToSlider(range.max, range)).toBe(1);
  });
  it("midpoint is the geometric mean (log scale), not the arithmetic one", () => {
    const mid = sliderToScale(0.5, range);
    expect(mid).toBeCloseTo(Math.sqrt(range.min * range.max));
    expect(mid).toBeLessThan((range.min + range.max) / 2);
  });
  it("round-trips", () => {
    for (const t of [0.1, 0.37, 0.5, 0.82]) {
      expect(scaleToSlider(sliderToScale(t, range), range)).toBeCloseTo(t);
    }
  });
  it("clamps out-of-range inputs", () => {
    expect(sliderToScale(-1, range)).toBeCloseTo(range.min);
    expect(sliderToScale(2, range)).toBeCloseTo(range.max);
    expect(scaleToSlider(1e-9, range)).toBe(0);
    expect(scaleToSlider(1e9, range)).toBe(1);
  });
});

describe("wheelZoom", () => {
  it("one detent is a small fixed multiplicative step (the upstream min/max-jump bug fix)", () => {
    const s = 0.1;
    expect(wheelZoom(s, 1, range)).toBeCloseTo(s * WHEEL_STEP);
    expect(wheelZoom(s, -1, range)).toBeCloseTo(s / WHEEL_STEP);
  });
  it("never leaves the range", () => {
    expect(wheelZoom(range.min, -10, range)).toBe(range.min);
    expect(wheelZoom(range.max, 10, range)).toBe(range.max);
  });
});
