"""FastAPI app. Local-only: binds to localhost, stores projects as JSON on disk."""
from __future__ import annotations

import json
import re
import tempfile
from pathlib import Path

import yaml
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, ValidationError
from starlette.background import BackgroundTask

from . import llm
from . import templates as tpl
from .library import LIBRARY
from .layout import layout_flow
from .models import Flow, Proposal
from .render import render

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "projects"
SAMPLE = ROOT / "examples" / "sample.yaml"
TEMPLATES = ROOT / "data" / "templates"
DIST = ROOT / "frontend" / "dist"

app = FastAPI(title="Proposal PPT Studio", docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_SAFE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _project_path(name: str) -> Path:
    if not _SAFE.match(name):
        raise HTTPException(400, "invalid project name")
    return DATA / f"{name}.json"


def _parse(body: dict) -> Proposal:
    try:
        return Proposal.model_validate(body)
    except ValidationError as e:
        raise HTTPException(422, json.loads(e.json()))


@app.get("/api/sample")
def sample() -> dict:
    return Proposal.model_validate(yaml.safe_load(SAMPLE.read_text())).model_dump(mode="json")


@app.get("/api/library")
def library() -> dict:
    return LIBRARY


@app.post("/api/validate")
def validate(body: dict) -> dict:
    p = _parse(body)
    return {"ok": True, "slides": len(p.slides)}


@app.post("/api/gantt/weeks")
def gantt_weeks(body: dict) -> list[dict]:
    from .models import Gantt

    try:
        g = Gantt.model_validate(body)
    except ValidationError as e:
        raise HTTPException(422, json.loads(e.json()))
    out = []
    for w in range(1, g.week_count + 1):
        s, e = g.week_range(w)
        out.append({"week": w, "label": f"{s.day} {s:%b} - {e.day} {e:%b}"})
    return out


@app.post("/api/flow/layout")
def flow_layout(body: dict) -> dict:
    """Geometry (EMU) identical to what the exporter places on the slide."""
    try:
        return layout_flow(Flow.model_validate({"notes": [], **body}))
    except ValidationError as e:
        raise HTTPException(422, json.loads(e.json()))


@app.post("/api/cost/summary")
def cost_summary(body: dict) -> dict:
    from .models import Cost

    try:
        c = Cost.model_validate(body)
    except ValidationError as e:
        raise HTTPException(422, json.loads(e.json()))
    return {"year_totals": c.year_totals, "total_cost": c.total_cost,
            "total_benefit": c.total_benefit, "benefit_values": c.benefit_values, "cba": round(c.cba, 2)}


def _template_path(name: str) -> Path:
    if not tpl.NAME_RE.match(name):
        raise HTTPException(400, "invalid template name")
    return TEMPLATES / f"{name}.pptx"


@app.post("/api/render")
def render_deck(body: dict, template: str | None = None, title_layout: int | None = None,
                content_layout: int | None = None, use_theme_colors: bool = True, preset: str | None = None):
    p = _parse(body)
    tpath = None
    if template:
        tpath = _template_path(template)
        if not tpath.exists():
            raise HTTPException(404, "template not found")
    tmp = tempfile.NamedTemporaryFile(suffix=".pptx", delete=False)
    tmp.close()
    warnings: list[str] = []
    try:
        render(p, tmp.name, template=tpath, title_layout=title_layout, content_layout=content_layout,
               use_theme_colors=use_theme_colors, warnings=warnings, preset=preset)
    except ValueError as e:
        Path(tmp.name).unlink(missing_ok=True)
        raise HTTPException(400, str(e))
    name = re.sub(r"[^A-Za-z0-9_-]+", "_", p.meta.title).strip("_") or "proposal"
    header = " | ".join(warnings).encode("ascii", "replace").decode()
    return FileResponse(
        tmp.name,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename=f"{name}.pptx",
        headers={"X-Render-Warnings": header} if header else None,
        background=BackgroundTask(lambda: Path(tmp.name).unlink(missing_ok=True)),
    )


@app.get("/api/presets")
def list_presets() -> list[dict]:
    from . import theme
    return [{"id": k, "label": v["label"], "description": v["description"], "font": v["font"],
             "colors": v["colors"]} for k, v in theme.PRESETS.items()]


@app.get("/api/templates/details")
def template_details() -> list[dict]:
    """One row per stored template for the management view; unreadable files are flagged, not hidden."""
    rows = []
    for path in sorted(TEMPLATES.glob("*.pptx")) if TEMPLATES.exists() else []:
        st = path.stat()
        row = {"name": path.stem, "size_kb": round(st.st_size / 1024), "modified": int(st.st_mtime)}
        try:
            info = tpl.inspect(path)
            row.update(slide_w_in=info["slide_w_in"], slide_h_in=info["slide_h_in"], layouts=len(info["layouts"]),
                       colors={k: v for k, v in info["colors"].items() if k.startswith("accent") or k == "dk2"},
                       warnings=info["warnings"], ok=True)
        except Exception as e:
            row.update(ok=False, warnings=[f"could not read template: {type(e).__name__}"])
        rows.append(row)
    return rows


@app.post("/api/templates/{name}/rename")
def rename_template(name: str, to: str) -> dict:
    src, dst = _template_path(name), _template_path(to)
    if not src.exists():
        raise HTTPException(404, "not found")
    if dst.exists():
        raise HTTPException(409, f"a template named '{to}' already exists")
    src.rename(dst)
    return {"name": to}


@app.get("/api/templates/{name}/file")
def download_template(name: str):
    path = _template_path(name)
    if not path.exists():
        raise HTTPException(404, "not found")
    return FileResponse(path, filename=f"{name}.pptx",
                        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation")


@app.get("/api/templates")
def list_templates() -> list[str]:
    return sorted(p.stem for p in TEMPLATES.glob("*.pptx")) if TEMPLATES.exists() else []


@app.put("/api/templates/{name}")
async def upload_template(name: str, request: Request) -> dict:
    """Raw-body upload of a .pptx/.potx (no multipart dependency). Stored locally only."""
    path = _template_path(name)
    data = await request.body()
    try:
        clean = tpl.normalize(data)
        TEMPLATES.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".upload")
        tmp.write_bytes(clean)
        try:
            info = tpl.inspect(tmp)
        except Exception as e:  # python-pptx raises many types on corrupt files
            tmp.unlink(missing_ok=True)
            raise tpl.TemplateError(f"could not read template: {type(e).__name__}") from e
        tmp.replace(path)
    except tpl.TemplateError as e:
        raise HTTPException(400, str(e))
    return {"name": name, **info}


@app.get("/api/templates/{name}")
def template_info(name: str) -> dict:
    path = _template_path(name)
    if not path.exists():
        raise HTTPException(404, "not found")
    return {"name": name, **tpl.inspect(path)}


@app.get("/api/templates/{name}/preview")
def template_preview(name: str) -> dict:
    path = _template_path(name)
    if not path.exists():
        raise HTTPException(404, "not found")
    try:
        return tpl.preview(path)
    except Exception as e:
        raise HTTPException(422, f"could not read template: {type(e).__name__}")


@app.delete("/api/templates/{name}")
def delete_template(name: str) -> dict:
    _template_path(name).unlink(missing_ok=True)
    return {"deleted": name}


class LLMRequest(BaseModel):
    task: str
    text: str
    redact: bool = True
    terms: list[str] = []
    existing: list[str] = []  # current assumptions, so the model does not repeat them
    context: str = ""  # short deck summary for consistency


@app.get("/api/llm/status")
def llm_status() -> dict:
    i = llm.get_provider().info()
    return {"provider": i.name, "configured": i.configured, "host": i.host, "model": i.model, "hint": i.hint}


@app.post("/api/llm/prepare")
def llm_prepare(req: LLMRequest) -> dict:
    """Return exactly what /run would send. Makes no network call."""
    try:
        msgs = llm.build_messages(req.task, req.text, req.redact, req.terms, req.existing, req.context, LIBRARY)
    except llm.LLMError as e:
        raise HTTPException(400, str(e))
    i = llm.get_provider().info()
    return {"messages": msgs, "host": i.host, "model": i.model, "provider": i.name, "configured": i.configured}


@app.post("/api/llm/run")
def llm_run(req: LLMRequest) -> dict:
    provider = llm.get_provider()
    if not provider.info().configured:
        raise HTTPException(409, "No LLM provider configured")
    try:
        result, warnings = llm.run_task(provider, req.task, req.text, req.redact, req.terms,
                                        req.existing, req.context, LIBRARY)
        return {"task": req.task, "result": result, "warnings": warnings}
    except llm.LLMError as e:
        raise HTTPException(502, str(e))


@app.get("/api/projects")
def list_projects() -> list[str]:
    return sorted(p.stem for p in DATA.glob("*.json")) if DATA.exists() else []


@app.get("/api/projects/{name}")
def get_project(name: str) -> dict:
    path = _project_path(name)
    if not path.exists():
        raise HTTPException(404, "not found")
    return json.loads(path.read_text())


@app.put("/api/projects/{name}")
def save_project(name: str, body: dict) -> dict:
    _parse(body)
    path = _project_path(name)
    DATA.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(body, indent=2))
    return {"saved": name}


@app.delete("/api/projects/{name}")
def delete_project(name: str) -> dict:
    _project_path(name).unlink(missing_ok=True)
    return {"deleted": name}


if DIST.exists():
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=DIST, html=True), name="ui")
