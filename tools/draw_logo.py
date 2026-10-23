#!/usr/bin/env python3
"""Draw the Sento logo (style B2, "soft flat"): a towel on a bucket, stacked on a bath stool.

Writes:
  icons/logo.svg  the logo on a transparent background (used in the top bar)
  icons/icon.svg  the app icon: the logo on baby blue, with room for iOS's rounded corners
Then render the PNG icons with tools/make_icons.sh.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAND = '#89CFF0'
C = {'stool': '#F4B4C2', 'stoolShade': '#E296A8', 'bucket': '#F5CE55', 'bucketShade': '#E8B83C',
     'lip': '#FBE29A', 'band': '#DD6650', 'towel': '#FFFFFF', 'towelShade': '#E2EDF2', 'stripe': '#7DBFE0'}

# The stack on a 100×100 square (spans about x 19–81, y 21–81).
STACK = f"""
<ellipse cx="50" cy="80.2" rx="27" ry="1.8" fill="#0B2230" fill-opacity=".12"/>
<path d="M28.5 57 H71.5 L75.6 76.4 Q76.2 79 73.6 79 H67.4 C66.2 66.4 33.8 66.4 32.6 79 H26.4 Q23.8 79 24.4 76.4 Z" fill="{C['stool']}"/>
<path d="M28.5 57 H71.5 L72.4 61.4 H27.6 Z" fill="{C['stoolShade']}"/>
<rect x="19.5" y="51" width="61" height="7.5" rx="3.75" fill="{C['stool']}"/>
<path d="M24 53.4 H44" stroke="#FFFFFF" stroke-opacity=".55" stroke-width="1.6" stroke-linecap="round"/>
<path d="M29.5 34 H70.5 L67.4 48.4 Q66.8 51 64.2 51 H35.8 Q33.2 51 32.6 48.4 Z" fill="{C['bucket']}"/>
<path d="M61 34 H70.5 L67.4 48.4 Q66.8 51 64.2 51 H58.6 Z" fill="{C['bucketShade']}"/>
<path d="M31.1 40.5 H68.9 L68.1 44.2 H31.9 Z" fill="{C['band']}"/>
<path d="M35 37 L36.6 47" stroke="#FFFFFF" stroke-opacity=".6" stroke-width="2" stroke-linecap="round"/>
<rect x="27.5" y="31" width="45" height="4.6" rx="2.3" fill="{C['lip']}"/>
<path d="M27.5 29 H36.5 V38.6 Q36.5 41 34.1 41 H29.9 Q27.5 41 27.5 38.6 Z" fill="{C['towelShade']}"/>
<rect x="25.5" y="21.5" width="49" height="11" rx="5.5" fill="{C['towelShade']}"/>
<rect x="27" y="21.5" width="46" height="8" rx="4" fill="{C['towel']}"/>
<path d="M30.5 27.6 H69" stroke="{C['stripe']}" stroke-width="1.9" stroke-linecap="round"/>
<path d="M29.6 36.4 H34.4" stroke="{C['stripe']}" stroke-width="1.6" stroke-linecap="round"/>
""".strip()


def svg(body, size=100, view='0 0 100 100'):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}" width="{size}" height="{size}">{body}</svg>\n'


# Transparent logo, cropped close to the stack (centre ~50,51)
logo = svg(STACK, 100, '16 18 68 68')
# App icon: brand background, stack scaled to ~78% and centred
icon = svg(f'<rect width="100" height="100" fill="{BRAND}"/>'
           f'<g transform="translate(50 50) scale(.86) translate(-50 -51)">{STACK}</g>', 512)

open(os.path.join(ROOT, 'icons', 'logo.svg'), 'w').write(logo)
open(os.path.join(ROOT, 'icons', 'icon.svg'), 'w').write(icon)
print('wrote icons/logo.svg and icons/icon.svg')
