"""LLM layer: pluggable providers, deterministic prompt building, redaction, validated output.

Nothing here runs unless the user explicitly calls /api/llm/run. Secrets are read from
environment variables only and are never returned by the API.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Literal, Optional
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel, ValidationError

from .models import Flow, FlowEdge, FlowNode


class LLMError(Exception):
    pass


# ---------------------------------------------------------------- redaction
_PATTERNS = [
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[EMAIL]"),
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[ID]"),
    (re.compile(r"(?<!\w)\+?\d[\d\s().-]{8,}\d(?!\w)"), "[NUMBER]"),
    (re.compile(r"\b\d{6,}\b"), "[NUMBER]"),
]


def redact(text: str, extra_terms: list[str] | None = None) -> str:
    for term in sorted({t.strip() for t in (extra_terms or []) if t.strip()}, key=len, reverse=True):
        text = re.sub(re.escape(term), "[REDACTED]", text, flags=re.IGNORECASE)
    for pat, repl in _PATTERNS:
        text = pat.sub(repl, text)
    return text


# ------------------------------------------------------------------ tasks
Task = Literal["assumptions", "flow", "bullets", "tobe", "summary", "risks", "scope", "benefits", "outline"]


class LLMValidationError(LLMError):
    """The model replied, but the reply is unusable. Eligible for one repair retry."""


_SYSTEM = (
    "You help automation solution architects draft proposal slides. "
    "Reply with a single JSON object only, no prose, no markdown fences. "
    "Be concise and specific; never invent client names, figures or systems that are not in the input."
)

_KIND_GUIDE = (
    'Node kinds: "start"/"end" mark entry and exit; "process" is a generic step; "decision" is a yes/no check with '
    'exactly two outgoing edges labelled "Yes" and "No"; "bot" is a step done by the RPA bot; "human" is a manual step '
    'by an analyst/agent; "data" is a database, storage or queue; "ai" is an OCR, ML, NLP or GenAI step.'
)

OUTLINE_KINDS = ("summary", "asis", "tobe", "assumptions", "scope", "risks", "benefits", "gantt", "next_steps")

_TASK_PROMPTS: dict[str, str] = {
    "assumptions": (
        'Draft 6-10 project assumptions for an automation proposal as {"items": ["..."]}. Each item must be a specific, '
        "testable statement the project depends on: scope limits, data and environment access, access for the bot and "
        "its users, exception handling, UAT and SME involvement, cost basis, reassessment after requirements sign-off. "
        "Do not restate the process description and do not write filler (for example 'no changes will be made'). "
        "Each item is one sentence."
    ),
    "flow": (
        'Convert the process description into a flow as {"title": "...", "nodes": [{"id": "n1", "label": "...", '
        '"kind": "..."}], "edges": [{"src": "n1", "dst": "n2", "label": ""}], "notes": []}. '
        + _KIND_GUIDE +
        " Include exactly one start and at least one end. Connect every step. Labels are at most 8 words. "
        "Use ids n1, n2, ... and at most 14 nodes. Add an optional \"lane\" to a node only if the description names "
        "different actors."
    ),
    "tobe": (
        'You are given an AS-IS (manual) process. Design the TO-BE automated flow as {"title": "...", '
        '"lanes": ["..."], "nodes": [{"id": "n1", "label": "...", "kind": "...", "lane": "..."}], '
        '"edges": [{"src": "n1", "dst": "n2", "label": "", "note": ""}], "notes": []}. '
        + _KIND_GUIDE +
        " Use 2 to 4 lanes named by actor or system (for example RPA Bot, Analyst, GenAI); lanes are never decisions or "
        "step names; every node has a lane from "
        '"lanes". Use "ai" for OCR/ML/NLP/GenAI steps, "bot" for RPA steps, "human" for steps that stay manual '
        "(validation, exception handling) and route failures or exceptions to a human step. Set an edge \"note\" ONLY "
        "when the input states a figure such as an expected success rate; when it does, copy it as the note on the "
        "arrow leaving the automated step it applies to (for example \"~60-70% success expected\"). Never invent "
        "numbers. Include one start and "
        "at least one end. Labels at most 8 words; ids n1, n2, ...; at most 14 nodes."
    ),
    "bullets": (
        'Write a proposal-style summary as slide bullets: {"title": "...", "bullets": ["..."]} with 4-7 bullets. '
        "State what is proposed and the benefit; do not just repeat the input line by line."
    ),
    "outline": (
        'Plan a solution proposal deck from the brief as {"title": "...", "subtitle": "...", "slides": '
        '[{"kind": "...", "title": "..."}]}. Allowed kinds: ' + ", ".join(OUTLINE_KINDS) + ". "
        "summary = executive summary; asis = current manual process flow; tobe = automated flow in swimlanes; "
        "assumptions; scope; risks; benefits = benefit drivers and cost/CBA; gantt = execution plan; "
        "next_steps. Choose 5-10 slides in a sensible order, each kind at most once, with a short specific title. "
        "Include only slides the brief gives enough material for."
    ),
    "summary": (
        'Write an executive summary for the proposal as {"title": "Executive summary", "bullets": ["..."]} with 3-5 '
        "bullets: the problem, the proposed automation, the expected outcome and the key dependency. Use only facts "
        "and figures that appear in the input or the deck context; do not invent numbers."
    ),
    "risks": (
        'List 4-8 delivery risks and dependencies as {"items": [{"risk": "...", "impact": "Low|Medium|High", '
        '"mitigation": "..."}]}. Each risk is specific to the described process and systems (data quality, environment '
        "and access, SME availability, change control, volume or accuracy shortfalls), with one concrete mitigation. "
        "No generic filler and no invented figures."
    ),
    "scope": (
        'Split the described work into scope as {"in_scope": ["..."], "out_scope": ["..."]}, 3-8 items each. '
        "In scope: what the solution does. Out of scope: adjacent work a reader might assume is included but the "
        "input does not commit to. Do not invent systems or volumes."
    ),
    "benefits": (
        'Propose benefit drivers as {"drivers": [{"name": "...", "annual_volume": 0, "minutes_saved": 0, '
        '"hourly_rate": 0, "success_rate": 0}]} with 1-4 drivers (success_rate between 0 and 1). Fill a number ONLY '
        "when the input states it; otherwise use 0 so the user can enter it. Never estimate volumes, times or rates."
    ),
}

MAX_NODES = 14


class AssumptionsOut(BaseModel):
    items: list[str]


class BulletsOut(BaseModel):
    title: str = ""
    bullets: list[str]


class OutlineSlide(BaseModel):
    kind: str
    title: str = ""


class OutlineOut(BaseModel):
    title: str = ""
    subtitle: str = ""
    slides: list[OutlineSlide]


class RiskOut(BaseModel):
    risk: str
    impact: Literal["Low", "Medium", "High"] = "Medium"
    mitigation: str = ""


class RisksOut(BaseModel):
    items: list[RiskOut]


class ScopeOut(BaseModel):
    in_scope: list[str] = []
    out_scope: list[str] = []


class DriverOut(BaseModel):
    name: str
    annual_volume: float = 0
    minutes_saved: float = 0
    hourly_rate: float = 0
    success_rate: float = 1.0


class BenefitsOut(BaseModel):
    drivers: list[DriverOut]


def build_messages(task: str, text: str, do_redact: bool, terms: list[str] | None = None,
                   existing: list[str] | None = None, context: str = "",
                   library: dict[str, list[str]] | None = None) -> list[dict]:
    if task not in _TASK_PROMPTS:
        raise LLMError(f"unknown task '{task}'")
    red = (lambda t: redact(t, terms)) if do_redact else (lambda t: t)
    parts = [_TASK_PROMPTS[task]]
    if context.strip():
        parts.append(f'Deck context (for consistency, not to be repeated):\n"""\n{red(context.strip())}\n"""')
    if task == "assumptions":
        keep = [red(x) for x in (existing or []) if x.strip()][:20]
        if keep:
            parts.append("Existing assumptions (do not repeat or paraphrase these):\n" + "\n".join(f"- {x}" for x in keep))
        if library:
            ex = [v[0] for v in library.values() if v][:6]
            parts.append("Style examples from the team's library (match this tone and specificity):\n"
                         + "\n".join(f"- {x}" for x in ex))
    parts.append(f'Input:\n"""\n{red(text)}\n"""')
    return [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": "\n\n".join(parts)}]


def parse_output(task: str, raw: str) -> dict:
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        raise LLMValidationError("the reply was not a JSON object")
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError as e:
        raise LLMValidationError(f"the reply was invalid JSON: {e}") from e
    try:
        if task == "assumptions":
            out = AssumptionsOut.model_validate(data)
            return {"items": [i.strip() for i in out.items if i.strip()]}
        if task == "outline":
            return OutlineOut.model_validate(data).model_dump()
        if task == "risks":
            return RisksOut.model_validate(data).model_dump()
        if task == "scope":
            out = ScopeOut.model_validate(data)
            return {"in_scope": [i.strip() for i in out.in_scope if i.strip()],
                    "out_scope": [i.strip() for i in out.out_scope if i.strip()]}
        if task == "benefits":
            return BenefitsOut.model_validate(data).model_dump()
        if task in ("bullets", "summary"):
            out = BulletsOut.model_validate(data)
            return {"title": out.title, "bullets": [b.strip() for b in out.bullets if b.strip()]}
        flow = Flow.model_validate({"notes": [], **data})
        return flow.model_dump(mode="json")
    except ValidationError as e:
        raise LLMValidationError(f"the reply failed validation: {e.errors()[0]['msg']}") from e


# ------------------------------------------------------------ post-checks
def _key(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()


def _similar(a: str, b: str) -> bool:
    """Near-duplicate: very similar text, or one statement is contained in the other (at least 4 words)."""
    if a == b or SequenceMatcher(None, a, b).ratio() > 0.88:
        return True
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    return len(short.split()) >= 4 and short in long_


def _dedupe(items: list[str], existing: list[str], min_len: int, cap: int) -> tuple[list[str], int]:
    seen = [_key(x) for x in existing if x.strip()]
    out, dropped = [], 0
    for it in items:
        k = _key(it)
        if len(it) < min_len or any(_similar(k, s) for s in seen):
            dropped += 1
            continue
        seen.append(k)
        out.append(it)
    return out[:cap], dropped + max(0, len(out) - cap)


def _numbers(t: str) -> set[str]:
    out = set()
    for m in re.findall(r"\d+(?:[.,]\d+)*", t):
        out.add(m)
        out.add(m.replace(",", ""))
    return out


def _finalize_flow(data: dict, task: str, source_text: str) -> tuple[dict, list[str]]:
    flow = Flow.model_validate(data)
    warnings: list[str] = []
    ids = [n.id for n in flow.nodes]
    if not flow.nodes:
        raise LLMValidationError("the flow has no steps")
    if len(set(ids)) != len(ids):
        raise LLMValidationError("step ids must be unique")
    if len(ids) > MAX_NODES:
        raise LLMValidationError(f"the flow has {len(ids)} steps; use at most {MAX_NODES}")
    touched = {e.src for e in flow.edges} | {e.dst for e in flow.edges}
    if len(ids) > 1 and any(i not in touched for i in ids):
        raise LLMValidationError("every step must be connected by at least one arrow")

    nodes = [n.model_copy() for n in flow.nodes]
    edges = [e.model_copy() for e in flow.edges]

    # decisions: label the two branches when the model left them blank
    for n in nodes:
        outs = [e for e in edges if e.src == n.id]
        if n.kind == "decision" and len(outs) == 2 and not any(e.label.strip() for e in outs):
            outs[0].label, outs[1].label = "Yes", "No"
            warnings.append(f'Labelled the branches of "{n.label}" as Yes / No.')

    # lanes (To-Be)
    lanes = [x.strip() for x in flow.lanes if x.strip()]
    if task == "tobe":
        for n in nodes:
            if n.lane and n.lane not in lanes:
                lanes.append(n.lane)
        if not lanes:
            raise LLMValidationError("define 2 to 4 lanes and give every step a lane")
        for n in nodes:
            if not n.lane:
                n.lane = lanes[0]
                warnings.append(f'Placed "{n.label}" in lane "{lanes[0]}" (none given).')
        # a lane holding only decisions is not an actor: move them to the lane of the step that feeds them
        by_lane: dict[str, list] = {}
        for n in nodes:
            by_lane.setdefault(n.lane, []).append(n)
        for ln, members in by_lane.items():
            if members and all(m.kind == "decision" for m in members) and len(by_lane) > 1:
                for m in members:
                    src = next((e.src for e in edges if e.dst == m.id), None)
                    target = next((x.lane for x in nodes if x.id == src and x.lane != ln), None)
                    m.lane = target or next(l for l in by_lane if l != ln)
                lanes = [x for x in lanes if x != ln]
                warnings.append(f'Removed lane "{ln}" (it held only decisions).')

    # start / end
    indeg = {n.id: 0 for n in nodes}
    outdeg = {n.id: 0 for n in nodes}
    for e in edges:
        indeg[e.dst] += 1
        outdeg[e.src] += 1
    taken = set(ids)

    def new_id(base: str) -> str:
        k, cand = 1, base
        while cand in taken:
            k += 1
            cand = f"{base}{k}"
        taken.add(cand)
        return cand

    lane_of = {n.id: n.lane for n in nodes}
    if not any(n.kind == "start" for n in nodes):
        entries = [n for n in nodes if indeg[n.id] == 0]
        if 1 <= len(entries) <= 2:
            sid = new_id("start")
            nodes.insert(0, FlowNode(id=sid, label="Start", kind="start", lane=lane_of[entries[0].id]))
            edges = [FlowEdge(src=sid, dst=n.id) for n in entries] + edges
            warnings.append("Added a Start step.")
    if not any(n.kind == "end" for n in nodes):
        exits = [n for n in nodes if n.id in outdeg and outdeg[n.id] == 0 and n.kind != "start"]
        if 1 <= len(exits) <= 3:
            eid = new_id("end")
            nodes.append(FlowNode(id=eid, label="End", kind="end", lane=lane_of[exits[0].id]))
            edges += [FlowEdge(src=n.id, dst=eid) for n in exits]
            warnings.append("Added an End step.")

    # figures on arrows must come from the input
    allowed = _numbers(source_text)
    for e in edges:
        if e.note and not _numbers(e.note) <= allowed:
            warnings.append(f'Removed arrow tag "{e.note}": its figure is not in your input.')
            e.note = ""

    # surface things we will not guess at
    if task == "tobe" and not any(e.note for e in edges):
        pct = re.findall(r"~?\d+(?:\s*[-\u2013]\s*\d+)?\s*%", source_text)
        if pct:
            warnings.append(f'Your input mentions "{pct[0].strip()}" but no arrow carries it; select the arrow it applies to and add a tag.')
    for n in nodes:
        labels = [e.label.strip().lower() for e in edges if e.src == n.id and e.label.strip()]
        if n.kind == "decision" and len(labels) != len(set(labels)):
            warnings.append(f'"{n.label}" has two arrows with the same label; check the branches.')

    out = Flow(title=flow.title, nodes=nodes, edges=edges, notes=flow.notes, lanes=lanes if task == "tobe" else flow.lanes)
    return out.model_dump(mode="json"), warnings


def finalize(task: str, data: dict, source_text: str = "", existing: list[str] | None = None) -> tuple[dict, list[str]]:
    """Quality checks and safe normalisation. Raises LLMValidationError when the draft is not usable."""
    if task == "assumptions":
        items, dropped = _dedupe(data["items"], existing or [], min_len=15, cap=10)
        if len(items) < 3:
            raise LLMValidationError("fewer than 3 usable, non-duplicate assumptions; write more specific ones")
        return {"items": items}, ([f"Removed {dropped} duplicate, too-short or surplus item(s)."] if dropped else [])
    if task == "outline":
        seen, slides, warns = set(), [], []
        for sl in data["slides"]:
            kind = sl["kind"].strip().lower().replace("-", "_").replace(" ", "_")
            kind = {"as_is": "asis", "to_be": "tobe", "executive_summary": "summary", "plan": "gantt",
                    "cost": "benefits", "assumption": "assumptions", "risk": "risks"}.get(kind, kind)
            if kind not in OUTLINE_KINDS:
                warns.append(f'Dropped unknown slide kind "{sl["kind"]}".')
            elif kind in seen:
                warns.append(f'Dropped a second "{kind}" slide.')
            else:
                seen.add(kind)
                slides.append({"kind": kind, "title": sl["title"].strip()})
        if len(slides) < 2:
            raise LLMValidationError("the outline needs at least 2 known slide kinds")
        return {"title": data["title"].strip(), "subtitle": data["subtitle"].strip(), "slides": slides[:10]}, warns
    if task == "risks":
        seen, items, dropped = [], [], 0
        for r in data["items"]:
            k = _key(r["risk"])
            if len(r["risk"].strip()) < 10 or any(_similar(k, x) for x in seen):
                dropped += 1
                continue
            seen.append(k)
            items.append({**r, "risk": r["risk"].strip(), "mitigation": r["mitigation"].strip()})
        if len(items) < 2:
            raise LLMValidationError("fewer than 2 usable, distinct risks")
        warns = [f"Removed {dropped} duplicate or too-short risk(s)."] if dropped else []
        warns += [f'"{r["risk"][:40]}" has no mitigation.' for r in items if not r["mitigation"]]
        return {"items": items[:8]}, warns
    if task == "scope":
        ins, d1 = _dedupe(data["in_scope"], [], min_len=8, cap=8)
        outs, d2 = _dedupe(data["out_scope"], ins, min_len=8, cap=8)
        if not ins:
            raise LLMValidationError("no usable in-scope items")
        warns = [f"Removed {d1 + d2} duplicate or too-short item(s)."] if d1 + d2 else []
        if not outs:
            warns.append("No out-of-scope items were suggested; state exclusions explicitly.")
        return {"in_scope": ins, "out_scope": outs}, warns
    if task == "benefits":
        allowed = _numbers(source_text)
        warns, drivers = [], []
        for d in data["drivers"]:
            d = dict(d)
            for f in ("annual_volume", "minutes_saved", "hourly_rate"):
                v = d[f]
                txt = f"{v:g}"
                if v and not (txt in allowed or f"{v:,.0f}" in allowed or txt.rstrip("0").rstrip(".") in allowed):
                    warns.append(f'"{d["name"]}": cleared {f.replace("_", " ")} {txt} because it is not in your input.')
                    d[f] = 0
            if d["success_rate"] > 1 or d["success_rate"] < 0:
                d["success_rate"] = 1.0
            drivers.append(d)
        if not drivers:
            raise LLMValidationError("no benefit drivers returned")
        return {"drivers": drivers[:4]}, warns
    if task in ("bullets", "summary"):
        items, dropped = _dedupe(data["bullets"], [], min_len=3, cap=7)
        if len(items) < 2:
            raise LLMValidationError("fewer than 2 usable bullets")
        return {"title": data["title"], "bullets": items}, ([f"Removed {dropped} duplicate or surplus bullet(s)."] if dropped else [])
    return _finalize_flow(data, task, source_text)


def run_task(provider: "Provider", task: str, text: str, do_redact: bool = True, terms: list[str] | None = None,
             existing: list[str] | None = None, context: str = "", library: dict[str, list[str]] | None = None,
             client: Optional[httpx.Client] = None) -> tuple[dict, list[str]]:
    """Build the prompt, call the model, validate; one repair round trip if the reply is unusable."""
    msgs = build_messages(task, text, do_redact, terms, existing, context, library)
    last: LLMValidationError | None = None
    for _ in range(2):
        raw = provider.complete(msgs, client)
        try:
            return finalize(task, parse_output(task, raw), text, existing)
        except LLMValidationError as e:
            last = e
            msgs = msgs + [
                {"role": "assistant", "content": raw},
                {"role": "user", "content": f"That reply was rejected: {e}. Reply again with corrected JSON only."},
            ]
    assert last is not None
    raise last


# -------------------------------------------------------------- providers
@dataclass
class ProviderInfo:
    name: str
    configured: bool
    host: str = ""
    model: str = ""
    hint: str = ""


class Provider:
    name = "none"

    def info(self) -> ProviderInfo:
        return ProviderInfo(self.name, False, hint="Set LLM_PROVIDER and credentials in the environment.")

    def complete(self, messages: list[dict], client: Optional[httpx.Client] = None) -> str:
        raise LLMError("No LLM provider configured")


_REASONING = re.compile(r"^(gpt-5|o[0-9])", re.IGNORECASE)


class OpenAICompatible(Provider):
    """OpenAI, Ollama (http://localhost:11434/v1), LM Studio, or any compatible endpoint."""

    name = "openai-compatible"

    def __init__(self, base_url: str, api_key: str, model: str):
        self.base_url, self.api_key, self.model = base_url.rstrip("/"), api_key, model

    def info(self) -> ProviderInfo:
        return ProviderInfo(self.name, bool(self.base_url and self.model), urlparse(self.base_url).netloc, self.model)

    def complete(self, messages, client=None) -> str:
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        payload = {"model": self.model, "messages": messages, "response_format": {"type": "json_object"}}
        if not _REASONING.match(self.model):  # reasoning models only accept the default temperature
            payload["temperature"] = 0.2
        url = f"{self.base_url}/chat/completions"
        try:
            return _post(url, headers, payload, client)
        except LLMError as e:
            # Some local servers (e.g. LM Studio) reject json_object: retry once without it.
            if "HTTP 400" not in str(e):
                raise
            payload.pop("response_format")
            return _post(url, headers, payload, client)


class AzureOpenAI(Provider):
    name = "azure-openai"

    def __init__(self, endpoint: str, api_key: str, deployment: str, api_version: str):
        self.endpoint, self.api_key = endpoint.rstrip("/"), api_key
        self.deployment, self.api_version = deployment, api_version

    def info(self) -> ProviderInfo:
        ok = bool(self.endpoint and self.api_key and self.deployment)
        return ProviderInfo(self.name, ok, urlparse(self.endpoint).netloc, self.deployment)

    def complete(self, messages, client=None) -> str:
        url = (f"{self.endpoint}/openai/deployments/{self.deployment}/chat/completions"
               f"?api-version={self.api_version}")
        payload = {"messages": messages, "temperature": 0.2, "response_format": {"type": "json_object"}}
        return _post(url, {"api-key": self.api_key}, payload, client)


_HINTS = {
    401: "authentication failed: check the API key",
    403: "access denied: the key or project may not be allowed to use this model (or the organisation needs verification)",
    404: "model or deployment not found: check the model/deployment name",
    429: "rate limit or quota exceeded",
}
_SAFE_CODE = re.compile(r"^[A-Za-z0-9_.:-]{1,60}$")


def _http_error(r: httpx.Response) -> str:
    """Actionable but safe: HTTP status, a fixed hint and the provider's short error code only.

    The response body/message is never echoed because it may contain fragments of the request.
    """
    msg = f"LLM endpoint returned HTTP {r.status_code}"
    code = ""
    try:
        err = r.json().get("error", {})
        raw = str(err.get("code") or err.get("type") or "")
        code = raw if _SAFE_CODE.match(raw) else ""
    except (ValueError, AttributeError):
        pass
    if code:
        msg += f" ({code})"
    hint = _HINTS.get(r.status_code)
    return f"{msg}: {hint}" if hint else msg


def _post(url: str, headers: dict, payload: dict, client: Optional[httpx.Client]) -> str:
    own = client is None
    client = client or httpx.Client(timeout=90)
    try:
        r = client.post(url, headers=headers, json=payload)
    except httpx.HTTPError as e:
        raise LLMError(f"could not reach LLM endpoint: {type(e).__name__}") from e
    finally:
        if own:
            client.close()
    if r.status_code >= 400:
        raise LLMError(_http_error(r))
    try:
        return r.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, ValueError) as e:
        raise LLMError("unexpected response shape from LLM endpoint") from e


def get_provider(env: dict | None = None) -> Provider:
    env = os.environ if env is None else env
    kind = env.get("LLM_PROVIDER", "none").lower()
    if kind == "azure":
        return AzureOpenAI(env.get("AZURE_OPENAI_ENDPOINT", ""), env.get("AZURE_OPENAI_API_KEY", ""),
                           env.get("AZURE_OPENAI_DEPLOYMENT", ""), env.get("AZURE_OPENAI_API_VERSION", "2024-06-01"))
    if kind in ("openai", "ollama", "lmstudio", "openai-compatible"):
        default = "http://localhost:11434/v1" if kind == "ollama" else "https://api.openai.com/v1"
        return OpenAICompatible(env.get("OPENAI_BASE_URL", default), env.get("OPENAI_API_KEY", ""),
                                env.get("OPENAI_MODEL", ""))
    return Provider()
