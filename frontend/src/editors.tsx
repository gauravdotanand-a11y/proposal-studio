import { useEffect, useMemo, useState } from "react";
import {
  Box, Button, Chip, Divider, IconButton, MenuItem, Paper, Stack, Switch, FormControlLabel,
  TextField, Typography, Table, TableBody, TableCell, TableHead, TableRow, Accordion,
  AccordionSummary, AccordionDetails,
} from "@mui/material";
import DeleteOutline from "@mui/icons-material/DeleteOutline";
import Add from "@mui/icons-material/Add";
import ExpandMore from "@mui/icons-material/ExpandMore";
import { AiAssist } from "./AiAssist";
import { FlowPreview, type Selection } from "./FlowPreview";
import type { Assumptions, Cost, CostKind, Flow, FlowEdge, FlowNode, Gantt, NodeKind } from "./types";

const KINDS: NodeKind[] = ["start", "process", "decision", "bot", "human", "data", "ai", "end"];

// ---------------------------------------------------------------- helpers
export { Section };
const isoDay = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;

/** Monday..Friday label of a 1-based week; the range starts and ends on working days (holidays skipped). */
export function weekLabel(startISO: string, week: number, holidays: string[] = []): string {
  const d = new Date(startISO + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  const dow = (d.getDay() + 6) % 7; // Monday=0
  const mon = new Date(d); mon.setDate(d.getDate() - dow + (week - 1) * 7);
  const days = Array.from({ length: 5 }, (_, i) => { const x = new Date(mon); x.setDate(mon.getDate() + i); return x; });
  const off = new Set(holidays);
  const work = days.filter((x) => !off.has(isoDay(x)));
  const [a, b] = work.length ? [work[0], work[work.length - 1]] : [days[0], days[4]];
  const f = (x: Date) => `${x.getDate()} ${x.toLocaleString("en", { month: "short" })}`;
  return `${f(a)} - ${f(b)}`;
}

export const money = (cur: string, v: number) => (v ? `${cur}${v.toLocaleString("en", { maximumFractionDigits: 2 })}` : "-");

export function driverValues(d: NonNullable<Cost["drivers"]>[number], n: number): number[] {
  const base = (d.annual_volume * d.minutes_saved) / 60 * d.hourly_rate * d.success_rate;
  return Array.from({ length: n }, (_, i) => base * (d.ramp.length ? d.ramp[i] ?? 0 : 1));
}

export function benefitValues(c: Cost): number[] {
  const n = c.years.length;
  const out = Array.from({ length: n }, (_, i) => c.benefits?.[i] ?? 0);
  for (const d of c.drivers ?? []) driverValues(d, n).forEach((v, i) => (out[i] += v));
  return out;
}

export function costSummary(c: Cost) {
  const yearTotals = c.years.map((_, i) => c.lines.reduce((s, l) => s + (l.values[i] || 0), 0));
  const totalCost = yearTotals.reduce((a, b) => a + b, 0);
  const benefits = benefitValues(c);
  const totalBenefit = benefits.reduce((a, b) => a + b, 0);
  const oneTime = c.lines.filter((l) => l.kind === "one_time").reduce((s, l) => s + l.values.reduce((a, b) => a + b, 0), 0);
  const recurring = c.lines.filter((l) => l.kind === "recurring").reduce((s, l) => s + l.values.reduce((a, b) => a + b, 0), 0);
  return { yearTotals, totalCost, totalBenefit, benefits, oneTime, recurring, cba: totalCost ? totalBenefit / totalCost : 0 };
}

export function flowToText(f: Flow) {
  const nodes = f.nodes.map((n) => `${n.id} | ${n.kind} | ${n.label}${n.lane ? " @ " + n.lane : ""}`).join("\n");
  const edges = f.edges
    .map((e) => `${e.src} -> ${e.dst}${e.label ? " : " + e.label : ""}${e.note ? " | " + e.note : ""}`)
    .join("\n");
  return { nodes, edges };
}

export function parseFlow(nodesTxt: string, edgesTxt: string): { nodes: FlowNode[]; edges: FlowEdge[]; errors: string[] } {
  const errors: string[] = [];
  const nodes: FlowNode[] = [];
  nodesTxt.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    const [id, kind, ...rest] = line.split("|").map((s) => s.trim());
    const joined = rest.join(" | ");
    const at = joined.lastIndexOf(" @ ");
    const label = (at >= 0 ? joined.slice(0, at) : joined).trim();
    const lane = at >= 0 ? joined.slice(at + 3).trim() : "";
    if (!id || !kind || !label) return void errors.push(`Node line ${i + 1}: use "id | kind | label @ lane"`);
    if (!KINDS.includes(kind as NodeKind)) return void errors.push(`Node line ${i + 1}: unknown kind "${kind}"`);
    nodes.push({ id, kind: kind as NodeKind, label, ...(lane ? { lane } : {}) });
  });
  const ids = new Set(nodes.map((n) => n.id));
  const edges: FlowEdge[] = [];
  edgesTxt.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    const m = line.match(/^\s*(\S+)\s*->\s*(\S+)\s*(?::\s*([^|]*?))?\s*(?:\|\s*(.*))?$/);
    if (!m) return void errors.push(`Edge line ${i + 1}: use "a -> b : label | note"`);
    if (!ids.has(m[1]) || !ids.has(m[2])) return void errors.push(`Edge line ${i + 1}: unknown node id`);
    edges.push({ src: m[1], dst: m[2], label: (m[3] || "").trim(), ...(m[4]?.trim() ? { note: m[4].trim() } : {}) });
  });
  return { nodes, edges, errors };
}

// ----------------------------------------------------------------- common
function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, mb: 2.5 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Typography variant="h6">{title}</Typography>
        {actions}
      </Stack>
      {children}
    </Paper>
  );
}

const num = (v: string) => (v === "" ? 0 : Number(v) || 0);

// ------------------------------------------------------------------ gantt
export function GanttEditor({ g, onChange }: { g: Gantt; onChange: (g: Gantt) => void }) {
  const weeks = g.weeks || Math.max(1, ...g.activities.map((a) => a.end_week));
  const setAct = (i: number, patch: Partial<Gantt["activities"][0]>) =>
    onChange({ ...g, activities: g.activities.map((a, k) => (k === i ? { ...a, ...patch } : a)) });
  // Drag in the preview: grab the first/last week of a bar to resize it, the middle to move it,
  // or an empty week to draw a new range. Columns stay frozen while dragging.
  const [drag, setDrag] = useState<{ row: number; mode: "start" | "end" | "move" | "new"; anchor: number; orig: [number, number]; weeks: number } | null>(null);
  const weekAt = (e: React.PointerEvent) => {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-week]");
    return el ? Number(el.getAttribute("data-week")) : null;
  };
  const down = (row: number, w: number, e: React.PointerEvent) => {
    const a = g.activities[row];
    const mode = w === a.start_week ? "start" : w === a.end_week ? "end" : w > a.start_week && w < a.end_week ? "move" : "new";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ row, mode, anchor: w, orig: [a.start_week, a.end_week], weeks });
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const w = weekAt(e);
    if (w === null) return;
    const [s0, e0] = drag.orig;
    let s = s0, en = e0;
    if (drag.mode === "start") { s = Math.min(w, e0); en = Math.max(w, e0); }
    else if (drag.mode === "end") { s = Math.min(w, s0); en = Math.max(w, s0); }
    else if (drag.mode === "move") {
      const d = Math.max(1 - s0, Math.min(w - drag.anchor, drag.weeks - e0));
      s = s0 + d; en = e0 + d;
    } else { s = Math.min(drag.anchor, w); en = Math.max(drag.anchor, w); }
    const cur = g.activities[drag.row];
    if (cur.start_week !== s || cur.end_week !== en) setAct(drag.row, { start_week: s, end_week: en });
  };
  return (
    <>
      <Section title="Execution plan">
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2 }}>
          <TextField label="Title" value={g.title} onChange={(e) => onChange({ ...g, title: e.target.value })} fullWidth />
          <TextField label="Start date" type="date" value={g.start_date} InputLabelProps={{ shrink: true }}
            onChange={(e) => onChange({ ...g, start_date: e.target.value })} />
        </Stack>
        <TextField label="Footnote" value={g.note} onChange={(e) => onChange({ ...g, note: e.target.value })} fullWidth sx={{ mb: 2 }} />
        <TextField label="Holidays (YYYY-MM-DD, comma separated)" fullWidth sx={{ mb: 2 }}
          helperText="Week labels start and end on working days"
          value={(g.holidays ?? []).join(", ")}
          onChange={(e) => onChange({ ...g, holidays: e.target.value.split(",").map((x) => x.trim()).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)) })} />
        <Table size="small">
          <TableHead><TableRow><TableCell>Activity</TableCell><TableCell width={150}>Section</TableCell><TableCell width={100}>Start wk</TableCell><TableCell width={100}>End wk</TableCell><TableCell width={48} /></TableRow></TableHead>
          <TableBody>
            {g.activities.map((a, i) => (
              <TableRow key={i}>
                <TableCell><TextField fullWidth value={a.name} onChange={(e) => setAct(i, { name: e.target.value })} /></TableCell>
                <TableCell><TextField fullWidth placeholder="optional" value={a.section ?? ""} onChange={(e) => setAct(i, { section: e.target.value })} /></TableCell>
                <TableCell><TextField type="number" inputProps={{ min: 1, max: 156 }} value={a.start_week} onChange={(e) => setAct(i, { start_week: Math.min(156, Math.max(1, num(e.target.value))) })} /></TableCell>
                <TableCell><TextField type="number" inputProps={{ min: 1, max: 156 }} value={a.end_week} onChange={(e) => setAct(i, { end_week: Math.min(156, Math.max(1, num(e.target.value))) })} /></TableCell>
                <TableCell><IconButton aria-label="remove activity" onClick={() => onChange({ ...g, activities: g.activities.filter((_, k) => k !== i) })}><DeleteOutline /></IconButton></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Button startIcon={<Add />} sx={{ mt: 1 }} onClick={() => {
          const last = g.activities[g.activities.length - 1];
          const s = last ? last.end_week + 1 : 1;
          onChange({ ...g, activities: [...g.activities, { name: "New activity", start_week: s, end_week: s }] });
        }}>Add activity</Button>
      </Section>
      <Section title="Preview">
        <Box sx={{ overflowX: "auto" }}>
          <Typography variant="caption" color="text.secondary">Drag a bar's first or last week to resize it, its middle to move it, or an empty week to draw one.</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: `200px repeat(${drag ? drag.weeks : weeks}, minmax(54px, 1fr))`, fontSize: 11, minWidth: 200 + weeks * 54, userSelect: "none" }}
            onPointerMove={move} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
            <Box sx={{ bgcolor: "primary.main", p: 0.5 }} />
            {Array.from({ length: weeks }, (_, w) => (
              <Box key={w} sx={{ bgcolor: "primary.main", color: "primary.contrastText", textAlign: "center", p: 0.5, fontWeight: 700 }}>week {w + 1}</Box>
            ))}
            <Box sx={{ bgcolor: "primary.main", color: "primary.contrastText", p: 0.5, fontWeight: 700 }}>Activities</Box>
            {Array.from({ length: weeks }, (_, w) => (
              <Box key={w} sx={{ bgcolor: "#C9E8EE", color: "#1B2A7A", textAlign: "center", p: 0.5, fontSize: 9 }}>{weekLabel(g.start_date, w + 1, g.holidays)}</Box>
            ))}
            {g.activities.map((a, i) => (
              <Box key={i} sx={{ display: "contents" }}>
                {a.section && a.section !== (g.activities[i - 1]?.section ?? "") && (
                  <Box sx={{ gridColumn: "1 / -1", bgcolor: "#7FC4D2", color: "#1B2A7A", p: 0.5, fontWeight: 700 }}>{a.section}</Box>
                )}
                <Box sx={{ bgcolor: "#C9E8EE", color: "#1B2A7A", p: 0.75, borderTop: "1px solid #fff" }}>{a.name}</Box>
                {Array.from({ length: weeks }, (_, w) => {
                  const on = w + 1 >= a.start_week && w + 1 <= a.end_week;
                  const edge = on && (w + 1 === a.start_week || w + 1 === a.end_week);
                  return <Box key={w} data-week={w + 1} onPointerDown={(e) => down(i, w + 1, e)}
                    sx={{ bgcolor: on ? "secondary.main" : "action.hover", borderTop: "1px solid", borderLeft: "1px solid", borderColor: "divider",
                      touchAction: "none", cursor: edge ? "ew-resize" : on ? "grab" : "crosshair" }} />;
                })}
              </Box>
            ))}
          </Box>
        </Box>
        {g.note && <Typography variant="body2" sx={{ mt: 1.5, fontWeight: 600 }} color="primary">{g.note}</Typography>}
      </Section>
    </>
  );
}

// ------------------------------------------------------------------- cost
const grid = (min: number) => ({ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 1.5 });

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Box sx={{ p: 1.25, borderRadius: 2, bgcolor: "action.hover" }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{label}</Typography>
      <Typography sx={{ fontWeight: strong ? 700 : 500 }}>{value}</Typography>
    </Box>
  );
}

export function CostEditor({ c, onChange }: { c: Cost; onChange: (c: Cost) => void }) {
  const s = useMemo(() => costSummary(c), [c]);
  const n = c.years.length;
  const setLine = (i: number, patch: Partial<Cost["lines"][0]>) =>
    onChange({ ...c, lines: c.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) });
  const setVal = (i: number, y: number, v: number) =>
    setLine(i, { values: c.lines[i].values.map((x, k) => (k === y ? v : x)) });
  const setKind = (i: number, kind: CostKind) => {
    const l = c.lines[i];
    const seed = l.values.find((v) => v) ?? 0;
    if (kind === "one_time") setLine(i, { kind, values: l.values.map((_, y) => (y === 0 ? seed : 0)) });
    else if (kind === "recurring") setLine(i, { kind, values: Array.from({ length: n }, () => seed) });
    else setLine(i, { kind });
  };
  const setDriver = (i: number, patch: Partial<NonNullable<Cost["drivers"]>[0]>) =>
    onChange({ ...c, drivers: (c.drivers ?? []).map((x, k) => (k === i ? { ...x, ...patch } : x)) });

  return (
    <>
      <Section title="Cost & benefits" actions={<Chip color="secondary" label={`CBA ${s.cba.toFixed(1)}x`} />}>
        <Box sx={{ ...grid(180), mb: 2.5 }}>
          <TextField label="Title" value={c.title} onChange={(e) => onChange({ ...c, title: e.target.value })} sx={{ gridColumn: "span 2" }} />
          <TextField label="Currency" value={c.currency} onChange={(e) => onChange({ ...c, currency: e.target.value })} />
        </Box>

        <Typography variant="subtitle2" sx={{ mb: 1 }}>Cost heads</Typography>
        <Stack spacing={1.5}>
          {c.lines.map((l, i) => (
            <Paper key={i} variant="outlined" sx={{ p: 1.5 }}>
              <Box sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 150px auto", gap: 1.5, alignItems: "center", mb: 1.5 }}>
                <TextField label="Name" fullWidth value={l.head} onChange={(e) => setLine(i, { head: e.target.value })} />
                <TextField select label="Type" value={l.kind ?? "mixed"} onChange={(e) => setKind(i, e.target.value as CostKind)}>
                  <MenuItem value="mixed">Custom</MenuItem>
                  <MenuItem value="one_time">One-time</MenuItem>
                  <MenuItem value="recurring">Recurring</MenuItem>
                </TextField>
                <IconButton aria-label="remove cost line" onClick={() => onChange({ ...c, lines: c.lines.filter((_, k) => k !== i) })}><DeleteOutline /></IconButton>
              </Box>
              <Box sx={grid(110)}>
                {c.years.map((y, k) => (
                  <TextField key={y} label={y} type="number" value={l.values[k] ?? 0} onChange={(e) => setVal(i, k, num(e.target.value))} />
                ))}
                <Stat label="Total" value={money(c.currency, l.values.reduce((a, b) => a + b, 0))} strong />
              </Box>
            </Paper>
          ))}
        </Stack>
        <Button startIcon={<Add />} sx={{ mt: 1 }}
          onClick={() => onChange({ ...c, lines: [...c.lines, { head: "New cost head", values: c.years.map(() => 0), kind: "mixed" }] })}>Add cost head</Button>

        <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>Manual benefits per year</Typography>
        <Box sx={grid(110)}>
          {c.years.map((y, k) => (
            <TextField key={y} label={y} type="number" value={c.benefits?.[k] ?? 0}
              onChange={(e) => {
                const cur = c.years.map((_, j) => c.benefits?.[j] ?? 0);
                cur[k] = num(e.target.value);
                onChange({ ...c, benefits: cur });
              }} />
          ))}
        </Box>
      </Section>

      <Section title="Benefit drivers" actions={
        <Stack direction="row" spacing={1}>
        <AiAssist<any[]> task="benefits" label="Suggest drivers" placeholder="State the volumes, minutes per item and hourly rate you know; unknown figures stay 0…"
          onAccept={(ds) => onChange({ ...c, drivers: [...(c.drivers ?? []), ...ds.map((d) => ({ ...d, ramp: [] }))] })} />
        <Button startIcon={<Add />} onClick={() => onChange({ ...c, drivers: [...(c.drivers ?? []), {
          name: "New driver", annual_volume: 0, minutes_saved: 0, hourly_rate: 0, success_rate: 1, ramp: [] }] })}>Add driver</Button>
        </Stack>}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Benefit per year = items × minutes saved ÷ 60 × hourly rate × success rate × ramp-up.
        </Typography>
        <Stack spacing={1.5}>
          {(c.drivers ?? []).map((d, i) => {
            const vals = driverValues(d, n);
            return (
              <Paper key={i} variant="outlined" sx={{ p: 1.5 }}>
                <Box sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 1.5, alignItems: "center", mb: 1.5 }}>
                  <TextField label="Name" fullWidth value={d.name} onChange={(e) => setDriver(i, { name: e.target.value })} />
                  <IconButton aria-label="remove driver" onClick={() => {
                    const rest = (c.drivers ?? []).filter((_, k) => k !== i);
                    onChange({ ...c, drivers: rest, benefits: !rest.length && !c.benefits?.length ? c.years.map(() => 0) : c.benefits });
                  }}><DeleteOutline /></IconButton>
                </Box>
                <Box sx={{ ...grid(140), mb: 1.5 }}>
                  <TextField label="Items / year" type="number" value={d.annual_volume} onChange={(e) => setDriver(i, { annual_volume: Math.max(0, num(e.target.value)) })} />
                  <TextField label="Minutes saved / item" type="number" value={d.minutes_saved} onChange={(e) => setDriver(i, { minutes_saved: Math.max(0, num(e.target.value)) })} />
                  <TextField label={`Rate / hour (${c.currency})`} type="number" value={d.hourly_rate} onChange={(e) => setDriver(i, { hourly_rate: Math.max(0, num(e.target.value)) })} />
                  <TextField label="Success %" type="number" value={Math.round(d.success_rate * 100)}
                    onChange={(e) => setDriver(i, { success_rate: Math.min(100, Math.max(0, num(e.target.value))) / 100 })} />
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.75 }}>Ramp-up (share of full benefit per year)</Typography>
                <Box sx={{ ...grid(110), mb: 1.5 }}>
                  {c.years.map((y, k) => (
                    <TextField key={y} label={y} type="number" inputProps={{ step: 0.1, min: 0 }} value={d.ramp.length ? d.ramp[k] ?? 0 : 1}
                      onChange={(e) => {
                        const cur = c.years.map((_, j) => (d.ramp.length ? d.ramp[j] ?? 0 : 1));
                        cur[k] = Math.max(0, num(e.target.value));
                        setDriver(i, { ramp: cur });
                      }} />
                  ))}
                </Box>
                <Box sx={grid(110)}>
                  {vals.map((v, k) => <Stat key={k} label={`${c.years[k]} benefit`} value={money(c.currency, Math.round(v))} />)}
                </Box>
              </Paper>
            );
          })}
          {(c.drivers ?? []).length === 0 && <Typography color="text.secondary">No drivers: benefits come from the manual row above.</Typography>}
        </Stack>
      </Section>

      <Section title="Summary">
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell />
                {c.years.map((y) => <TableCell key={y} align="right">{y}</TableCell>)}
                <TableCell align="right">Total</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow><TableCell>Total cost</TableCell>
                {s.yearTotals.map((t, i) => <TableCell key={i} align="right">{money(c.currency, t)}</TableCell>)}
                <TableCell align="right" sx={{ fontWeight: 700 }}>{money(c.currency, s.totalCost)}</TableCell></TableRow>
              <TableRow><TableCell>Total benefits</TableCell>
                {s.benefits.map((b, i) => <TableCell key={i} align="right">{money(c.currency, Math.round(b))}</TableCell>)}
                <TableCell align="right" sx={{ fontWeight: 700 }}>{money(c.currency, Math.round(s.totalBenefit))}</TableCell></TableRow>
            </TableBody>
          </Table>
        </Box>
        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
          <Chip color="secondary" label={`CBA ${s.cba.toFixed(1)}x`} />
          {s.oneTime > 0 && <Chip variant="outlined" label={`One-time ${money(c.currency, s.oneTime)}`} />}
          {s.recurring > 0 && <Chip variant="outlined" label={`Recurring ${money(c.currency, s.recurring)}`} />}
        </Stack>
      </Section>
    </>
  );
}

// ------------------------------------------------------------ assumptions
export function AssumptionsEditor({ a, onChange, library, deckContext }: { a: Assumptions; onChange: (a: Assumptions) => void; library: Record<string, string[]>; deckContext?: string }) {
  const [draft, setDraft] = useState("");
  const add = (t: string) => !a.items.includes(t) && onChange({ ...a, items: [...a.items, t] });
  return (
    <>
      <Section title="Assumptions" actions={
        <Stack direction="row" spacing={1} alignItems="center">
          <AiAssist<string[]> task="assumptions" label="Suggest with AI" placeholder="Describe the process, scope and systems involved…"
            context={{ existing: a.items, deckContext }}
            onAccept={(items) => onChange({ ...a, items: [...a.items, ...items.filter((t) => !a.items.includes(t))] })} />
          <FormControlLabel control={<Switch checked={a.numbered} onChange={(e) => onChange({ ...a, numbered: e.target.checked })} />} label="Numbered" />
        </Stack>}>
        <TextField label="Title" fullWidth value={a.title} onChange={(e) => onChange({ ...a, title: e.target.value })} sx={{ mb: 2 }} />
        <Stack spacing={1}>
          {a.items.map((t, i) => (
            <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
              <Typography sx={{ pt: 1, width: 28 }} color="text.secondary">{i + 1}.</Typography>
              <TextField fullWidth multiline value={t} onChange={(e) => onChange({ ...a, items: a.items.map((x, k) => (k === i ? e.target.value : x)) })} />
              <IconButton aria-label="remove assumption" onClick={() => onChange({ ...a, items: a.items.filter((_, k) => k !== i) })}><DeleteOutline /></IconButton>
            </Stack>
          ))}
        </Stack>
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <TextField fullWidth placeholder="Add your own assumption" value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { add(draft.trim()); setDraft(""); } }} />
          <Button variant="contained" disabled={!draft.trim()} onClick={() => { add(draft.trim()); setDraft(""); }}>Add</Button>
        </Stack>
      </Section>
      <Section title="Assumption library">
        {Object.entries(library).map(([cat, items]) => (
          <Accordion key={cat} disableGutters variant="outlined">
            <AccordionSummary expandIcon={<ExpandMore />}>{cat}</AccordionSummary>
            <AccordionDetails>
              <Stack spacing={1}>
                {items.map((t) => (
                  <Stack key={t} direction="row" spacing={1} alignItems="center">
                    <Typography variant="body2" sx={{ flex: 1 }}>{t}</Typography>
                    <Button size="small" disabled={a.items.includes(t)} onClick={() => add(t)}>{a.items.includes(t) ? "Added" : "Add"}</Button>
                  </Stack>
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>
        ))}
      </Section>
    </>
  );
}

// ------------------------------------------------------------------- flow
const nextNodeId = (ids: string[]) => {
  let k = ids.length + 1;
  while (ids.includes(`n${k}`)) k++;
  return `n${k}`;
};

export function FlowEditor({ f, onChange, deckContext, asIsText }: { f: Flow; onChange: (f: Flow) => void; deckContext?: string; asIsText?: string }) {
  const init = useMemo(() => flowToText(f), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [nodesTxt, setNodes] = useState(init.nodes);
  const [edgesTxt, setEdges] = useState(init.edges);
  const [sel, setSel] = useState<Selection>(null);
  const parsed = useMemo(() => parseFlow(nodesTxt, edgesTxt), [nodesTxt, edgesTxt]);
  useEffect(() => {
    if (parsed.errors.length) return;
    // Skip no-op syncs (e.g. on mount) so they do not create undo steps.
    const same = JSON.stringify([f.nodes, f.edges]) === JSON.stringify([parsed.nodes, parsed.edges]);
    if (!same) onChange({ ...f, nodes: parsed.nodes, edges: parsed.edges });
  }, [parsed]); // eslint-disable-line react-hooks/exhaustive-deps

  const nodes = parsed.errors.length ? f.nodes : parsed.nodes;
  const edges = parsed.errors.length ? f.edges : parsed.edges;
  const graph = { ...f, nodes, edges };

  /** Single write path for canvas edits: keeps the text editors and the deck in sync. */
  const apply = (n: FlowNode[], ed: FlowEdge[], patch: Partial<Flow> = {}) => {
    const t = flowToText({ ...f, nodes: n, edges: ed });
    setNodes(t.nodes);
    setEdges(t.edges);
    onChange({ ...f, ...patch, nodes: n, edges: ed });
  };

  const selNode = sel?.kind === "node" ? nodes.find((n) => n.id === sel.id) : undefined;
  const selEdge = sel?.kind === "edge" ? edges[sel.index] : undefined;

  const addNode = (from?: string) => {
    const src = from ? nodes.find((n) => n.id === from) : selNode;
    const id = nextNodeId(nodes.map((n) => n.id));
    const node: FlowNode = { id, kind: "process", label: "New step", ...(src?.lane ? { lane: src.lane } : {}) };
    const ed = src ? [...edges, { src: src.id, dst: id, label: src.kind === "decision" ? (edges.some((e) => e.src === src.id) ? "No" : "Yes") : "" }] : edges;
    apply([...nodes, node], ed);
    setSel({ kind: "node", id });
  };
  const connect = (src: string, dst: string) => {
    if (edges.some((e) => e.src === src && e.dst === dst)) return;
    const s = nodes.find((n) => n.id === src);
    const label = s?.kind === "decision" ? (edges.some((e) => e.src === src) ? "No" : "Yes") : "";
    apply(nodes, [...edges, { src, dst, label }]);
    setSel({ kind: "edge", index: edges.length });
  };
  const patchNode = (id: string, patch: Partial<FlowNode>) => {
    const next = nodes.map((n) => {
      if (n.id !== id) return n;
      const m = { ...n, ...patch };
      if (!m.lane) delete m.lane;
      return m;
    });
    apply(next, edges);
  };
  const removeNode = (id: string) => {
    apply(nodes.filter((n) => n.id !== id), edges.filter((e) => e.src !== id && e.dst !== id));
    setSel(null);
  };
  const patchEdge = (i: number, patch: Partial<FlowEdge>) => apply(nodes, edges.map((e, k) => (k === i ? { ...e, ...patch } : e)));
  const lanes = Array.from(new Set(nodes.map((n) => n.lane).filter(Boolean) as string[]));

  return (
    <>
      <Section title="Flow" actions={
        <Stack direction="row" spacing={0.5}>
          <AiAssist<Flow> task="tobe" label="Draft To-Be from As-Is" initialText={asIsText}
            placeholder="Paste or describe the AS-IS manual process. Mention expected success rates only if you know them."
            context={{ deckContext }}
            onAccept={(r) => {
              const t = flowToText({ ...f, nodes: r.nodes, edges: r.edges });
              setNodes(t.nodes); setEdges(t.edges); setSel(null);
              onChange({ ...f, title: r.title || f.title, nodes: r.nodes, edges: r.edges, notes: r.notes?.length ? r.notes : f.notes, lanes: r.lanes ?? [] });
            }} />
          <AiAssist<Flow> task="flow" label="Draft flow with AI" placeholder="Describe the process step by step, including decisions…"
            context={{ deckContext }}
            onAccept={(r) => {
              const t = flowToText({ ...f, nodes: r.nodes, edges: r.edges });
              setNodes(t.nodes); setEdges(t.edges); setSel(null);
              onChange({ ...f, title: r.title || f.title, nodes: r.nodes, edges: r.edges, notes: r.notes?.length ? r.notes : f.notes });
            }} />
        </Stack>}>
        <TextField label="Title" fullWidth value={f.title} onChange={(e) => onChange({ ...f, title: e.target.value })} sx={{ mb: 2 }} />
        <TextField label="Footnotes (one per line)" multiline fullWidth value={f.notes.join("\n")}
          onChange={(e) => onChange({ ...f, notes: e.target.value.split("\n").filter((x) => x.trim()) })} />
      </Section>

      <Section title="Canvas" actions={<Button startIcon={<Add />} onClick={() => addNode()}>{selNode ? "Add next step" : "Add step"}</Button>}>
        <FlowPreview flow={graph} interactive selection={sel} onSelect={setSel} onConnect={connect} onDropNew={(src) => addNode(src)} />
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          Click a step or arrow to edit it. With a step selected, drag its blue handle onto another step to connect, or onto empty
          space to add a new step. Layout is automatic and identical in the exported .pptx.
        </Typography>

        {selNode && (
          <Paper variant="outlined" sx={{ p: 1.5, mt: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Step {selNode.id}</Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 1.5 }}>
              <TextField label="Label" value={selNode.label} onChange={(e) => patchNode(selNode.id, { label: e.target.value })} />
              <TextField select label="Kind" value={selNode.kind} onChange={(e) => patchNode(selNode.id, { kind: e.target.value as NodeKind })}>
                {KINDS.map((k) => <MenuItem key={k} value={k}>{k}</MenuItem>)}
              </TextField>
              <TextField label="Lane (optional)" value={selNode.lane ?? ""} helperText={lanes.length ? `Lanes: ${lanes.join(", ")}` : "Adds swimlanes"}
                onChange={(e) => patchNode(selNode.id, { lane: e.target.value })} />
            </Box>
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <Button size="small" startIcon={<Add />} onClick={() => addNode(selNode.id)}>Add next step</Button>
              <Button size="small" color="error" startIcon={<DeleteOutline />} onClick={() => removeNode(selNode.id)}>Delete step</Button>
            </Stack>
          </Paper>
        )}
        {selEdge && sel?.kind === "edge" && (
          <Paper variant="outlined" sx={{ p: 1.5, mt: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Arrow {nodes.find((n) => n.id === selEdge.src)?.label} → {nodes.find((n) => n.id === selEdge.dst)?.label}
            </Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 1.5 }}>
              <TextField label="Label (e.g. Yes / No)" value={selEdge.label} onChange={(e) => patchEdge(sel.index, { label: e.target.value })} />
              <TextField label="Tag (e.g. ~60-70% success expected)" value={selEdge.note ?? ""} onChange={(e) => patchEdge(sel.index, { note: e.target.value })} />
            </Box>
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <Button size="small" onClick={() => patchEdge(sel.index, { src: selEdge.dst, dst: selEdge.src })}>Reverse</Button>
              <Button size="small" color="error" startIcon={<DeleteOutline />}
                onClick={() => { apply(nodes, edges.filter((_, k) => k !== sel.index)); setSel(null); }}>Delete arrow</Button>
            </Stack>
          </Paper>
        )}
      </Section>

      <Accordion disableGutters variant="outlined" sx={{ mb: 2.5 }}>
        <AccordionSummary expandIcon={<ExpandMore />}>Edit as text</AccordionSummary>
        <AccordionDetails>
          <Typography variant="caption" color="text.secondary">Steps — one per line: id | kind | label @ lane (lane optional; kinds: {KINDS.join(", ")})</Typography>
          <TextField multiline minRows={6} fullWidth value={nodesTxt} onChange={(e) => setNodes(e.target.value)}
            sx={{ mb: 2, mt: 0.5, "& textarea": { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13 } }} />
          <Typography variant="caption" color="text.secondary">Connections — one per line: from -&gt; to : label | tag</Typography>
          <TextField multiline minRows={5} fullWidth value={edgesTxt} onChange={(e) => setEdges(e.target.value)}
            sx={{ mt: 0.5, "& textarea": { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13 } }} />
          {parsed.errors.map((er) => <Typography key={er} color="error" variant="body2" sx={{ mt: 1 }}>{er}</Typography>)}
        </AccordionDetails>
      </Accordion>
    </>
  );
}

// ---------------------------------------------------------------- bullets
export function BulletsEditor({ title, bullets, onChange, deckContext }: { title: string; bullets: string[]; onChange: (t: string, b: string[]) => void; deckContext?: string }) {
  return (
    <Section title="Bullets" actions={
      <AiAssist<{ title: string; bullets: string[] }> task="bullets" label="Draft with AI" placeholder="Paste the context to summarize…"
        context={{ deckContext }}
        onAccept={(r) => onChange(r.title || title, [...bullets.filter((b) => b.trim()), ...r.bullets])} />}>
      <TextField label="Title" fullWidth value={title} onChange={(e) => onChange(e.target.value, bullets)} sx={{ mb: 2 }} />
      <TextField label="Bullets (one per line)" multiline minRows={6} fullWidth value={bullets.join("\n")}
        onChange={(e) => onChange(title, e.target.value.split("\n"))} />
    </Section>
  );
}
