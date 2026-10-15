from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from studio import htmlimport
from studio.api import app

SAMPLE = Path(__file__).resolve().parents[2] / "examples" / "sample-deck.html"
client = TestClient(app)


def _import(html: str):
    return htmlimport.from_html(html.encode("utf-8"))


def test_sample_deck_maps_to_typed_slides():
    p, warnings, src = htmlimport.from_html(SAMPLE.read_bytes())
    assert src == "html"
    assert p.meta.title == "Invoice Intake Automation" and p.meta.subtitle == "OCR and RPA for purchase invoices"
    types = [s.type for s in p.slides]
    assert types == ["title", "bullets", "assumptions", "scope", "risks", "gantt", "cost", "flow", "bullets"]
    assert p.slides[0].notes.startswith("Welcome everyone")
    s = {s.type: s for s in p.slides}
    assert len(s["assumptions"].assumptions.items) == 3
    assert s["scope"].scope.in_scope[0].startswith("Standard") and s["scope"].scope.out_scope == ["Handwritten invoices", "Payment processing"]
    assert [r.impact for r in s["risks"].risks.items] == ["High", "Medium"]
    g = s["gantt"].gantt.activities
    assert [(a.name, a.start_week, a.end_week) for a in g] == [("Requirements", 1, 1), ("Build", 2, 3), ("UAT", 4, 4)]
    c = s["cost"].cost
    assert c.years == ["Y0", "Y1", "Y2"] and c.lines[0].values == [75000, 0, 0] and c.benefits == [20000, 180000, 180000]
    assert len(s["flow"].flow.nodes) == 6  # start + 4 steps + end
    assert any("image(s) were not imported" in w for w in warnings)


def test_scripts_are_never_executed_or_included():
    p, _, _ = _import("<html><body><section><h1>A</h1><p>real</p><script>document.write('evil')</script></section>"
                      "<section><h2>B</h2><ul><li>x</li></ul></section></body></html>")
    flat = " ".join(b for s in p.slides for b in ([s.title] + s.bullets))
    assert "evil" not in flat and "document" not in flat


def test_reveal_style_nested_sections_are_flattened():
    html = "<div class='reveal'><div class='slides'><section><h1>Deck</h1></section>" \
           "<section><section><h2>One</h2><p>a</p></section><section><h2>Two</h2><p>b</p></section></section></div></div>"
    p, _, _ = _import(html)
    assert [s.title for s in p.slides[1:]] == ["One", "Two"]


def test_heading_split_fallback_when_no_slide_markup():
    p, w, _ = _import("<body><h1>Title</h1><p>sub</p><h2>First</h2><ul><li>a</li></ul><h2>Second</h2><ul><li>b</li></ul></body>")
    assert [s.title for s in p.slides[1:]] == ["First", "Second"]
    assert any("headings" in m for m in w)


def test_unmatched_hint_falls_back_to_bullets_with_warning():
    p, w, _ = _import("<section data-type='risks'><h2>Risks</h2></section><section><h2>X</h2><p>y</p></section>")
    assert any("did not match" in m or "bullets" in m for m in w) or p.slides[1].type == "bullets"


def test_no_slides_is_an_error():
    with pytest.raises(ValueError):
        htmlimport.from_html(b"<html><body></body></html>")


def test_api_import_detects_html():
    r = client.post("/api/import", content=SAMPLE.read_bytes())
    assert r.status_code == 200 and r.json()["source"] == "html"
    assert client.post("/api/import", content=b"<html><body></body></html>").status_code == 400
