import { useState } from "react";
import { Box, Button, Chip, IconButton, MenuItem, Stack, Tab, Tabs, TextField, Typography } from "@mui/material";
import Add from "@mui/icons-material/Add";
import DeleteOutline from "@mui/icons-material/DeleteOutline";
import { GanttEditor, Section } from "./editors";
import { AiAssist } from "./AiAssist";
import type { Compare, NextSteps, Risks, ScopeSpec } from "./types";

// -------------------------------------------------------------- compare
export function CompareEditor({ c, onChange }: { c: Compare; onChange: (c: Compare) => void }) {
  const [tab, setTab] = useState(0);
  const weeks = (g: Compare["previous"]) => g.weeks || Math.max(1, ...g.activities.map((a) => a.end_week));
  const old = new Map(c.previous.activities.map((a) => [a.name, `${a.start_week}-${a.end_week}`]));
  const changed = c.updated.activities.filter((a) => old.get(a.name) !== `${a.start_week}-${a.end_week}`).map((a) => a.name);
  const delta = weeks(c.updated) - weeks(c.previous);
  const g = tab === 0 ? c.previous : c.updated;
  return (
    <>
      <Section title="Plan revision">
        <Stack direction="row" flexWrap="wrap" useFlexGap spacing={2} sx={{ mb: 2 }}>
          <TextField label="Slide title" sx={{ flex: "2 1 240px" }} value={c.title} onChange={(e) => onChange({ ...c, title: e.target.value })} />
          <TextField label="Previous label" sx={{ flex: "1 1 180px" }} value={c.previous_label} onChange={(e) => onChange({ ...c, previous_label: e.target.value })} />
          <TextField label="Updated label" sx={{ flex: "1 1 180px" }} value={c.updated_label} onChange={(e) => onChange({ ...c, updated_label: e.target.value })} />
        </Stack>
        <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
          <Chip color={delta > 0 ? "warning" : "default"} label={delta === 0 ? "Same duration" : `${delta > 0 ? "+" : ""}${delta} week(s)`} />
          {changed.map((n) => <Chip key={n} size="small" variant="outlined" label={n} />)}
          {changed.length === 0 && <Typography variant="body2" color="text.secondary">No activities changed yet.</Typography>}
        </Stack>
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Button size="small" variant="outlined"
            onClick={() => onChange({ ...c, updated: JSON.parse(JSON.stringify({ ...c.previous, title: c.updated.title })) })}>
            Copy previous into updated
          </Button>
        </Stack>
      </Section>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label={c.previous_label || "Previous"} />
        <Tab label={c.updated_label || "Updated"} />
      </Tabs>
      <GanttEditor key={tab} g={g} onChange={(ng) => onChange(tab === 0 ? { ...c, previous: ng } : { ...c, updated: ng })} />
    </>
  );
}

// ---------------------------------------------------------------- scope
function ListColumn({ title, items, onChange }: { title: string; items: string[]; onChange: (i: string[]) => void }) {
  return (
    <Box sx={{ flex: 1 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>{title}</Typography>
      <Stack spacing={1}>
        {items.map((t, i) => (
          <Stack key={i} direction="row" spacing={1}>
            <TextField fullWidth multiline value={t} onChange={(e) => onChange(items.map((x, k) => (k === i ? e.target.value : x)))} />
            <IconButton aria-label="remove item" onClick={() => onChange(items.filter((_, k) => k !== i))}><DeleteOutline /></IconButton>
          </Stack>
        ))}
      </Stack>
      <Button startIcon={<Add />} sx={{ mt: 1 }} onClick={() => onChange([...items, ""])}>Add</Button>
    </Box>
  );
}

export function ScopeEditor({ s, onChange }: { s: ScopeSpec; onChange: (s: ScopeSpec) => void }) {
  return (
    <Section title="Scope" actions={
      <AiAssist<{ in_scope: string[]; out_scope: string[] }> task="scope" label="Suggest scope" placeholder="Describe what the solution does and what is not discussed…"
        context={{ existing: [...s.in_scope, ...s.out_scope] }}
        onAccept={(v) => onChange({ ...s, in_scope: [...s.in_scope, ...v.in_scope.filter((x) => !s.in_scope.includes(x))],
          out_scope: [...s.out_scope, ...v.out_scope.filter((x) => !s.out_scope.includes(x))] })} />}>
      <TextField label="Title" fullWidth value={s.title} onChange={(e) => onChange({ ...s, title: e.target.value })} sx={{ mb: 2 }} />
      <Stack direction={{ xs: "column", md: "row" }} spacing={3}>
        <ListColumn title="In scope" items={s.in_scope} onChange={(i) => onChange({ ...s, in_scope: i })} />
        <ListColumn title="Out of scope" items={s.out_scope} onChange={(i) => onChange({ ...s, out_scope: i })} />
      </Stack>
      <TextField label="Footnote" fullWidth value={s.note} onChange={(e) => onChange({ ...s, note: e.target.value })} sx={{ mt: 2 }} />
    </Section>
  );
}

// ---------------------------------------------------------------- risks
export function RisksEditor({ r, onChange }: { r: Risks; onChange: (r: Risks) => void }) {
  const set = (i: number, patch: Partial<Risks["items"][0]>) =>
    onChange({ ...r, items: r.items.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  return (
    <Section title="Risks and dependencies" actions={
      <Stack direction="row" spacing={1}>
      <AiAssist<Risks["items"]> task="risks" label="Suggest risks" placeholder="Describe the process, systems and dependencies…"
        context={{ existing: r.items.map((x) => x.risk) }}
        onAccept={(items) => onChange({ ...r, items: [...r.items, ...items] })} />
      <Button startIcon={<Add />} onClick={() => onChange({ ...r, items: [...r.items, { risk: "", impact: "Medium", mitigation: "" }] })}>Add risk</Button>
      </Stack>}>
      <TextField label="Title" fullWidth value={r.title} onChange={(e) => onChange({ ...r, title: e.target.value })} sx={{ mb: 2 }} />
      <Stack spacing={1.5}>
        {r.items.map((it, i) => (
          <Stack key={i} direction="row" flexWrap="wrap" useFlexGap spacing={1} alignItems="flex-start">
            <TextField label="Risk" multiline sx={{ flex: "2 1 220px" }} value={it.risk} onChange={(e) => set(i, { risk: e.target.value })} />
            <TextField select label="Impact" value={it.impact} sx={{ flex: "0 0 130px" }} onChange={(e) => set(i, { impact: e.target.value as Risks["items"][0]["impact"] })}>
              {["Low", "Medium", "High"].map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
            </TextField>
            <TextField label="Mitigation" multiline sx={{ flex: "2 1 220px" }} value={it.mitigation} onChange={(e) => set(i, { mitigation: e.target.value })} />
            <IconButton aria-label="remove risk" onClick={() => onChange({ ...r, items: r.items.filter((_, k) => k !== i) })}><DeleteOutline /></IconButton>
          </Stack>
        ))}
      </Stack>
    </Section>
  );
}

// ----------------------------------------------------------- next steps
export function NextStepsEditor({ n, onChange }: { n: NextSteps; onChange: (n: NextSteps) => void }) {
  const set = (i: number, patch: Partial<NextSteps["items"][0]>) =>
    onChange({ ...n, items: n.items.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  return (
    <Section title="Next steps" actions={
      <Button startIcon={<Add />} onClick={() => onChange({ ...n, items: [...n.items, { action: "", owner: "", due: "" }] })}>Add step</Button>}>
      <TextField label="Title" fullWidth value={n.title} onChange={(e) => onChange({ ...n, title: e.target.value })} sx={{ mb: 2 }} />
      <Stack spacing={1.5}>
        {n.items.map((it, i) => (
          <Stack key={i} direction="row" flexWrap="wrap" useFlexGap spacing={1} alignItems="flex-start">
            <Typography sx={{ pt: 1, width: 24 }} color="text.secondary">{i + 1}.</Typography>
            <TextField label="Action" multiline sx={{ flex: "3 1 220px" }} value={it.action} onChange={(e) => set(i, { action: e.target.value })} />
            <TextField label="Owner" value={it.owner} sx={{ flex: "1 1 150px" }} onChange={(e) => set(i, { owner: e.target.value })} />
            <TextField label="Due" value={it.due} sx={{ flex: "0 1 130px", minWidth: 100 }} onChange={(e) => set(i, { due: e.target.value })} />
            <IconButton aria-label="remove step" onClick={() => onChange({ ...n, items: n.items.filter((_, k) => k !== i) })}><DeleteOutline /></IconButton>
          </Stack>
        ))}
      </Stack>
    </Section>
  );
}
