import { useState } from "react";
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, LinearProgress,
  Paper, Stack, Step, StepLabel, Stepper, Switch, TextField, Typography,
} from "@mui/material";
import AutoAwesome from "@mui/icons-material/AutoAwesomeOutlined";
import { api, type LLMPrepared, type LLMStatus } from "./api";
import { newSlide } from "./factory";
import type { Slide } from "./types";

export const OUTLINE_LABEL: Record<string, string> = {
  summary: "Executive summary", asis: "As-Is process", tobe: "To-Be flow", assumptions: "Assumptions", scope: "Scope",
  risks: "Risks", benefits: "Benefits and cost", gantt: "Execution plan", next_steps: "Next steps",
};

interface OutlineSlide { kind: string; title: string }
interface Draft { kind: string; slide: Slide; note: string; failed: boolean }

const STEPS = ["Brief", "Review payload", "Choose slides", "Review drafts"];

/** Turn a model result for one outline kind into a slide (pure; unit tested). */
export function slideFromResult(kind: string, title: string, result: any): Slide | null {
  const t = title || OUTLINE_LABEL[kind] || "";
  switch (kind) {
    case "summary": return { type: "bullets", title: t, bullets: result.bullets };
    case "asis": return { type: "flow", flow: { ...result, title: t } };
    case "tobe": return { type: "flow", flow: { ...result, title: t } };
    case "assumptions": return { type: "assumptions", assumptions: { title: t, items: result.items, numbered: true } };
    case "scope": return { type: "scope", scope: { title: t, in_scope: result.in_scope, out_scope: result.out_scope, note: "" } };
    case "risks": return { type: "risks", risks: { title: t, items: result.items } };
    case "benefits": {
      const base = newSlide("cost");
      return { ...base, cost: { ...base.cost!, title: t, drivers: result.drivers.map((d: any) => ({ ...d, ramp: [] })) } };
    }
    default: return null;
  }
}

const TASK_OF: Record<string, string> = {
  summary: "summary", asis: "flow", tobe: "tobe", assumptions: "assumptions", scope: "scope", risks: "risks", benefits: "benefits",
};

function skeleton(kind: string, title: string): Slide {
  const s: Slide = kind === "asis" ? newSlide("flow", { flowTitle: title || "As-Is process" })
    : kind === "tobe" ? newSlide("flow", { flowTitle: title || "TO BE", swimlanes: true })
    : kind === "summary" ? { ...newSlide("bullets"), title: title || "Executive summary" }
    : kind === "benefits" ? newSlide("cost")
    : kind === "gantt" ? newSlide("gantt")
    : kind === "next_steps" ? newSlide("next_steps")
    : newSlide(kind as any);
  return s;
}

function flowText(s: Slide | undefined): string {
  const f = s?.flow;
  if (!f) return "";
  return f.nodes.map((n, i) => `${i + 1}. ${n.label}`).join("\n");
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Receives the accepted slides and, when ticked, the suggested deck title and subtitle. */
  onApply: (slides: Slide[], meta?: { title: string; subtitle: string }) => void;
}

export function DeckDraft({ open, onClose, onApply }: Props) {
  const [step, setStep] = useState(0);
  const [brief, setBrief] = useState("");
  const [redact, setRedact] = useState(true);
  const [terms, setTerms] = useState("");
  const [status, setStatus] = useState<LLMStatus | null>(null);
  const [prep, setPrep] = useState<LLMPrepared | null>(null);
  const [outline, setOutline] = useState<{ title: string; subtitle: string; slides: OutlineSlide[] } | null>(null);
  const [picked, setPicked] = useState<boolean[]>([]);
  const [useMeta, setUseMeta] = useState(true);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [keep, setKeep] = useState<boolean[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  const req = (task: string, text: string, context = "") => ({
    task, text, redact, terms: terms.split(",").map((t) => t.trim()).filter(Boolean), existing: [] as string[], context,
  });
  const reset = () => {
    setStep(0); setPrep(null); setOutline(null); setDrafts([]); setErr(""); setWarnings([]); setProgress(null); setBusy(false);
  };
  const close = () => { reset(); onClose(); };
  const begin = () => { api.llmStatus().then(setStatus).catch(() => setStatus(null)); };

  const preview = async () => {
    setBusy(true); setErr("");
    try { begin(); setPrep(await api.llmPrepare(req("outline", brief))); setStep(1); }
    catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  const planOutline = async () => {
    setBusy(true); setErr("");
    try {
      const r = await api.llmRun(req("outline", brief));
      setOutline(r.result); setWarnings(r.warnings ?? []);
      setPicked(r.result.slides.map(() => true));
      setStep(2);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  const generate = async () => {
    if (!outline) return;
    const chosen = outline.slides.filter((_, i) => picked[i]);
    setBusy(true); setErr(""); setProgress({ done: 0, total: chosen.length });
    const ctx = [`Proposal: ${outline.title}`, `Slides: ${chosen.map((c) => c.title || OUTLINE_LABEL[c.kind]).join(", ")}`].join("\n");
    const out: Draft[] = [];
    for (const c of chosen) {
      const task = TASK_OF[c.kind];
      if (!task) { out.push({ kind: c.kind, slide: skeleton(c.kind, c.title), note: "Template slide: fill in manually.", failed: false }); }
      else {
        const asis = out.find((d) => d.kind === "asis");
        const text = c.kind === "tobe" && asis ? `${brief}\n\nAS-IS process steps:\n${flowText(asis.slide)}` : brief;
        try {
          const r = await api.llmRun(req(task, text, ctx));
          const slide = slideFromResult(c.kind, c.title, r.result);
          out.push({ kind: c.kind, slide: slide ?? skeleton(c.kind, c.title), note: (r.warnings ?? []).join(" "), failed: false });
        } catch (e) {
          out.push({ kind: c.kind, slide: skeleton(c.kind, c.title), note: `Draft failed (${String(e).slice(0, 120)}); an empty slide is offered instead.`, failed: true });
        }
      }
      setProgress({ done: out.length, total: chosen.length });
    }
    setDrafts(out); setKeep(out.map(() => true)); setBusy(false); setStep(3);
  };
  const apply = () => {
    onApply(drafts.filter((_, i) => keep[i]).map((d) => d.slide), useMeta && outline?.title ? { title: outline.title, subtitle: outline.subtitle } : undefined);
    close();
  };
  const summary = (d: Draft) => {
    const s = d.slide;
    if (s.flow) return `${s.flow.nodes.length} steps${s.flow.lanes?.length ? `, lanes: ${s.flow.lanes.join(", ")}` : ""}`;
    if (s.bullets) return s.bullets.join(" · ");
    if (s.assumptions) return `${s.assumptions.items.length} assumptions`;
    if (s.scope) return `${s.scope.in_scope.length} in scope, ${s.scope.out_scope.length} out of scope`;
    if (s.risks) return `${s.risks.items.length} risks`;
    if (s.cost) return `${s.cost.drivers?.length ?? 0} benefit drivers`;
    return "";
  };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="md">
      <DialogTitle>Draft a deck from a brief</DialogTitle>
      <DialogContent>
        <Stepper activeStep={step} sx={{ mb: 3 }}>{STEPS.map((s) => <Step key={s}><StepLabel>{s}</StepLabel></Step>)}</Stepper>
        {status && !status.configured && (
          <Alert severity="info" sx={{ mb: 2 }}>No LLM provider is configured, so nothing can be sent. You can still preview the exact payload.</Alert>
        )}
        {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
        {busy && progress && <LinearProgress variant="determinate" value={(progress.done / Math.max(1, progress.total)) * 100} sx={{ mb: 2 }} />}

        {step === 0 && (
          <Stack spacing={2}>
            <TextField multiline minRows={8} fullWidth autoFocus value={brief} onChange={(e) => setBrief(e.target.value)}
              placeholder="Describe the process today, the pain, what should be automated, systems involved, volumes and any known success rates. The more specific, the better the drafts." />
            <FormControlLabel control={<Switch checked={redact} onChange={(e) => setRedact(e.target.checked)} />}
              label="Redact emails, phone numbers and long IDs before sending" />
            <TextField label="Also redact these terms (comma separated)" value={terms} onChange={(e) => setTerms(e.target.value)} helperText="e.g. client name, system names" />
            <Typography variant="caption" color="text.secondary">
              Step 1 asks for an outline only. After you pick slides, one request per slide is sent with your brief and a short deck summary;
              nothing is added to your deck until you accept the drafts.
            </Typography>
          </Stack>
        )}

        {step === 1 && prep && (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2">This exact payload will be sent to</Typography>
              <Chip size="small" color={prep.configured ? "primary" : "default"} label={prep.configured ? `${prep.host || "?"} · ${prep.model}` : "no provider"} />
            </Stack>
            {prep.messages.map((m, i) => (
              <Paper key={i} variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="caption" color="text.secondary">{m.role}</Typography>
                <Box component="pre" sx={{ m: 0, whiteSpace: "pre-wrap", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12.5 }}>{m.content}</Box>
              </Paper>
            ))}
          </Stack>
        )}

        {step === 2 && outline && (
          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">Untick slides you do not want drafted. A title slide is kept as it is.</Typography>
            {outline.title && (
              <FormControlLabel control={<Checkbox checked={useMeta} onChange={(e) => setUseMeta(e.target.checked)} />}
                label={`Set deck title to “${outline.title}”${outline.subtitle ? ` / “${outline.subtitle}”` : ""}`} />
            )}
            {outline.slides.map((s, i) => (
              <FormControlLabel key={i} control={<Checkbox checked={!!picked[i]} onChange={(e) => setPicked(picked.map((p, k) => (k === i ? e.target.checked : p)))} />}
                label={<span><b>{OUTLINE_LABEL[s.kind]}</b>{s.title && s.title !== OUTLINE_LABEL[s.kind] ? ` · ${s.title}` : ""}
                  {!TASK_OF[s.kind] && <Chip size="small" variant="outlined" label="template only" sx={{ ml: 1 }} />}</span>} />
            ))}
            {warnings.map((w) => <Alert key={w} severity="info" sx={{ py: 0 }}>{w}</Alert>)}
          </Stack>
        )}

        {step === 3 && (
          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">
              Nothing is in your deck yet. Untick drafts you do not want; accepted slides are added at the end as one undoable step.
            </Typography>
            {drafts.map((d, i) => (
              <Paper key={i} variant="outlined" sx={{ p: 1.25 }}>
                <FormControlLabel control={<Checkbox checked={!!keep[i]} onChange={(e) => setKeep(keep.map((k, j) => (j === i ? e.target.checked : k)))} />}
                  label={<span><b>{OUTLINE_LABEL[d.kind]}</b> · {d.slide.title || d.slide.flow?.title || d.slide.scope?.title || d.slide.risks?.title || d.slide.assumptions?.title || d.slide.cost?.title || ""}</span>} />
                <Typography variant="body2" color="text.secondary" sx={{ pl: 4 }}>{summary(d)}</Typography>
                {d.note && <Alert severity={d.failed ? "warning" : "info"} sx={{ py: 0, mt: 0.5, ml: 4 }}>{d.note}</Alert>}
              </Paper>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={close}>{step === 3 ? "Reject all" : "Cancel"}</Button>
        {step > 0 && step < 3 && <Button disabled={busy} onClick={() => setStep(step - 1)}>Back</Button>}
        {step === 0 && <Button variant="contained" startIcon={<AutoAwesome />} disabled={!brief.trim() || busy} onClick={preview}>Preview payload</Button>}
        {step === 1 && <Button variant="contained" color="secondary" disabled={!prep?.configured || busy} onClick={planOutline}>Plan outline</Button>}
        {step === 2 && <Button variant="contained" color="secondary" disabled={!picked.some(Boolean) || busy} onClick={generate}>Draft {picked.filter(Boolean).length} slide(s)</Button>}
        {step === 3 && <Button variant="contained" disabled={!keep.some(Boolean)} onClick={apply}>Add {keep.filter(Boolean).length} slide(s)</Button>}
      </DialogActions>
    </Dialog>
  );
}
