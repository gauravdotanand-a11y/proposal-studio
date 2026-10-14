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
