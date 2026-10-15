import type { Proposal } from "./types";

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`${r.status}: ${t.slice(0, 300)}`);
  }
  return r.json() as Promise<T>;
}

export interface LLMStatus { provider: string; configured: boolean; host: string; model: string; hint: string }
export interface LLMPrepared { messages: { role: string; content: string }[]; host: string; model: string; provider: string; configured: boolean }
export interface LLMReq { task: string; text: string; redact: boolean; terms: string[]; existing?: string[]; context?: string }
const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export interface TemplateInfo {
  name: string; slide_w_in: number; slide_h_in: number;
  layouts: { index: number; name: string; placeholders: string[] }[];
  title_layout: number; content_layout: number; colors: Record<string, string>; warnings: string[];
}
export interface PreviewShape { x: number; y: number; w: number; h: number; kind: string; label: string; fill: string | null; src?: string }
export interface PreviewLayout { index: number; name: string; background: string | null; show_master_shapes: boolean; shapes: PreviewShape[] }
export interface TemplatePreview { slide_w: number; slide_h: number; background: string; master_shapes: PreviewShape[]; layouts: PreviewLayout[] }
export interface ExportOpts { template: string; titleLayout: number | null; contentLayout: number | null; useThemeColors: boolean; preset: string }
export interface Preset { id: string; label: string; description: string; font: string; colors: Record<string, string> }
export interface TemplateRow {
  name: string; size_kb: number; modified: number; ok: boolean; warnings: string[];
  slide_w_in?: number; slide_h_in?: number; layouts?: number; colors?: Record<string, string>;
}

export const api = {
  fitNotes: (p: Proposal) => post("/api/validate", p).then(j<{ ok: boolean; notes: { slide: number; message: string }[] }>),
  presets: () => fetch("/api/presets").then(j<Preset[]>),
  templateDetails: () => fetch("/api/templates/details").then(j<TemplateRow[]>),
  renameTemplate: (n: string, to: string) =>
    fetch(`/api/templates/${encodeURIComponent(n)}/rename?to=${encodeURIComponent(to)}`, { method: "POST" }).then(j<{ name: string }>),
  templates: () => fetch("/api/templates").then(j<string[]>),
  templatePreview: (n: string) => fetch(`/api/templates/${encodeURIComponent(n)}/preview`).then(j<TemplatePreview>),
  templateInfo: (n: string) => fetch(`/api/templates/${encodeURIComponent(n)}`).then(j<TemplateInfo>),
  uploadTemplate: (n: string, f: File) =>
    fetch(`/api/templates/${encodeURIComponent(n)}`, { method: "PUT", body: f }).then(j<TemplateInfo>),
  deleteTemplate: (n: string) => fetch(`/api/templates/${encodeURIComponent(n)}`, { method: "DELETE" }).then(j<{ deleted: string }>),
  llmStatus: () => fetch("/api/llm/status").then(j<LLMStatus>),
  llmPrepare: (r: LLMReq) => post("/api/llm/prepare", r).then(j<LLMPrepared>),
  llmRun: (r: LLMReq) => post("/api/llm/run", r).then(j<{ task: string; result: any; warnings: string[] }>),
  sample: () => fetch("/api/sample").then(j<Proposal>),
  library: () => fetch("/api/library").then(j<Record<string, string[]>>),
  projects: () => fetch("/api/projects").then(j<string[]>),
  load: (n: string) => fetch(`/api/projects/${encodeURIComponent(n)}`).then(j<Proposal>),
  save: (n: string, p: Proposal) =>
    fetch(`/api/projects/${encodeURIComponent(n)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    }).then(j<{ saved: string }>),
  async exportPptx(p: Proposal, o?: ExportOpts): Promise<{ blob: Blob; warnings: string }> {
    const q = new URLSearchParams();
    if (!o?.template && o?.preset) q.set("preset", o.preset);
    if (o?.template) {
      q.set("template", o.template);
      if (o.titleLayout !== null) q.set("title_layout", String(o.titleLayout));
      if (o.contentLayout !== null) q.set("content_layout", String(o.contentLayout));
      q.set("use_theme_colors", String(o.useThemeColors));
    }
    const r = await fetch(`/api/render?${q}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p),
    });
    if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 300)}`);
    return { blob: await r.blob(), warnings: r.headers.get("X-Render-Warnings") ?? "" };
  },
};
