from pathlib import Path

from PIL import Image, ImageChops

HERE = Path(__file__).resolve().parent
FONT_DIR = HERE / "assets" / "fonts"

# Keep one variable file per family that Google served identically for all weights.
renames = {
    "fraunces-400.woff2": "fraunces-var.woff2",
    "plus-jakarta-sans-400.woff2": "plus-jakarta-sans-var.woff2",
}
for src, dst in renames.items():
    s = FONT_DIR / src
    d = FONT_DIR / dst
    if s.exists() and not d.exists():
        s.rename(d)

# Remove duplicate weight files.
for name in [
    "fraunces-600.woff2",
    "fraunces-700.woff2",
    "plus-jakarta-sans-500.woff2",
    "plus-jakarta-sans-600.woff2",
    "plus-jakarta-sans-700.woff2",
]:
    p = FONT_DIR / name
    if p.exists():
        p.unlink()

range_main = (
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,"
    "U+2000-206F,U+2070-209F,U+20AC,U+2122,U+2190-21FF,U+2260-226F,"
    "U+FEFF,U+FFFD"
)

css = f"""/* Self-hosted latin subsets. No network needed after first load. */
@font-face{{
  font-family:'Fraunces';font-style:normal;font-weight:400 700;font-display:swap;
  src:url('./fonts/fraunces-var.woff2') format('woff2');
  unicode-range:{range_main};
}}
@font-face{{
  font-family:'Plus Jakarta Sans';font-style:normal;font-weight:400 700;font-display:swap;
  src:url('./fonts/plus-jakarta-sans-var.woff2') format('woff2');
  unicode-range:{range_main};
}}
@font-face{{
  font-family:'IBM Plex Mono';font-style:normal;font-weight:400;font-display:swap;
  src:url('./fonts/ibm-plex-mono-400.woff2') format('woff2');
  unicode-range:{range_main};
}}
@font-face{{
  font-family:'IBM Plex Mono';font-style:normal;font-weight:500;font-display:swap;
  src:url('./fonts/ibm-plex-mono-500.woff2') format('woff2');
  unicode-range:{range_main};
}}
@font-face{{
  font-family:'IBM Plex Mono';font-style:normal;font-weight:600;font-display:swap;
  src:url('./fonts/ibm-plex-mono-600.woff2') format('woff2');
  unicode-range:{range_main};
}}
"""
(HERE / "assets" / "fonts.css").write_text(css, encoding="utf-8")

# Tight logo crop; keep white background (header chip is white).
logo_src = HERE.parent / "Logo" / "Logo GELAR RASA.png"
src = Image.open(logo_src)
if src.mode in ("RGBA", "LA", "P"):
    src = src.convert("RGBA")
    white = Image.new("RGBA", src.size, (255, 255, 255, 255))
    im = Image.alpha_composite(white, src).convert("RGB")
else:
    im = src.convert("RGB")
bg = Image.new("RGB", im.size, (255, 255, 255))
diff = ImageChops.difference(im, bg)
bbox = diff.getbbox()
if bbox:
    im = im.crop(bbox)
# add a little breathing room
pad = 24
canvas = Image.new("RGB", (im.width + pad * 2, im.height + pad * 2), (255, 255, 255))
canvas.paste(im, (pad, pad))
canvas.save(HERE / "assets" / "logo.png", optimize=True)
print("logo", canvas.size, (HERE / "assets" / "logo.png").stat().st_size // 1024, "KB")
print("fonts", len(list(FONT_DIR.glob("*.woff2"))), "files")
