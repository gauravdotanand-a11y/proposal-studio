import { memo } from "react";
import { Box } from "@mui/material";
import { FlowPreview } from "./FlowPreview";
import { costSummary } from "./editors";
import { slideTitle } from "./factory";
import type { Gantt, Meta, Slide } from "./types";

const NAVY = "#1B2A7A", TEAL = "#C9E8EE", TEAL_D = "#7FC4D2", ORANGE = "#FF4F1F", GREY = "#C8CDD3";
const W = 160, H = 90;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function Lines({ x, y, count, w = 120, gap = 7 }: { x: number; y: number; count: number; w?: number; gap?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <rect key={i} x={x} y={y + i * gap} width={w * (0.55 + ((i * 37) % 45) / 100)} height={2.6} rx={1.3} fill={GREY} />
      ))}
    </>
  );
}

function MiniGantt({ g, x, y, w, h, bar }: { g: Gantt; x: number; y: number; w: number; h: number; bar: string }) {
  const weeks = g.weeks || Math.max(1, ...g.activities.map((a) => a.end_week));
  const rows = Math.min(g.activities.length, 8);
  const labelW = w * 0.28;
  const cell = (w - labelW) / weeks;
  const rh = (h - 5) / (rows + 1);
  return (
    <g>
      <rect x={x} y={y} width={w} height={rh} fill={NAVY} />
      {g.activities.slice(0, rows).map((a, i) => (
        <g key={i}>
          <rect x={x} y={y + (i + 1) * rh} width={labelW - 1} height={rh - 0.6} fill={TEAL} />
          <rect x={x + labelW + (a.start_week - 1) * cell} y={y + (i + 1) * rh + 0.5} width={(a.end_week - a.start_week + 1) * cell}
            height={rh - 1.6} fill={bar} />
        </g>
      ))}
    </g>
  );
}

function Body({ s, meta }: { s: Slide; meta: Meta }) {
  switch (s.type) {
    case "title":
      return (
        <>
          <text x={14} y={40} fontSize={11} fontWeight={700} fill={NAVY} fontFamily="Arial, sans-serif">{clip(meta.title, 26)}</text>
          <text x={14} y={54} fontSize={6.5} fill="#666" fontFamily="Arial, sans-serif">{clip(meta.subtitle, 40)}</text>
        </>
      );
    case "gantt":
      return s.gantt ? <MiniGantt g={s.gantt} x={10} y={26} w={140} h={56} bar={ORANGE} /> : null;
    case "compare":
      return s.compare ? (
        <>
          <MiniGantt g={s.compare.previous} x={10} y={26} w={140} h={27} bar={TEAL_D} />
          <MiniGantt g={s.compare.updated} x={10} y={56} w={140} h={27} bar={ORANGE} />
        </>
      ) : null;
    case "cost": {
      if (!s.cost) return null;
      const sum = costSummary(s.cost);
      const n = s.cost.years.length;
      const max = Math.max(1, ...sum.yearTotals, ...sum.benefits);
      const bw = 120 / n;
      return (
        <g>
          {sum.yearTotals.map((v, i) => {
            const hc = (v / max) * 46, hb = (sum.benefits[i] / max) * 46;
            return (
              <g key={i}>
                <rect x={16 + i * bw} y={80 - hc} width={bw * 0.38} height={hc} fill={NAVY} />
                <rect x={16 + i * bw + bw * 0.4} y={80 - hb} width={bw * 0.38} height={hb} fill={ORANGE} />
              </g>
            );
          })}
          <line x1={14} x2={150} y1={80} y2={80} stroke={GREY} />
        </g>
      );
    }
    case "solution":
      return s.solution ? (
        <>
          {s.solution.stages.map((st, i, a) => {
            const bw = (140 - (a.length - 1) * 4) / a.length;
            return <rect key={i} x={10 + i * (bw + 4)} y={28} width={bw} height={20} rx={3} fill={st.ai ? ORANGE : TEAL} />;
          })}
          <Lines x={10} y={58} count={4} w={60} />
          <Lines x={86} y={58} count={4} w={60} />
        </>
      ) : null;
    case "scope":
      return (
        <>
          <rect x={10} y={28} width={67} height={9} fill={TEAL} />
          <rect x={83} y={28} width={67} height={9} fill="#E6E6E6" />
          <Lines x={10} y={43} count={Math.min(5, s.scope?.in_scope.length ?? 3)} w={60} />
          <Lines x={83} y={43} count={Math.min(5, s.scope?.out_scope.length ?? 3)} w={60} />
        </>
      );
    case "risks":
    case "next_steps": {
      const n = Math.min(5, (s.risks?.items.length ?? s.next_steps?.items.length ?? 3));
      return (
        <>
          <rect x={10} y={26} width={140} height={8} fill={NAVY} />
          {Array.from({ length: n }, (_, i) => (
            <g key={i}>
              <rect x={10} y={36 + i * 9} width={140} height={7.4} fill={i % 2 ? "#F4F6F8" : "#EAEFF3"} />
              {s.type === "risks" && <rect x={62} y={37.4 + i * 9} width={14} height={4.6} rx={1} fill={i % 3 === 0 ? ORANGE : TEAL} />}
            </g>
          ))}
        </>
      );
    }
    default:
      return <Lines x={12} y={30} count={Math.min(7, Math.max(3, (s.assumptions?.items.length ?? s.bullets?.length ?? 4)))} w={130} gap={8} />;
  }
}

function SlideThumbImpl({ slide, meta }: { slide: Slide; meta: Meta }) {
  if (slide.type === "flow" && slide.flow) {
    return (
      <Box sx={{ lineHeight: 0 }}>
        <FlowPreview flow={slide.flow} compact />
      </Box>
    );
  }
  const title = slide.type === "title" ? "" : slideTitle(slide);
  return (
    <Box sx={{ lineHeight: 0, bgcolor: "#fff", borderRadius: 1, overflow: "hidden", border: 1, borderColor: "divider" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" aria-hidden="true">
        <rect width={W} height={H} fill="#fff" />
        {title && <text x={10} y={16} fontSize={8} fontWeight={700} fill={NAVY} fontFamily="Arial, sans-serif">{clip(title, 30)}</text>}
        <Body s={slide} meta={meta} />
      </svg>
    </Box>
  );
}

/** Re-render only when this slide (or the deck meta) changed; slides are updated immutably. */
export const SlideThumb = memo(SlideThumbImpl, (a, b) => a.slide === b.slide && a.meta === b.meta);
