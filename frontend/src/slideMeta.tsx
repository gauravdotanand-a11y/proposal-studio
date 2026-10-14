import Title from "@mui/icons-material/TitleOutlined";
import Flow from "@mui/icons-material/AccountTreeOutlined";
import ListIcon from "@mui/icons-material/ChecklistOutlined";
import Bars from "@mui/icons-material/BarChartOutlined";
import Money from "@mui/icons-material/PaidOutlined";
import Notes from "@mui/icons-material/NotesOutlined";
import CompareArrows from "@mui/icons-material/CompareArrowsOutlined";
import FactCheck from "@mui/icons-material/FactCheckOutlined";
import WarningAmber from "@mui/icons-material/WarningAmberOutlined";
import PlaylistCheck from "@mui/icons-material/PlaylistAddCheckOutlined";
import Hub from "@mui/icons-material/HubOutlined";
import type { SlideType } from "./types";

export const LABEL: Record<SlideType, string> = {
  title: "Title", solution: "Solution overview", flow: "Flow diagram", compare: "Plan revision", scope: "Scope",
  risks: "Risks", next_steps: "Next steps", assumptions: "Assumptions", gantt: "Gantt plan", cost: "Cost & CBA", bullets: "Bullets",
};

export const ICON: Record<SlideType, JSX.Element> = {
  title: <Title fontSize="small" />, solution: <Hub fontSize="small" />, flow: <Flow fontSize="small" />,
  compare: <CompareArrows fontSize="small" />, scope: <FactCheck fontSize="small" />, risks: <WarningAmber fontSize="small" />,
  next_steps: <PlaylistCheck fontSize="small" />, assumptions: <ListIcon fontSize="small" />, gantt: <Bars fontSize="small" />,
  cost: <Money fontSize="small" />, bullets: <Notes fontSize="small" />,
};
