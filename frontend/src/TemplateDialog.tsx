import { useEffect, useRef, useState } from "react";
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem,
  Stack, Switch, TextField, Typography, CircularProgress,
} from "@mui/material";
import UploadFile from "@mui/icons-material/UploadFileOutlined";
import DeleteOutline from "@mui/icons-material/DeleteOutline";
import { api, type ExportOpts, type TemplateInfo, type TemplatePreview } from "./api";
import { LayoutThumbs } from "./LayoutThumbs";

interface Props {
  open: boolean;
  onClose: () => void;
  opts: ExportOpts;
  onChange: (o: ExportOpts) => void;
}

const slug = (f: string) => f.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 64) || "template";

export function TemplateDialog({ open, onClose, opts, onChange }: Props) {
  const [names, setNames] = useState<string[]>([]);
  const [info, setInfo] = useState<TemplateInfo | null>(null);
  const [prev, setPrev] = useState<TemplatePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);

  const refresh = () => api.templates().then((n) => {
    setNames(n);
    if (opts.template && !n.includes(opts.template)) onChange({ ...opts, template: "", titleLayout: null, contentLayout: null });
  }).catch(() => setNames([]));
  useEffect(() => { if (open) refresh(); }, [open]);
  useEffect(() => {
    if (!open || !opts.template) { setInfo(null); setPrev(null); return; }
    api.templateInfo(opts.template).then(setInfo).catch(() => setInfo(null));
    api.templatePreview(opts.template).then(setPrev).catch(() => setPrev(null));
  }, [open, opts.template]);

  const upload = async (f: File) => {
    setBusy(true); setErr("");
    try {
      const name = slug(f.name);
      const i = await api.uploadTemplate(name, f);
      await refresh();
      setInfo(i);
      api.templatePreview(name).then(setPrev).catch(() => setPrev(null));
      onChange({ ...opts, template: name, titleLayout: null, contentLayout: null });
    } catch (e) { setErr(String(e)); } finally { setBusy(false); if (file.current) file.current.value = ""; }
  };
  const remove = async () => {
    if (!opts.template) return;
    await api.deleteTemplate(opts.template).catch(() => {});
    onChange({ ...opts, template: "", titleLayout: null, contentLayout: null });
    refresh();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Slide template</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Upload your corporate .pptx or .potx. Exports use its slide master, layouts, fonts and footer. The file is stored only on this computer.
          </Typography>
          {err && <Alert severity="error">{err}</Alert>}
          <Stack direction="row" spacing={1}>
            <TextField select fullWidth label="Template" value={opts.template} InputLabelProps={{ shrink: true }} SelectProps={{ displayEmpty: true }}
              onChange={(e) => onChange({ ...opts, template: e.target.value, titleLayout: null, contentLayout: null })}>
              <MenuItem value="">Built-in look-alike theme</MenuItem>
              {names.map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
            </TextField>
            <input ref={file} type="file" hidden accept=".pptx,.potx"
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            <Button variant="outlined" startIcon={busy ? <CircularProgress size={16} /> : <UploadFile />} disabled={busy}
              onClick={() => file.current?.click()} sx={{ whiteSpace: "nowrap" }}>Upload</Button>
          </Stack>

          {info && (
            <>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Chip size="small" label={`${info.slide_w_in} × ${info.slide_h_in} in`} />
                {Object.entries(info.colors).filter(([k]) => k.startsWith("accent") || k === "dk2").map(([k, v]) => (
                  <Chip key={k} size="small" label={k} sx={{ bgcolor: `#${v}`, color: "#fff", textShadow: "0 0 2px rgba(0,0,0,.6)" }} />
                ))}
              </Stack>
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
                    Schematic preview from the template's layout geometry (placeholders in blue, master decoration and logos shown);
                    fonts and exact rendering appear in the exported deck.
                  </Typography>
                </>
              )}
              <Typography variant="caption" color="text.secondary">
                Content layout should be a "title only" style layout; diagrams, tables and bullets are placed below its title.
              </Typography>
              <FormControlLabel control={<Switch checked={opts.useThemeColors}
                onChange={(e) => onChange({ ...opts, useThemeColors: e.target.checked })} />}
                label="Use the template's theme colors for diagrams and tables" />
            </>
          )}
          {!opts.template && <Box sx={{ color: "text.secondary", fontSize: 13 }}>No template selected: the built-in theme is used.</Box>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {opts.template && <Button color="error" startIcon={<DeleteOutline />} onClick={remove}>Remove template</Button>}
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
