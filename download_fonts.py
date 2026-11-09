from __future__ import annotations

import re
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
FONT_DIR = HERE / "assets" / "fonts"
FONT_DIR.mkdir(parents=True, exist_ok=True)

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
}
CSS_URL = (
    "https://fonts.googleapis.com/css2?"
    "family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700"
    "&family=Plus+Jakarta+Sans:wght@400;500;600;700"
    "&family=IBM+Plex+Mono:wght@400;500;600"
    "&display=swap"
)

req = urllib.request.Request(CSS_URL, headers=UA)
css = urllib.request.urlopen(req, timeout=30).read().decode("utf-8")

# Split into @font-face blocks, keep only the latin subset.
blocks = re.findall(r"@font-face\s*{(.*?)}", css, flags=re.S)
latin = []
for block in blocks:
    if "/* latin */" in block:
        latin.append(block)

# The comment is outside the @font-face; instead walk the CSS with comments.
parts = re.split(r"/\*\s*([a-z-]+)\s*\*/", css)
current = None
faces = []
for part in parts:
    if part in {"latin", "latin-ext", "vietnamese", "cyrillic", "cyrillic-ext", "greek", "greek-ext"}:
        current = part
    elif current == "latin":
        for block in re.findall(r"@font-face\s*{(.*?)}", part, flags=re.S):
            faces.append(block)

print("latin faces:", len(faces))

manifest = []
for block in faces:
    fam = re.search(r"font-family:\s*'([^']+)'", block)
    weight = re.search(r"font-weight:\s*(\d+)", block)
    url = re.search(r"url\((https://[^)]+)\)", block)
    if not (fam and weight and url):
        continue
    family = fam.group(1)
    w = weight.group(1)
    slug = family.lower().replace(" ", "-")
    filename = f"{slug}-{w}.woff2"
    dest = FONT_DIR / filename
    if not dest.exists():
        r = urllib.request.Request(url.group(1), headers=UA)
        dest.write_bytes(urllib.request.urlopen(r, timeout=30).read())
    manifest.append((family, w, filename, dest.stat().st_size))
    print(f"{family:22s} {w}  {filename:28s} {dest.stat().st_size/1024:6.1f} KB")

# de-duplicate by family/weight (keep first)
seen = set()
lines = []
for family, w, filename, _ in manifest:
    key = (family, w)
    if key in seen:
        continue
    seen.add(key)
    lines.append(
        "@font-face{"
        f"font-family:'{family}';font-style:normal;font-weight:{w};font-display:swap;"
        f"src:url('./fonts/{filename}') format('woff2');"
        "unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,"
        "U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;"
        "}"
    )

(HERE / "assets" / "fonts.css").write_text("\n".join(lines) + "\n", encoding="utf-8")
print("wrote", HERE / "assets" / "fonts.css", "faces", len(lines))
