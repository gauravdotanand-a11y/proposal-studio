import yaml
from pathlib import Path

from studio.layout import layout_flow
from studio.models import Flow
from studio import theme as T

SAMPLE = Path(__file__).parents[2] / "examples" / "sample.yaml"


def _sample_flow() -> Flow:
    d = yaml.safe_load(SAMPLE.read_text())
    return Flow.model_validate(next(s["flow"] for s in d["slides"] if s["type"] == "flow"))


def _stress_flow() -> Flow:
    nodes = [{"id": f"n{i}", "label": f"Step {i}", "kind": "decision" if i % 3 == 2 else "process"} for i in range(14)]
    edges = [{"src": f"n{i}", "dst": f"n{i+1}", "label": "Yes" if i % 3 == 2 else ""} for i in range(13)]
    edges += [{"src": "n2", "dst": "n13", "label": "No"}, {"src": "n5", "dst": "n11", "label": "No"},
              {"src": "n8", "dst": "n13", "label": "No"}, {"src": "n11", "dst": "n3", "label": "Retry"}]
    return Flow.model_validate({"title": "t", "nodes": nodes, "edges": edges})


def _hit(p, q, box, pad=1):
    (x1, y1), (x2, y2) = p, q
    bx, by, bw, bh = box
    return (max(x1, x2) > bx + pad and min(x1, x2) < bx + bw - pad
            and max(y1, y2) > by + pad and min(y1, y2) < by + bh - pad)


def _check(f: Flow):
    lay = layout_flow(f)
    boxes = {n["id"]: (n["x"], n["y"], n["w"], n["h"]) for n in lay["nodes"]}
    for n in lay["nodes"]:  # inside the slide, no overlap between nodes
        assert 0 <= n["x"] and n["x"] + n["w"] <= lay["slide_w"]
        assert 0 <= n["y"] and n["y"] + n["h"] <= lay["slide_h"]
    ids = list(boxes)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            assert not _hit((boxes[a][0], boxes[a][1]), (boxes[a][0] + boxes[a][2], boxes[a][1] + boxes[a][3]), boxes[b], 0)
    for e in lay["edges"]:
        pts = e["points"]
        assert len(pts) >= 2
        for p, q in zip(pts, pts[1:]):
            assert abs(p[0] - q[0]) <= 1 or abs(p[1] - q[1]) <= 1, "segments must be orthogonal"
            for nid, box in boxes.items():
                if nid in (e["src"], e["dst"]):
                    continue
                assert not _hit(p, q, box), f"edge {e['src']}->{e['dst']} crosses node {nid}"
    return lay


def test_sample_routes_cleanly():
    lay = _check(_sample_flow())
    assert len(lay["edges"]) == 8


def test_stress_routes_cleanly_and_deterministic():
    f = _stress_flow()
    assert _check(f) == layout_flow(f)


def test_snake_wrap_drops_vertically():
    nodes = [{"id": f"n{i}", "label": str(i), "kind": "process"} for i in range(7)]
    edges = [{"src": f"n{i}", "dst": f"n{i+1}", "label": ""} for i in range(6)]
    lay = layout_flow(Flow.model_validate({"title": "t", "nodes": nodes, "edges": edges}))
    wrap = next(e for e in lay["edges"] if e["src"] == "n4")
    assert len(wrap["points"]) == 2 and wrap["points"][0][0] == wrap["points"][1][0]
    pos = {n["id"]: n for n in lay["nodes"]}
    assert pos["n5"]["x"] == pos["n4"]["x"] and pos["n6"]["x"] < pos["n5"]["x"]


def test_branch_goes_below_parent():
    f = _sample_flow()
    pos = {n["id"]: n for n in layout_flow(f)["nodes"]}
    assert pos["validate"]["y"] < pos["manual"]["y"] or pos["validate"]["x"] != pos["manual"]["x"]


def _lane_flow() -> Flow:
    return Flow.model_validate({
        "title": "To be",
        "nodes": [
            {"id": "a", "label": "Pick case", "kind": "bot", "lane": "RPA Bot"},
            {"id": "b", "label": "Extract", "kind": "ai", "lane": "RPA Bot"},
            {"id": "c", "label": "Save", "kind": "data", "lane": "RPA Bot"},
            {"id": "d", "label": "Validate", "kind": "human", "lane": "Agent"},
            {"id": "e", "label": "Download", "kind": "process", "lane": "Agent"},
            {"id": "f", "label": "Extra", "kind": "process", "lane": "Agent"},
        ],
        "edges": [{"src": "a", "dst": "b"}, {"src": "b", "dst": "c", "note": "~60-70% success expected"},
                  {"src": "c", "dst": "d"}, {"src": "d", "dst": "e"}, {"src": "d", "dst": "f", "label": "No"}],
    })


def test_swimlane_places_nodes_in_lane_bands():
    lay = _check(_lane_flow())
    assert [l["name"] for l in lay["lanes"]] == ["RPA Bot", "Agent"]
    bands = {l["name"]: (l["y"], l["y"] + l["h"]) for l in lay["lanes"]}
    for n in lay["nodes"]:
        lo, hi = bands[n["lane"]]
        assert lo <= n["y"] and n["y"] + n["h"] <= hi
    # one layer per column, left to right
    xs = {n["id"]: n["x"] for n in lay["nodes"]}
    assert xs["a"] < xs["b"] < xs["c"] < xs["d"] < xs["e"]
    assert {n["id"]: n["badge"] for n in lay["nodes"]}["b"] == "AI"


def test_edge_note_box_inside_slide():
    lay = layout_flow(_lane_flow())
    e = next(e for e in lay["edges"] if e["note"])
    x, y, w, h = e["note_box"]
    assert 0 <= x and x + w <= lay["slide_w"] and 0 <= y and y + h <= lay["slide_h"]


def test_many_layers_shrinks_boxes_and_flags_overflow():
    nodes = [{"id": f"n{i}", "label": str(i), "lane": "A" if i % 2 else "B"} for i in range(14)]
    edges = [{"src": f"n{i}", "dst": f"n{i+1}"} for i in range(13)]
    lay = layout_flow(Flow.model_validate({"title": "t", "nodes": nodes, "edges": edges}))
    assert lay["overflow"] is True
    assert all(n["x"] + n["w"] <= lay["slide_w"] for n in lay["nodes"])
