"""Fit content to the slide: estimate text height, shrink fonts, split long content into continuation slides.

Estimates are deliberately conservative averages (no font metrics are available), so a deck can still
differ slightly in PowerPoint; the goal is that nothing runs off the slide in normal use.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from pptx.util import Inches

from . import theme as T
from .layout import layers
from .models import Flow, FlowEdge, FlowNode, Proposal, Slide

PT = 12700
MIN_GANTT_ROW = Inches(0.26)
MAX_GANTT_ROW = Inches(0.4)


def est_lines(text: str, width: float, size_pt: float, bold: bool = False) -> int:
    """Approximate wrapped line count for text in a box `width` EMU wide."""
    per_line = max(1, int(width / PT / (size_pt * (0.56 if bold else 0.5))))
    return sum(max(1, math.ceil(len(p) / (per_line * 0.92))) for p in str(text or "").split("\n"))


def text_h(lines: int, size_pt: float, after_pt: float = 0.0) -> int:
    return int((lines * size_pt * 1.2 + after_pt) * PT)


def title_size(text: str, width: float, base: float = 28, lo: float = 18) -> float:
    """Largest size (not above `base`) that keeps the title within two lines."""
    for s in range(int(base), int(lo) - 1, -2):
        if est_lines(text, width, s, True) <= 2:
            return s
    return lo


@dataclass
class Piece:
    slide: Slide
    number: int  # 1-based slide number in the source deck
    part: int = 0
    parts: int = 1
    opts: dict = field(default_factory=dict)


def _cont(title: str, part: int) -> str:
    return f"{title} (cont.)" if part else title


def _content_h() -> int:
    return int(T.SLIDE_H - T.CONTENT_TOP - Inches(0.75))


# ---------------------------------------------------------------- bullets
BULLET_SIZES = (15, 14, 13, 12)


def _bullets_h(items, numbered, start, size) -> int:
    inner = T.SLIDE_W - 2 * T.MARGIN - Inches(0.2)
    total = 0
    for k, it in enumerate(items):
        prefix = f"{start + k + 1}. " if numbered else "• "
        total += text_h(est_lines(prefix + it, inner, size), size, 8)
    return total


def _split(items, fits):
    chunks, cur, start = [], [], 0
    for it in items:
        if cur and not fits(cur + [it], start):
            chunks.append((start, cur))
            start += len(cur)
            cur = [it]
        else:
            cur.append(it)
    chunks.append((start, cur))
    return chunks


def _pick_size(sizes, fits_at):
    for s in sizes:
        if fits_at(s):
            return s
    return None


# ----------------------------------------------------------------- tables
def table_row_h(cells: list[tuple[str, float, float, bool]], floor: float) -> int:
    """Height of a row from (text, column width, size_pt, bold) cells; margins included."""
    h = max(text_h(est_lines(t, w - Inches(0.1), s, b), s) for t, w, s, b in cells)
    return int(max(floor, h + Inches(0.08)))


def _chunk_rows(heights: list[int], avail: int):
    out, cur, used = [], [], 0
    for i, h in enumerate(heights):
        if cur and used + h > avail:
            out.append(cur)
            cur, used = [], 0
        cur.append(i)
        used += h
    out.append(cur)
    return out


# ------------------------------------------------------------------ gantt
def gantt_rows(activities) -> list[tuple[str, object]]:
    rows, last = [], ""
    for a in activities:
        if a.section and a.section != last:
            rows.append(("section", a.section))
        last = a.section or last
        rows.append(("act", a))
    return rows


def gantt_row_heights(activities, row_h: int, compact: bool = False) -> list[int]:
    name_w = Inches(2.9 if compact else 3.4)
    size = 9 if compact else 10
    out = []
    for kind, payload in gantt_rows(activities):
        if kind == "section":
            out.append(int(row_h))
        else:
            out.append(table_row_h([(payload.name, name_w, size, False)], row_h))
    return out


def plan_gantt(acts, avail: int):
    """Choose a row height and split activities into slides that fit `avail` (below the two header rows)."""
    avail = int(avail * 0.88)  # estimates run a little low for wrapped names
    for row_h in (MAX_GANTT_ROW, Inches(0.33), MIN_GANTT_ROW):
        heads = int(row_h * 2)
        if sum(gantt_row_heights(acts, row_h)) + heads <= avail:
            return [list(range(len(acts)))], row_h
    row_h = MIN_GANTT_ROW
    chunks, cur, used = [], [], int(row_h * 2)
    for i, a in enumerate(acts):
        extra = gantt_row_heights([a], row_h)[-1] + (int(row_h) if a.section and (not cur or acts[cur[-1]].section != a.section) else 0)
        if cur and used + extra > avail:
            chunks.append(cur)
            cur, used = [], int(row_h * 2)
        cur.append(i)
        used += extra
    chunks.append(cur)
    return chunks, row_h


# ------------------------------------------------------------------- flow
MAX_FLOW_NODES = 14
PART_NODES = 11
LANE_LAYERS = 8


def split_flow(f: Flow) -> list[Flow]:
    """Split a dense flow into linked parts at layer boundaries.

    Each cut gets an end shape ("Continues: <step>") in the earlier part and a start shape
    ("From previous slide") in the next, so the reader can follow the process across slides.
    Returns [f] when no split is needed.
    """
    lanes_mode = bool([x for x in f.lanes if x.strip()] or any(n.lane for n in f.nodes))
    layer = layers(f)
    n_layers = max(layer.values(), default=0) + 1
    if len(f.nodes) <= MAX_FLOW_NODES and not (lanes_mode and n_layers > LANE_LAYERS + 1):
        return [f]
    by_layer: dict[int, list[FlowNode]] = {}
    for n in f.nodes:
        by_layer.setdefault(layer[n.id], []).append(n)
    parts_n = max(math.ceil(len(f.nodes) / PART_NODES), math.ceil(n_layers / LANE_LAYERS) if lanes_mode else 1, 2)
    target = len(f.nodes) / parts_n
    groups: list[list[int]] = [[]]
    count = 0
    for li in sorted(by_layer):
        size = len(by_layer[li])
        if groups[-1] and (count + size > PART_NODES or (count >= target and len(groups) < parts_n)
                           or (lanes_mode and len(groups[-1]) >= LANE_LAYERS)):
            groups.append([])
            count = 0
        groups[-1].append(li)
        count += size
    if len(groups) < 2:
        return [f]
    part_of = {n.id: gi for gi, g in enumerate(groups) for li in g for n in by_layer[li]}
    nodes_by_id = {n.id: n for n in f.nodes}
    total = len(groups)
    out: list[Flow] = []
    for gi in range(total):
        nodes = [n.model_copy() for n in f.nodes if part_of[n.id] == gi]
        edges: list[FlowEdge] = []
        extra_in: dict[str, str] = {}
        for e in f.edges:
            a, b = part_of[e.src], part_of[e.dst]
            if a == gi and b == gi:
                edges.append(e.model_copy())
            elif a == gi:  # leaves this part
                oid = f"cont_out_{e.src}_{e.dst}"
                lbl = f"To part {b + 1}"
                nodes.append(FlowNode(id=oid, label=lbl, kind="end", lane=nodes_by_id[e.src].lane))
                edges.append(FlowEdge(src=e.src, dst=oid, label=e.label, note=e.note))
            elif b == gi:  # arrives from an earlier/later part
                if e.dst not in extra_in:
                    iid = f"cont_in_{e.dst}"
                    extra_in[e.dst] = iid
                    src_part = a + 1
                    nodes.append(FlowNode(id=iid, label=f"From part {src_part}", kind="start", lane=nodes_by_id[e.dst].lane))
                    edges.append(FlowEdge(src=iid, dst=e.dst))
        title = f"{f.title} (part {gi + 1} of {total})"
        used = {n.lane for n in nodes if n.lane}
        out.append(Flow(title=title, nodes=nodes, edges=edges, notes=f.notes if gi == total - 1 else [],
                        lanes=[x for x in f.lanes if x in used] if f.lanes else []))
    return out


# ------------------------------------------------------------------- main
def expand(proposal: Proposal) -> tuple[list[Piece], list[tuple[int, str]]]:
    """Turn the deck into renderable pieces and collect (slide number, message) fit notes."""
    pieces: list[Piece] = []
    notes: list[tuple[int, str]] = []
    full_w = T.SLIDE_W - 2 * T.MARGIN
    for n, s in enumerate(proposal.slides, start=1):
        if s.type in ("assumptions", "bullets"):
            a = s.assumptions
            items = list(a.items if s.type == "assumptions" else (s.bullets or []))
            numbered = bool(a.numbered) if a else False
            title = (a.title if a else s.title) or ""
            avail = _content_h()
            size = _pick_size(BULLET_SIZES, lambda z: _bullets_h(items, numbered, 0, z) <= avail)
            if size is not None:
                if size < 15:
                    notes.append((n, f"text reduced to {size}pt to fit"))
                pieces.append(Piece(s, n, opts={"size": size, "start": 0}))
                continue
            chunks = _split(items, lambda c, st: _bullets_h(c, numbered, st, 12) <= avail)
            notes.append((n, f"too long for one slide: split into {len(chunks)} slides at 12pt"))
            for p, (start, chunk) in enumerate(chunks):
                c = s.model_copy(deep=True)
                if c.assumptions is not None:
                    c.assumptions.items, c.assumptions.title = chunk, _cont(title, p)
                else:
                    c.bullets, c.title = chunk, _cont(title, p)
                pieces.append(Piece(c, n, p, len(chunks), {"size": 12, "start": start}))
        elif s.type in ("risks", "next_steps"):
            avail = _content_h() - Inches(0.45)
            if s.type == "risks":
                widths = [5, 1.4, 5]
                rows = [[i.risk, i.impact, i.mitigation] for i in s.risks.items]
            else:
                widths = [0.5, 7, 2.2, 1.8]
                rows = [[str(k), i.action, i.owner, i.due] for k, i in enumerate(s.next_steps.items, 1)]
            total = sum(widths)
            cols = [full_w * w / total for w in widths]
            heights = [table_row_h([(t, cols[c], 11, False) for c, t in enumerate(r)], Inches(0.32)) for r in rows]
            groups = _chunk_rows(heights, int(avail))
            if len(groups) == 1:
                pieces.append(Piece(s, n))
                continue
            notes.append((n, f"too long for one slide: split into {len(groups)} slides"))
            for p, g in enumerate(groups):
                c = s.model_copy(deep=True)
                node = c.risks if s.type == "risks" else c.next_steps
                node.items = [node.items[i] for i in g]
                node.title = _cont(node.title, p)
                pieces.append(Piece(c, n, p, len(groups), {"start": g[0]}))
        elif s.type == "scope":
            sc = s.scope
            col_w = (full_w - Inches(0.4)) / 2 - Inches(0.2)
            avail = int(T.SLIDE_H - T.CONTENT_TOP - Inches(1.9) - Inches(0.55))

            def col_h(items, size):
                return sum(text_h(est_lines("• " + t, col_w, size), size, 6) for t in items)
            size = _pick_size((13, 12, 11), lambda z: max(col_h(sc.in_scope, z), col_h(sc.out_scope, z)) <= avail)
            if size is not None:
                if size < 13:
                    notes.append((n, f"text reduced to {size}pt to fit"))
                pieces.append(Piece(s, n, opts={"size": size}))
                continue
            ci, co = _chunk_rows([col_h([t], 11) for t in sc.in_scope], avail), _chunk_rows([col_h([t], 11) for t in sc.out_scope], avail)
            k = max(len(ci), len(co))
            notes.append((n, f"too long for one slide: split into {k} slides"))
            for p in range(k):
                c = s.model_copy(deep=True)
                c.scope.in_scope = [sc.in_scope[i] for i in (ci[p] if p < len(ci) else [])]
                c.scope.out_scope = [sc.out_scope[i] for i in (co[p] if p < len(co) else [])]
                c.scope.title = _cont(sc.title, p)
                if p < k - 1:
                    c.scope.note = ""
                pieces.append(Piece(c, n, p, k, {"size": 11}))
        elif s.type == "gantt":
            g = s.gantt
            avail = int(T.SLIDE_H - Inches(1.3) - (T.CONTENT_TOP + Inches(0.1)))
            chunks, row_h = plan_gantt(g.activities, avail)
            if len(chunks) > 1:
                notes.append((n, f"{len(g.activities)} activities: split into {len(chunks)} slides"))
            elif row_h <= MIN_GANTT_ROW:
                notes.append((n, "rows are at minimum height; consider fewer activities"))
            for p, idx in enumerate(chunks):
                c = s.model_copy(deep=True) if len(chunks) > 1 else s
                if len(chunks) > 1:
                    c.gantt.activities = [g.activities[i] for i in idx]
                    c.gantt.title = _cont(g.title, p)
                    c.gantt.weeks = g.weeks or g.week_count  # keep identical week columns on every part
                    if p < len(chunks) - 1:
                        c.gantt.note = ""
                pieces.append(Piece(c, n, p, len(chunks), {"row_h": row_h}))
        elif s.type == "cost":
            c0 = s.cost
            width = full_w
            row_h = Inches(0.3)
            line_h = [table_row_h([(ln.head, Inches(3.2), 11, False)], row_h) for ln in c0.lines]
            fixed = Inches(0.45) * 2 + Inches(0.3) + Inches(0.5) + Inches(0.3) + Inches(0.8)
            if c0.drivers:
                fixed += sum(text_h(est_lines(f"{d.name}: {d.annual_volume:,.0f} items/yr x {d.minutes_saved:g} min x "
                                              f"{c0.currency}{d.hourly_rate:g}/h x {d.success_rate:.0%} success", width, 9), 9)
                             for d in c0.drivers) + Inches(0.3)
            avail = _content_h()
            if sum(line_h) + fixed <= avail:
                pieces.append(Piece(s, n, opts={"row_h": row_h}))
                continue
            # last slide carries totals, CBA and benefits; earlier slides only the cost lines
            last_cap = max(avail - fixed, Inches(0.6))
            idx = list(range(len(c0.lines)))
            tail, used = [], 0
            for i in reversed(idx):
                if tail and used + line_h[i] > last_cap:
                    break
                tail.insert(0, i)
                used += line_h[i]
            head = idx[: len(idx) - len(tail)]
            groups = [g for g in _chunk_rows([line_h[i] for i in head], int(avail - Inches(0.45))) ] if head else []
            groups = [[head[j] for j in g] for g in groups] + [tail]
            notes.append((n, f"too many cost lines for one slide: split into {len(groups)} slides"))
            for p, g in enumerate(groups):
                c = s.model_copy(deep=True)
                c.cost.title = _cont(c0.title, p)
                pieces.append(Piece(c, n, p, len(groups), {"row_h": row_h, "lines": g, "final": p == len(groups) - 1}))
        elif s.type == "compare":
            c = s.compare
            rows = sum(len(gantt_rows(gg.activities)) + 2 for gg in (c.previous, c.updated))
            if rows * Inches(0.22) > T.SLIDE_H - Inches(2.6):
                notes.append((n, "too many activities for one comparison slide; rows are tight, consider fewer activities"))
            pieces.append(Piece(s, n))
        elif s.type == "flow":
            parts = split_flow(s.flow)
            if len(parts) > 1:
                notes.append((n, f"{len(s.flow.nodes)} steps are too many for one diagram: split into {len(parts)} linked slides"))
            for p, part in enumerate(parts):
                c = s.model_copy(deep=True) if len(parts) > 1 else s
                if len(parts) > 1:
                    c.flow = part
                pieces.append(Piece(c, n, p, len(parts)))
        else:
            pieces.append(Piece(s, n))
    return pieces, notes
