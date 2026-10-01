"""Writes src/data/shapes/<id>.json for the hand drawn cars (no reference model exists, so the measured arrays are
synthesised from the plan and side profiles below; the side profile used for the build is PROFILES.<id> in PanelBuilder).
Run: python3 scripts/make-handmade-shapes.py"""
import json
def lerp(keys, t):
    for j in range(1, len(keys)):
        if t <= keys[j][0]:
            u = (t - keys[j-1][0]) / (keys[j][0] - keys[j-1][0]); return keys[j-1][1] + (keys[j][1] - keys[j-1][1]) * u
    return keys[-1][1]
CARS = {
  # Corvette C8
  'c8': dict(L=4.63, W=2.14, H=1.225,
    HW=[(0, 0.88), (0.04, 0.99), (0.14, 1.06), (0.28, 1.07), (0.45, 1.03), (0.62, 1.035), (0.8, 1.0), (0.93, 0.93), (1, 0.76)],
    CENTRE=[(0, 0.88), (0.02, 1.0), (0.08, 1.04), (0.2, 1.08), (0.3, 1.14), (0.36, 1.20), (0.42, 1.225), (0.52, 1.225), (0.58, 1.2), (0.66, 1.02), (0.72, 0.93), (0.8, 0.9), (0.9, 0.78), (0.97, 0.64), (1, 0.52)],
    BELT=[(0, 0.88), (0.1, 1.0), (0.3, 1.02), (0.5, 0.98), (0.7, 0.9), (0.9, 0.74), (1, 0.52)],
    wheels=[(1.435, 0.9, 0.327, 0.26), (-1.287, 0.91, 0.346, 0.31)]),
  # Porsche 911 GT3 RS (992): wide rear haunches, round headlamp humps, fastback roof, raised swan neck wing
  'gt3rs': dict(L=4.57, W=2.1, H=1.32,
    HW=[(0, 0.9), (0.04, 0.99), (0.14, 1.04), (0.3, 1.04), (0.5, 0.98), (0.7, 0.99), (0.85, 0.97), (0.95, 0.9), (1, 0.78)],
    CENTRE=[(0, 0.82), (0.03, 0.98), (0.1, 1.04), (0.2, 1.12), (0.3, 1.22), (0.4, 1.3), (0.5, 1.32), (0.58, 1.3), (0.66, 1.08), (0.72, 0.96), (0.78, 0.9), (0.88, 0.78), (0.96, 0.66), (1, 0.55)],
    BELT=[(0, 0.82), (0.1, 0.98), (0.3, 1.0), (0.5, 0.97), (0.72, 0.92), (0.9, 0.78), (1, 0.55)],
    wheels=[(1.325, 0.88, 0.35, 0.28), (-1.132, 0.9, 0.355, 0.34)]),
  # Lamborghini Urus: tall coupe SUV, wide haunches, roof peak mid body falling to a short tail
  'urus': dict(L=4.2, W=2.12, H=1.64,
    HW=[(0, 0.93), (0.04, 1.0), (0.14, 1.05), (0.3, 1.05), (0.5, 1.02), (0.7, 1.03), (0.85, 1.01), (0.95, 0.95), (1, 0.82)],
    CENTRE=[(0, 1.18), (0.02, 1.38), (0.08, 1.45), (0.2, 1.55), (0.3, 1.62), (0.4, 1.64), (0.52, 1.64), (0.6, 1.58), (0.68, 1.32), (0.74, 1.2), (0.82, 1.17), (0.92, 1.12), (0.98, 1.05), (1, 0.92)],
    BELT=[(0, 1.2), (0.1, 1.3), (0.3, 1.3), (0.5, 1.26), (0.7, 1.2), (0.9, 1.1), (1, 0.95)],
    wheels=[(1.3, 0.93, 0.4, 0.285), (-1.18, 0.93, 0.4, 0.315)]),
}
nz, nu = 120, 17
for cid, c in CARS.items():
    hw, t, b, cat = [], [], [], []
    for i in range(nz):
        tt = (i + 0.5) / nz
        hw.append(round(lerp(c['HW'], tt), 4))
        ce, e = lerp(c['CENTRE'], tt), lerp(c['BELT'], tt)
        for k in range(nu):
            u = k / (nu - 1)
            t.append(round(ce + (min(e, ce) - ce) * u * u, 4)); b.append(0.12); cat.append(0)
    wheels = []
    for sx in (1, -1):
        for z, x, r, w in c['wheels']: wheels.append({'x': sx * x, 'z': z, 'r': r, 'w': w})
    json.dump({'id': cid, 'length': c['L'], 'bike': False, 'nz': nz, 'nu': nu, 'width': c['W'], 'height': c['H'], 'hw': hw, 't': t, 'b': b, 'cat': cat, 'side': [0] * nz,
               'cats': ['paint', 'glass', 'light', 'dark', 'chrome', 'wheel'], 'wheels': wheels}, open(f'src/data/shapes/{cid}.json', 'w'), separators=(',', ':'))
