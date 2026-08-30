// packages/web/scripts/fetch-tree.test.mjs
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { transformTree } from "./fetch-tree.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const slice = JSON.parse(
  fs.readFileSync(path.resolve(here, "../fixtures/repoe-tree-slice.json"), "utf-8"),
);

const SHOCK_CHANCE_TRANSLATION = {
  ids: ["shock_chance_+%"],
  English: [{ condition: [{ min: 1 }], format: ["#"], index_handlers: [[]], string: "{0}% increased chance to [Shock]" }],
};
const ZEALOTS_OATH_TRANSLATION = {
  ids: ["keystone_zealots_oath"],
  English: [{ condition: [{}], format: ["ignore"], index_handlers: [[]], string: "[ZealotsOath|Zealot's Oath]" }],
};

describe("transformTree", () => {
  const out = transformTree(slice, [SHOCK_CHANCE_TRANSLATION, ZEALOTS_OATH_TRANSLATION]);

  it("carries the orbit constants through unchanged", () => {
    expect(out.constants.orbitRadii).toEqual(slice.orbit_radii);
    expect(out.constants.skillsPerOrbit).toEqual(slice.skills_per_orbit);
  });

  it("inverts group->passives into a node map keyed by hash, using the group id as-is (no +1 shift)", () => {
    expect(out.groups["1068"]).toEqual([3249.42, 4552.83]);
    const shockChance = out.nodes["4"];
    expect(shockChance[0]).toBe(1068); // group
  });

  it("encodes kind: normal, notable, keystone, jewel", () => {
    const kindOf = (id) => out.nodes[id][4];
    expect(kindOf("4")).toBe(0); // normal
    expect(kindOf("30")).toBe(1); // notable
    expect(kindOf("52")).toBe(2); // keystone
    expect(kindOf("2491")).toBe(3); // jewel
  });

  it("carries connections through as bare hash ids", () => {
    expect(out.nodes["4"][5]).toEqual([11578]);
  });

  it("interns the translated stat line and appends statIdx before ascNameIdx/iconIdx", () => {
    const t = out.nodes["4"];
    const statIdx = t[6];
    expect(out.strings[statIdx[0]]).toBe("15% increased chance to Shock");
  });

  it("records the ascendancy name for an ascendancy notable", () => {
    const t = out.nodes["30"];
    const ascNameIdx = t[7];
    expect(out.strings[ascNameIdx]).toBe("Ranger1");
  });

  it("appends iconIdx as the tuple's last element for every node", () => {
    const t = out.nodes["4"];
    expect(out.strings[t[8]]).toBe("Art/2DArt/SkillIcons/passives/LightningDamagenode.dds");
    // a node with neither stats nor an ascendancy name still gets statIdx=[] and
    // ascNameIdx=null placeholders so iconIdx stays at a fixed position 8
    const jewel = out.nodes["2491"];
    expect(jewel[6]).toEqual([]);
    expect(jewel[7]).toBeNull();
    expect(out.strings[jewel[8]]).toBe("Art/2DArt/SkillIcons/passives/MasteryBlank.dds");
  });

  it("lists iconIdx in meta.nodeFields", () => {
    expect(out.meta.nodeFields).toEqual([
      "group", "orbit", "orbitIndex", "nameIdx", "kind", "conns", "statIdx", "ascNameIdx?", "iconIdx",
    ]);
  });
});
