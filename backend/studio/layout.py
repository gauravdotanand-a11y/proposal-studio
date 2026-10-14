"""Deterministic flow auto-layout and edge routing.

Single source of truth for both the .pptx renderer and the web preview.
All geometry is in EMU, slide-relative.

Strategy
- Longest-path layering (cycles tolerated: back edges are ignored for layering).
- Layers wrap into bands of PER_ROW columns; odd bands run right-to-left ("snake"), so a
  wrap-over edge is a short vertical drop instead of a long return line.
- Rows: the first outgoing branch (Yes, or first listed) stays in the parent's row; other
  branches go to the rows below, so decisions read as "main path across, exceptions down".
- Routing: orthogonal polylines picked from a short list of candidates; the first one that
  avoids every other node wins (fewest collisions otherwise).
"""
from __future__ import annotations

from pptx.util import Inches

from . import theme as T
from .models import Flow

PER_ROW = 5
BOX_W = Inches(1.75)
BOX_H = Inches(0.95)
DECISION_EXTRA_H = Inches(0.15)
MAX_CELL_H = Inches(1.3)
MIN_CELL_H = Inches(1.15)
TOP = Inches(1.4)
BAND_GAP = Inches(0.2)
FOOTER_RESERVE = Inches(0.75)
PAD = Inches(0.03)
LABEL_W = Inches(0.5)

# connection-site indices on rect-like shapes: 0=top 1=left 2=bottom 3=right
TOP_SITE, LEFT_SITE, BOTTOM_SITE, RIGHT_SITE = 0, 1, 2, 3

_YES = {"yes", "y", "true", "ok", "pass"}
_NO = {"no", "n", "false", "fail"}


# ----------------------------------------------------------------- layering
def layers(flow: Flow) -> dict[str, int]:
    """Longest-path layering; back edges (cycles) are ignored for layering."""
    out: dict[str, list[str]] = {n.id: [] for n in flow.nodes}
    indeg = {n.id: 0 for n in flow.nodes}
    for e in flow.edges:
        out[e.src].append(e.dst)
        indeg[e.dst] += 1
    state: dict[str, int] = {}
    back: set[tuple[str, str]] = set()

    def dfs(u: str) -> None:
        state[u] = 1
        for v in out[u]:
            if state.get(v) == 1:
                back.add((u, v))
            elif v not in state:
                dfs(v)
        state[u] = 2

    for n in flow.nodes:
        if indeg[n.id] == 0 and n.id not in state:
            dfs(n.id)
    for n in flow.nodes:
        if n.id not in state:
            dfs(n.id)
    layer = {n.id: 0 for n in flow.nodes}
    for _ in range(len(flow.nodes)):
        changed = False
        for e in flow.edges:
            if (e.src, e.dst) in back:
                continue
            if layer[e.dst] < layer[e.src] + 1:
                layer[e.dst] = layer[e.src] + 1
                changed = True
        if not changed:
            break
    return layer


def _rank(label: str) -> int:
    lab = label.strip().lower()
    return 0 if lab in _YES else (2 if lab in _NO else 1)


def _assign_rows(f: Flow, layer: dict[str, int]) -> dict[str, int]:
    index = {n.id: i for i, n in enumerate(f.nodes)}
    outs: dict[str, list] = {n.id: [] for n in f.nodes}
    for e in f.edges:
        outs[e.src].append(e)
    by_layer: dict[int, list] = {}
    for n in f.nodes:
        by_layer.setdefault(layer[n.id], []).append(n)

    desired: dict[str, int] = {}
    row: dict[str, int] = {}
    for l in sorted(by_layer):
        used: set[int] = set()
        for n in sorted(by_layer[l], key=lambda n: (desired.get(n.id, 0), index[n.id])):
            r = desired.get(n.id, 0)
            while r in used:
                r += 1
            used.add(r)
            row[n.id] = r
        for n in sorted(by_layer[l], key=lambda n: row[n.id]):
            k = 0
            for e in sorted(outs[n.id], key=lambda e: _rank(e.label)):  # stable
                if layer[e.dst] > l and e.dst not in desired:
                    desired[e.dst] = row[n.id] + k
                    k += 1
    return row


# ------------------------------------------------------------------ routing
Box = tuple[float, float, float, float]  # x, y, w, h
Pt = tuple[float, float]


def _hits(points: list[Pt], boxes: list[Box]) -> int:
    n = 0
    for (x1, y1), (x2, y2) in zip(points, points[1:]):
        lo_x, hi_x, lo_y, hi_y = min(x1, x2), max(x1, x2), min(y1, y2), max(y1, y2)
        for bx, by, bw, bh in boxes:
            if hi_x > bx - PAD and lo_x < bx + bw + PAD and hi_y > by - PAD and lo_y < by + bh + PAD:
                n += 1
    return n


def _length(points: list[Pt]) -> float:
    return sum(abs(a[0] - b[0]) + abs(a[1] - b[1]) for a, b in zip(points, points[1:]))


def _dedupe(points: list[Pt]) -> list[Pt]:
    out: list[Pt] = []
    for p in points:
        if not out or abs(out[-1][0] - p[0]) > 1 or abs(out[-1][1] - p[1]) > 1:
            out.append(p)
    # drop collinear middle points
    i = 1
    while i < len(out) - 1:
        a, b, c = out[i - 1], out[i], out[i + 1]
        if (abs(a[0] - b[0]) < 1 and abs(b[0] - c[0]) < 1) or (abs(a[1] - b[1]) < 1 and abs(b[1] - c[1]) < 1):
            out.pop(i)
        else:
            i += 1
    return out


def _candidates(S: Box, D: Box, gutter: float, corr: float) -> list[list[Pt]]:
    sx, sy, sw, sh = S
    dx, dy, dw, dh = D
    scx, scy, dcx, dcy = sx + sw / 2, sy + sh / 2, dx + dw / 2, dy + dh / 2
    sr, sb, st, sl = sx + sw, sy + sh, sy, sx
    dr, db, dt, dl = dx + dw, dy + dh, dy, dx
    c: list[list[Pt]] = []
    if dl >= sr:  # destination to the right
        if abs(scy - dcy) < 1:
            c.append([(sr, scy), (dl, dcy)])
        for gx in (dl - gutter / 2, sr + gutter / 2):
            c.append([(sr, scy), (gx, scy), (gx, dcy), (dl, dcy)])
        c.append([(scx, sb if dcy > scy else st), (scx, dcy), (dl, dcy)])
        ys = sb + corr  # corridor just below the source row
        c.append([(scx, sb), (scx, ys), (dl - gutter / 2, ys), (dl - gutter / 2, dcy), (dl, dcy)])
    elif dr <= sl:  # destination to the left (snake bands)
        if abs(scy - dcy) < 1:
            c.append([(sl, scy), (dr, dcy)])
        for gx in (dr + gutter / 2, sl - gutter / 2):
            c.append([(sl, scy), (gx, scy), (gx, dcy), (dr, dcy)])
        c.append([(scx, sb if dcy > scy else st), (scx, dcy), (dr, dcy)])
        ys = sb + corr
        c.append([(scx, sb), (scx, ys), (dr + gutter / 2, ys), (dr + gutter / 2, dcy), (dr, dcy)])
    else:  # columns overlap: same column or adjacent offset
        if dt >= sb:
            c.append([(scx, sb), (dcx, dt)] if abs(scx - dcx) < 1 else [(scx, sb), (scx, (sb + dt) / 2), (dcx, (sb + dt) / 2), (dcx, dt)])
            yd = dt - corr
            c.append([(scx, sb), (scx, sb + corr), (dcx, sb + corr), (dcx, dt)])
            c.append([(scx, sb), (scx, yd), (dcx, yd), (dcx, dt)])
        elif db <= st:
            c.append([(scx, st), (dcx, db)] if abs(scx - dcx) < 1 else [(scx, st), (scx, (st + db) / 2), (dcx, (st + db) / 2), (dcx, db)])
        for gx in (max(sr, dr) + gutter / 2, min(sl, dl) - gutter / 2):
            start = (sr, scy) if gx > scx else (sl, scy)
            end = (dr, dcy) if gx > dcx else (dl, dcy)
            c.append([start, (gx, scy), (gx, dcy), end])
    # last resort: out the bottom, along the corridor, into the top
    yb = max(sb, db) + corr
    c.append([(scx, sb), (scx, yb), (dcx, yb), (dcx, db)])
    return c


def _route(S: Box, D: Box, obstacles: list[Box], gutter: float, corr: float) -> list[Pt]:
    best, best_key = None, None
    for cand in _candidates(S, D, gutter, corr):
        pts = _dedupe([(float(x), float(y)) for x, y in cand])
        if len(pts) < 2:
            continue
        key = (_hits(pts, obstacles), _length(pts))
        if best_key is None or key < best_key:
            best, best_key = pts, key
        if key[0] == 0:
            break
    assert best is not None
    return best


def _site_of(box: Box, p: Pt) -> int | None:
    x, y, w, h = box
    sites = {TOP_SITE: (x + w / 2, y), LEFT_SITE: (x, y + h / 2),
             BOTTOM_SITE: (x + w / 2, y + h), RIGHT_SITE: (x + w, y + h / 2)}
    for idx, (sx, sy) in sites.items():
        if abs(sx - p[0]) < 2 and abs(sy - p[1]) < 2:
            return idx
    return None


LABEL_W, LABEL_H = Inches(0.4), Inches(0.25)


def _label_candidates(points: list[Pt]) -> list[tuple[int, int]]:
    """Possible (centre x, top y) spots for an edge label, best first.

    Sibling edges leave a decision from the same point, so the caller picks the first
    spot that does not collide with an earlier label; the later spots stay inside the
    first segment so they never straddle the bend.
    """
    (x0, y0), (x1, y1) = points[0], points[1]
    half = LABEL_W / 2
    if abs(y0 - y1) < 1:  # horizontal first segment
        sign = 1 if x1 > x0 else -1
        seg = abs(x1 - x0)
        inner = min(half + Inches(0.02), max(seg / 2, half * 0.6))
        cx_in = x0 + sign * max(inner, min(seg - half, half + Inches(0.02)))
        return [(int(x0 + sign * Inches(0.3)), int(y0 - LABEL_H - Inches(0.02))),
                (int(cx_in), int(y0 + Inches(0.03))),
                (int(x0 + sign * Inches(0.3)), int(y0 + Inches(0.03)))]
    sign = 1 if y1 > y0 else -1
    top = y0 + Inches(0.05) if sign > 0 else y0 - LABEL_H - Inches(0.05)
    return [(int(x0 + Inches(0.3)), int(top)), (int(x0 - Inches(0.3)), int(top)),
            (int(x0 + Inches(0.3)), int(top + sign * LABEL_H))]


def _overlap(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> bool:
    return a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]


def _pick_label(points: list[Pt], taken: list[tuple], boxes: list[Box]) -> tuple[int, int]:
    cands = _label_candidates(points)
    for cx, ty in cands:
        r = (cx - LABEL_W / 2, ty, LABEL_W, LABEL_H)
        if not any(_overlap(r, t) for t in taken) and not any(_overlap(r, b) for b in boxes):
            taken.append(r)
            return cx, ty
    cx, ty = cands[0]
    taken.append((cx - LABEL_W / 2, ty, LABEL_W, LABEL_H))
    return cx, ty


# ------------------------------------------------------------ shared pieces
_BADGES = {"bot": "BOT", "human": "MANUAL", "data": "DB", "ai": "AI"}


def _lane_order(f: Flow) -> list[str]:
    lanes = [x for x in f.lanes if x.strip()]
    for n in f.nodes:
        if n.lane and n.lane not in lanes:
            lanes.append(n.lane)
    return lanes


def _note_box(pts: list[Pt], gutter: float) -> tuple[int, int, int, int]:
    """Box (x, y, w, h) for an edge annotation, beside the longest segment."""
    best = max(zip(pts, pts[1:]), key=lambda s: abs(s[0][0] - s[1][0]) + abs(s[0][1] - s[1][1]))
    (x0, y0), (x1, y1) = best
    h = Inches(0.5)
    if abs(y0 - y1) < 1:  # horizontal segment: tag sits under the arrow, inside the gutter
        w = min(max(gutter * 0.9, Inches(0.7)), Inches(1.1))
        return int((x0 + x1) / 2 - w / 2), int(y0 + Inches(0.06)), int(w), int(h)
    w = Inches(1.0)
    return int(x0 + Inches(0.08)), int((y0 + y1) / 2 - h / 2), int(w), int(h)


def _build_edges(f: Flow, pos: dict[str, Box], gap_x: float, corr: float) -> list[dict]:
    edges = []
    taken: list[tuple] = []
    for e in f.edges:
        obstacles = [b for i, b in pos.items() if i not in (e.src, e.dst)]
        pts = _route(pos[e.src], pos[e.dst], obstacles, gap_x, corr)
        lx, ly = _pick_label(pts, taken, list(pos.values())) if e.label else _label_candidates(pts)[0]
        edge = {"src": e.src, "dst": e.dst, "label": e.label, "note": e.note,
                "points": [[int(round(px)), int(round(py))] for px, py in pts],
                "label_x": lx, "label_y": ly, "begin_site": None, "end_site": None, "note_box": None}
        if len(pts) == 2:
            edge["begin_site"] = _site_of(pos[e.src], pts[0])
            edge["end_site"] = _site_of(pos[e.dst], pts[1])
        if e.note:
            edge["note_box"] = list(_note_box(pts, gap_x))
        edges.append(edge)
    return edges


def _node_dicts(f: Flow, pos: dict[str, Box]) -> list[dict]:
    return [{"id": n.id, "label": n.label, "kind": n.kind, "lane": n.lane, "badge": _BADGES.get(n.kind, ""),
             "x": int(pos[n.id][0]), "y": int(pos[n.id][1]), "w": int(pos[n.id][2]), "h": int(pos[n.id][3])}
            for n in f.nodes]


# ------------------------------------------------------------------- swimlane
def _swimlane(f: Flow, lanes: list[str], top_y: float) -> dict:
    layer = layers(f)
    n_layers = max(layer.values()) + 1
    label_w = Inches(1.15)
    left = T.MARGIN
    avail_w = T.SLIDE_W - 2 * T.MARGIN - label_w
    gutter_min, gutter_floor = Inches(0.4), Inches(0.15)
    n_gaps = max(0, n_layers - 1)
    roomy = (avail_w - gutter_min * n_gaps) / n_layers
    if roomy >= Inches(0.95):
        box_w = min(float(BOX_W), roomy)
    else:  # squeeze: keep everything on the slide, shrinking boxes (and flag it)
        box_w = min(Inches(0.95), (avail_w - gutter_floor * n_gaps) / n_layers)
    gap_x = (avail_w - n_layers * box_w) / n_gaps if n_gaps else 0.0
    overflow = box_w < Inches(0.8)

    lane_of = {n.id: (n.lane if n.lane in lanes else lanes[0]) for n in f.nodes}
    # stack nodes that share a lane and a layer
    slot: dict[str, int] = {}
    seen: dict[tuple[str, int], int] = {}
    for n in f.nodes:
        key = (lane_of[n.id], layer[n.id])
        slot[n.id] = seen.get(key, 0)
        seen[key] = slot[n.id] + 1
    lane_rows = {ln: 1 for ln in lanes}
    for n in f.nodes:
        lane_rows[lane_of[n.id]] = max(lane_rows[lane_of[n.id]], slot[n.id] + 1)

    avail_h = T.SLIDE_H - FOOTER_RESERVE - top_y
    total_rows = sum(lane_rows.values())
    cell_h = MAX_CELL_H
    if total_rows * cell_h > avail_h:
        cell_h = max(MIN_CELL_H - Inches(0.1), avail_h / total_rows)
    corr = (cell_h - BOX_H) / 2

    lane_top, y = {}, float(top_y)
    lane_boxes = []
    for ln in lanes:
        lane_top[ln] = y
        hh = lane_rows[ln] * cell_h
        lane_boxes.append({"name": ln, "x": int(left), "y": int(y), "w": int(T.SLIDE_W - 2 * T.MARGIN),
                           "h": int(hh), "label_w": int(label_w)})
        y += hh

    pos: dict[str, Box] = {}
    for n in f.nodes:
        h = BOX_H + DECISION_EXTRA_H if n.kind == "decision" else BOX_H
        x = left + label_w + layer[n.id] * (box_w + gap_x)
        cy = lane_top[lane_of[n.id]] + slot[n.id] * cell_h + cell_h / 2
        pos[n.id] = (float(int(x)), float(int(cy - h / 2)), float(int(box_w)), float(int(h)))

    return {
        "slide_w": int(T.SLIDE_W), "slide_h": int(T.SLIDE_H),
        "nodes": _node_dicts(f, pos), "edges": _build_edges(f, pos, gap_x, corr),
        "lanes": lane_boxes, "overflow": overflow,
        "notes_top": int(y + Inches(0.1)),
    }


# --------------------------------------------------------------------- main
def layout_flow(f: Flow, top: float | None = None) -> dict:
    top_y = TOP if top is None else top
    lanes = _lane_order(f)
    if lanes and f.nodes:
        return _swimlane(f, lanes, top_y)
    # columns adapt to the slide width (4:3 templates get 4 columns instead of 5)
    per_row = int(max(3, min(PER_ROW, (T.SLIDE_W - 2 * T.MARGIN + Inches(0.5)) // (BOX_W + Inches(0.55)))))
    layer = layers(f) if f.nodes else {}
    row = _assign_rows(f, layer) if f.nodes else {}
    gap_x = (T.SLIDE_W - 2 * T.MARGIN - per_row * BOX_W) / (per_row - 1)

    n_layers = (max(layer.values()) + 1) if layer else 0
    n_bands = (n_layers + per_row - 1) // per_row
    band_rows = []
    for b in range(n_bands):
        ids = [i for i, l in layer.items() if b * per_row <= l < (b + 1) * per_row]
        band_rows.append(max(row[i] for i in ids) + 1)

    avail = T.SLIDE_H - FOOTER_RESERVE - top_y - max(0, n_bands - 1) * BAND_GAP
    cell_h = MAX_CELL_H
    if band_rows and sum(band_rows) * cell_h > avail:
        cell_h = max(MIN_CELL_H, avail / sum(band_rows))
    corr = (cell_h - BOX_H) / 2  # half the free corridor between rows

    band_top, y = [], float(top_y)
    for r in band_rows:
        band_top.append(y)
        y += r * cell_h + BAND_GAP

    pos: dict[str, Box] = {}
    for n in f.nodes:
        b, col = divmod(layer[n.id], per_row)
        if b % 2 == 1:  # snake: odd bands run right-to-left
            col = per_row - 1 - col
        x = T.MARGIN + col * (BOX_W + gap_x)
        h = BOX_H + DECISION_EXTRA_H if n.kind == "decision" else BOX_H
        top = band_top[b] + row[n.id] * cell_h - (h - BOX_H) / 2
        pos[n.id] = (float(int(x)), float(int(top)), float(int(BOX_W)), float(int(h)))

    return {
        "slide_w": int(T.SLIDE_W), "slide_h": int(T.SLIDE_H),
        "nodes": _node_dicts(f, pos), "edges": _build_edges(f, pos, gap_x, corr),
        "lanes": [], "overflow": False,
        "notes_top": int(y + Inches(0.05)),
    }
