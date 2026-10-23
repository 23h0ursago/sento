#!/usr/bin/env python3
"""Draw the header illustration: a bath stool, a bucket and a folded towel, side by side.

Flat front views on a shared baseline, one thin navy outline, muted colours.
Usage: python3 tools/draw_bathset.py > icons/bathset.svg
"""
import sys

LINE = '#2B4756'   # matches the app's dark text
LW = 1.3
BASE = 46          # shared baseline

STOOL = '#F2B8C4'
STOOL_SHADE = '#E39CAD'
BUCKET = '#F3CD5C'
BUCKET_RIM = '#F8E29C'
BUCKET_IN = '#E4B640'
BAND = '#D9604C'
TOWEL = '#FFFFFF'
TOWEL_SHADE = '#EEF3F5'
STRIPE = '#6FB7DA'

stroke = f'stroke="{LINE}" stroke-width="{LW}" stroke-linejoin="round" stroke-linecap="round"'


def shadow(cx, rx):
    return f'<ellipse cx="{cx}" cy="{BASE + 1.6}" rx="{rx}" ry="1.6" fill="#000" fill-opacity=".08"/>'


def taper(y, top_y, bottom_y, top_l, top_r, bot_l, bot_r):
    """x-range of a trapezoid at height y."""
    t = (y - top_y) / (bottom_y - top_y)
    return top_l + (bot_l - top_l) * t, top_r + (bot_r - top_r) * t


parts = []

# --- bath stool (風呂椅子): seat slab over legs with an arch ---
parts.append(shadow(27, 23))
parts.append(f'<path d="M8 21 H46 L49 {BASE} H5 Z M12.5 {BASE} C13 31.5 41 31.5 41.5 {BASE} Z" '
             f'fill="{STOOL}" fill-rule="evenodd" {stroke}/>')
parts.append(f'<path d="M8 21 H46 L46.6 26 H7.4 Z" fill="{STOOL_SHADE}" stroke="none"/>')   # shade under the seat
parts.append(f'<rect x="4" y="14" width="46" height="7" rx="3.5" fill="{STOOL}" {stroke}/>')

# --- bucket (湯桶): tapered tub, rim, one red stripe ---
top_y, bot_y, tl, tr, bl, br = 20, BASE, 62, 100, 66, 96
parts.append(shadow(81, 17))
parts.append(f'<path d="M{tl} {top_y} H{tr} L{br} {bot_y} H{bl} Z" fill="{BUCKET}" {stroke}/>')
y0, y1 = 27, 31
l0, r0 = taper(y0, top_y, bot_y, tl, tr, bl, br)
l1, r1 = taper(y1, top_y, bot_y, tl, tr, bl, br)
parts.append(f'<path d="M{l0:.2f} {y0} H{r0:.2f} L{r1:.2f} {y1} H{l1:.2f} Z" fill="{BAND}"/>')
parts.append(f'<ellipse cx="81" cy="{top_y}" rx="19" ry="3.6" fill="{BUCKET_RIM}" {stroke}/>')
parts.append(f'<ellipse cx="81" cy="{top_y + 0.5}" rx="15.5" ry="2.1" fill="{BUCKET_IN}"/>')

# --- folded towel: two layers, rounded at the fold, thin stripes ---
parts.append(shadow(139, 27))
parts.append(f'<rect x="112" y="36" width="54" height="10" rx="4.5" fill="{TOWEL_SHADE}" {stroke}/>')
parts.append(f'<path d="M115 42.6 H159" stroke="{STRIPE}" stroke-width="1.6" stroke-linecap="round"/>')
parts.append(f'<rect x="116" y="27" width="47" height="10" rx="4.5" fill="{TOWEL}" {stroke}/>')
parts.append(f'<path d="M119 33.6 H156" stroke="{STRIPE}" stroke-width="1.6" stroke-linecap="round"/>')

svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 8 170 42">'
       + ''.join(parts) + '</svg>')
sys.stdout.write(svg)
