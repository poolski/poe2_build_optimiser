import { describe, expect, it, vi } from "vitest";
import { OBJECTIVE_SPEC_RE } from "@poe2/contract";
import ObjectiveBuilder, {
  buildObjectiveSpec,
  parseObjectiveModel,
} from "./ObjectiveBuilder";
import { KNOWN_METRICS } from "../metrics/knownMetrics";
import { click, mount, setInput } from "../test/dom";

describe("buildObjectiveSpec (pure)", () => {
  it("single metric passes through", () => {
    expect(buildObjectiveSpec({ ...parseObjectiveModel("TotalEHP") })).toBe("TotalEHP");
  });
  it("dps-ehp blend", () => {
    expect(
      buildObjectiveSpec({ kind: "dps-ehp", metric: "", weight: 0.25, blendA: "", blendB: "" }),
    ).toBe("dps-ehp:0.25");
  });
  it("custom blend", () => {
    expect(
      buildObjectiveSpec({
        kind: "blend",
        metric: "",
        weight: 0.5,
        blendA: "TotalDPS",
        blendB: "TotalEHP",
      }),
    ).toBe("blend:TotalDPS,TotalEHP,0.5");
  });
  it("clamps the weight into [0,1]", () => {
    expect(buildObjectiveSpec({ kind: "dps-ehp", metric: "", weight: 5, blendA: "", blendB: "" })).toBe(
      "dps-ehp:1",
    );
  });
  it("every produced spec is accepted by the contract regex", () => {
    const specs = [
      buildObjectiveSpec(parseObjectiveModel("TotalDPS")),
      buildObjectiveSpec({ kind: "dps-ehp", metric: "", weight: 0.5, blendA: "", blendB: "" }),
      buildObjectiveSpec({
        kind: "blend",
        metric: "",
        weight: 0.7,
        blendA: "Life",
        blendB: "EnergyShield",
      }),
    ];
    for (const s of specs) expect(OBJECTIVE_SPEC_RE.test(s)).toBe(true);
  });
});

describe("parseObjectiveModel round-trips", () => {
  for (const spec of ["TotalDPS", "dps-ehp:0.5", "blend:TotalDPS,TotalEHP,0.25"]) {
    it(spec, () => {
      expect(buildObjectiveSpec(parseObjectiveModel(spec))).toBe(spec);
    });
  }
});

describe("<ObjectiveBuilder> emits the spec on interaction", () => {
  it("switching to the DPS/EHP radio emits a dps-ehp spec", () => {
    const onChange = vi.fn();
    const m = mount(<ObjectiveBuilder value="TotalDPS" onChange={onChange} />);
    const radios = m.container.querySelectorAll<HTMLInputElement>('input[name="obj-kind"]');
    m.act(() => click(radios[1])); // DPS/EHP blend
    expect(onChange).toHaveBeenLastCalledWith(expect.stringMatching(/^dps-ehp:/));
    m.unmount();
  });

  it("editing the single-metric field emits that metric", () => {
    const onChange = vi.fn();
    const m = mount(<ObjectiveBuilder value="TotalDPS" onChange={onChange} />);
    const field = m.container.querySelector<HTMLInputElement>('input[type="text"]')!;
    m.act(() => setInput(field, "FullDPS"));
    expect(onChange).toHaveBeenLastCalledWith("FullDPS");
    m.unmount();
  });

  it("the single-metric field's datalist matches the shared known-metrics list exactly (no invented names)", () => {
    // Was a hand-rolled inline list including "CombinedDPS" / "FullDPS", neither attested
    // anywhere else in this repo -- invented PoB stats per CLAUDE.md. Must come from the same
    // shared module ConstraintsEditor uses, not a component-local list.
    const onChange = vi.fn();
    const m = mount(<ObjectiveBuilder value="TotalDPS" onChange={onChange} />);
    const field = m.container.querySelector<HTMLInputElement>('input[type="text"]')!;
    const listId = field.getAttribute("list");
    expect(listId).toBeTruthy();

    const datalist = m.container.querySelector<HTMLDataListElement>(`datalist#${listId}`);
    expect(datalist).not.toBeNull();
    const options = [...datalist!.querySelectorAll("option")].map((o) => o.getAttribute("value"));
    expect(options).toEqual(KNOWN_METRICS);
    m.unmount();
  });
});
