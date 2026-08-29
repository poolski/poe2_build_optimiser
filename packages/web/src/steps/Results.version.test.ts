import { describe, expect, it } from "vitest";
import { isVersionMismatch, MIN_ID_COVERAGE } from "./Results";

// The declared-version check landed at integration (2026-08-29): 05 and 06 both specified a
// tree-version fallback, but BuildSummary had no treeVersion field to implement it against.

describe("isVersionMismatch", () => {
  it("trusts the declared version over id coverage, both ways", () => {
    // matching versions win even when coverage looks bad (a heavily-respecced import)
    expect(isVersionMismatch("0_5", "0_5", 0)).toBe(false);
    // mismatched versions lose even when coverage looks fine (ids overlap across versions)
    expect(isVersionMismatch("0_2", "0_5", 1)).toBe(true);
  });

  it("falls back to id coverage when the build declares no version", () => {
    expect(isVersionMismatch(null, "0_5", 1)).toBe(false);
    expect(isVersionMismatch(null, "0_5", MIN_ID_COVERAGE)).toBe(false);
    expect(isVersionMismatch(null, "0_5", MIN_ID_COVERAGE - 0.01)).toBe(true);
  });

  it("falls back to id coverage when the shipped tree declares no version", () => {
    expect(isVersionMismatch("0_5", null, 0.9)).toBe(false);
    expect(isVersionMismatch("0_5", null, 0.1)).toBe(true);
  });
});
