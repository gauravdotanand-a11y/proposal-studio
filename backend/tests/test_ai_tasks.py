import json

from studio import evalset, llm


class Fake(llm.Provider):
    def __init__(self, reply):
        self.reply = reply

    def complete(self, messages, client=None):
        return json.dumps(self.reply)


def test_risks_dedupe_and_flags():
    prov = Fake({"items": [
        {"risk": "OCR accuracy lower on scanned invoices", "impact": "High", "mitigation": "Review thresholds"},
        {"risk": "OCR accuracy is lower on scanned invoices", "impact": "High", "mitigation": "x"},
        {"risk": "SME availability during UAT", "impact": "Medium", "mitigation": "Book slots"},
    ]})
    res, warns = llm.run_task(prov, "risks", "invoices")
    assert len(res["items"]) == 2 and warns


def test_scope_requires_in_scope():
    import pytest
    with pytest.raises(llm.LLMValidationError):
        llm.finalize("scope", {"in_scope": [], "out_scope": ["Payment processing"]})


def test_benefits_clears_invented_figures():
    prov = Fake({"drivers": [{"name": "Manual keying", "annual_volume": 5000, "minutes_saved": 12,
                              "hourly_rate": 45, "success_rate": 0.7}]})
    res, warns = llm.run_task(prov, "benefits", "5,000 cases a year, 12 minutes each, rate is 30 per hour")
    d = res["drivers"][0]
    assert d["annual_volume"] == 5000 and d["minutes_saved"] == 12 and d["hourly_rate"] == 0
    assert any("hourly rate" in w for w in warns)


def test_summary_uses_bullet_shape():
    prov = Fake({"title": "Executive summary", "bullets": ["Problem: manual keying", "Proposal: OCR and bot", "Outcome: faster close"]})
    res, _ = llm.run_task(prov, "summary", "text")
    assert len(res["bullets"]) == 3


def test_rubric_flags_bad_flow():
    case = next(c for c in evalset.CASES if c["task"] == "flow")
    bad = {"nodes": [{"id": "a", "label": "x", "kind": "process"}], "edges": [], "lanes": []}
    assert evalset.check(case, bad, [])


def test_outline_filters_unknown_and_duplicate_kinds():
    prov = Fake({"title": "Invoice automation", "subtitle": "Proposal", "slides": [
        {"kind": "Summary", "title": "Executive summary"}, {"kind": "as-is", "title": "x"},
        {"kind": "asis", "title": "Current process"}, {"kind": "asis", "title": "again"},
        {"kind": "risks", "title": "Risks"}]})
    res, warns = llm.run_task(prov, "outline", "brief")
    assert [s["kind"] for s in res["slides"]] == ["summary", "asis", "risks"]
    assert len(warns) == 2


def test_outline_needs_two_slides():
    import pytest
    with pytest.raises(llm.LLMValidationError):
        llm.finalize("outline", {"title": "", "subtitle": "", "slides": [{"kind": "nope", "title": ""}]})
