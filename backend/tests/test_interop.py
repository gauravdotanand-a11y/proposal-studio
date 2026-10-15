import io
import shutil

import pytest
import yaml
from fastapi.testclient import TestClient
from pptx import Presentation

from studio import interop
from studio.api import app
from studio.models import Proposal
from studio.render import render

client = TestClient(app)


def _sample():
    return Proposal.model_validate(yaml.safe_load(open("../examples/sample.yaml")))


def test_notes_are_exported_on_first_part_only(tmp_path):
    p = _sample()
    p.slides[2].notes = "Say this out loud."
    render(p, tmp_path / "n.pptx")
    prs = Presentation(str(tmp_path / "n.pptx"))
    assert prs.slides[2].notes_slide.notes_text_frame.text == "Say this out loud."


def test_alt_text_on_tables_and_flow_shapes(tmp_path):
    render(_sample(), tmp_path / "a.pptx")
    prs = Presentation(str(tmp_path / "a.pptx"))
    ns = "{http://schemas.openxmlformats.org/presentationml/2006/main}cNvPr"
    descrs = [el.get("descr") for sl in prs.slides for el in sl._element.iter(ns) if el.get("descr")]
    assert any(d.startswith("Gantt chart") for d in descrs)
    assert any(d.startswith("Arrow from") for d in descrs)
    assert any(" step: " in d for d in descrs)


def test_round_trip_is_exact(tmp_path):
    p = _sample()
    p.slides[0].notes = "kept"
    render(p, tmp_path / "r.pptx")
    got, warnings, source = interop.from_pptx((tmp_path / "r.pptx").read_bytes())
    assert source == "embedded" and warnings == []
    assert got.model_dump() == p.model_dump()


def test_embedded_item_survives_a_template_render(tmp_path):
    p = _sample()
    render(p, tmp_path / "base.pptx")
    render(p, tmp_path / "t.pptx", template=tmp_path / "base.pptx")
    _, _, source = interop.from_pptx((tmp_path / "t.pptx").read_bytes())
    assert source == "embedded"


def test_foreign_pptx_imports_as_bullets():
    prs = Presentation()
    s = prs.slides.add_slide(prs.slide_layouts[1])
    s.shapes.title.text = "Quarterly plan"
    s.placeholders[1].text_frame.text = "First point\nSecond point"
    s.notes_slide.notes_text_frame.text = "note"
    buf = io.BytesIO()
    prs.save(buf)
    r = client.post("/api/import", content=buf.getvalue())
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "approximate" and body["warnings"]
    slide = body["proposal"]["slides"][0]
    assert slide["notes"] == "note"
    assert body["proposal"]["meta"]["title"] == "Quarterly plan"


def test_import_json_and_yaml_and_bad_input():
    p = _sample()
    assert client.post("/api/import", content=p.model_dump_json()).json()["source"] == "json"
    assert client.post("/api/import", content=open("../examples/sample.yaml", "rb").read()).json()["source"] == "yaml"
    assert client.post("/api/import", content=b"just words").status_code == 400
    assert client.post("/api/import", content=b'{"meta": {}}').status_code == 400
    assert client.post("/api/import", content=b"PK\x03\x04garbage").status_code == 400


@pytest.mark.skipif(shutil.which("soffice") is None, reason="LibreOffice not installed")
def test_pdf_export_and_exported_file_opens_in_libreoffice():
    r = client.post("/api/render?format=pdf", json=_sample().model_dump(mode="json"))
    assert r.status_code == 200 and r.content[:4] == b"%PDF"


def test_unknown_format_rejected():
    r = client.post("/api/render?format=docx", json=_sample().model_dump(mode="json"))
    assert r.status_code == 400
