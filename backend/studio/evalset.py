"""Small synthetic evaluation set for AI tasks, with rubric checks that need no judge model.

Run against the configured provider (synthetic data only):
    python -m studio.evalset [task ...]
"""
from __future__ import annotations

import re
import sys

from . import llm

CASES: list[dict] = [
    {
        "task": "assumptions",
        "text": "Bot reads invoices from a shared mailbox, extracts fields with OCR, validates against SOP rules and "
                "creates a record in the finance app. About 4,000 invoices a month. Exceptions go to an analyst.",
        "must_mention": ["exception", "access"],
    },
    {
        "task": "flow",
        "text": "Start. Bot picks the next ticket. Check if the ticket type is standard. If yes, bot updates the record "
                "and closes the ticket. If no, route to the manual queue. End.",
        "min_nodes": 5, "needs_decision": True,
    },
    {
        "task": "tobe",
        "text": "Analyst opens the case, reads the notes, copies fields into a sheet, checks them against a rulebook, "
                "and uploads the sheet. Expected automation success rate is about 60-70%.",
        "min_lanes": 2, "figures": ["60", "70"],
    },
    {
        "task": "risks",
        "text": "OCR extraction on scanned invoices, UAT depends on finance SMEs, test environment differs from production.",
        "min_items": 3,
    },
    {
        "task": "scope",
        "text": "Automate intake and validation of standard purchase invoices. Handwritten invoices and payment "
                "processing are not discussed.",
        "min_items": 2,
    },
    {
        "task": "benefits",
        "text": "5,000 cases a year, each takes 12 minutes manually, the loaded rate is 30 per hour.",
        "figures": ["5000", "12", "30"],
    },
    {
        "task": "summary",
        "text": "Finance receives invoices by email and keys them in by hand. We propose OCR plus a bot to create records "
                "and route exceptions to analysts. Depends on test data access.",
        "min_items": 3,
    },
]


def check(case: dict, result: dict, warnings: list[str]) -> list[str]:
    """Return a list of rubric failures (empty = pass)."""
    task, fails = case["task"], []
    blob = repr(result).lower()
    if task == "assumptions":
        items = result["items"]
        if len(items) < 4:
            fails.append("fewer than 4 assumptions")
        for w in case.get("must_mention", []):
            if w not in blob:
                fails.append(f"does not mention '{w}'")
    elif task in ("flow", "tobe"):
        nodes, edges = result["nodes"], result["edges"]
        if len(nodes) < case.get("min_nodes", 4):
            fails.append("too few steps")
        if sum(n["kind"] == "start" for n in nodes) != 1:
            fails.append("needs exactly one start")
        if not any(n["kind"] == "end" for n in nodes):
            fails.append("needs an end")
        if case.get("needs_decision"):
            for n in nodes:
                if n["kind"] == "decision":
                    labels = sorted(e["label"].lower() for e in edges if e["src"] == n["id"])
                    if labels != ["no", "yes"]:
                        fails.append(f"decision '{n['label']}' branches are {labels}")
        if task == "tobe" and len(result.get("lanes", [])) < case.get("min_lanes", 2):
            fails.append("needs at least 2 lanes")
        notes = " ".join(e["note"] for e in edges)
        for f in case.get("figures", []):
            if f not in notes and not any("figure is not in your input" in w for w in warnings) and f not in blob:
                fails.append(f"figure {f} missing")
    elif task == "risks":
        if len(result["items"]) < case.get("min_items", 3):
            fails.append("too few risks")
        if any(not r["mitigation"] for r in result["items"]):
            fails.append("risk without mitigation")
    elif task == "scope":
        if len(result["in_scope"]) < 2 or len(result["out_scope"]) < case.get("min_items", 2) - 1:
            fails.append("scope lists too short")
    elif task == "benefits":
        txt = case["text"].replace(",", "")
        for d in result["drivers"]:
            for f in ("annual_volume", "minutes_saved", "hourly_rate"):
                v = d[f]
                if v and f"{v:g}" not in re.findall(r"\d+(?:\.\d+)?", txt):
                    fails.append(f"invented {f}={v}")
    elif task == "summary":
        if not (case.get("min_items", 3) <= len(result["bullets"]) <= 7):
            fails.append("bullet count out of range")
    return fails


def run(tasks: list[str] | None = None, provider=None) -> list[dict]:
    provider = provider or llm.get_provider()
    rows = []
    for c in CASES:
        if tasks and c["task"] not in tasks:
            continue
        try:
            res, warns = llm.run_task(provider, c["task"], c["text"])
            rows.append({"task": c["task"], "fails": check(c, res, warns), "warnings": warns})
        except llm.LLMError as e:
            rows.append({"task": c["task"], "fails": [f"error: {e}"], "warnings": []})
    return rows


if __name__ == "__main__":
    out = run(sys.argv[1:] or None)
    for r in out:
        print(("PASS " if not r["fails"] else "FAIL ") + r["task"], "; ".join(r["fails"]))
    raise SystemExit(1 if any(r["fails"] for r in out) else 0)
