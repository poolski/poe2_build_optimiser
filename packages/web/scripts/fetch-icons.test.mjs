// packages/web/scripts/fetch-icons.test.mjs
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchIcons, iconPathsFromTree } from "./fetch-icons.mjs";

describe("iconPathsFromTree", () => {
  it("dedupes icon paths across nodes and drops nodes with no iconIdx", () => {
    const minTreeFile = {
      strings: ["a.dds", "b.dds"],
      nodes: {
        "1": [0, 0, 0, 0, 0, [], [], null, 0], // -> "a.dds"
        "2": [0, 0, 0, 0, 0, [], [], null, 0], // -> "a.dds" again
        "3": [0, 0, 0, 0, 0, [], [], null, 1], // -> "b.dds"
        "4": [0, 0, 0, 0, 0, [], [], null], // no iconIdx slot at all
      },
    };
    expect(iconPathsFromTree(minTreeFile)).toEqual(["a.dds", "b.dds"]);
  });
});

describe("fetchIcons", () => {
  let destRoot;
  beforeEach(() => {
    destRoot = mkdtempSync(join(tmpdir(), "fetch-icons-test-"));
  });
  afterEach(() => {
    rmSync(destRoot, { recursive: true, force: true });
  });

  function fakeFetch(responses) {
    return async (url) => {
      const r = responses[url];
      if (!r) throw new Error(`unexpected url ${url}`);
      return r;
    };
  }
  const ok = (bytes) => ({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer });
  const fail = (status) => ({ ok: false, status, arrayBuffer: async () => new ArrayBuffer(0) });

  it("downloads a new icon and writes it under destRoot with a .png extension", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchImpl = fakeFetch({
      "https://image.ggpk.exposed/poe2/Art/2DArt/SkillIcons/passives/a.dds": ok(bytes),
    });
    const result = await fetchIcons(["Art/2DArt/SkillIcons/passives/a.dds"], destRoot, fetchImpl);
    expect(result).toEqual({ downloaded: 1, skipped: 0, failed: 0, failedPaths: [] });
    const dest = join(destRoot, "Art/2DArt/SkillIcons/passives/a.png");
    expect(existsSync(dest)).toBe(true);
    expect([...readFileSync(dest)]).toEqual([1, 2, 3]);
  });

  it("skips a path whose destination file already exists, without calling fetch", async () => {
    const dest = join(destRoot, "Art/2DArt/SkillIcons/passives/a.png");
    mkdirSync(join(destRoot, "Art/2DArt/SkillIcons/passives"), { recursive: true });
    writeFileSync(dest, "existing");
    const fetchImpl = fakeFetch({}); // any call throws "unexpected url"
    const result = await fetchIcons(["Art/2DArt/SkillIcons/passives/a.dds"], destRoot, fetchImpl);
    expect(result).toEqual({ downloaded: 0, skipped: 1, failed: 0, failedPaths: [] });
  });

  it("records a failure for a non-ok response (matches the real 500-on-bad-path behavior) without throwing", async () => {
    const fetchImpl = fakeFetch({
      "https://image.ggpk.exposed/poe2/bogus.dds": fail(500),
    });
    const result = await fetchIcons(["bogus.dds"], destRoot, fetchImpl);
    expect(result.downloaded).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.failedPaths).toEqual([{ path: "bogus.dds", error: "Error: HTTP 500" }]);
  });
});
