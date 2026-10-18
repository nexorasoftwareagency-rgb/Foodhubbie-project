#!/usr/bin/env python3
"""sfx_ep1.py — EP1 ORDER score. Times read from this EP's own comp.html T constants."""
import os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, r"C:\Users\2nile\.config\opencode\skills\onetake\scripts")
from sfx_palette import Score, air, glass, wood, sub, bubble, pan_of

src = open(os.path.join(HERE, "comp.html"), encoding="utf8").read()
block = src.split("const T={", 1)[1].split("};", 1)[0]
T = {}
for k, v in re.findall(r"(\w+):\s*(\[[^\]]*\]|[\d.]+)", block):
    T[k] = [float(x) for x in re.findall(r"[\d.]+", v)] if v.startswith("[") else float(v)
stac = [float(x) for x in re.findall(r"\[([\d.]+),'", block)]
assert len(stac) == 3

s = Score(dur=28.0, T60=1.1)
place = s.place
place(bubble(660, 0.20), T["seed"], 0.45, -0.20, 0.30)
place(air(0.50, 380, 1500, 1.3, 0.50), T["whip1"], 0.38, -0.15, 0.50, pan_to=0.10)
place(wood(170, 0.10), T["press1"], 0.55, 0.0, 0.15)
place(wood(160, 0.10), T["press2"], 0.60, 0.0, 0.15)
place(sub(72, 0.30), T["land1"], 0.70, 0.0, 0.30)
for i, (t, f) in enumerate(zip(stac, (1319, 1480, 1661))):
    place(glass(f, 0.25, 0.8), t, 0.30 + 0.02 * i, 0.0, 0.40)
place(sub(66, 0.28), T["land2"], 0.68, 0.0, 0.30)
place(bubble(740, 0.24), T["toChat"][1], 0.50, 0.0, 0.30)
place(air(0.45, 520, 1700, 1.3, 0.50), T["rip"], 0.35, -0.10, 0.50, pan_to=0.30)
place(sub(80, 0.26), T["land3"], 0.62, pan_of(405), 0.30)
place(air(1.40, 260, 2300, 1.1, 0.55), T["rest2"][1] - 0.35, 0.45, -0.25, 0.60, pan_to=0.0)
place(sub(58, 0.45), T["gather"][1], 0.85, 0.0, 0.40)
place(air(0.60, 1900, 320, 1.4), T["fold"][0] + 0.02, 0.35, 0.0, 0.50)
place(sub(54, 0.70), T["stamp"], 1.00, 0.0, 0.45)
place(glass(988, 1.00, 0.40), T["stamp"] + 0.01, 0.12, 0.0, 0.65)
place(air(0.70, 800, 380, 1.2, 0.50), T["end"], 0.22, 0.0, 0.55)
s.write(os.path.join(HERE, "sfx.wav"))
print("EP1 sfx.wav written")
