import { describe, expect, it } from "vitest";
import { slideFromResult } from "../DeckDraft";

describe("slideFromResult", () => {
  it("summary becomes a bullets slide with the outline title", () => {
    const s = slideFromResult("summary", "Executive summary", { title: "x", bullets: ["a", "b"] })!;
    expect(s.type).toBe("bullets");
    expect(s.bullets).toEqual(["a", "b"]);
  });
  it("tobe keeps lanes and takes the outline title", () => {
    const s = slideFromResult("tobe", "Automated flow", { title: "TO BE", lanes: ["Bot", "Agent"], nodes: [], edges: [], notes: [] })!;
    expect(s.flow!.title).toBe("Automated flow");
    expect(s.flow!.lanes).toEqual(["Bot", "Agent"]);
  });
  it("benefits adds drivers to a cost slide with empty ramp", () => {
    const s = slideFromResult("benefits", "", { drivers: [{ name: "d", annual_volume: 1, minutes_saved: 2, hourly_rate: 3, success_rate: 1 }] })!;
    expect(s.type).toBe("cost");
    expect(s.cost!.drivers![0].ramp).toEqual([]);
  });
  it("template-only kinds return null", () => {
    expect(slideFromResult("gantt", "", {})).toBeNull();
  });
});
