// packages/web/scripts/statTranslate.test.mjs
import { describe, expect, it } from "vitest";
import { translateStat } from "./statTranslate.mjs";

const SHOCK_CHANCE = {
  ids: ["shock_chance_+%"],
  English: [
    { condition: [{ min: 1 }], format: ["#"], index_handlers: [[]], string: "{0}% increased chance to [Shock]" },
    { condition: [{ max: -1 }], format: ["#"], index_handlers: [["negate"]], string: "{0}% reduced chance to [Shock]" },
  ],
};

const ZEALOTS_OATH_GENERAL = {
  ids: ["keystone_zealots_oath"],
  English: [{ condition: [{}], format: ["ignore"], index_handlers: [[]], string: "[ZealotsOath|Zealot's Oath]" }],
};

const ZEALOTS_OATH_PASSIVE = {
  ids: ["keystone_zealots_oath"],
  English: [
    {
      condition: [{}],
      format: ["ignore"],
      index_handlers: [[]],
      string:
        "Excess Life Recovery from Regeneration is applied to [EnergyShield|Energy Shield]\n[EnergyShield|Energy Shield] does not Recharge",
    },
  ],
};

const BREACH_SPLINTERS = {
  ids: ["map_breach_splinters_drop_as_stones_permyriad"],
  English: [
    {
      condition: [{ min: 1 }],
      format: ["#"],
      index_handlers: [["divide_by_one_hundred_2dp_if_required"]],
      string: "Breach Splinters have {0}% chance to drop as Breachstones instead",
    },
  ],
};

const DEFLECTION = {
  ids: ["+_deflection_rating_per_50_missing_maximum_energy_shield"],
  English: [
    {
      condition: [{}],
      format: ["+#"],
      index_handlers: [[]],
      string: "{0} to [Deflect|Deflection Rating] per 50 missing [EnergyShield|Energy Shield]",
    },
  ],
};

const QUICKSAND = {
  ids: ["chronomancer_grant_cast_speed_+%", "chronomancer_grant_area_of_effect_+%"],
  English: [
    {
      condition: [{ min: 1 }, { min: 1 }],
      format: ["ignore", "ignore"],
      index_handlers: [[], []],
      string: "Grants [Chronobuff|Sands of Time]",
    },
  ],
};

describe("translateStat", () => {
  it("picks the positive-condition branch and strips the [Tag] bracket", () => {
    expect(translateStat({ "shock_chance_+%": 15 }, [SHOCK_CHANCE])).toEqual([
      "15% increased chance to Shock",
    ]);
  });

  it("picks the negative-condition branch via the negate handler", () => {
    expect(translateStat({ "shock_chance_+%": -10 }, [SHOCK_CHANCE])).toEqual([
      "10% reduced chance to Shock",
    ]);
  });

  it("prefers a later (passive-specific) entry over an earlier (general) one for the same id", () => {
    // fetch-tree.mjs orders entries [passiveSpecific..., general...] before calling this --
    // translateStat itself just takes the first ids-match, so ordering is the caller's job. This
    // test locks that contract: first match wins.
    expect(translateStat({ keystone_zealots_oath: 1 }, [ZEALOTS_OATH_PASSIVE, ZEALOTS_OATH_GENERAL])).toEqual([
      "Excess Life Recovery from Regeneration is applied to Energy Shield\nEnergy Shield does not Recharge",
    ]);
  });

  it("applies a divide_by index handler", () => {
    expect(translateStat({ map_breach_splinters_drop_as_stones_permyriad: 2500 }, [BREACH_SPLINTERS])).toEqual([
      "Breach Splinters have 25% chance to drop as Breachstones instead",
    ]);
  });

  it("prefixes a + for the +# format and strips a [Tag|Display] pair", () => {
    expect(
      translateStat({ "+_deflection_rating_per_50_missing_maximum_energy_shield": 40 }, [DEFLECTION]),
    ).toEqual(["+40 to Deflection Rating per 50 missing Energy Shield"]);
  });

  it("matches a multi-id line only when every id is present, substituting nothing for ignore-format slots", () => {
    expect(
      translateStat(
        { "chronomancer_grant_cast_speed_+%": 1, "chronomancer_grant_area_of_effect_+%": 1 },
        [QUICKSAND],
      ),
    ).toEqual(["Grants Sands of Time"]);
  });

  it("falls back to a raw id: value line when no entry matches", () => {
    expect(translateStat({ is_focused_totem: 1 }, [])).toEqual(["is_focused_totem: 1"]);
  });
});
