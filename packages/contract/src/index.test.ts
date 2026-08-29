import { describe, expect, it } from "vitest";
import { CONTRACT_VERSION } from "@poe2/contract";

// Fork-prep alias smoke test: proves the "@poe2/contract" alias resolves under the vitest
// suites (both configs share vitest.alias.ts). Replace with real schema tests in phase 2.
describe("@poe2/contract", () => {
  it("exports a version string", () => {
    expect(typeof CONTRACT_VERSION).toBe("string");
  });
});
