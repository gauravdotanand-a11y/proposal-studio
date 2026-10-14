import { useEffect, useState } from "react";
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
  Stack, Step, StepLabel, Stepper, Switch, TextField, Typography, CircularProgress, Paper,
} from "@mui/material";
import AutoAwesome from "@mui/icons-material/AutoAwesomeOutlined";
import { api, type LLMPrepared, type LLMStatus } from "./api";

export type AiTask = "assumptions" | "flow" | "bullets" | "tobe" | "summary" | "risks" | "scope" | "benefits";

/** Flatten a task result into the checkable rows shown in the review step. */
export function rowsOf(task: AiTask, r: any): { label: string; part?: string }[] {
  if (!r) return [];
  switch (task) {
    case "assumptions": return r.items.map((label: string) => ({ label }));
    case "bullets": case "summary": return r.bullets.map((label: string) => ({ label }));
    case "risks": return r.items.map((x: any) => ({ label: `${x.risk} [${x.impact}]${x.mitigation ? " — " + x.mitigation : ""}` }));
    case "scope": return [...r.in_scope.map((label: string) => ({ label, part: "in" })), ...r.out_scope.map((label: string) => ({ label, part: "out" }))];
    case "benefits": return r.drivers.map((d: any) => ({ label: `${d.name}: ${d.annual_volume} /yr × ${d.minutes_saved} min × ${d.hourly_rate}/h × ${Math.round(d.success_rate * 100)}%` }));
    default: return [];
  }
}

/** Build the value handed to onAccept from the ticked rows. */
export function acceptValue(task: AiTask, r: any, picked: boolean[]): any {
  const keep = <X,>(a: X[], off = 0) => a.filter((_, i) => picked[i + off]);
  switch (task) {
    case "assumptions": return keep<string>(r.items);
    case "bullets": case "summary": return { title: r.title, bullets: keep<string>(r.bullets) };
    case "risks": return keep<any>(r.items);
    case "scope": return { in_scope: keep<string>(r.in_scope), out_scope: keep<string>(r.out_scope, r.in_scope.length) };
    case "benefits": return keep<any>(r.drivers);
    default: return r;
  }
}

interface Props<T> {
  task: AiTask;
  label: string;
  placeholder: string;
  /** Prefilled input (e.g. the deck's As-Is flow) used when the dialog opens empty. */
  initialText?: string;
  /** Sent with the request so suggestions fit the deck and do not repeat existing items. */
  context?: { existing?: string[]; deckContext?: string };
  /** Called with only the parts of the suggestion the user accepted. */
  onAccept: (accepted: T) => void;
}

const STEPS = ["Describe", "Review payload", "Review suggestion"];

export function AiAssist<T = any>({ task, label, placeholder, initialText, context, onAccept }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [text, setText] = useState("");
  const [redact, setRedact] = useState(true);
  const [terms, setTerms] = useState("");
  const [status, setStatus] = useState<LLMStatus | null>(null);
  const [prep, setPrep] = useState<LLMPrepared | null>(null);
  const [result, setResult] = useState<any>(null);
  const [picked, setPicked] = useState<boolean[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const isFlow = task === "flow" || task === "tobe";

  useEffect(() => {
    if (!open) return;
    api.llmStatus().then(setStatus).catch(() => setStatus(null));
    if (initialText && !text.trim()) setText(initialText);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const req = () => ({
    task, text, redact, terms: terms.split(",").map((t) => t.trim()).filter(Boolean),
    existing: context?.existing ?? [], context: context?.deckContext ?? "",
  });
  const close = () => { setOpen(false); setStep(0); setPrep(null); setResult(null); setErr(""); setWarnings([]); };
  const rows = isFlow ? [] : rowsOf(task, result);
  const items: string[] | null = isFlow || !result ? null : rows.map((r) => r.label);

  const preview = async () => {
    setBusy(true); setErr("");
    try { setPrep(await api.llmPrepare(req())); setStep(1); }
    catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true); setErr("");
    try {
      const r = await api.llmRun(req());
      setResult(r.result);
      setWarnings(r.warnings ?? []);
      setPicked(isFlow ? [] : rowsOf(task, r.result).map(() => true));
      setStep(2);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  const accept = () => {
    onAccept((isFlow ? result : acceptValue(task, result, picked)) as T);
    close();
  };

  return (
    <>
      <Button startIcon={<AutoAwesome />} onClick={() => setOpen(true)}>{label}</Button>
      <Dialog open={open} onClose={close} fullWidth maxWidth="md">
        <DialogTitle>{label}</DialogTitle>
        <DialogContent>
          <Stepper activeStep={step} sx={{ mb: 3 }}>{STEPS.map((s) => <Step key={s}><StepLabel>{s}</StepLabel></Step>)}</Stepper>

          {status && !status.configured && (
            <Alert severity="info" sx={{ mb: 2 }}>
              No LLM provider is configured, so nothing can be sent. Set <code>LLM_PROVIDER</code> (azure | openai | ollama) and credentials in the
              environment where the backend runs. You can still preview the exact payload.
            </Alert>
          )}
          {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}

          {step === 0 && (
            <Stack spacing={2}>
              <TextField multiline minRows={7} fullWidth autoFocus placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
              <FormControlLabel control={<Switch checked={redact} onChange={(e) => setRedact(e.target.checked)} />}
                label="Redact emails, phone numbers and long IDs before sending" />
              <Typography variant="caption" color="text.secondary">
                The deck context and existing items shown in the next step are sent too. If a reply is unusable, one correction request is sent.
              </Typography>
              <TextField label="Also redact these terms (comma separated)" value={terms} onChange={(e) => setTerms(e.target.value)}
                helperText="e.g. client name, system names" />
            </Stack>
          )}

          {step === 1 && prep && (
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
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

          {step === 2 && result && (
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">Nothing is applied until you accept. Untick items to reject them.</Typography>
              {items && items.map((t, i) => (
                <FormControlLabel key={i} control={<Checkbox checked={!!picked[i]} onChange={(e) => setPicked(picked.map((p, k) => (k === i ? e.target.checked : p)))} />} label={t} />
              ))}
              {warnings.map((w) => <Alert key={w} severity="info" sx={{ py: 0 }}>{w}</Alert>)}
              {isFlow && (
                <>
                  <Typography variant="subtitle2">{result.title}</Typography>
                  {result.lanes?.length > 0 && <Typography variant="body2" color="text.secondary">Lanes: {result.lanes.join(", ")}</Typography>}
                  {result.nodes.map((n: any) => <Typography key={n.id} variant="body2"><b>{n.id}</b> · {n.kind} · {n.label}{n.lane ? ` · ${n.lane}` : ""}</Typography>)}
                  <Typography variant="subtitle2" sx={{ pt: 1 }}>Connections</Typography>
                  {result.edges.map((e: any, i: number) => <Typography key={i} variant="body2">{e.src} → {e.dst}{e.label ? ` (${e.label})` : ""}{e.note ? ` — ${e.note}` : ""}</Typography>)}
                </>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {busy && <CircularProgress size={20} />}
          <Button onClick={close}>{step === 2 ? "Reject all" : "Cancel"}</Button>
          {step === 1 && <Button onClick={() => setStep(0)}>Back</Button>}
          {step === 0 && <Button variant="contained" disabled={!text.trim() || busy} onClick={preview}>Preview payload</Button>}
          {step === 1 && <Button variant="contained" color="secondary" disabled={!prep?.configured || busy} onClick={send}>Send to LLM</Button>}
          {step === 2 && <Button variant="contained" disabled={items ? !picked.some(Boolean) : false} onClick={accept}>
            {isFlow ? "Accept flow" : "Accept selected"}</Button>}
        </DialogActions>
      </Dialog>
    </>
  );
}
