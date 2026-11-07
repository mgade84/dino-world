"""Writes icon.svg (full bleed; the open mouth shows the sky behind it) and icon-maskable.svg (artwork scaled into the safe zone) for Dino World."""
import sys

out = sys.argv[1]

# A roaring T-Rex head in profile, facing right; the neck runs well past the bottom edge.
HEAD = ("M -40 760 L 30 512 C 60 420, 100 300, 160 235 C 200 185, 250 165, 300 170 C 360 175, 420 195, 455 215 "
        "C 475 228, 482 245, 470 258 C 455 272, 420 280, 380 284 L 262 296 L 424 384 "
        "C 434 396, 418 412, 390 412 C 330 404, 270 395, 235 388 C 215 430, 200 470, 205 512 L 200 760 Z")


def teeth():
    s = []
    for i, x in enumerate(range(286, 452, 22)):  # upper, hanging from (262,296)->(465,262)
        y = 296 - (x - 262) * (34 / 203)
        length = 24 if i in (1, 2) else 17
        s.append(f"M {x-6:.1f} {y-1:.1f} L {x:.1f} {y+length:.1f} L {x+6:.1f} {y-1:.1f} Z")
    for i, x in enumerate(range(292, 412, 21)):  # lower, rising from (262,296)->(424,384)
        y = 296 + (x - 262) * (88 / 162)
        length = 20 if i in (1, 2) else 14
        s.append(f"M {x-5.5:.1f} {y+1:.1f} L {x:.1f} {y-length:.1f} L {x+5.5:.1f} {y+1:.1f} Z")
    return " ".join(s)


RAIN = "".join(
    f'<line x1="{x}" y1="{y}" x2="{x-14}" y2="{y+70}" />'
    for x, y in [(60, 20), (130, 90), (210, 10), (330, 60), (480, 120), (500, 300), (90, 250), (370, 420), (470, 440), (150, 140), (280, 450), (20, 380)]
)
BOLT = "M 420 -10 L 372 120 L 404 124 L 330 268 L 352 270 L 300 380 L 410 222 L 384 220 L 452 92 L 424 90 L 470 -10 Z"
# The head is drawn 30% larger than its path, nudged left and down so it fills the icon.
HEAD_T = "translate(300 280) scale(1.3) translate(-300 -280) translate(-38 8)"


def svg(scale):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs>
  <radialGradient id="sky" cx="0.72" cy="0.18" r="0.95">
    <stop offset="0" stop-color="#3b5560"/><stop offset="0.45" stop-color="#15242a"/><stop offset="1" stop-color="#05080a"/>
  </radialGradient>
  <linearGradient id="skin" x1="0.2" y1="0" x2="0.8" y2="1">
    <stop offset="0" stop-color="#3d3527"/><stop offset="1" stop-color="#16130e"/>
  </linearGradient>
  <linearGradient id="jaw" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#4a4232" stop-opacity="0"/><stop offset="1" stop-color="#6a5e47"/>
  </linearGradient>
  <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#ffe7a1"/><stop offset="0.45" stop-color="#f0a12a"/><stop offset="1" stop-color="#f0a12a" stop-opacity="0"/>
  </radialGradient>
  <!-- The edge light: only above the upper jaw, so it can't show inside the open mouth. -->
  <clipPath id="top"><path d="M 0 0 H 512 V 250 L 470 250 L 262 290 L 0 324 Z"/></clipPath>
  <clipPath id="headclip"><path d="{HEAD}"/></clipPath>
  <filter id="soft"><feGaussianBlur stdDeviation="6"/></filter>
</defs>
<rect width="512" height="512" fill="url(#sky)"/>
<g stroke="#9fb9c4" stroke-opacity="0.22" stroke-width="2.5" stroke-linecap="round">{RAIN}</g>
<g transform="translate(256 256) scale({scale}) translate(-256 -256)">
  <path d="{BOLT}" fill="#e9f4ff" opacity="0.85" filter="url(#soft)"/>
  <path d="{BOLT}" fill="#f4faff"/>
  <g transform="{HEAD_T}">
    <path d="{HEAD}" fill="#bcd8e4" transform="translate(4 -6)" clip-path="url(#top)"/>
    <path d="{HEAD}" fill="url(#skin)"/>
    <g clip-path="url(#headclip)">
      <path d="M 120 300 C 150 240, 175 205, 205 185 L 228 182 C 196 214, 170 260, 150 320 Z" fill="#0f0c08" opacity="0.75"/>
      <path d="M 70 420 C 95 340, 120 290, 150 260 L 168 268 C 140 300, 118 360, 100 440 Z" fill="#0f0c08" opacity="0.7"/>
      <path d="M 340 178 C 350 195, 352 212, 346 228 L 362 226 C 366 210, 364 194, 356 180 Z" fill="#0f0c08" opacity="0.6"/>
      <path d="M 392 190 C 400 204, 402 218, 398 232 L 410 230 C 414 216, 412 202, 404 192 Z" fill="#0f0c08" opacity="0.55"/>
      <path d="M 196 760 L 240 380 L 420 400 L 420 760 Z" fill="url(#jaw)" opacity="0.7"/>
    </g>
    <path d="{teeth()}" fill="#e8e0cc"/>
    <path d="M 252 196 C 270 180, 305 178, 328 190 C 310 192, 280 196, 258 206 Z" fill="#0d0b08"/>
    <circle cx="294" cy="214" r="26" fill="url(#glow)"/>
    <ellipse cx="294" cy="214" rx="11" ry="9" fill="#f6b23a"/>
    <ellipse cx="294" cy="214" rx="2.6" ry="8" fill="#140a02"/>
    <ellipse cx="446" cy="229" rx="7" ry="4" fill="#0b0a08" transform="rotate(-18 446 229)"/>
  </g>
</g>
</svg>'''


with open(f"{out}/icon.svg", "w") as f:
    f.write(svg(1.0))
# Android masks icons to as little as the central 80%: keep the head inside that.
with open(f"{out}/icon-maskable.svg", "w") as f:
    f.write(svg(0.84))
for name in ["icon", "icon-maskable"]:
    with open(f"{out}/{name}.html", "w") as f:
        f.write(f'<!doctype html><html><head><style>html,body{{margin:0;background:#000}}img{{display:block;width:100vw;height:100vh}}</style></head><body><img src="{name}.svg"></body></html>')
