import DragHandle from "@mui/icons-material/DragIndicator";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@mui/material/styles";
import {
  Alert, AppBar, Box, Button, CircularProgress, Divider, Drawer, IconButton, List, ListItemButton, ListItemIcon,
  ListItemText, Menu, MenuItem, Paper, Snackbar, Stack, TextField, Toolbar, Tooltip, Typography, useMediaQuery,
} from "@mui/material";
import Download from "@mui/icons-material/FileDownloadOutlined";
import Save from "@mui/icons-material/SaveOutlined";
import FolderOpen from "@mui/icons-material/FolderOpenOutlined";
import NoteAdd from "@mui/icons-material/NoteAddOutlined";
import Undo from "@mui/icons-material/UndoOutlined";
import Redo from "@mui/icons-material/RedoOutlined";
import AutoAwesome from "@mui/icons-material/AutoAwesomeOutlined";
import WarnIcon from "@mui/icons-material/WarningAmberOutlined";
import MoreVert from "@mui/icons-material/MoreVert";
import Add from "@mui/icons-material/Add";
import Settings from "@mui/icons-material/TuneOutlined";
import MenuIcon from "@mui/icons-material/MenuOutlined";
import Up from "@mui/icons-material/KeyboardArrowUp";
import Down from "@mui/icons-material/KeyboardArrowDown";
import Delete from "@mui/icons-material/DeleteOutline";
import Copy from "@mui/icons-material/ContentCopyOutlined";
import Slideshow from "@mui/icons-material/SlideshowOutlined";
import { api, type ExportOpts } from "./api";
import { TemplateDialog } from "./TemplateDialog";
import { SolutionEditor } from "./SolutionEditor";
import { CompareEditor, NextStepsEditor, RisksEditor, ScopeEditor } from "./MoreEditors";
import { AssumptionsEditor, BulletsEditor, CostEditor, FlowEditor, GanttEditor } from "./editors";
import { SlideThumb } from "./SlideThumb";
import { Wizard } from "./Wizard";
import { DeckDraft } from "./DeckDraft";
import { newSlide, slideTitle } from "./factory";
import { ICON, LABEL } from "./slideMeta";
import { useUndoable } from "./useUndoable";
import type { Proposal, Slide, SlideType } from "./types";

const DRAFT_KEY = "proposal-studio-draft";
const OPTS_KEY = "proposal-studio-export-opts";
const DEFAULT_OPTS: ExportOpts = { template: "", titleLayout: null, contentLayout: null, useThemeColors: true, preset: "corporate" };

function clean(p: Proposal): Proposal {
  return { ...p, slides: p.slides.map((s) => s.type === "bullets" ? { ...s, bullets: (s.bullets ?? []).filter((b) => b.trim()) } : s) };
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

export default function App() {
  const hist = useUndoable<Proposal | null>(null);
  const p = hist.state;
  const setP = hist.set;
  const [sel, setSel] = useState(-1); // -1 = deck settings
  const [lib, setLib] = useState<Record<string, string[]>>({});
  const [name, setName] = useState("my-proposal");
  const [projects, setProjects] = useState<string[]>([]);
  const [addEl, setAddEl] = useState<HTMLElement | null>(null);
  const [openEl, setOpenEl] = useState<HTMLElement | null>(null);
  const [moreEl, setMoreEl] = useState<HTMLElement | null>(null);
  const [canPdf, setCanPdf] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [fitNotes, setFitNotes] = useState<{ slide: number; message: string }[]>([]);
  const [navOpen, setNavOpen] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down("md"));
  const [opts, setOpts] = useState<ExportOpts>(() => {
    try { return { ...DEFAULT_OPTS, ...JSON.parse(localStorage.getItem(OPTS_KEY) || "{}") }; } catch { return DEFAULT_OPTS; }
  });
  const [toast, setToast] = useState<{ msg: string; sev: "success" | "error" } | null>(null);

  useEffect(() => {
    api.library().then(setLib).catch(() => {});
    let draft: Proposal | null = null;
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch { /* ignore */ }
    if (draft?.meta && draft.slides) hist.reset(draft);
    else api.sample().then(hist.reset).catch((e) => setToast({ msg: String(e), sev: "error" }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // A remembered template may have been deleted: fall back to the built-in theme.
    api.templates().then((names) => {
      setOpts((o) => (o.template && !names.includes(o.template) ? { ...o, template: "", titleLayout: null, contentLayout: null } : o));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    try { localStorage.setItem(OPTS_KEY, JSON.stringify(opts)); } catch { /* storage unavailable */ }
  }, [opts]);
  useEffect(() => { api.capabilities().then((c) => setCanPdf(c.pdf)).catch(() => setCanPdf(false)); }, []);

  // Ask the backend how the deck will fit (shrunk text, split slides) so the editor can say so before export.
  useEffect(() => {
    if (!p) return;
    const t = setTimeout(() => { api.fitNotes(clean(p)).then((r) => setFitNotes(r.notes)).catch(() => setFitNotes([])); }, 700);
    return () => clearTimeout(t);
  }, [p]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!p) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
  }, [p]);

  // Selection must stay valid after undo/redo/delete.
  useEffect(() => {
    if (p && sel >= p.slides.length) setSel(p.slides.length - 1);
  }, [p, sel]);

  // Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z, Ctrl+Y. Text fields keep their native undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); hist.undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); hist.redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hist.undo, hist.redo]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateSlide = useCallback((i: number, patch: Partial<Slide>) =>
    setP((cur) => cur && { ...cur, slides: cur.slides.map((s, k) => (k === i ? { ...s, ...patch } : s)) }), [setP]);

  if (!p) return <Box sx={{ p: 6, textAlign: "center" }}><CircularProgress /></Box>;
  const slide = sel >= 0 ? p.slides[sel] ?? null : null;

  const download = (blob: Blob, filename: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const doImport = async (f: File) => {
    try {
      const r = await api.importDeck(f);
      setP(() => r.proposal);
      setSel(-1);
      setToast({ msg: r.warnings.length ? r.warnings[0] : `Imported ${f.name}. Undo restores the previous deck.`, sev: "success" });
    } catch (e) { setToast({ msg: String(e), sev: "error" }); }
    finally { if (importRef.current) importRef.current.value = ""; }
  };
  const doExport = async (format: "pptx" | "pdf" = "pptx") => {
    setBusy(true);
    try {
      const { blob, warnings } = await api.exportPptx(clean(p), opts, format);
      download(blob, `${name || "proposal"}.${format}`);
      setToast({ msg: warnings ? `Exported with notes: ${warnings}` : `Exported .${format}`, sev: "success" });
    } catch (e) { setToast({ msg: String(e), sev: "error" }); }
    finally { setBusy(false); }
  };
  const doSave = async () => {
    try { await api.save(name, clean(p)); setToast({ msg: `Saved "${name}"`, sev: "success" }); }
    catch (e) { setToast({ msg: String(e), sev: "error" }); }
  };
  const reorder = (from: number, to: number) => {
    if (from === to || to < 0) return;
    setP((cur) => {
      if (!cur) return cur;
      const s = [...cur.slides];
      const [m] = s.splice(from, 1);
      s.splice(to, 0, m);
      return { ...cur, slides: s };
    });
    setSel(to);
  };
  const duplicate = (i: number) => {
    setP((cur) => {
      if (!cur) return cur;
      const s = [...cur.slides];
      s.splice(i + 1, 0, JSON.parse(JSON.stringify(cur.slides[i])));
      return { ...cur, slides: s };
    });
    setSel(i + 1);
  };
  const choose = (i: number) => { setSel(i); setNavOpen(false); };

  // Short deck summary sent with AI requests so drafts stay consistent with the rest of the deck.
  const deckContext = (() => {
    const lines = [`Proposal: ${p.meta.title}${p.meta.subtitle ? ` (${p.meta.subtitle})` : ""}`];
    for (const s of p.slides) {
      if (s.scope) {
        if (s.scope.in_scope.length) lines.push(`In scope: ${s.scope.in_scope.join("; ")}`);
        if (s.scope.out_scope.length) lines.push(`Out of scope: ${s.scope.out_scope.join("; ")}`);
      }
      if (s.solution) lines.push(`Solution: ${s.solution.title}; stages: ${s.solution.stages.map((st) => st.title).join(" > ")}`);
    }
    return lines.join("\n").slice(0, 1500);
  })();
  // The deck's As-Is flow, as plain text, to seed the "Draft To-Be from As-Is" dialog.
  const asIsText = (() => {
    const cur = sel >= 0 ? p.slides[sel] : null;
    const src = p.slides.find((s) => s !== cur && s.type === "flow" && s.flow && /as[\s-]?is/i.test(s.flow.title));
    if (!src?.flow) return undefined;
    const label = (id: string) => src.flow!.nodes.find((n) => n.id === id)?.label ?? id;
    return [
      "AS-IS process steps:",
      ...src.flow.nodes.map((n) => `- ${n.label}${n.kind === "decision" ? " (decision)" : ""}`),
      "Flow:",
      ...src.flow.edges.map((e) => `- ${label(e.src)} -> ${label(e.dst)}${e.label ? ` [${e.label}]` : ""}`),
    ].join("\n");
  })();

  const navList = (
    <>
      <List dense sx={{ pb: 0 }}>
        <ListItemButton selected={sel === -1} onClick={() => choose(-1)}>
          <ListItemIcon><Settings fontSize="small" /></ListItemIcon><ListItemText primary="Deck settings" />
        </ListItemButton>
      </List>
      <Divider sx={{ my: 0.5 }} />
      <Stack spacing={0.5} sx={{ p: 1 }}>
        {p.slides.map((s, i) => {
          const showBefore = overIdx === i && dragIdx !== null && dragIdx !== i && dragIdx > i;
          const showAfter = overIdx === i && dragIdx !== null && dragIdx !== i && dragIdx < i;
          return (
            <Box key={i} draggable data-slide-idx={i}
              onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); setDragIdx(i); }}
              onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOverIdx(i); }}
              onDrop={(e) => { e.preventDefault(); if (dragIdx !== null) reorder(dragIdx, i); setDragIdx(null); setOverIdx(null); }}
              sx={{ borderTop: 3, borderBottom: 3, borderColor: "transparent",
                ...(showBefore ? { borderTopColor: "secondary.main" } : {}), ...(showAfter ? { borderBottomColor: "secondary.main" } : {}),
                opacity: dragIdx === i ? 0.4 : 1 }}>
              <Box role="button" tabIndex={0} aria-label={`Slide ${i + 1}: ${LABEL[s.type]}`} aria-current={sel === i}
                onClick={() => choose(i)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(i); } }}
                sx={{ cursor: "grab", p: 0.75, borderRadius: 2, border: 2, borderColor: sel === i ? "primary.main" : "transparent",
                  bgcolor: sel === i ? "action.selected" : "transparent", "&:hover": { bgcolor: "action.hover" } }}>
                <SlideThumb slide={s} meta={p.meta} />
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.5, color: "text.secondary" }}>
                  {ICON[s.type]}
                  {fitNotes.some((n) => n.slide === i + 1) && (
                    <Tooltip title={fitNotes.filter((n) => n.slide === i + 1).map((n) => n.message).join("; ")}>
                      <WarnIcon fontSize="inherit" color="warning" aria-label="fit note" />
                    </Tooltip>)}
                  <Typography variant="caption" noWrap sx={{ flex: 1, fontWeight: 600 }}>
                    {i + 1}. {LABEL[s.type]}{slideTitle(s) && s.type !== "title" ? ` · ${slideTitle(s)}` : ""}
                  </Typography>
                  <Box role="button" aria-label={`Drag to reorder slide ${i + 1}`}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); setDragIdx(i); setOverIdx(i); }}
                    onPointerMove={(e) => {
                      if (dragIdx !== i) return;
                      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-slide-idx]");
                      if (el) setOverIdx(Number(el.getAttribute("data-slide-idx")));
                    }}
                    onPointerUp={() => { if (dragIdx === i && overIdx !== null && overIdx !== i) reorder(i, overIdx); setDragIdx(null); setOverIdx(null); }}
                    onPointerCancel={() => { setDragIdx(null); setOverIdx(null); }}
                    sx={{ touchAction: "none", cursor: "grab", display: "flex", alignItems: "center", px: 0.5, py: 0.25, borderRadius: 1, "&:hover": { bgcolor: "action.hover" } }}>
                    <DragHandle fontSize="small" />
                  </Box>
                </Stack>
              </Box>
            </Box>
          );
        })}
      </Stack>
      <Box sx={{ p: 1.5, position: "sticky", bottom: 0, bgcolor: "background.paper" }}>
        <Button fullWidth startIcon={<Add />} variant="outlined" onClick={(e) => setAddEl(e.currentTarget)}>Add slide</Button>
        <Button fullWidth startIcon={<AutoAwesome />} sx={{ mt: 0.75 }} onClick={() => setDraftOpen(true)}>Draft deck from brief</Button>
      </Box>
    </>
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <AppBar position="static" color="transparent">
        <Toolbar sx={{ gap: 1, px: { xs: 1, md: 2 } }}>
          {narrow && <IconButton aria-label="open slide list" onClick={() => setNavOpen(true)}><MenuIcon /></IconButton>}
          {!narrow && <Typography variant="h6" sx={{ mr: 2 }}>Proposal Studio</Typography>}
          <TextField value={name} onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_-]/g, "-"))}
            sx={{ width: narrow ? undefined : 200, flex: narrow ? 1 : "none", minWidth: 0 }} inputProps={{ "aria-label": "project name" }} />
          <Tooltip title="Undo (Ctrl/Cmd+Z)">
            <span><IconButton aria-label="undo" disabled={!hist.canUndo} onClick={hist.undo}><Undo /></IconButton></span>
          </Tooltip>
          <Tooltip title="Redo (Shift+Ctrl/Cmd+Z)">
            <span><IconButton aria-label="redo" disabled={!hist.canRedo} onClick={hist.redo}><Redo /></IconButton></span>
          </Tooltip>
          {!narrow && <Box sx={{ flex: 1 }} />}
          <Tooltip title="New proposal">
            <IconButton aria-label="new proposal" onClick={() => setWizardOpen(true)}><NoteAdd /></IconButton>
          </Tooltip>
          <Tooltip title="Open saved project">
            <IconButton aria-label="open project" onClick={async (e) => { setOpenEl(e.currentTarget); setProjects(await api.projects().catch(() => [])); }}><FolderOpen /></IconButton>
          </Tooltip>
          <Tooltip title="More: import, project file, PDF">
            <IconButton aria-label="more actions" onClick={(e) => setMoreEl(e.currentTarget)}><MoreVert /></IconButton>
          </Tooltip>
          <input ref={importRef} type="file" hidden accept=".pptx,.potx,.json,.yaml,.yml"
            onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
          {narrow ? (
            <>
              <Tooltip title={opts.template ? `Template: ${opts.template}` : opts.preset && opts.preset !== "corporate" ? `Look: ${opts.preset}` : "Template"}>
                <IconButton aria-label="template" onClick={() => setTplOpen(true)}><Slideshow /></IconButton>
              </Tooltip>
              <Tooltip title="Save"><IconButton aria-label="save" onClick={doSave}><Save /></IconButton></Tooltip>
              <Tooltip title="Export .pptx">
                <span>
                  <IconButton aria-label="export pptx" color="secondary" disabled={busy} onClick={() => doExport()}>
                    {busy ? <CircularProgress size={20} color="inherit" /> : <Download />}
                  </IconButton>
                </span>
              </Tooltip>
            </>
          ) : (
            <>
              <Button startIcon={<Slideshow />} onClick={() => setTplOpen(true)}>
                {opts.template ? `Template: ${opts.template}` : opts.preset && opts.preset !== "corporate" ? `Look: ${opts.preset}` : "Template"}
              </Button>
              <Button startIcon={<Save />} onClick={doSave}>Save</Button>
              <Button variant="contained" color="secondary" startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <Download />}
                disabled={busy} onClick={() => doExport()}>Export .pptx</Button>
            </>
          )}
        </Toolbar>
      </AppBar>

      <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
        {!narrow && (
          <Paper square elevation={0} sx={{ width: 280, borderRight: 1, borderColor: "divider", overflowY: "auto", flexShrink: 0 }}>
            {navList}
          </Paper>
        )}
        {narrow && (
          <Drawer open={navOpen} onClose={() => setNavOpen(false)} PaperProps={{ sx: { width: 300 } }}>{navList}</Drawer>
        )}

        <Box sx={{ flex: 1, overflowY: "auto", p: { xs: 2, md: 4 } }}>
          <Box sx={{ maxWidth: 960, mx: "auto" }}>
            {slide && (
              <Stack direction="row" spacing={0.5} justifyContent="flex-end" sx={{ mb: 1 }}>
                <Tooltip title="Duplicate slide"><IconButton aria-label="duplicate slide" onClick={() => duplicate(sel)}><Copy /></IconButton></Tooltip>
                <IconButton aria-label="move up" onClick={() => reorder(sel, sel - 1)} disabled={sel === 0}><Up /></IconButton>
                <IconButton aria-label="move down" onClick={() => reorder(sel, sel + 1)} disabled={sel === p.slides.length - 1}><Down /></IconButton>
                <IconButton aria-label="delete slide" onClick={() => { setP((cur) => cur && { ...cur, slides: cur.slides.filter((_, k) => k !== sel) }); setSel(-1); }}><Delete /></IconButton>
              </Stack>
            )}
            {sel >= 0 && fitNotes.filter((n) => n.slide === sel + 1).map((n) => (
              <Alert key={n.message} severity="info" sx={{ mb: 1.5 }}>On export: {n.message}.</Alert>
            ))}
            {sel === -1 && (
              <Paper variant="outlined" sx={{ p: 2.5 }}>
                <Typography variant="h6" sx={{ mb: 2 }}>Deck settings</Typography>
                <Stack spacing={2}>
                  <TextField label="Deck title" value={p.meta.title} onChange={(e) => setP({ ...p, meta: { ...p.meta, title: e.target.value } })} />
                  <TextField label="Subtitle" value={p.meta.subtitle} onChange={(e) => setP({ ...p, meta: { ...p.meta, subtitle: e.target.value } })} />
                  <TextField label="Brand (footer left)" value={p.meta.brand} onChange={(e) => setP({ ...p, meta: { ...p.meta, brand: e.target.value } })} />
                  <TextField label="Footer text" value={p.meta.footer} onChange={(e) => setP({ ...p, meta: { ...p.meta, footer: e.target.value } })} />
                </Stack>
              </Paper>
            )}
            {slide?.type === "title" && <Typography color="text.secondary">The title slide uses the deck title and subtitle from Deck settings.</Typography>}
            {slide?.type === "bullets" && <BulletsEditor deckContext={deckContext} title={slide.title ?? ""} bullets={slide.bullets ?? []} onChange={(t, b) => updateSlide(sel, { title: t, bullets: b })} />}
            {slide?.type === "compare" && slide.compare && <CompareEditor c={slide.compare} onChange={(c) => updateSlide(sel, { compare: c })} />}
            {slide?.type === "scope" && slide.scope && <ScopeEditor s={slide.scope} onChange={(s) => updateSlide(sel, { scope: s })} />}
            {slide?.type === "risks" && slide.risks && <RisksEditor r={slide.risks} onChange={(r) => updateSlide(sel, { risks: r })} />}
            {slide?.type === "next_steps" && slide.next_steps && <NextStepsEditor n={slide.next_steps} onChange={(n) => updateSlide(sel, { next_steps: n })} />}
            {slide?.type === "solution" && slide.solution && <SolutionEditor s={slide.solution} onChange={(s) => updateSlide(sel, { solution: s })} />}
            {slide?.type === "assumptions" && slide.assumptions && <AssumptionsEditor a={slide.assumptions} library={lib} deckContext={deckContext} onChange={(a) => updateSlide(sel, { assumptions: a })} />}
            {slide?.type === "gantt" && slide.gantt && <GanttEditor g={slide.gantt} onChange={(g) => updateSlide(sel, { gantt: g })} />}
            {slide?.type === "cost" && slide.cost && <CostEditor c={slide.cost} onChange={(c) => updateSlide(sel, { cost: c })} />}
            {slide?.type === "flow" && slide.flow && (
              <FlowEditor key={`${sel}-${hist.version}`} f={slide.flow} deckContext={deckContext} asIsText={asIsText} onChange={(f) => updateSlide(sel, { flow: f })} />
            )}
            {sel >= 0 && slide && (
              <TextField label="Speaker notes" multiline minRows={2} fullWidth sx={{ mt: 2 }} value={slide.notes ?? ""}
                placeholder="Optional. Exported as PowerPoint speaker notes."
                onChange={(e) => updateSlide(sel, { notes: e.target.value })} />
            )}
          </Box>
        </Box>
      </Box>

      <Menu anchorEl={addEl} open={!!addEl} onClose={() => setAddEl(null)}>
        {(Object.keys(LABEL) as SlideType[]).map((t) => (
          <MenuItem key={t} onClick={() => {
            setP((cur) => cur && { ...cur, slides: [...cur.slides, newSlide(t)] });
            setSel(p.slides.length);
            setAddEl(null);
            setNavOpen(false);
          }}>
            <ListItemIcon>{ICON[t]}</ListItemIcon>{LABEL[t]}
          </MenuItem>
        ))}
      </Menu>
      <Menu anchorEl={moreEl} open={!!moreEl} onClose={() => setMoreEl(null)}>
        <MenuItem onClick={() => { setMoreEl(null); importRef.current?.click(); }}>Import deck (.pptx, .json, .yaml)</MenuItem>
        <MenuItem onClick={() => { setMoreEl(null); download(new Blob([JSON.stringify(clean(p), null, 2)], { type: "application/json" }), `${name || "proposal"}.json`); }}>
          Download project file (.json)</MenuItem>
        <MenuItem disabled={!canPdf || busy} onClick={() => { setMoreEl(null); doExport("pdf"); }}>
          Export PDF{canPdf ? "" : " (needs LibreOffice on the server)"}</MenuItem>
      </Menu>
      <Menu anchorEl={openEl} open={!!openEl} onClose={() => setOpenEl(null)}>
        {projects.length === 0 && <MenuItem disabled>No saved projects</MenuItem>}
        {projects.map((n) => (
          <MenuItem key={n} onClick={async () => {
            setOpenEl(null);
            try { hist.reset(await api.load(n)); setName(n); setSel(-1); } catch (e) { setToast({ msg: String(e), sev: "error" }); }
          }}>{n}</MenuItem>
        ))}
      </Menu>
      <TemplateDialog open={tplOpen} onClose={() => setTplOpen(false)} opts={opts} onChange={setOpts} />
      <DeckDraft open={draftOpen} onClose={() => setDraftOpen(false)}
        onApply={(slides, meta) => {
          setP((cur) => (cur ? { ...cur, meta: meta ? { ...cur.meta, ...meta } : cur.meta, slides: [...cur.slides, ...slides] } : cur));
          setSel(p.slides.length);
          setToast({ msg: `Added ${slides.length} drafted slide(s). Undo removes them.`, sev: "success" });
        }} />
      <Wizard open={wizardOpen} onClose={() => setWizardOpen(false)}
        onCreate={(np) => { setP(np); setSel(-1); setWizardOpen(false); setToast({ msg: "New proposal created. Undo restores the previous deck.", sev: "success" }); }} />
      <Snackbar open={!!toast} autoHideDuration={4000} onClose={() => setToast(null)}>
        {toast ? <Alert severity={toast.sev} onClose={() => setToast(null)}>{toast.msg}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}
