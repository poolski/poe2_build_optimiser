import { describe, expect, it, vi } from "vitest";
import ConstraintsEditor, {
  parsePreserve,
  rowsToConstraints,
  toValue,
} from "./ConstraintsEditor";
import { KNOWN_METRICS } from "../metrics/knownMetrics";
import { click, mount, setInput } from "../test/dom";

describe("rowsToConstraints (pure)", () => {
  it("keeps well-formed rows, drops blank / non-numeric ones", () => {
    expect(
      rowsToConstraints([
        { metric: "FireResist", value: "75" },
        { metric: "  ", value: "10" },
        { metric: "Life", value: "" },
        { metric: "Mana", value: "abc" },
        { metric: "TotalEHP", value: "-5" },
      ]),
    ).toEqual({ FireResist: 75, TotalEHP: -5 });
  });
});

describe("parsePreserve (pure)", () => {
  it("splits on comma/whitespace and dedups", () => {
    expect(parsePreserve("TotalEHP, Life  Life,,Evasion")).toEqual([
      "TotalEHP",
      "Life",
      "Evasion",
    ]);
  });
  it("empty -> []", () => {
    expect(parsePreserve("   ")).toEqual([]);
  });
});

describe("toValue", () => {
  it("assembles the whole ConstraintsValue, minResist optional", () => {
    expect(toValue([{ metric: "Life", value: "3000" }], "TotalEHP", "75")).toEqual({
      constraints: { Life: 3000 },
      preserveMetrics: ["TotalEHP"],
      minResist: 75,
    });
    expect(toValue([], "", "").minResist).toBeUndefined();
  });
});

describe("<ConstraintsEditor> add / remove rows", () => {
  it("adding a row then filling it emits the constraint; removing it clears it", () => {
    const onChange = vi.fn();
    const m = mount(<ConstraintsEditor onChange={onChange} />);

    m.act(() => click(m.container.querySelector("button")!)); // "+ Add constraint"
    const metric = m.container.querySelector<HTMLInputElement>(
      'input[aria-label="constraint metric 1"]',
    )!;
    const value = m.container.querySelector<HTMLInputElement>(
      'input[aria-label="constraint value 1"]',
    )!;
    m.act(() => setInput(metric, "FireResist"));
    m.act(() => setInput(value, "75"));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ constraints: { FireResist: 75 } }),
    );

    m.act(() =>
      click(m.container.querySelector('button[aria-label="remove constraint 1"]')!),
    );
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ constraints: {} }));
    m.unmount();
  });
});

describe("<ConstraintsEditor> metric picker (datalist hybrid)", () => {
  it("metric input is wired to a datalist of known metrics", () => {
    const onChange = vi.fn();
    const m = mount(<ConstraintsEditor onChange={onChange} />);
    m.act(() => click(m.container.querySelector("button")!)); // "+ Add constraint"

    const field = m.container.querySelector<HTMLInputElement>(
      'input[aria-label="constraint metric 1"]',
    )!;
    const listId = field.getAttribute("list");
    expect(listId).toBeTruthy();

    const datalist = m.container.querySelector<HTMLDataListElement>(`datalist#${listId}`);
    expect(datalist).not.toBeNull();
    const options = [...datalist!.querySelectorAll("option")].map((o) => o.getAttribute("value"));
    expect(options).toEqual(KNOWN_METRICS);
    m.unmount();
  });

  it("still accepts a free-text metric not present in the datalist", () => {
    const onChange = vi.fn();
    const m = mount(<ConstraintsEditor onChange={onChange} />);
    m.act(() => click(m.container.querySelector("button")!));

    const metric = m.container.querySelector<HTMLInputElement>(
      'input[aria-label="constraint metric 1"]',
    )!;
    const value = m.container.querySelector<HTMLInputElement>(
      'input[aria-label="constraint value 1"]',
    )!;
    m.act(() => setInput(metric, "TotallyCustomStat"));
    m.act(() => setInput(value, "10"));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ constraints: { TotallyCustomStat: 10 } }),
    );
    m.unmount();
  });
});
