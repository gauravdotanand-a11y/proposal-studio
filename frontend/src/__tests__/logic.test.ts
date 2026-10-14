import { describe, expect, it } from "vitest";
import { benefitValues, costSummary, driverValues } from "../editors";
import { acceptValue, rowsOf } from "../AiAssist";
import { newSlide } from "../factory";

const driver = { name: "d", annual_volume: 6000, minutes_saved: 10, hourly_rate: 30, success_rate: 0.5, ramp: [] as number[] };

describe("cost maths", () => {
  it("driver = volume x minutes / 60 x rate x success", () => {
    expect(driverValues(driver, 2)).toEqual([15000, 15000]);
  });
  it("ramp scales years and missing ramp years are zero", () => {
    expect(driverValues({ ...driver, ramp: [0.1, 1] }, 3)).toEqual([1500, 15000, 0]);
  });
  it("manual benefits add to drivers", () => {
    const c: any = { years: ["Y0", "Y1"], lines: [], benefits: [100, 200], drivers: [driver] };
    expect(benefitValues(c)).toEqual([15100, 15200]);
  });
  it("summary totals cost lines", () => {
    const c: any = { years: ["Y0", "Y1"], currency: "$", lines: [{ name: "a", values: [10, 20] }, { name: "b", values: [5, 5] }], benefits: [], drivers: [] };
    expect(costSummary(c).totalCost).toBe(40);
  });
});

describe("AI review rows", () => {
  it("scope rows keep in/out parts and accept respects unticked items", () => {
    const r = { in_scope: ["a", "b"], out_scope: ["c"] };
    expect(rowsOf("scope", r).map((x) => x.part)).toEqual(["in", "in", "out"]);
    expect(acceptValue("scope", r, [true, false, true])).toEqual({ in_scope: ["a"], out_scope: ["c"] });
  });
  it("risks accept only ticked", () => {
    const r = { items: [{ risk: "x", impact: "High", mitigation: "m" }, { risk: "y", impact: "Low", mitigation: "" }] };
    expect(acceptValue("risks", r, [false, true])).toEqual([r.items[1]]);
  });
  it("bullets keep title", () => {
    expect(acceptValue("summary", { title: "T", bullets: ["1", "2"] }, [true, false])).toEqual({ title: "T", bullets: ["1"] });
  });
});

describe("factory", () => {
  it("compare slide starts with equal plans", () => {
    const s: any = newSlide("compare");
    expect(s.compare.previous.activities).toEqual(s.compare.updated.activities);
    expect(s.compare.previous).not.toBe(s.compare.updated);
  });
});
