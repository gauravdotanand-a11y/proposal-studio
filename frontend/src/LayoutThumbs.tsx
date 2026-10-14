import { Box, Button, Stack, Typography } from "@mui/material";
import type { PreviewShape, TemplatePreview } from "./api";

const PT = 12700; // EMU per point

function Decor({ s }: { s: PreviewShape }) {
  const x = s.x / PT, y = s.y / PT, w = s.w / PT, h = s.h / PT;
  if (s.kind === "picture")
    return s.src
      ? <image href={s.src} x={x} y={y} width={w} height={h} preserveAspectRatio="xMidYMid meet" />
      : <rect x={x} y={y} width={w} height={h} fill="#bbb" opacity={0.5} />;
  if (s.kind === "placeholder")
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} fill="rgba(31,111,235,0.10)" stroke="#1F6FEB" strokeWidth={1.5} strokeDasharray="6 4" />
        <text x={x + 6} y={y + Math.min(h - 4, 22)} fontSize={Math.min(20, Math.max(11, h * 0.5))} fill="#1F6FEB"
          fontFamily="-apple-system, Arial, sans-serif">{s.label}</text>
      </g>
    );
  if (s.kind === "aux")
    return <rect x={x} y={y} width={w} height={h} fill="none" stroke="#999" strokeWidth={1} strokeDasharray="3 3" />;
  if (s.kind === "group")
    return <rect x={x} y={y} width={w} height={h} fill="none" stroke="#bbb" strokeWidth={1} />;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={s.fill ? `#${s.fill}` : "none"} stroke={s.fill ? "none" : "#bbb"} strokeWidth={1} />
      {s.label && <text x={x + 4} y={y + Math.min(h - 3, 16)} fontSize={Math.min(14, h * 0.6)} fill="#444">{s.label}</text>}
    </g>
  );
}

interface Props {
  data: TemplatePreview;
  titleLayout: number;
  contentLayout: number;
  onPick: (role: "title" | "content", index: number) => void;
}

export function LayoutThumbs({ data, titleLayout, contentLayout, onPick }: Props) {
  const W = data.slide_w / PT, H = data.slide_h / PT;
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 1.5, maxHeight: 360, overflowY: "auto", pr: 0.5 }}>
      {data.layouts.map((l) => {
        const isT = l.index === titleLayout, isC = l.index === contentLayout;
        return (
          <Box key={l.index} sx={{ border: 2, borderColor: isT || isC ? "primary.main" : "divider", borderRadius: 2, p: 0.75, bgcolor: "background.paper" }}>
            <Box sx={{ borderRadius: 1, overflow: "hidden", lineHeight: 0, border: 1, borderColor: "divider" }}>
              <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Layout ${l.name}`}>
                <rect width={W} height={H} fill={`#${l.background ?? data.background}`} />
                {l.show_master_shapes && data.master_shapes.map((s, i) => <Decor key={`m${i}`} s={s} />)}
                {l.shapes.map((s, i) => <Decor key={i} s={s} />)}
              </svg>
            </Box>
            <Typography variant="caption" noWrap sx={{ display: "block", mt: 0.5, fontWeight: 600 }} title={l.name}>{l.name}</Typography>
            <Stack direction="row" spacing={0.5}>
              <Button size="small" variant={isT ? "contained" : "text"} onClick={() => onPick("title", l.index)} sx={{ minWidth: 0, px: 1, fontSize: 11 }}>Title</Button>
              <Button size="small" variant={isC ? "contained" : "text"} onClick={() => onPick("content", l.index)} sx={{ minWidth: 0, px: 1, fontSize: 11 }}>Content</Button>
            </Stack>
          </Box>
        );
      })}
    </Box>
  );
}
