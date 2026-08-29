import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NodeDiff, { fmt } from "./NodeDiff";
import { mockResult } from "../mock/mockClient";

describe("fmt", () => {
  it("renders an em dash for null / non-finite", () => {
    expect(fmt(null)).toBe("—");
    expect(fmt(undefined)).toBe("—");
    expect(fmt(Number.NaN)).toBe("—");
    expect(fmt(Number.POSITIVE_INFINITY)).toBe("—");
  });
  it("formats finite numbers", () => {
    expect(fmt(0.5)).toContain("0.5");
    expect(fmt(12345)).toMatch(/12[,.\s]?345/);
  });
});

describe("<NodeDiff>", () => {
  const html = renderToStaticMarkup(<NodeDiff result={mockResult()} />);

  it("lists every freed node with its name and points freed", () => {
    expect(html).toContain("Avatar of Fire");
    expect(html).toContain("Sundering");
    expect(html).toContain("frees 1 pt");
  });
  it("lists the re-spend steps with their stat lines", () => {
    expect(html).toContain("Overheating Blow");
    expect(html).toContain("Gain 25% of Physical Damage as Extra Fire Damage");
  });
  it("handles a negative valueLost (removing the node helped)", () => {
    // Avatar of Fire in the fixture has valueLost -3593 -> shows a negative value, not a crash.
    expect(html).toMatch(/-3[,.\s]?593/);
  });
});
