"""Look-alike corporate theme (navy titles, teal boxes, orange accents)."""
from contextlib import contextmanager

from pptx.dml.color import RGBColor
from pptx.util import Inches, Pt

NAVY = RGBColor(0x1B, 0x2A, 0x7A)
TEAL = RGBColor(0xC9, 0xE8, 0xEE)
TEAL_DARK = RGBColor(0x7F, 0xC4, 0xD2)
ORANGE = RGBColor(0xFF, 0x4F, 0x1F)
GREY = RGBColor(0x55, 0x55, 0x55)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
LINE = RGBColor(0x1B, 0x2A, 0x7A)
LANE_TINT = RGBColor(0xF1, 0xF8, 0xFA)
NOTE_FILL = RGBColor(0xBF, 0xD4, 0xF2)
OUT_FILL = RGBColor(0xE6, 0xE6, 0xE6)

FONT = "Arial"
SLIDE_W = Inches(13.333)
SLIDE_H = Inches(7.5)
MARGIN = Inches(0.6)
TITLE_SIZE = Pt(28)
BODY_SIZE = Pt(14)

CONTENT_TOP = Inches(1.3)  # y where slide content starts (below the title)


@contextmanager
def override(**values):
    """Temporarily replace theme attributes (e.g. when rendering onto a corporate template)."""
    import sys
    mod = sys.modules[__name__]
    saved = {k: getattr(mod, k) for k in values}
    try:
        for k, v in values.items():
            setattr(mod, k, v)
        yield
    finally:
        for k, v in saved.items():
            setattr(mod, k, v)


# ----------------------------------------------------------- built-in looks
# Every look keeps a light slide background so box/lane/table contrast rules stay the same.
def _rgb(h: str) -> RGBColor:
    return RGBColor.from_string(h)


_ROLES = ("NAVY", "TEAL", "TEAL_DARK", "ORANGE", "GREY", "LANE_TINT", "NOTE_FILL", "OUT_FILL")

PRESETS: dict[str, dict] = {
    "corporate": {
        "label": "Corporate",
        "description": "Navy titles, teal boxes, orange accent. The default look.",
        "font": "Arial",
        "colors": {"NAVY": "1B2A7A", "TEAL": "C9E8EE", "TEAL_DARK": "7FC4D2", "ORANGE": "FF4F1F",
                   "GREY": "555555", "LANE_TINT": "F1F8FA", "NOTE_FILL": "BFD4F2", "OUT_FILL": "E6E6E6"},
    },
    "forest": {
        "label": "Forest",
        "description": "Deep green with sage boxes and an amber accent.",
        "font": "Calibri",
        "colors": {"NAVY": "1F4D3A", "TEAL": "DCEBDD", "TEAL_DARK": "8DB596", "ORANGE": "E08A00",
                   "GREY": "4A4F4B", "LANE_TINT": "F3F8F3", "NOTE_FILL": "F6E3B4", "OUT_FILL": "E8EBE8"},
    },
    "slate": {
        "label": "Slate",
        "description": "Charcoal and cool grey-blue with a bright blue accent.",
        "font": "Calibri",
        "colors": {"NAVY": "2B3440", "TEAL": "DDE4EC", "TEAL_DARK": "9FB0C3", "ORANGE": "1F6FEB",
                   "GREY": "4D5560", "LANE_TINT": "F4F6F9", "NOTE_FILL": "CFE0FB", "OUT_FILL": "E7E9EC"},
    },
    "plum": {
        "label": "Plum",
        "description": "Aubergine with lilac boxes and a coral accent.",
        "font": "Georgia",
        "colors": {"NAVY": "4B1F5C", "TEAL": "EBDDF1", "TEAL_DARK": "B896C8", "ORANGE": "E8505B",
                   "GREY": "56505A", "LANE_TINT": "F8F3FA", "NOTE_FILL": "F7D9DC", "OUT_FILL": "ECE8EE"},
    },
    "mono": {
        "label": "Monochrome",
        "description": "Black and greys with a single red accent; prints well.",
        "font": "Arial",
        "colors": {"NAVY": "111111", "TEAL": "E4E4E4", "TEAL_DARK": "A8A8A8", "ORANGE": "D62828",
                   "GREY": "444444", "LANE_TINT": "F5F5F5", "NOTE_FILL": "D9D9D9", "OUT_FILL": "EEEEEE"},
    },
}


def preset_overrides(name: str) -> dict:
    """Theme attribute overrides for a built-in look (raises KeyError for unknown names)."""
    p = PRESETS[name]
    out = {role: _rgb(p["colors"][role]) for role in _ROLES}
    out["LINE"] = out["NAVY"]
    out["FONT"] = p["font"]
    return out
