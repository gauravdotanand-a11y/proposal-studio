import type { Slide, SlideType } from "./types";

export interface FactoryOpts {
  startDate?: string;
  currency?: string;
  years?: number;
  flowTitle?: string;
  swimlanes?: boolean;
}

const isoToday = () => new Date().toISOString().slice(0, 10);

export function newSlide(t: SlideType, o: FactoryOpts = {}): Slide {
  const start = o.startDate || isoToday();
  const cur = o.currency ?? "$";
  const nYears = Math.min(8, Math.max(1, o.years ?? 4));
  const years = Array.from({ length: nYears }, (_, i) => `Y${i}`);
  const zeros = years.map(() => 0);
  switch (t) {
    case "title": return { type: "title" };
    case "compare": {
      const base = { title: "HL Execution Plan", start_date: start, note: "", activities: [
        { name: "Requirement gathering / BRD", start_week: 1, end_week: 1 },
        { name: "Implementation", start_week: 2, end_week: 6 },
        { name: "UAT", start_week: 7, end_week: 8 }] };
      return { type: "compare", compare: { title: "Plan revision", previous_label: "Previous version", updated_label: "Updated version",
        previous: base, updated: JSON.parse(JSON.stringify(base)) } };
    }
    case "scope": return { type: "scope", scope: { title: "Scope", in_scope: ["Item in scope"], out_scope: ["Item out of scope"], note: "" } };
    case "risks": return { type: "risks", risks: { title: "Risks and dependencies", items: [{ risk: "Describe the risk", impact: "Medium", mitigation: "" }] } };
    case "next_steps": return { type: "next_steps", next_steps: { title: "Next steps", items: [{ action: "First action", owner: "", due: "" }] } };
    case "solution": return { type: "solution", solution: { title: "Solution overview", stages: [
      { heading: "Input Sources", title: "Source", body: "", ai: false },
      { heading: "ML / GenAI", title: "Extract", body: "", ai: true },
      { heading: "Automation", title: "RPA bot", body: "", ai: false }],
      blocks: [{ heading: "Solution", text: "" }], steps_title: "High Level End to End Flow", steps: [{ label: "", text: "" }] } };
    case "bullets": return { type: "bullets", title: "Solution overview", bullets: ["Point one"] };
    case "assumptions": return { type: "assumptions", assumptions: { title: "Assumptions", items: [], numbered: true } };
    case "gantt": return { type: "gantt", gantt: { title: "HL Execution Plan", start_date: start, activities: [
      { name: "Requirement gathering / BRD", start_week: 1, end_week: 1 },
      { name: "Implementation", start_week: 2, end_week: 6 },
      { name: "UAT", start_week: 7, end_week: 8 },
      { name: "Deployment", start_week: 9, end_week: 9 },
      { name: "Hypercare", start_week: 10, end_week: 10 }], note: "" } };
    case "cost": return { type: "cost", cost: { title: "Cost", currency: cur, years,
      lines: [{ head: "Development Cost (One Time)", values: [...zeros], kind: "one_time" },
              { head: "Infrastructure Cost", values: [...zeros], kind: "recurring" }],
      benefits: [...zeros] } };
    case "flow":
      if (o.swimlanes) return { type: "flow", flow: { title: o.flowTitle ?? "TO BE", notes: [],
        nodes: [
          { id: "n1", kind: "bot", label: "Pick next item", lane: "RPA Bot" },
          { id: "n2", kind: "ai", label: "Extract data", lane: "RPA Bot" },
          { id: "n3", kind: "human", label: "Validate and update", lane: "Agent" }],
        edges: [{ src: "n1", dst: "n2", label: "" }, { src: "n2", dst: "n3", label: "" }] } };
      return { type: "flow", flow: { title: o.flowTitle ?? "HL Flow of Automation", notes: [],
        nodes: [{ id: "n1", kind: "start", label: "Start" }, { id: "n2", kind: "process", label: "Step" }, { id: "n3", kind: "end", label: "End" }],
        edges: [{ src: "n1", dst: "n2", label: "" }, { src: "n2", dst: "n3", label: "" }] } };
  }
}

export function slideTitle(s: Slide): string {
  return s.compare?.title || s.scope?.title || s.risks?.title || s.next_steps?.title || s.solution?.title
    || s.flow?.title || s.gantt?.title || s.cost?.title || s.assumptions?.title || s.title || "";
}
