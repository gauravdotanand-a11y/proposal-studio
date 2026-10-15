# Proposal Studio

Local app that turns a structured proposal (flows, Gantt, cost/CBA, assumptions) into an editable .pptx.
No telemetry; projects are stored under `data/`. Nothing leaves your machine except the optional, user-triggered LLM call
(its exact payload is shown first). Use only synthetic data when testing against endpoints your organisation has not approved.

## Run
```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt pytest
(cd frontend && npm install && npm run build)
cd backend && ../.venv/bin/uvicorn studio.api:app --port 8000   # UI at http://127.0.0.1:8000
```
Dev UI with hot reload: `cd frontend && npm run dev` (proxies /api to :8000).
CLI: `cd backend && ../.venv/bin/python -m studio.cli ../examples/sample.yaml ../out/sample.pptx`

## AI assist (optional)
Off by default. The backend reads credentials from environment variables only; the UI never sees keys.
```bash
# Azure OpenAI (production)
LLM_PROVIDER=azure AZURE_OPENAI_ENDPOINT=https://<res>.openai.azure.com AZURE_OPENAI_API_KEY=... \
  AZURE_OPENAI_DEPLOYMENT=<deployment> [AZURE_OPENAI_API_VERSION=2024-06-01]
# Local / testing (Ollama, LM Studio, OpenAI-compatible)
LLM_PROVIDER=ollama OPENAI_MODEL=llama3.1          # base URL defaults to http://localhost:11434/v1
LLM_PROVIDER=openai OPENAI_BASE_URL=... OPENAI_API_KEY=... OPENAI_MODEL=...
```
Flow: describe -> **preview exact payload (redaction applied, host shown)** -> send -> accept/reject suggestions.
Use synthetic data when testing against non-approved endpoints.

## Looks and templates
Toolbar -> Template has two tabs. **Built-in looks**: Corporate, Forest, Slate, Plum, Monochrome (colours and font; all shapes stay
native). **My templates**: upload, rename, download and delete your own corporate .pptx/.potx files.

## Draft a deck from a brief (AI)
Sidebar -> "Draft deck from brief": describe the process, review the exact payload, pick slides from the proposed outline,
review each draft, then add them to the deck as one undoable step. Needs a configured LLM provider.

## Notes, import, PDF
- **Speaker notes**: per-slide field under every editor; exported as PowerPoint notes.
- **Import** (toolbar `...` menu): a `.pptx` exported by this app restores the whole deck exactly (the source is embedded as a
  standard customXml item; set `STUDIO_EMBED_SOURCE=0` to disable). Other `.pptx` files import as editable bullet slides
  (text and tables only). `.json` / `.yaml` proposals import directly. **Download project file** saves the deck as JSON.
- **HTML decks** (for example written by Copilot): import a `.html` file. Slides are split by `section`/`.slide`/headings,
  scripts are never executed, and slides map to assumptions, scope, risks, next steps, Gantt, cost or a simple flow
  (from `data-type` hints or title keywords), otherwise bullets. See `docs/copilot-html-contract.md` for a prompt
  that makes Copilot produce HTML that imports cleanly.
- **PDF export**: needs LibreOffice (`soffice`) on the machine running the backend; the menu item is disabled otherwise.
- **Accessibility**: tables and diagram shapes carry alt text (arrows read as "Arrow from A to B (Yes)").

## Tests
```bash
cd backend && ../.venv/bin/python -m pytest -q      # backend
cd frontend && npm test                              # frontend (vitest)
tools/render.sh out/sample.pptx /tmp/render          # optional visual check via LibreOffice
```

## Corporate templates
Toolbar -> Template -> Upload a `.pptx` or `.potx` (macro-enabled files are rejected). Exports use its slide master,
layouts, fonts and footer/slide-number placeholders; the template's own sample slides are not included.
Pick the title and content layouts (auto-detected: "title" and "title only" style). Diagram/table colors follow the
template theme accents (switchable). Templates are stored under `data/templates/` and never leave your machine.
The dialog shows a schematic thumbnail per layout (placeholders, master decoration, logos) so you can pick title/content layouts visually.
Non-16:9 templates work but diagrams are cramped (a warning is shown). The in-app preview still shows the built-in look.

## Slide types
`title`, `solution` (pipeline stages + text blocks + numbered end-to-end steps), `flow` (auto-layout; add `lane` to nodes for
swimlanes, `note` on edges for tags like "~60-70% success expected"; kinds `bot`/`human`/`data`/`ai` get badges),
`assumptions`, `bullets`, `gantt` (optional `section` per activity), `cost` (one-time/recurring lines + benefit drivers:
volume x minutes saved x hourly rate x success x ramp-up), `compare` (previous vs updated plan, changes highlighted),
`scope`, `risks`, `next_steps`. See `examples/sample.yaml`.

## Editing
- Left sidebar shows a thumbnail per slide; drag to reorder (arrow buttons are the keyboard/touch alternative).
- Undo/redo: toolbar buttons, Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z (typing is grouped into one step; text fields keep native undo).
- New proposal wizard (toolbar): basics, slide selection with presets, start date, currency, cost years.
- Flow canvas: click a step or arrow to edit; drag the blue handle of a selected step onto another step to connect or onto
  empty space to add a step. Layout stays automatic, identical to the exported deck.
