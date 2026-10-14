import { Box, Button, IconButton, Paper, Stack, Switch, FormControlLabel, TextField, Typography } from "@mui/material";
import Add from "@mui/icons-material/Add";
import DeleteOutline from "@mui/icons-material/DeleteOutline";
import ArrowForward from "@mui/icons-material/ArrowForward";
import type { Solution } from "./types";

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

export function SolutionEditor({ s, onChange }: { s: Solution; onChange: (s: Solution) => void }) {
  const setStage = (i: number, patch: Partial<Solution["stages"][0]>) =>
    onChange({ ...s, stages: s.stages.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  return (
    <>
      <Section title="Solution overview">
        <TextField label="Title" fullWidth value={s.title} onChange={(e) => onChange({ ...s, title: e.target.value })} />
      </Section>

      <Section title="Pipeline stages" actions={
        <Button startIcon={<Add />} disabled={s.stages.length >= 7}
          onClick={() => onChange({ ...s, stages: [...s.stages, { heading: "", title: "New stage", body: "", ai: false }] })}>Add stage</Button>}>
        <Stack spacing={1.5}>
          {s.stages.map((st, i) => (
            <Paper key={i} variant="outlined" sx={{ p: 1.5 }}>
              <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1.5} alignItems="center">
                <TextField label="Heading" value={st.heading} onChange={(e) => setStage(i, { heading: e.target.value })} sx={{ flex: "1 1 150px", minWidth: 130 }} />
                <TextField label="Box title" value={st.title} onChange={(e) => setStage(i, { title: e.target.value })} sx={{ flex: "1 1 170px", minWidth: 130 }} />
                <TextField label="Description" sx={{ flex: "3 1 260px", minWidth: 200 }} value={st.body} onChange={(e) => setStage(i, { body: e.target.value })} />
                <FormControlLabel control={<Switch checked={st.ai} onChange={(e) => setStage(i, { ai: e.target.checked })} />} label="AI" />
                <IconButton aria-label="remove stage" disabled={s.stages.length <= 1}
                  onClick={() => onChange({ ...s, stages: s.stages.filter((_, k) => k !== i) })}><DeleteOutline /></IconButton>
              </Stack>
            </Paper>
          ))}
        </Stack>
      </Section>

      <Section title="Text blocks (left column)" actions={
        <Button startIcon={<Add />} onClick={() => onChange({ ...s, blocks: [...s.blocks, { heading: "Heading", text: "" }] })}>Add block</Button>}>
        <Stack spacing={1.5}>
          {s.blocks.map((b, i) => (
            <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
              <Stack spacing={1} sx={{ flex: 1 }}>
                <TextField label="Heading" value={b.heading} onChange={(e) => onChange({ ...s, blocks: s.blocks.map((x, k) => (k === i ? { ...x, heading: e.target.value } : x)) })} />
                <TextField label="Text" multiline minRows={2} value={b.text} onChange={(e) => onChange({ ...s, blocks: s.blocks.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)) })} />
              </Stack>
              <IconButton aria-label="remove block" onClick={() => onChange({ ...s, blocks: s.blocks.filter((_, k) => k !== i) })}><DeleteOutline /></IconButton>
            </Stack>
          ))}
        </Stack>
      </Section>

      <Section title="End-to-end steps (right column)" actions={
        <Button startIcon={<Add />} onClick={() => onChange({ ...s, steps: [...s.steps, { label: "", text: "" }] })}>Add step</Button>}>
        <TextField label="Column title" fullWidth value={s.steps_title} onChange={(e) => onChange({ ...s, steps_title: e.target.value })} sx={{ mb: 1.5 }} />
        <Stack spacing={1}>
          {s.steps.map((st, i) => (
            <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
              <Typography sx={{ pt: 1, width: 24 }} color="text.secondary">{i + 1}.</Typography>
              <TextField label="Label" value={st.label} sx={{ width: 150 }} onChange={(e) => onChange({ ...s, steps: s.steps.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
              <TextField label="Text" fullWidth value={st.text} onChange={(e) => onChange({ ...s, steps: s.steps.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)) })} />
              <IconButton aria-label="remove step" onClick={() => onChange({ ...s, steps: s.steps.filter((_, k) => k !== i) })}><DeleteOutline /></IconButton>
            </Stack>
          ))}
        </Stack>
      </Section>

      <Section title="Preview">
        <Box sx={{ borderRadius: 2, border: 1, borderColor: "divider", bgcolor: "#fff", color: "#555", p: 2, overflowX: "auto" }}>
          <Typography sx={{ color: "#1B2A7A", fontWeight: 700, fontSize: 18, mb: 1.5 }}>{s.title}</Typography>
          <Stack direction="row" alignItems="flex-end" spacing={0.5} sx={{ mb: 2 }}>
            {s.stages.map((st, i) => (
              <Stack key={i} direction="row" alignItems="center" spacing={0.5} sx={{ flex: 1, minWidth: 110 }}>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ color: "#1B2A7A", fontWeight: 700, fontSize: 11, textAlign: "center", minHeight: 16 }}>{st.heading}</Typography>
                  <Box sx={{ bgcolor: st.ai ? "#FF4F1F" : "#C9E8EE", color: st.ai ? "#fff" : "#1B2A7A", borderRadius: 2, p: 1, textAlign: "center", minHeight: 78 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: 12 }}>{st.title}</Typography>
                    <Typography sx={{ fontSize: 10 }}>{st.body}</Typography>
                  </Box>
                </Box>
                {i < s.stages.length - 1 && <ArrowForward sx={{ color: "#1B2A7A", fontSize: 18, mt: 2 }} />}
              </Stack>
            ))}
          </Stack>
          <Box sx={{ borderTop: "1px solid #7FC4D2", pt: 1.5, display: "grid", gridTemplateColumns: "46fr 54fr", gap: 3, fontSize: 12 }}>
            <Box>{s.blocks.map((b, i) => <Box key={i} sx={{ mb: 1 }}><b style={{ color: "#1B2A7A" }}>{b.heading}</b><div>{b.text}</div></Box>)}</Box>
            <Box>
              <b style={{ color: "#1B2A7A" }}>{s.steps_title}</b>
              {s.steps.map((st, i) => <div key={i}><b style={{ color: "#1B2A7A" }}>{i + 1}. {st.label ? st.label + ": " : ""}</b>{st.text}</div>)}
            </Box>
          </Box>
        </Box>
      </Section>
    </>
  );
}
