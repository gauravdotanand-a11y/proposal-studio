import { useEffect, useRef, useState } from "react";
import {
  Alert, Box, Button, Card, CardActionArea, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
  IconButton, MenuItem, Stack, Switch, Tab, Tabs, TextField, Tooltip, Typography, CircularProgress,
} from "@mui/material";
import UploadFile from "@mui/icons-material/UploadFileOutlined";
import DeleteOutline from "@mui/icons-material/DeleteOutline";
import EditOutlined from "@mui/icons-material/EditOutlined";
import FileDownload from "@mui/icons-material/FileDownloadOutlined";
import Check from "@mui/icons-material/CheckCircle";
import { api, type ExportOpts, type Preset, type TemplateInfo, type TemplatePreview, type TemplateRow } from "./api";
import { LayoutThumbs } from "./LayoutThumbs";

interface Props {
  open: boolean;
  onClose: () => void;
  opts: ExportOpts;
  onChange: (o: ExportOpts) => void;
}

const slug = (f: string) => f.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 64) || "template";
const NO_TEMPLATE = { template: "", titleLayout: null, contentLayout: null };

function Swatches({ colors }: { colors: string[] }) {
  return (
    <Stack direction="row" spacing={0.5}>
      {colors.map((c, i) => <Box key={i} sx={{ width: 22, height: 22, borderRadius: 1, bgcolor: `#${c}`, border: 1, borderColor: "divider" }} />)}
    </Stack>
  );
}

function PresetCard({ p, selected, onPick }: { p: Preset; selected: boolean; onPick: () => void }) {
  const c = p.colors;
  return (
    <Card variant="outlined" sx={{ borderWidth: 2, borderColor: selected ? "primary.main" : "divider" }}>
      <CardActionArea onClick={onPick} sx={{ p: 1.5 }} aria-pressed={selected}>
        {/* miniature slide: title bar, two boxes, accent bar, in the look's own colours */}
        <Box sx={{ bgcolor: "#fff", borderRadius: 1, border: 1, borderColor: "divider", p: 1, mb: 1.25, height: 78 }}>
          <Box sx={{ width: "55%", height: 8, bgcolor: `#${c.NAVY}`, borderRadius: 0.5, mb: 1 }} />
          <Stack direction="row" spacing={0.75}>
            <Box sx={{ flex: 1, height: 30, bgcolor: `#${c.TEAL}`, borderRadius: 1 }} />
            <Box sx={{ flex: 1, height: 30, bgcolor: `#${c.ORANGE}`, borderRadius: 1 }} />
            <Box sx={{ flex: 1, height: 30, bgcolor: `#${c.TEAL_DARK}`, borderRadius: 1 }} />
          </Stack>
        </Box>
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <Typography sx={{ fontWeight: 700, flex: 1, fontFamily: p.font }}>{p.label}</Typography>
          {selected && <Check color="primary" fontSize="small" />}
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", minHeight: 32 }}>{p.description}</Typography>
        <Typography variant="caption" color="text.secondary">Font: {p.font}</Typography>
      </CardActionArea>
    </Card>
  );
}

export function TemplateDialog({ open, onClose, opts, onChange }: Props) {
  const [tab, setTab] = useState(0);
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [info, setInfo] = useState<TemplateInfo | null>(null);
  const [prev, setPrev] = useState<TemplatePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const file = useRef<HTMLInputElement>(null);

  const refresh = () => api.templateDetails().then((r) => {
    setRows(r);
    if (opts.template && !r.some((x) => x.name === opts.template)) onChange({ ...opts, ...NO_TEMPLATE });
  }).catch(() => setRows([]));

  useEffect(() => {
    if (!open) return;
    setTab(opts.template ? 1 : 0);
    refresh();
    api.presets().then(setPresets).catch(() => setPresets([]));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open || !opts.template) { setInfo(null); setPrev(null); return; }
    api.templateInfo(opts.template).then(setInfo).catch(() => setInfo(null));
    api.templatePreview(opts.template).then(setPrev).catch(() => setPrev(null));
  }, [open, opts.template]);

  const upload = async (f: File) => {
    setBusy(true); setErr("");
    try {
      let name = slug(f.name);
      if (rows.some((r) => r.name === name)) {  // never silently overwrite another template
        let k = 2;
        while (rows.some((r) => r.name === `${name}-${k}`)) k++;
        name = `${name}-${k}`;
      }
      const i = await api.uploadTemplate(name, f);
      await refresh();
      setInfo(i);
      onChange({ ...opts, template: name, titleLayout: null, contentLayout: null });
    } catch (e) { setErr(String(e)); } finally { setBusy(false); if (file.current) file.current.value = ""; }
  };
  const remove = async (name: string) => {
    if (!window.confirm(`Delete template "${name}" from this computer?`)) return;
    await api.deleteTemplate(name).catch(() => {});
    if (opts.template === name) onChange({ ...opts, ...NO_TEMPLATE });
    refresh();
  };
  const rename = async (name: string) => {
    const to = slug(newName);
    setErr("");
    try {
      await api.renameTemplate(name, to);
      if (opts.template === name) onChange({ ...opts, template: to });
      setRenaming(null);
      refresh();
    } catch (e) { setErr(String(e)); }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Slide template and look</DialogTitle>
      <DialogContent>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
          <Tab label="Built-in looks" />
          <Tab label={`My templates (${rows.length})`} />
        </Tabs>
        {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}

        {tab === 0 && (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Ready-made colour and font sets for decks without a corporate template. All shapes stay native and editable.
              {opts.template && " A custom template is currently selected and takes priority; picking a look switches back to built-in."}
            </Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 1.5 }}>
              {presets.map((p) => (
                <PresetCard key={p.id} p={p} selected={!opts.template && opts.preset === p.id}
                  onPick={() => onChange({ ...opts, ...NO_TEMPLATE, preset: p.id })} />
              ))}
            </Box>
          </Stack>
        )}

        {tab === 1 && (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                Upload your corporate .pptx or .potx. Exports use its slide master, layouts, fonts and footer.
                Files are stored only on this computer.
              </Typography>
              <input ref={file} type="file" hidden accept=".pptx,.potx" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              <Button variant="outlined" startIcon={busy ? <CircularProgress size={16} /> : <UploadFile />} disabled={busy}
                onClick={() => file.current?.click()} sx={{ whiteSpace: "nowrap" }}>Upload template</Button>
            </Stack>

            {rows.length === 0 && <Box sx={{ color: "text.secondary", fontSize: 13 }}>No templates uploaded yet.</Box>}
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 1.5 }}>
              {rows.map((r) => {
                const sel = opts.template === r.name;
                return (
                  <Card key={r.name} variant="outlined" sx={{ borderWidth: 2, borderColor: sel ? "primary.main" : "divider" }}>
                    <CardActionArea disabled={!r.ok} sx={{ p: 1.5 }} aria-pressed={sel}
                      onClick={() => onChange({ ...opts, template: r.name, titleLayout: null, contentLayout: null })}>
                      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.5 }}>
                        {renaming === r.name ? (
                          <TextField size="small" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") rename(r.name); if (e.key === "Escape") setRenaming(null); }} />
                        ) : (
                          <Typography noWrap sx={{ fontWeight: 700, flex: 1 }}>{r.name}</Typography>
                        )}
                        {sel && <Check color="primary" fontSize="small" />}
                      </Stack>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
                        {r.colors && <Swatches colors={Object.values(r.colors).slice(0, 6)} />}
                      </Stack>
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                        {r.ok ? `${r.slide_w_in} × ${r.slide_h_in} in · ${r.layouts} layouts · ${r.size_kb} KB` : "Unreadable file"}
                        {" · "}{new Date(r.modified * 1000).toLocaleDateString()}
                      </Typography>
                      {r.warnings.length > 0 && <Chip size="small" color="warning" variant="outlined" label={`${r.warnings.length} warning(s)`} sx={{ mt: 0.75 }} />}
                    </CardActionArea>
                    <Stack direction="row" justifyContent="flex-end" sx={{ px: 1, pb: 0.5 }}>
                      {renaming === r.name
                        ? <Button size="small" onClick={() => rename(r.name)}>Save name</Button>
                        : <Tooltip title="Rename"><IconButton size="small" aria-label={`rename ${r.name}`} onClick={() => { setRenaming(r.name); setNewName(r.name); }}><EditOutlined fontSize="small" /></IconButton></Tooltip>}
                      <Tooltip title="Download .pptx"><IconButton size="small" component="a" href={`/api/templates/${encodeURIComponent(r.name)}/file`} aria-label={`download ${r.name}`}><FileDownload fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Delete"><IconButton size="small" aria-label={`delete ${r.name}`} onClick={() => remove(r.name)}><DeleteOutline fontSize="small" /></IconButton></Tooltip>
                    </Stack>
                  </Card>
                );
              })}
            </Box>

            {info && opts.template && (
              <Stack spacing={2} sx={{ pt: 1 }}>
                <Typography variant="subtitle2">Layouts for “{opts.template}”</Typography>
                {info.warnings.map((w) => <Alert key={w} severity="warning">{w}</Alert>)}
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                  <TextField select fullWidth label="Title slide layout" value={opts.titleLayout ?? info.title_layout}
                    onChange={(e) => onChange({ ...opts, titleLayout: Number(e.target.value) })}>
                    {info.layouts.map((l) => <MenuItem key={l.index} value={l.index}>{l.name}</MenuItem>)}
                  </TextField>
                  <TextField select fullWidth label="Content slide layout" value={opts.contentLayout ?? info.content_layout}
                    onChange={(e) => onChange({ ...opts, contentLayout: Number(e.target.value) })}>
                    {info.layouts.map((l) => <MenuItem key={l.index} value={l.index}>{l.name}</MenuItem>)}
                  </TextField>
                </Stack>
                {prev && (
                  <>
                    <LayoutThumbs data={prev}
                      titleLayout={opts.titleLayout ?? info.title_layout} contentLayout={opts.contentLayout ?? info.content_layout}
                      onPick={(role, index) => onChange(role === "title" ? { ...opts, titleLayout: index } : { ...opts, contentLayout: index })} />
                    <Typography variant="caption" color="text.secondary">
                      Schematic preview from the template's layout geometry; fonts and exact rendering appear in the exported deck.
                      Content layout should be a "title only" style layout.
                    </Typography>
                  </>
                )}
                <FormControlLabel control={<Switch checked={opts.useThemeColors}
                  onChange={(e) => onChange({ ...opts, useThemeColors: e.target.checked })} />}
                  label="Use the template's theme colors for diagrams and tables" />
              </Stack>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {opts.template && <Button onClick={() => onChange({ ...opts, ...NO_TEMPLATE })}>Use a built-in look instead</Button>}
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
