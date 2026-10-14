import { useEffect, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import type { Flow } from "./types";

interface LNode { id: string; label: string; kind: string; badge?: string; x: number; y: number; w: number; h: number }
interface LLane { name: string; x: number; y: number; w: number; h: number; label_w: number }
interface LEdge { src: string; dst: string; label: string; note?: string; note_box?: [number, number, number, number] | null; points: [number, number][]; label_x: number; label_y: number }
interface Layout { slide_w: number; slide_h: number; nodes: LNode[]; edges: LEdge[]; lanes?: LLane[]; overflow?: boolean; notes_top: number }

const EMU_PT = 12700; // EMU per point
const PT = 1; // geometry is converted to points on load
const IN = 72; // points per inch
const toPt = (l: Layout): Layout => ({
  slide_w: l.slide_w / EMU_PT, slide_h: l.slide_h / EMU_PT, notes_top: l.notes_top / EMU_PT,
  nodes: l.nodes.map((n) => ({ ...n, x: n.x / EMU_PT, y: n.y / EMU_PT, w: n.w / EMU_PT, h: n.h / EMU_PT })),
  lanes: (l.lanes ?? []).map((ln) => ({ ...ln, x: ln.x / EMU_PT, y: ln.y / EMU_PT, w: ln.w / EMU_PT, h: ln.h / EMU_PT, label_w: ln.label_w / EMU_PT })),
  overflow: l.overflow,
  edges: l.edges.map((e) => ({ ...e,
    note_box: e.note_box ? (e.note_box.map((v) => v / EMU_PT) as [number, number, number, number]) : null, points: e.points.map(([x, y]) => [x / EMU_PT, y / EMU_PT] as [number, number]),
    label_x: e.label_x / EMU_PT, label_y: e.label_y / EMU_PT })),
});
const FILL: Record<string, string> = { bot: "#7FC4D2", ai: "#FF4F1F", human: "#FFFFFF" };
const NAVY = "#1B2A7A";

const poly = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");

function shapeFor(n: LNode) {
  const fill = FILL[n.kind] ?? "#C9E8EE";
  const stroke = n.kind === "human" || n.kind === "decision" ? NAVY : fill;
  const common = { fill, stroke, strokeWidth: PT };
  if (n.kind === "decision")
    return <polygon points={`${n.x + n.w / 2},${n.y} ${n.x + n.w},${n.y + n.h / 2} ${n.x + n.w / 2},${n.y + n.h} ${n.x},${n.y + n.h / 2}`} {...common} />;
  if (n.kind === "data") {
    const ry = Math.min(10, n.h * 0.14);
    return (
      <g {...common}>
        <path d={`M${n.x},${n.y + ry} v${n.h - 2 * ry} a${n.w / 2},${ry} 0 0 0 ${n.w},0 v${-(n.h - 2 * ry)} a${n.w / 2},${ry} 0 0 0 ${-n.w},0 z`} />
        <path d={`M${n.x},${n.y + ry} a${n.w / 2},${ry} 0 0 0 ${n.w},0`} fill="none" />
      </g>
    );
  }
  if (n.kind === "start" || n.kind === "end")
    return <ellipse cx={n.x + n.w / 2} cy={n.y + n.h / 2} rx={n.w / 2} ry={n.h / 2} {...common} />;
  return <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={n.h * 0.16} {...common} />;
}

export type Selection = { kind: "node"; id: string } | { kind: "edge"; index: number } | null;

interface Props {
  flow: Flow;
  compact?: boolean;
  /** Click to select, drag from the handle of a selected step to connect or create. */
  interactive?: boolean;
  selection?: Selection;
  onSelect?: (s: Selection) => void;
  onConnect?: (src: string, dst: string) => void;
  onDropNew?: (src: string) => void;
}

const BLUE = "#1F6FEB";

export function FlowPreview({ flow, compact = false, interactive = false, selection = null, onSelect, onConnect, onDropNew }: Props) {
  const [lay, setLay] = useState<Layout | null>(null);
  const [err, setErr] = useState("");
  const [drag, setDrag] = useState<{ from: string; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const key = JSON.stringify([flow.nodes, flow.edges, flow.notes, flow.lanes]);

  useEffect(() => {
    if (flow.nodes.length === 0) { setLay(null); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/flow/layout", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal,
          body: JSON.stringify({ title: flow.title, nodes: flow.nodes, edges: flow.edges, notes: flow.notes, lanes: flow.lanes ?? [] }),
        });
        if (!r.ok) throw new Error(`layout failed (${r.status})`);
        setLay(toPt(await r.json())); setErr("");
      } catch (e) { if ((e as Error).name !== "AbortError") setErr(String(e)); }
    }, 200);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <Typography color="error" variant="body2">{err}</Typography>;
  if (!lay) return <Typography color="text.secondary">Add steps to see the diagram.</Typography>;

  const toSvg = (e: React.PointerEvent) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const m = svg.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
  };
  const nodeAt = (x: number, y: number) => lay.nodes.find((n) => x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h);
  const hover = drag ? nodeAt(drag.x, drag.y) : undefined;
  const none = interactive ? { pointerEvents: "none" as const } : {};

  const noteH = flow.notes.length * 0.3 * IN;
  const height = Math.min(lay.slide_h, Math.max(lay.notes_top + noteH + 0.3 * IN, lay.slide_h * 0.5));
  return (
    <Box sx={{ borderRadius: compact ? 1 : 2, overflow: "hidden", border: 1, borderColor: "divider", bgcolor: "#fff" }}>
      <svg ref={svgRef} viewBox={`0 0 ${lay.slide_w} ${height}`} width="100%" role="img" aria-label="Flow diagram preview"
        style={{ display: "block", touchAction: interactive ? "none" : undefined }}
        onClick={interactive ? () => onSelect?.(null) : undefined}
        onPointerMove={drag ? (e) => { const p2 = toSvg(e); setDrag({ ...drag, x: p2.x, y: p2.y }); } : undefined}
        onPointerUp={drag ? (e) => {
          const p2 = toSvg(e);
          const hit = nodeAt(p2.x, p2.y);
          setDrag(null);
          if (hit && hit.id !== drag.from) onConnect?.(drag.from, hit.id);
          else if (!hit) onDropNew?.(drag.from);
        } : undefined}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth={8} markerHeight={8} markerUnits="strokeWidth" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={NAVY} />
          </marker>
        </defs>
        <text x={0.6 * IN} y={0.8 * IN} fontSize={28 * PT} fontWeight={700} fill={NAVY} fontFamily="Arial, sans-serif">{flow.title}</text>
        {(lay.lanes ?? []).map((ln, i) => (
          <g key={ln.name}>
            <rect x={ln.x} y={ln.y} width={ln.w} height={ln.h} fill={i % 2 ? "#F1F8FA" : "#FFFFFF"} stroke="#7FC4D2" strokeWidth={0.75} />
            <rect x={ln.x} y={ln.y} width={ln.label_w} height={ln.h} fill="#C9E8EE" stroke="#7FC4D2" strokeWidth={0.75} />
            <foreignObject x={ln.x} y={ln.y} width={ln.label_w} height={ln.h}>
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center",
                fontSize: 11, fontWeight: 700, color: NAVY, fontFamily: "Arial, sans-serif", padding: "0 4px", boxSizing: "border-box" }}>{ln.name}</div>
            </foreignObject>
          </g>
        ))}
        {lay.edges.map((e, i) => {
          const sel = selection?.kind === "edge" && selection.index === i;
          return (
            <g key={i}>
              <path d={poly(e.points)} fill="none" stroke={sel ? BLUE : NAVY} strokeWidth={(sel ? 2.5 : 1.25) * PT} markerEnd="url(#arrow)" />
              {interactive && (
                <path d={poly(e.points)} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: "pointer" }}
                  onClick={(ev) => { ev.stopPropagation(); onSelect?.({ kind: "edge", index: i }); }} />
              )}
            </g>
          );
        })}
        {lay.nodes.map((n) => {
          const sel = selection?.kind === "node" && selection.id === n.id;
          return (
            <g key={n.id} style={interactive ? { cursor: "pointer" } : undefined}
              onClick={interactive ? (ev) => { ev.stopPropagation(); onSelect?.({ kind: "node", id: n.id }); } : undefined}>
              {shapeFor(n)}
              <foreignObject x={n.x} y={n.y} width={n.w} height={n.h} style={none}>
                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center",
                  padding: "0 5%", boxSizing: "border-box", fontSize: (n.w < 100 ? 9 : 10) * PT, fontFamily: "Arial, sans-serif", lineHeight: 1.15,
                  color: n.kind === "ai" ? "#fff" : NAVY, overflow: "hidden" }}>{n.label}</div>
              </foreignObject>
              {(sel || hover?.id === n.id) && (
                <rect x={n.x - 3} y={n.y - 3} width={n.w + 6} height={n.h + 6} rx={6} fill="none"
                  stroke={hover?.id === n.id && drag?.from !== n.id ? "#1A9E5C" : BLUE} strokeWidth={2} strokeDasharray={sel ? undefined : "4 3"} style={{ pointerEvents: "none" }} />
              )}
            </g>
          );
        })}
        {interactive && selection?.kind === "node" && (() => {
          const n = lay.nodes.find((x) => x.id === selection.id);
          if (!n) return null;
          return (
            <g>
              <title>Drag to another step to connect, or to empty space to add a step</title>
              <circle cx={n.x + n.w + 3} cy={n.y + n.h / 2} r={7} fill={BLUE} stroke="#fff" strokeWidth={1.5} style={{ cursor: "crosshair" }}
                onClick={(ev) => ev.stopPropagation()}
                onPointerDown={(ev) => {
                  ev.stopPropagation();
                  (ev.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(ev.pointerId);
                  const p2 = toSvg(ev);
                  setDrag({ from: n.id, x: p2.x, y: p2.y });
                }} />
              <path d={`M${n.x + n.w + 0.5},${n.y + n.h / 2} h5 m-2.5,-2.5 l2.5,2.5 l-2.5,2.5`} stroke="#fff" strokeWidth={1.4} fill="none" style={{ pointerEvents: "none" }} />
            </g>
          );
        })()}
        {drag && (() => {
          const n = lay.nodes.find((x) => x.id === drag.from);
          if (!n) return null;
          return <line x1={n.x + n.w + 3} y1={n.y + n.h / 2} x2={drag.x} y2={drag.y} stroke={BLUE} strokeWidth={2} strokeDasharray="5 4" style={{ pointerEvents: "none" }} />;
        })()}
        {lay.edges.filter((e) => e.note_box).map((e, i) => {
          const [x, y, w, h] = e.note_box!;
          return (
            <g key={`n${i}`}>
              <rect x={x} y={y} width={w} height={h} rx={5} fill="#BFD4F2" />
              <foreignObject x={x} y={y} width={w} height={h}>
                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center",
                  fontSize: 8, fontWeight: 700, color: NAVY, fontFamily: "Arial, sans-serif", padding: 2, boxSizing: "border-box", lineHeight: 1.1 }}>{e.note}</div>
              </foreignObject>
            </g>
          );
        })}
        {lay.nodes.filter((n) => n.badge).map((n) => (
          <g key={`b${n.id}`}>
            <rect x={n.x + 4.3} y={n.y - 7.2} width={44.6} height={14.4} rx={4} fill={n.kind === "ai" ? "#FF4F1F" : NAVY} />
            <text x={n.x + 4.3 + 22.3} y={n.y + 2.6} textAnchor="middle" fontSize={7} fontWeight={700} fill="#fff" fontFamily="Arial, sans-serif">{n.badge}</text>
          </g>
        ))}
        {lay.edges.filter((e) => e.label).map((e, i) => (
          <text key={i} x={e.label_x} y={e.label_y + 9 * PT} textAnchor="middle" fontSize={9 * PT} fontWeight={700} fill={NAVY} fontFamily="Arial, sans-serif">{e.label}</text>
        ))}
        {flow.notes.map((n, i) => (
          <text key={i} x={0.6 * IN} y={lay.notes_top + (i * 0.3 + 0.2) * IN} fontSize={10 * PT} fill="#555" fontFamily="Arial, sans-serif">* {n}</text>
        ))}
      </svg>
    </Box>
  );
}
