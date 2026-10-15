export type NodeKind = "start" | "process" | "decision" | "bot" | "human" | "data" | "ai" | "end";
export interface FlowNode { id: string; label: string; kind: NodeKind; lane?: string | null }
export interface FlowEdge { src: string; dst: string; label: string; note?: string }
export interface Flow { title: string; nodes: FlowNode[]; edges: FlowEdge[]; notes: string[]; lanes?: string[] }
export interface Activity { name: string; start_week: number; end_week: number; section?: string }
export interface Gantt { title: string; start_date: string; weeks?: number | null; activities: Activity[]; note: string; holidays?: string[] }
export type CostKind = "one_time" | "recurring" | "mixed";
export interface CostLine { head: string; values: number[]; kind?: CostKind }
export interface Driver { name: string; annual_volume: number; minutes_saved: number; hourly_rate: number; success_rate: number; ramp: number[] }
export interface Cost { title: string; currency: string; years: string[]; lines: CostLine[]; benefits: number[]; drivers?: Driver[] }
export interface Assumptions { title: string; items: string[]; numbered: boolean }
export interface Stage { heading: string; title: string; body: string; ai: boolean }
export interface TextBlock { heading: string; text: string }
export interface Step { label: string; text: string }
export interface Solution { title: string; stages: Stage[]; blocks: TextBlock[]; steps_title: string; steps: Step[] }
export interface Compare { title: string; previous_label: string; updated_label: string; previous: Gantt; updated: Gantt }
export interface ScopeSpec { title: string; in_scope: string[]; out_scope: string[]; note: string }
export interface Risk { risk: string; impact: "Low" | "Medium" | "High"; mitigation: string }
export interface Risks { title: string; items: Risk[] }
export interface NextStep { action: string; owner: string; due: string }
export interface NextSteps { title: string; items: NextStep[] }
export type SlideType = "title" | "assumptions" | "gantt" | "cost" | "flow" | "bullets" | "solution" | "compare" | "scope" | "risks" | "next_steps";
export interface Slide {
  type: SlideType;
  title?: string;
  bullets?: string[];
  notes?: string;
  flow?: Flow | null;
  gantt?: Gantt | null;
  cost?: Cost | null;
  assumptions?: Assumptions | null;
  solution?: Solution | null;
  compare?: Compare | null;
  scope?: ScopeSpec | null;
  risks?: Risks | null;
  next_steps?: NextSteps | null;
}
export interface Meta { title: string; subtitle: string; footer: string; brand: string }
export interface Proposal { meta: Meta; slides: Slide[] }
