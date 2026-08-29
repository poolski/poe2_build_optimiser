// New on the port. Upstream's wheel zoom (viewport.ts had none; TreeView.tsx did
// `vp.zoom * (deltaY<0 ? 1.15 : 1/1.15)` clamped to a *fixed* [0.01, 3]) jumped between the
// effective min and max in one detent because the fixed clamp bore no relation to the tree's
// fit-to-bounds scale. intake/web-ui/06-tree-canvas.md "Fixes to make on the port" asks for:
//   (a) a log-scale zoom slider spanning [minScale, maxScale] derived from the tree bounds
//   (b) wheel zoom as a small fixed multiplicative step per detent, cursor-anchored
//   (c) +/-/fit buttons
// This module is the (a)/(b) maths; TreeCanvas wires the buttons and the cursor anchor.

/** One wheel detent = this multiplicative step. ~1.15x, matching upstream's constant but now
 * bounded by a range that actually fits the tree. */
export const WHEEL_STEP = 1.15;

/** Slider position in [0, 1] -> scale, logarithmically between range.min and range.max. */
export function sliderToScale(t: number, range: { min: number; max: number }): number {
  const clamped = Math.min(1, Math.max(0, t));
  return range.min * Math.pow(range.max / range.min, clamped);
}

/** Scale -> slider position in [0, 1] (inverse of sliderToScale). */
export function scaleToSlider(scale: number, range: { min: number; max: number }): number {
  if (scale <= range.min) return 0;
  if (scale >= range.max) return 1;
  return Math.log(scale / range.min) / Math.log(range.max / range.min);
}

/** Apply `steps` wheel detents (positive = zoom in) to a scale, clamped to the range. */
export function wheelZoom(
  scale: number,
  steps: number,
  range: { min: number; max: number },
): number {
  const next = scale * Math.pow(WHEEL_STEP, steps);
  return Math.min(range.max, Math.max(range.min, next));
}
