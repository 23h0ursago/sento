"""Draw the header illustration: an isometric bath stool, ケロリン-style bucket and folded towel
on a patch of tiled sento floor, with wobbly hand-drawn lines.

Usage: python3 tools/draw_bathset.py > icons/bathset.svg
"""
import math, sys
C, S = math.cos(math.radians(30)), 0.5
K = 9.0                      # px per unit
OX, OY = 52, 30              # screen offset
INK = '#5B4636'              # sepia line
LW = 0.95

BOUNDS = []
def P(x, y, z=0):
    p = (OX + (x - y) * C * K, OY + (x + y) * S * K - z * K)
    BOUNDS.append(p)
    return p

def poly(pts, fill, stroke=INK, extra=''):
    d = 'M' + ' L'.join(f'{a:.2f},{b:.2f}' for a, b in pts) + 'Z'
    return f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{LW}" stroke-linejoin="round" {extra}/>'

def line(pts, stroke=INK, w=LW, extra=''):
    d = 'M' + ' L'.join(f'{a:.2f},{b:.2f}' for a, b in pts)
    return f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="{w}" stroke-linecap="round" {extra}/>'

def box(x0, x1, y0, y1, z0, z1, top, left, right):
    """Visible faces of a box: top, +y face (front-left), +x face (front-right)."""
    out = []
    out.append(poly([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], left))
    out.append(poly([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], right))
    out.append(poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], top))
    return out

def hull(points):
    pts = sorted(set((round(a, 2), round(b, 2)) for a, b in points))
    def cross(o, a, b): return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0: hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]

def circle(cx, cy, z, r, n=48, a0=0, a1=2*math.pi):
    return [P(cx + r*math.cos(a0 + (a1-a0)*i/n), cy + r*math.sin(a0 + (a1-a0)*i/n), z) for i in range(n+1)]

out = []
# --- floor patch: a slab of small tiles ---
FX0, FX1, FY0, FY1, FT = 0.3, 7.3, 0.4, 4.1, 0.45
out += box(FX0, FX1, FY0, FY1, -FT, 0, '#DCEFF0', '#B7D7DA', '#C6E2E4')
for i in range(1, round((FX1 - FX0) / .5)):   # grout lines on top (0.5-unit tiles)
    x = FX0 + i * 0.5
    out.append(line([P(x, FY0, 0), P(x, FY1, 0)], '#FFFFFF', 0.45, 'opacity=".9"'))
for j in range(1, round((FY1 - FY0) / .5)):
    y = FY0 + j * 0.5
    out.append(line([P(FX0, y, 0), P(FX1, y, 0)], '#FFFFFF', 0.45, 'opacity=".9"'))
# little water puddle
out.append(poly(circle(6.3, 1.1, 0, 0.42)[:-1], '#C2E2F2', 'none', 'opacity=".85"'))

# --- stool (風呂椅子): legs block with arches, then a slightly larger seat ---
SX0, SX1, SY0, SY1 = 0.9, 3.7, 1.0, 3.3
LEG_H, SEAT_T = 1.25, 0.32
out.append('<g>')
out += box(SX0 + .12, SX1 - .12, SY0 + .12, SY1 - .12, 0, LEG_H, '#F4B9C6', '#F2C3CE', '#E9A9B8')
def arch_y(face_y, x0, x1, h, n=24):
    pts = [P(x0, face_y, 0)]
    for i in range(n + 1):
        t = math.pi * i / n
        pts.append(P((x0 + x1) / 2 - (x1 - x0) / 2 * math.cos(t), face_y, h * math.sin(t) ** .6))
    pts.append(P(x1, face_y, 0))
    return pts
def arch_x(face_x, y0, y1, h, n=24):
    pts = [P(face_x, y0, 0)]
    for i in range(n + 1):
        t = math.pi * i / n
        pts.append(P(face_x, (y0 + y1) / 2 - (y1 - y0) / 2 * math.cos(t), h * math.sin(t) ** .6))
    pts.append(P(face_x, y1, 0))
    return pts
out.append(poly(arch_y(SY1 - .12, SX0 + .42, SX1 - .42, 0.95), '#B57487'))
out.append(poly(arch_x(SX1 - .12, SY0 + .42, SY1 - .42, 0.95), '#A4687A'))
out += box(SX0, SX1, SY0, SY1, LEG_H, LEG_H + SEAT_T, '#F7C6D1', '#EFAFBE', '#E59CAE')
out.append(line([P(SX0 + 1.0, SY0 + .75, LEG_H + SEAT_T), P(SX1 - 1.0, SY0 + .75, LEG_H + SEAT_T)], '#D98DA0', .7))  # finger slot
out.append('</g>')

# --- bucket (ケロリン桶) on the seat: a frustum ---
BX, BY, BZ, BH, R0, R1 = 2.3, 2.15, 1.57, 1.1, .8, 1.0
body = hull(circle(BX, BY, BZ, R0) + circle(BX, BY, BZ + BH, R1))
out.append(poly(body, '#F6D46A'))
out.append(poly(circle(BX, BY, BZ + BH, R1)[:-1], '#F9E3A0'))                  # rim
out.append(poly(circle(BX, BY, BZ + BH - .05, R1 - .14)[:-1], '#E9BE4F', INK, 'stroke-opacity=".5"'))  # inside
# red ケロリン band (front arc)
band = circle(BX, BY, BZ + .5, (R0 + R1) / 2 * 1.0, 30, math.radians(-40), math.radians(130))
out.append(line(band, '#D2503F', 2.6, 'opacity=".92"'))

# --- folded towel on the floor: two stacked soft slabs with stripes ---
TX0, TX1, TY0, TY1 = 4.4, 6.8, 2.0, 3.8
out += box(TX0, TX1, TY0, TY1, 0, .45, '#FBFBF7', '#ECEBE4', '#E3E2DA')
out += box(TX0 + .1, TX1 - .1, TY0 + .1, TY1 - .1, .45, .9, '#FFFFFC', '#F1F0EA', '#E8E7E0')
for z in (.22, .67):
    out.append(line([P(TX0 + (.1 if z > .45 else 0), TY1 - (.1 if z > .45 else 0), z), P(TX1 - (.1 if z > .45 else 0), TY1 - (.1 if z > .45 else 0), z), P(TX1 - (.1 if z > .45 else 0), TY0 + (.1 if z > .45 else 0), z)], '#7BB8D6', 1.1))
# fold crease on top
out.append(line([P(TX0 + .1, (TY0 + TY1) / 2, .9), P(TX1 - .1, (TY0 + TY1) / 2, .9)], '#D9D8D0', .6))

# soap bubbles
for (x, y, z, r) in ((3.9, .7, 3.2, .27), (4.4, .35, 3.85, .18)):
    cx, cy = P(x, y, z)
    out.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r*K:.1f}" fill="#FFFFFF" fill-opacity=".35" stroke="#FFFFFF" stroke-width=".7"/>')

xs = [p[0] for p in BOUNDS]; ys = [p[1] for p in BOUNDS]
vx, vy = min(xs) - 3, min(ys) - 3
W, H = max(xs) - vx + 3, max(ys) - vy + 3
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vx:.1f} {vy:.1f} {W:.1f} {H:.1f}">'
       '<defs><filter id="w" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="1" seed="3"/>'
       '<feDisplacementMap in="SourceGraphic" scale=".9"/></filter></defs>'
       '<g filter="url(#w)">' + ''.join(out) + '</g></svg>')
sys.stdout.write(svg)
