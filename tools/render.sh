#!/bin/sh
# Render a .pptx to PNGs with LibreOffice for a visual check: tools/render.sh out/sample.pptx /tmp/render
# LibreOffice is close to, but not identical to, PowerPoint: use it to catch overlaps, not for sign-off.
set -e
src="$1"; dst="${2:-render}"
mkdir -p "$dst"
soffice --headless --convert-to pdf --outdir "$dst" "$src" >/dev/null 2>&1
pdftoppm -r 80 -png "$dst/$(basename "${src%.*}").pdf" "$dst/slide"
ls "$dst"
