"""Domain model: the single source of truth for a proposal deck."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


class Meta(BaseModel):
    title: str
    subtitle: str = ""
    footer: str = ""
    brand: str = ""


class FlowNode(BaseModel):
    id: str
    label: str
    kind: Literal["start", "process", "decision", "bot", "human", "data", "ai", "end"] = "process"
    lane: Optional[str] = None


class FlowEdge(BaseModel):
    src: str
    dst: str
    label: str = ""
    note: str = ""  # highlighted annotation on the arrow, e.g. "~60-70% success expected"


class Flow(BaseModel):
    title: str
    nodes: list[FlowNode]
    edges: list[FlowEdge]
    notes: list[str] = []
    lanes: list[str] = []  # optional explicit swimlane order; lanes are also inferred from node.lane

    @model_validator(mode="after")
    def _check_refs(self) -> "Flow":
        ids = {n.id for n in self.nodes}
        for e in self.edges:
            if e.src not in ids or e.dst not in ids:
                raise ValueError(f"edge {e.src}->{e.dst} references unknown node")
        return self


class Activity(BaseModel):
    name: str
    start_week: int = Field(ge=1)
    end_week: int = Field(ge=1)
    section: str = ""  # consecutive activities with the same section share a header band

    @model_validator(mode="after")
    def _order(self) -> "Activity":
        if self.end_week < self.start_week:
            raise ValueError(f"activity '{self.name}': end_week < start_week")
        return self


class Gantt(BaseModel):
    title: str = "High Level Execution Plan"
    start_date: date
    weeks: Optional[int] = None  # inferred from activities when omitted
    activities: list[Activity]
    note: str = ""
    holidays: list[date] = []  # days off; week labels start/end on working days

    @property
    def week_count(self) -> int:
        return self.weeks or max(a.end_week for a in self.activities)

    def week_range(self, week: int) -> tuple[date, date]:
        """Monday..Friday of 1-based week, anchored at start_date."""
        monday = self.start_date - timedelta(days=self.start_date.weekday())
        s = monday + timedelta(weeks=week - 1)
        days = [s + timedelta(days=i) for i in range(5)]
        work = [d for d in days if d not in set(self.holidays)]
        return (work[0], work[-1]) if work else (days[0], days[-1])


class CostLine(BaseModel):
    head: str
    values: list[float]  # one per year, Y0..Yn
    kind: Literal["one_time", "recurring", "mixed"] = "mixed"


class Driver(BaseModel):
    """Benefit driver: volume x minutes saved x hourly rate x success rate (x ramp-up per year)."""
    name: str
    annual_volume: float = Field(ge=0)
    minutes_saved: float = Field(ge=0)
    hourly_rate: float = Field(ge=0)
    success_rate: float = Field(default=1.0, ge=0, le=1)
    ramp: list[float] = []  # per-year multiplier (e.g. [0.1, 1, 1, 1]); empty = 100% every year

    def values(self, n_years: int) -> list[float]:
        ramp = self.ramp or [1.0] * n_years
        base = self.annual_volume * self.minutes_saved / 60.0 * self.hourly_rate * self.success_rate
        return [base * r for r in ramp]


class Cost(BaseModel):
    title: str = "Cost"
    currency: str = "$"
    years: list[str] = ["Y0", "Y1", "Y2", "Y3"]
    lines: list[CostLine]
    benefits: list[float] = []  # manual benefits per year; added to calculated drivers
    drivers: list[Driver] = []

    @model_validator(mode="after")
    def _lengths(self) -> "Cost":
        n = len(self.years)
        if self.benefits and len(self.benefits) != n:
            raise ValueError("benefits must be empty or have one value per year")
        if any(len(l.values) != n for l in self.lines):
            raise ValueError("every cost line must have one value per year")
        if any(d.ramp and len(d.ramp) != n for d in self.drivers):
            raise ValueError("driver ramp must be empty or have one value per year")
        if not self.benefits and not self.drivers:
            raise ValueError("provide benefits or at least one benefit driver")
        return self

    @property
    def year_totals(self) -> list[float]:
        return [sum(l.values[i] for l in self.lines) for i in range(len(self.years))]

    @property
    def total_cost(self) -> float:
        return sum(self.year_totals)

    @property
    def benefit_values(self) -> list[float]:
        n = len(self.years)
        out = [self.benefits[i] if self.benefits else 0.0 for i in range(n)]
        for d in self.drivers:
            for i, v in enumerate(d.values(n)):
                out[i] += v
        return out

    @property
    def total_benefit(self) -> float:
        return sum(self.benefit_values)

    @property
    def cba(self) -> float:
        return self.total_benefit / self.total_cost if self.total_cost else 0.0

    @property
    def one_time_total(self) -> float:
        return sum(sum(l.values) for l in self.lines if l.kind == "one_time")

    @property
    def recurring_total(self) -> float:
        return sum(sum(l.values) for l in self.lines if l.kind == "recurring")


class Compare(BaseModel):
    """Previous vs updated execution plan (e.g. after a re-baseline)."""
    title: str = "Plan revision"
    previous_label: str = "Previous version"
    updated_label: str = "Updated version"
    previous: Gantt
    updated: Gantt

    @property
    def changed(self) -> list[str]:
        old = {a.name: (a.start_week, a.end_week) for a in self.previous.activities}
        return [a.name for a in self.updated.activities if old.get(a.name) != (a.start_week, a.end_week)]

    @property
    def delta_weeks(self) -> int:
        return self.updated.week_count - self.previous.week_count


class ScopeSpec(BaseModel):
    title: str = "Scope"
    in_scope: list[str] = []
    out_scope: list[str] = []
    note: str = ""


class Risk(BaseModel):
    risk: str
    impact: Literal["Low", "Medium", "High"] = "Medium"
    mitigation: str = ""


class Risks(BaseModel):
    title: str = "Risks and dependencies"
    items: list[Risk]


class NextStep(BaseModel):
    action: str
    owner: str = ""
    due: str = ""


class NextSteps(BaseModel):
    title: str = "Next steps"
    items: list[NextStep]


class Assumptions(BaseModel):
    title: str = "Assumptions"
    items: list[str]
    numbered: bool = True


class Stage(BaseModel):
    heading: str = ""  # label above the box, e.g. "ML / GenAI"
    title: str
    body: str = ""
    ai: bool = False


class TextBlock(BaseModel):
    heading: str
    text: str


class Step(BaseModel):
    label: str = ""
    text: str


class Solution(BaseModel):
    title: str = "Solution overview"
    stages: list[Stage] = Field(min_length=1, max_length=7)
    blocks: list[TextBlock] = []
    steps_title: str = "High Level End to End Flow"
    steps: list[Step] = []


class Slide(BaseModel):
    type: Literal["title", "assumptions", "gantt", "cost", "flow", "bullets", "solution",
                  "compare", "scope", "risks", "next_steps"]
    compare: Optional[Compare] = None
    scope: Optional[ScopeSpec] = None
    risks: Optional[Risks] = None
    next_steps: Optional[NextSteps] = None
    solution: Optional[Solution] = None
    flow: Optional[Flow] = None
    gantt: Optional[Gantt] = None
    cost: Optional[Cost] = None
    assumptions: Optional[Assumptions] = None
    title: str = ""
    bullets: list[str] = []


class Proposal(BaseModel):
    meta: Meta
    slides: list[Slide]
