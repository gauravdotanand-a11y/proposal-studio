# Proposal Studio

Local app that turns a structured proposal (flows, Gantt, cost/CBA, assumptions) into an editable .pptx.
No telemetry; projects are stored under `data/` and nothing is sent anywhere (no LLM layer yet).

## Run
```bash
python3 -m venv .venv && .venv/bin/pip install python-pptx pydantic pyyaml fastapi uvicorn httpx pytest
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
