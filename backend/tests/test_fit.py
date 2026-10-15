import yaml

from studio import fit
from studio.models import Proposal

LONG = "Extremely long label text that keeps going to test wrapping inside boxes " * 2


def _deck(slides):
    return Proposal.model_validate({"meta": {"title": "T", "brand": "B", "footer": "f"}, "slides": slides})


def test_sample_deck_is_not_split():
    p = Proposal.model_validate(yaml.safe_load(open("../examples/sample.yaml")))
    pieces, notes = fit.expand(p)
    assert len(pieces) == len(p.slides)
    assert notes == []


def test_long_assumptions_split_without_losing_items():
    items = [LONG + str(i) for i in range(14)]
    pieces, notes = fit.expand(_deck([{"type": "assumptions", "assumptions": {"title": "A", "items": items, "numbered": True}}]))
    assert len(pieces) > 1 and notes
    got = [i for p in pieces for i in p.slide.assumptions.items]
    assert got == items
    assert pieces[1].opts["start"] == len(pieces[0].slide.assumptions.items)  # numbering continues
    assert pieces[1].slide.assumptions.title == "A (cont.)"


def test_moderate_list_shrinks_font_instead_of_splitting():
    items = ["A reasonably specific assumption sentence that wraps to a couple of lines on the slide " * 1 + str(i) for i in range(11)]
    pieces, _ = fit.expand(_deck([{"type": "bullets", "title": "B", "bullets": items}]))
    assert len(pieces) == 1 and pieces[0].opts["size"] <= 15


def test_gantt_split_keeps_all_activities_and_same_weeks():
    acts = [{"name": f"Activity {i}", "start_week": 1 + i % 10, "end_week": 3 + i % 10} for i in range(40)]
    pieces, notes = fit.expand(_deck([{"type": "gantt", "gantt": {"title": "G", "start_date": "2026-01-05", "activities": acts}}]))
    assert len(pieces) > 1 and notes
    assert sum(len(p.slide.gantt.activities) for p in pieces) == 40
    assert len({p.slide.gantt.weeks for p in pieces}) == 1


def test_cost_split_shows_totals_only_on_last_part():
    lines = [{"head": f"Cost head {i} " + "long " * 8, "values": [100, 200, 300, 400], "kind": "mixed"} for i in range(14)]
    cost = {"title": "Cost", "currency": "$", "years": ["Y0", "Y1", "Y2", "Y3"], "lines": lines, "benefits": [0, 0, 0, 0]}
    pieces, _ = fit.expand(_deck([{"type": "cost", "cost": cost}]))
    assert len(pieces) > 1
    assert [p.opts["final"] for p in pieces] == [False] * (len(pieces) - 1) + [True]
    assert sorted(i for p in pieces for i in p.opts["lines"]) == list(range(14))
    assert pieces[1].slide.cost.title == "Cost (cont.)"


def test_render_reports_fit_notes(tmp_path):
    from studio.render import render
    items = [LONG + str(i) for i in range(14)]
    p = _deck([{"type": "assumptions", "assumptions": {"title": "A", "items": items, "numbered": True}}])
    w: list[str] = []
    render(p, tmp_path / "x.pptx", warnings=w)
    assert any("split into" in m for m in w)


def test_gantt_chunks_respect_wrapped_row_heights():
    from pptx.util import Inches
    long_acts = [{"name": LONG * 2, "start_week": 1, "end_week": 3, "section": "S"} for _ in range(12)]
    pieces, _ = fit.expand(_deck([{"type": "gantt", "gantt": {"title": "G", "start_date": "2026-01-05", "activities": long_acts}}]))
    assert len(pieces) >= 3  # each wrapped row is tall, so few fit per slide
    for p in pieces:
        row_h = p.opts["row_h"]
        total = sum(fit.gantt_row_heights(p.slide.gantt.activities, row_h)) + row_h * 2
        assert total <= (7.5 - 1.3 - 1.4) * 914400 + 1


def _chain(n, lanes=None):
    nodes = [{"id": f"n{i}", "label": f"Step {i}", "kind": "process", **({"lane": lanes[i % len(lanes)]} if lanes else {})}
             for i in range(n)]
    edges = [{"src": f"n{i}", "dst": f"n{i + 1}", "label": ""} for i in range(n - 1)]
    return {"title": "Process", "nodes": nodes, "edges": edges, "notes": ["* note"]}


def test_small_flow_is_untouched():
    pieces, notes = fit.expand(_deck([{"type": "flow", "flow": _chain(8)}]))
    assert len(pieces) == 1 and notes == []


def test_dense_flow_is_split_into_linked_parts():
    pieces, notes = fit.expand(_deck([{"type": "flow", "flow": _chain(26)}]))
    assert len(pieces) >= 3 and notes
    real = [n.id for p in pieces for n in p.slide.flow.nodes if not n.id.startswith("cont_")]
    assert sorted(real) == sorted(f"n{i}" for i in range(26))  # every step appears exactly once
    for k, p in enumerate(pieces):
        f = p.slide.flow
        assert len([n for n in f.nodes if not n.id.startswith("cont_")]) <= 14
        assert f.title.endswith(f"(part {k + 1} of {len(pieces)})")
        if k < len(pieces) - 1:
            assert any(n.id.startswith("cont_out_") for n in f.nodes)
        if k > 0:
            assert any(n.id.startswith("cont_in_") for n in f.nodes)
    assert pieces[-1].slide.flow.notes == ["* note"] and pieces[0].slide.flow.notes == []


def test_swimlane_flow_with_many_columns_is_split_and_keeps_lanes():
    pieces, _ = fit.expand(_deck([{"type": "flow", "flow": {**_chain(12, ["Bot", "Analyst"]), "lanes": ["Bot", "Analyst"]}}]))
    assert len(pieces) >= 2
    for p in pieces:
        assert all(n.lane for n in p.slide.flow.nodes)


def test_branching_flow_edges_across_cut_are_all_represented():
    n = 20
    f = _chain(n)
    f["edges"].append({"src": "n2", "dst": "n15", "label": "Skip"})
    pieces, _ = fit.expand(_deck([{"type": "flow", "flow": f}]))
    outs = [e for p in pieces for e in p.slide.flow.edges if e.dst.startswith("cont_out_")]
    assert any(e.label == "Skip" for e in outs)
    from studio.models import Flow  # every part must still validate
    for p in pieces:
        Flow.model_validate(p.slide.flow.model_dump())


def test_continuation_shapes_are_merged_per_target_part():
    f = _chain(20)
    f["edges"] += [{"src": "n3", "dst": "n14", "label": ""}, {"src": "n4", "dst": "n15", "label": ""}]
    pieces, _ = fit.expand(_deck([{"type": "flow", "flow": f}]))
    for p in pieces:
        ids = [n.id for n in p.slide.flow.nodes]
        outs = [i for i in ids if i.startswith("cont_out_")]
        ins = [i for i in ids if i.startswith("cont_in_")]
        assert len(outs) == len(set(outs)) and len(ins) == len(set(ins))
    assert sum(1 for p in pieces[0].slide.flow.nodes if p.id.startswith("cont_out_")) <= len(pieces) - 1
