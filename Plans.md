# Plans.md: Proposal Studio

Living plan for the solution-proposal PPT generator. Update the status column and the log at the bottom as work lands.

Last updated: 2026-10-15

## 1. Context

Automation / AI solution teams repeatedly build the same proposal deck: As-Is process, To-Be (RPA / AI / ML / NLP) solution,
high-level flow with expected success rates, assumptions, execution plan (Gantt), cost and CBA, plan revisions.
Generic AI deck generators produce marketing-style slides, not this structured, diagram-heavy, assumption-heavy format.

**Goal:** a local web app that turns a structured proposal (typed by the user and/or drafted by an LLM) into an
**editable, branded .pptx** with native shapes, tables and arrows, plus a Gantt generator, cost/CBA calculator and
assumption library.

### Decisions (confirmed with the user)

| Topic | Decision |
|---|---|
| Form | Local web app (FastAPI backend + React/MUI frontend); CLI also available |
| UI style | Modern from the start: Material UI with a custom Apple-like theme, light and dark |
| LLM | Pluggable. Production: org-approved Azure OpenAI. Testing: any OpenAI-compatible endpoint or Ollama with synthetic data only. App must work with no LLM |
| Diagrams | Text/steps to auto-layout to native editable PowerPoint shapes |
| Template | No corporate .potx available at design time: look-alike theme built from the reference screenshots; real template upload supported |
| Privacy | Reference screenshots are never ingested, uploaded or committed. No telemetry. Projects and templates stored locally. Only the configured LLM endpoint is ever called |

### Prior art reviewed

| Repo | Takeaway |
|---|---|
| presenton | Pluggable LLM providers, template upload, editable PPTX. No flow/Gantt/cost domain model |
| ppt-master | Native-shape output and template reuse. Needs an agent host, not standalone |
| pptagent | Template-driven editing and a render-review loop. Heavy setup (LibreOffice, Playwright) |
| presentation-ai | Outline-first UX. PPTX export is partial |

None model proposal structure, so the domain layer is built here; the ideas above are borrowed.

## 2. Architecture

```
frontend/ (React + Vite + TS + MUI)  --/api-->  backend/studio (FastAPI)
  editors, canvas, thumbnails, wizard             models.py    Pydantic domain model (single source of truth)
  FlowPreview (SVG from /api/flow/layout)         layout.py    flow auto-layout + routing (shared by preview and export)
                                                  render.py    python-pptx renderer (native shapes, tables, connectors)
                                                  templates.py upload validation, layouts, theme colours, preview geometry
                                                  llm.py       providers, redaction, prompts, validated output
                                                  api.py       endpoints, local JSON storage under data/
```

Key design rules:
- One layout engine (`layout.py`) feeds both the web preview and the .pptx export, so they match.
- Everything exported is a native PowerPoint object (tables, shapes, connectors), so decks stay editable.
- LLM output is validated against Pydantic models before anything is applied; suggestions are accept/reject.
- Nothing leaves the machine except the user-triggered LLM call, and its exact payload is shown first.

## 3. Phases and status

Legend: DONE / PARTIAL / TODO

| # | Phase | Status | Delivered |
|---|---|---|---|
| 0 | Research and plan | DONE | Reviewed four repos, captured slide types and requirements from the reference screenshots, agreed decisions above |
| 1 | Core generator | DONE | Domain models, look-alike theme, renderer (title, bullets, assumptions, Gantt table, cost/CBA, flow), YAML CLI |
| 2 | API and web UI | DONE | FastAPI endpoints, project save/load, React + MUI app with dark/light theme, export button |
| 3 | LLM layer | DONE (OpenAI-compatible path verified live; Azure path untested) | Azure OpenAI and OpenAI-compatible/Ollama providers, redaction, preview-before-send, per-item accept/reject for assumptions, flow and bullets. Live test with `gpt-4o-mini`: all three tasks returned valid output; actionable 403/404/429 errors; no `temperature` sent to gpt-5/o-series |
| 4 | Flow engine | DONE | Auto-layout with snake wrapping, orthogonal routing around nodes, swimlanes, BOT/MANUAL/DB/AI badges, data cylinders, arrow tags (e.g. "~60-70% success expected"), live SVG preview |
| 5 | Corporate templates | DONE | .pptx/.potx upload (macros rejected), slide master/layout/footer reuse, theme-colour mapping, layout thumbnails, title/content layout picker |
| 6 | Screenshot slide types | DONE | Solution overview, To-Be swimlanes, plan revision (previous vs updated), Gantt sections, one-time/recurring costs, benefit-driver calculator, scope, risks, next steps |
| 7 | Editing experience | DONE | Cost editor rework (responsive cards), responsive shell, slide thumbnails with drag-reorder, undo/redo, new-proposal wizard, interactive flow canvas (select, drag-to-connect, drag-to-add) |
| 8 | Hardening and polish | TODO | See section 4 |

### Slide types supported

`title`, `solution`, `flow` (As-Is / To-Be / HL flow; optional lanes), `assumptions`, `bullets`, `gantt` (sections, holidays),
`compare`, `cost` (one-time/recurring + drivers), `scope`, `risks`, `next_steps`.

## 4. Remaining work

Ordered by priority.

| Priority | Item | Why / notes |
|---|---|---|
| P0 | **Open `out/sample.pptx` in PowerPoint and report issues** | Never verified in real PowerPoint/Keynote. Tests only check structure. Needs the user |
| P0 | Try a real corporate template | Master/logo/placeholder handling is only tested with synthetic templates |
| ~~P1~~ | ~~Audit remaining editors at desktop and narrow widths~~ | DONE 2026-10-15: all editors checked at desktop and 400px; clipping fixed in solution, risks, next steps and plan-revision editors |
| ~~P1~~ | ~~Packaging for a locked-down machine~~ | Dropped: Python and npm are allowed in the user's org, so a normal install is enough |
| P1 | Test AI assist (incl. new brief-to-deck and eval set) against real Azure OpenAI | OpenAI-compatible path verified live (2026-10-15, synthetic data). Azure uses a different URL and `api-key` header and has only been tested against a mock |
| P2 | Keep bent arrows attached in PowerPoint | Mostly DONE 2026-10-15 (checked in LibreOffice render): H-V-H bends are elbow connectors glued to both boxes (cylinder and oval connection sites remapped). Still freeform: U-shaped routes that return to the same x (e.g. decision to the box below it) and vertical-first bends. Not yet verified in real PowerPoint |
| ~~P2~~ | ~~More AI tasks~~ | DONE 2026-10-15: executive summary, risks, scope and benefit drivers (benefit figures not in the input are cleared). UI buttons on scope, risks and cost editors; summary available via API |
| ~~P2~~ | ~~AI evaluation set~~ | DONE 2026-10-15: `backend/studio/evalset.py` (7 synthetic cases, rubric checks). Run `python -m studio.evalset` against a configured provider. Live run 2026-10-15 (OpenAI-compatible, synthetic data): 7/7 pass, one run, rubric checks are structural not semantic |
| ~~P2~~ | ~~Frontend unit tests~~ | DONE 2026-10-15: vitest, 10 tests (cost maths, AI review rows, factory, undo/redo) |
| ~~P3~~ | ~~Touch-friendly reorder~~ | DONE 2026-10-15: pointer-based drag handle on slide thumbnails (touch and mouse) |
| P3 | Gantt UX | Drag-resize/move/draw bars and holiday-aware week labels are DONE (2026-10-15). Native-chart export mode still open |
| ~~P3~~ | ~~Version control and CI~~ | DONE 2026-10-15: git repo, `.github/workflows/ci.yml` (backend pytest, frontend vitest + build), `backend/requirements.txt`. CI not yet run on a remote |

## 5. Known limitations

- In-app previews are schematic or SVG approximations (no LibreOffice); the exported .pptx is the source of truth.
- Flow layout is automatic (no free positioning); graphs beyond about 14 steps in swimlane mode get small boxes and an overflow flag.
- Non-16:9 templates work but diagrams are cramped (a warning is shown).
- Template previews show geometry, not fonts or exact rendering.
- npm's global cache on this machine has root-owned files; use a local cache (`npm install --cache <dir>`).

## 6. How to run and verify

```bash
# backend tests (60 passing); frontend: cd frontend && npm test (10 passing)
cd backend && ../.venv/bin/python -m pytest -q

# generate the sample deck from YAML
cd backend && ../.venv/bin/python -m studio.cli ../examples/sample.yaml ../out/sample.pptx

# app (UI at http://127.0.0.1:8000)
(cd frontend && npm run build)
cd backend && ../.venv/bin/uvicorn studio.api:app --port 8000
```

Verification checklist per release:
1. Backend tests pass (layout never crosses nodes, nothing runs off the slide, template round-trips, LLM redaction and error handling).
2. Sample deck opens in PowerPoint; shapes, tables and arrows are editable.
3. A deck built with the user's real template keeps its master, fonts and footer.
4. With no LLM configured the app is fully usable; with one configured, the payload preview matches what is sent.

## 7. Log

| Date | Change |
|---|---|
| 2026-10-14 | Research, plan approved; core generator, API and web UI built |
| 2026-10-14 | LLM provider layer with preview-before-send and accept/reject |
| 2026-10-14 | Flow preview sharing the export layout; routing and snake wrapping |
| 2026-10-14 | Template upload, layout thumbnails, stale-selection fix |
| 2026-10-15 | Solution overview, swimlane To-Be, badges and arrow tags |
| 2026-10-15 | Plan revision compare, Gantt sections, cost drivers, scope, risks, next steps |
| 2026-10-15 | Cost editor rework and responsive shell |
| 2026-10-15 | Thumbnails with drag-reorder, undo/redo, wizard, interactive flow canvas |
| 2026-10-15 | AI quality pass: deck context + existing items + library examples in prompts, node-kind guidance, post-checks (dedupe, orphans, Start/End, Yes/No, invented figures), one repair retry, As-Is to To-Be task with swimlanes. Live re-test on one invented example: more specific assumptions, valid To-Be with lanes; success-rate tag placement is not reliable (surfaced as a warning). 54 backend tests pass |
| 2026-10-15 | Live OpenAI test (`gpt-4o-mini`, synthetic data): assumptions, bullets and flow all valid. Found and fixed: unhelpful 403 errors (now status + code + hint, body never echoed) and temperature rejected by reasoning models. 41 backend tests pass |
| 2026-10-15 | Fixed overlapping Yes/No flow labels and plan-revision row growth in export (explicit empty-cell font size, label collision handling). Editor audit: wrapping layouts for solution, risks, next steps, plan revision. Packaging dropped |
| 2026-10-15 | New AI tasks (summary, risks, scope, benefits) with post-checks, synthetic eval set, vitest suite, drag-resize Gantt preview, holiday-aware week labels, touch reorder handle, git + CI. Bent-arrow gluing left open (cannot verify elbow connectors without PowerPoint) |
| 2026-10-15 | LibreOffice installed for render checks (`tools/render.sh`). Found and fixed: Yes/No labels sat on the shared segment (now on the branch-specific part), arrow tags overlapped the next box (now placed in free space), boxes touched the swimlane edge, decision text wrapped badly |
| 2026-10-15 | Template gallery: 5 built-in looks (Corporate, Forest, Slate, Plum, Monochrome) via `preset`, plus template management (cards with details, rename, download, delete, no silent overwrite on upload). Fixed text colours being bound at import time so looks recolour body text |
| 2026-10-15 | Brief to full deck: `outline` AI task (known slide kinds only, duplicates dropped), then per-slide drafts via the existing section tasks; payload preview, slide picking and accept/reject before anything is added (one undoable step). Verified end to end against a fake local LLM; not yet run on a real model |
| 2026-10-15 | Overflow guards: `fit.py` estimates text height, steps fonts down, splits long bullets/assumptions/risks/next steps/scope/Gantt/cost into continuation slides, scales long titles, compacts dense Gantt headers; export notes and per-slide warnings in the UI. Gantt weeks capped at 156 (a 5,000-week plan hung the server). Found in stress test; estimates are conservative averages, not font metrics |
| 2026-10-15 | Speaker notes, alt text on tables and diagram shapes, exact round-trip import of exported decks (customXml item), approximate import of other .pptx, JSON/YAML import, project file download, PDF export via LibreOffice, memoized thumbnails. Not yet opened in real PowerPoint: confirm the embedded customXml item causes no repair prompt (`STUDIO_EMBED_SOURCE=0` disables it) |
| 2026-10-15 | Dense flows split into linked parts (`To part N` / `From part N` shapes). Live eval set against an OpenAI-compatible endpoint with a temporary key supplied by the user in their own terminal: 7/7 pass. Brief-to-deck and Azure still to run live |
| 2026-10-15 | Live brief-to-deck run (gpt-5-mini via OpenAI-compatible, synthetic brief): outline OK in 28 s, 8 slides drafted in 99 s sequentially. Fixed from it: outline titles were sentences (prompt + shortener), 2-line titles touched content (24pt cap), benefit volumes derived from a monthly figure were cleared (allow x12/x52/x250/x365/x60), Yes/No labels collided in tight swimlane gutters (decision corner spots), per-slide drafting now parallel |
| 2026-10-15 | Second live run (same brief): outline titles now short labels, 8 slides drafted in 35 s in parallel (was 99 s). Found and fixed: duplicate continuation shapes on split flows (now one `To part N` / `From part N` per part), over-eager splitting of 13-step swimlane flows (threshold now > 10 columns), benefit prompt now converts monthly/weekly/daily volumes to yearly |
| 2026-10-15 | Live check after restart: benefit drivers now return annual_volume 48,000 from "4,000 a month", minutes 6, hourly rate left 0 (not stated), success 0.65 (midpoint of the stated 60-70%). Azure path still untested live |
