import { useEffect, useState } from "react";
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack,
  Step, StepLabel, Stepper, Switch, TextField, Typography,
} from "@mui/material";
import { api } from "./api";
import { newSlide } from "./factory";
import { LABEL } from "./slideMeta";
import type { Proposal, Slide, SlideType } from "./types";

interface Item { key: string; type: SlideType; label: string; flowTitle?: string; swimlanes?: boolean }

const ITEMS: Item[] = [
  { key: "title", type: "title", label: "Title slide" },
  { key: "solution", type: "solution", label: "Solution overview (pipeline + end-to-end steps)" },
  { key: "asis", type: "flow", label: "As-Is process flow", flowTitle: "AS IS" },
  { key: "tobe", type: "flow", label: "To-Be solution (swimlanes)", flowTitle: "TO BE", swimlanes: true },
  { key: "hl", type: "flow", label: "HL flow of automation", flowTitle: "HL Flow of Automation" },
  { key: "assumptions", type: "assumptions", label: "Assumptions" },
  { key: "scope", type: "scope", label: "Scope (in / out)" },
  { key: "gantt", type: "gantt", label: "Execution plan (Gantt)" },
  { key: "cost", type: "cost", label: "Cost & CBA" },
  { key: "compare", type: "compare", label: "Plan revision (previous vs updated)" },
  { key: "risks", type: "risks", label: "Risks and dependencies" },
  { key: "next", type: "next_steps", label: "Next steps" },
];

const PRESETS: Record<string, { label: string; keys: string[] }> = {
  full: { label: "Full proposal", keys: ["title", "solution", "asis", "tobe", "hl", "assumptions", "scope", "gantt", "cost", "risks", "next"] },
  quick: { label: "Quick pitch", keys: ["title", "tobe", "assumptions", "gantt", "cost"] },
  minimal: { label: "Solution only", keys: ["title", "solution", "hl", "assumptions"] },
};

const STEPS = ["Basics", "Slides", "Review"];

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (p: Proposal) => void;
}

export function Wizard({ open, onClose, onCreate }: Props) {
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [brand, setBrand] = useState("");
  const [footer, setFooter] = useState("");
  const [start, setStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [currency, setCurrency] = useState("$");
  const [years, setYears] = useState(4);
  const [keys, setKeys] = useState<string[]>(PRESETS.full.keys);
  const [prefill, setPrefill] = useState(true);
  const [lib, setLib] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (open) { setStep(0); api.library().then(setLib).catch(() => setLib({})); }
  }, [open]);

  const toggle = (k: string) => setKeys((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  const chosen = ITEMS.filter((i) => keys.includes(i.key));

  const create = () => {
    const slides: Slide[] = chosen.map((it) => {
      const s = newSlide(it.type, { startDate: start, currency, years, flowTitle: it.flowTitle, swimlanes: it.swimlanes });
      if (it.type === "assumptions" && prefill && s.assumptions) {
        s.assumptions.items = Object.values(lib).map((arr) => arr[0]).filter(Boolean);
      }
      return s;
    });
    onCreate({ meta: { title: title.trim() || "Untitled proposal", subtitle, brand, footer }, slides });
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>New proposal</DialogTitle>
      <DialogContent>
        <Stepper activeStep={step} sx={{ mb: 3 }}>{STEPS.map((s) => <Step key={s}><StepLabel>{s}</StepLabel></Step>)}</Stepper>

        {step === 0 && (
          <Stack spacing={2}>
            <TextField label="Proposal title" autoFocus fullWidth value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Invoice intake automation" />
            <TextField label="Subtitle" fullWidth value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Brand (footer left)" fullWidth value={brand} onChange={(e) => setBrand(e.target.value)} />
              <TextField label="Footer text" fullWidth value={footer} onChange={(e) => setFooter(e.target.value)} />
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Project start date" type="date" fullWidth value={start} InputLabelProps={{ shrink: true }}
                onChange={(e) => setStart(e.target.value)} />
              <TextField label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} sx={{ width: { sm: 120 } }} />
              <TextField label="Cost years" type="number" inputProps={{ min: 1, max: 8 }} value={years}
                onChange={(e) => setYears(Math.min(8, Math.max(1, Number(e.target.value) || 1)))} sx={{ width: { sm: 120 } }} />
            </Stack>
          </Stack>
        )}

        {step === 1 && (
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {Object.entries(PRESETS).map(([k, p]) => (
                <Chip key={k} label={p.label} clickable color="primary" variant="outlined" onClick={() => setKeys(p.keys)} />
              ))}
            </Stack>
            <Box>
              {ITEMS.map((it) => (
                <FormControlLabel key={it.key} sx={{ display: "flex" }}
                  control={<Checkbox checked={keys.includes(it.key)} onChange={() => toggle(it.key)} />} label={it.label} />
              ))}
            </Box>
            <FormControlLabel control={<Switch checked={prefill} onChange={(e) => setPrefill(e.target.checked)} />}
              label="Pre-fill assumptions from the library (one per category, editable)" />
          </Stack>
        )}

        {step === 2 && (
          <Stack spacing={1.5}>
            <Typography>
              <b>{title.trim() || "Untitled proposal"}</b>{subtitle ? ` · ${subtitle}` : ""}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Starts {start} · {currency} · {years} cost year(s) · {chosen.length} slides
            </Typography>
            <Stack spacing={0.5}>
              {chosen.map((it, i) => (
                <Typography key={it.key} variant="body2">{i + 1}. {it.flowTitle ? `${LABEL[it.type]} (${it.flowTitle})` : LABEL[it.type]}</Typography>
              ))}
            </Stack>
            <Alert severity="info">This replaces the deck in the editor. You can undo it afterwards with Undo.</Alert>
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Box sx={{ flex: 1 }} />
        {step > 0 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
        {step < 2 && <Button variant="contained" disabled={step === 1 && chosen.length === 0} onClick={() => setStep(step + 1)}>Next</Button>}
        {step === 2 && <Button variant="contained" color="secondary" disabled={chosen.length === 0} onClick={create}>Create proposal</Button>}
      </DialogActions>
    </Dialog>
  );
}
