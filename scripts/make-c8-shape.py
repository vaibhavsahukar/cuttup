"""Writes src/data/shapes/c8.json: a hand-drawn Corvette C8 body (no reference model exists, so the measured arrays are
synthesised from the plan and side profiles below; the real side profile used for the build is PROFILES.c8 in PanelBuilder)."""
import json, math
L, nz, nu = 4.63, 120, 17
def lerp(keys, t):
    for j in range(1, len(keys)):
        if t <= keys[j][0]:
            u = (t - keys[j-1][0]) / (keys[j][0] - keys[j-1][0]); return keys[j-1][1] + (keys[j][1] - keys[j-1][1]) * u
    return keys[-1][1]
HW = [(0, 0.80), (0.04, 0.9), (0.14, 0.965), (0.28, 0.97), (0.45, 0.935), (0.62, 0.94), (0.8, 0.915), (0.93, 0.85), (1, 0.7)]
CENTRE = [(0, 0.88), (0.02, 1.0), (0.08, 1.04), (0.2, 1.08), (0.3, 1.14), (0.36, 1.20), (0.42, 1.225), (0.52, 1.225), (0.58, 1.2), (0.66, 1.02), (0.72, 0.93), (0.8, 0.9), (0.9, 0.78), (0.97, 0.64), (1, 0.52)]
BELT = [(0, 0.88), (0.1, 1.0), (0.3, 1.02), (0.5, 0.98), (0.7, 0.9), (0.9, 0.74), (1, 0.52)]
hw, t, b, cat = [], [], [], []
for i in range(nz):
    tt = (i + 0.5) / nz
    hw.append(round(lerp(HW, 1 - tt) if False else lerp(HW, tt), 4))
    c, e = lerp(CENTRE, tt), lerp(BELT, tt)
    for k in range(nu):
        u = k / (nu - 1)
        t.append(round(c + (min(e, c) - c) * u * u, 4)); b.append(0.12); cat.append(0)
side = [0] * nz
wheels = []
for sx in (1, -1):
    wheels.append({'x': sx * 0.82, 'z': 1.435, 'r': 0.327, 'w': 0.26})
    wheels.append({'x': sx * 0.83, 'z': -1.287, 'r': 0.346, 'w': 0.31})
json.dump({'id': 'c8', 'length': L, 'bike': False, 'nz': nz, 'nu': nu, 'width': 1.95, 'height': 1.225, 'hw': hw, 't': t, 'b': b, 'cat': cat, 'side': side,
           'cats': ['paint', 'glass', 'light', 'dark', 'chrome', 'wheel'], 'wheels': wheels}, open('src/data/shapes/c8.json', 'w'), separators=(',', ':'))
