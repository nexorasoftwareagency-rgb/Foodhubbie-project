#!/usr/bin/env python3
"""sfx_score.py — FoodHubbie 28s launch score on scripts/sfx_palette.py.

Times are read from comp.html's own T constants (score from the comp, not retyped).
Run:  python sfx_score.py  -> sfx.wav (48 kHz, peak -8 dBFS)
"""
import os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, r"C:\Users\2nile\.config\opencode\skills\onetake\scripts")
from sfx_palette import Score, air, glass, wood, sub, bubble, pan_of

# ── read T from the comp ───────────────────────────────────────────────────
src = open(os.path.join(HERE, "comp.html"), encoding="utf8").read()
block = src.split("const T={", 1)[1].split("};", 1)[0]
T = {}
for k, v in re.findall(r"(\w+):\s*(\[[^\]]*\]|[\d.]+)", block):
    T[k] = [float(x) for x in re.findall(r"[\d.]+", v)] if v.startswith("[") else float(v)
stac = [float(x) for x in re.findall(r"\[([\d.]+),'", block)]
need = ["seed", "whip1", "press1", "press2", "land1", "land2", "rip", "land3",
        "rest2", "gather", "fold", "stamp", "end", "toChat"]
missing = [k for k in need if k not in T]
assert not missing, f"missing T keys: {missing}"
assert len(stac) == 3, f"stac parse failed: {stac}"

s = Score(dur=28.0, T60=1.1)
place = s.place

# 1 · the QR breathes once, the ticket is born
place(bubble(660, 0.20), T["seed"], 0.45, -0.20, 0.30)
# 2 · hop to START ORDERING — air travels with the ticket
place(air(0.50, 380, 1500, 1.3, 0.50), T["whip1"], 0.38, -0.15, 0.50, pan_to=0.10)
# 3 · key presses: START, PLACE — one sound each
place(wood(170, 0.10), T["press1"], 0.55, 0.0, 0.15)
place(wood(160, 0.10), T["press2"], 0.60, 0.0, 0.15)
# 4 · lands in the KDS lane
place(sub(72, 0.30), T["land1"], 0.70, 0.0, 0.30)
# 5 · status staccato: RECEIVED / PREPARING / READY — glass up a scale
for i, (t, f) in enumerate(zip(stac, (1319, 1480, 1661))):
    place(glass(f, 0.25, 0.8), t, 0.30 + 0.02 * i, 0.0, 0.40)
# 6 · pin lands on the rider map
place(sub(66, 0.28), T["land2"], 0.68, 0.0, 0.30)
# 7 · green bubble pops into the chat
place(bubble(740, 0.24), T["toChat"][1], 0.50, 0.0, 0.30)
# 8 · money: air travels right with the camera, felt chip landing at the left
place(air(0.45, 520, 1700, 1.3, 0.50), T["rip"], 0.35, -0.10, 0.50, pan_to=0.30)
place(sub(80, 0.26), T["land3"], 0.62, pan_of(405), 0.30)
# 9 · the one breath: riser through the tail of the rest into the gather
place(air(1.40, 260, 2300, 1.1, 0.55), T["rest2"][1] - 0.35, 0.45, -0.25, 0.60, pan_to=0.0)
# 10 · gather arrival — the loudest felt hit after the stamp
place(sub(58, 0.45), T["gather"][1], 0.85, 0.0, 0.40)
# 11 · the fold: everything sucks inward
place(air(0.60, 1900, 320, 1.4), T["fold"][0] + 0.02, 0.35, 0.0, 0.50)
# 12 · seal stamp — the film's own impact
place(sub(54, 0.70), T["stamp"], 1.00, 0.0, 0.45)
place(glass(988, 1.00, 0.40), T["stamp"] + 0.01, 0.12, 0.0, 0.65)
# 13 · the end card settles — a falling breath, no chord
place(air(0.70, 800, 380, 1.2, 0.50), T["end"], 0.22, 0.0, 0.55)

s.write(os.path.join(HERE, "sfx.wav"))
print("sfx.wav written; events:", 1 + 1 + 2 + 1 + 3 + 1 + 1 + 2 + 1 + 1 + 1 + 2 + 1)
