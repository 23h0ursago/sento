#!/usr/bin/env python3
"""Build data/sento/: every public bath in Japan from OpenStreetMap, split into 0.5° tiles.

Run weekly by .github/workflows/sento-data.yml (or by hand: python3 tools/build_sento_data.py).
The app loads only the tiles near you, so nearby sento show up instantly and work offline.

Each place is a compact object:
  i  OpenStreetMap id ("n123", "w456", "r789")
  n  name, e English name (optional)
  a  latitude, o longitude
  h  opening_hours (optional, OpenStreetMap format)
  t  kind: "sento", "super" (super sento / spa) or "onsen" (hot-spring complex), or "" if unknown
  w  website (optional)
  p  1 if it's on the popular-in-Tokyo list (tools/popular-tokyo.json)
"""
import json
import math
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'sento')
POPULAR = os.path.join(ROOT, 'tools', 'popular-tokyo.json')
TILE = 0.5
SERVERS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
]
# Sento are usually amenity=public_bath; some (like Kosugiyu) are tagged as a sauna or shower with 湯 in the name.
QUERY = """[out:json][timeout:900];
area["ISO3166-1"="JP"][admin_level=2]->.jp;
(
  nwr["amenity"="public_bath"](area.jp);
  nwr["leisure"="sauna"]["name"~"湯"](area.jp);
  nwr["amenity"="shower"]["name"~"湯"](area.jp);
);
out center tags;"""

SUPER = re.compile(r'スパ|SPA|Spa|ランド|健康センター|ヘルスセンター|スーパー銭湯|極楽湯|おふろの王様|竜泉寺|テルマー|万葉|ラクーア|湯処|湯快爽快|天空|ゆ〜ゆ|やまとの湯|湯けむりの里')
CLOSED = re.compile(r'[（(【]跡[）)】]|跡$|跡地|閉店|廃業|閉館|休業中')
ONSEN = re.compile(r'温泉郷|旅館|ホテル|リゾート|共同浴場')


UA = 'SentoApp data build (github.com/23h0ursago/sento)'


def post(url, data):
    try:
        req = urllib.request.Request(url, data=data, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=1000) as res:
            return json.load(res)
    except urllib.error.URLError as err:
        if 'SSL' not in str(err):
            raise
        # Older system Pythons (e.g. macOS's) can't do TLS with some servers: use curl instead
        out = subprocess.run(['curl', '-sS', '--fail', '--max-time', '1000', '-A', UA, '--data-binary', '@-', url],
                             input=data, capture_output=True, check=True)
        return json.loads(out.stdout)


def fetch(query):
    data = urllib.parse.urlencode({'data': query}).encode()
    for attempt in range(3):
        for url in SERVERS:
            try:
                body = post(url, data)
                if re.search(r'timed out|runtime error|out of memory', body.get('remark', ''), re.I):
                    raise RuntimeError(body['remark'])
                return body
            except Exception as err:  # busy, timed out or unreachable: next server / next round
                print(f'  {url}: {err}', file=sys.stderr)
        time.sleep(60 * (attempt + 1))
    sys.exit('All Overpass servers failed')


def kind(tags):
    bt = tags.get('bath:type', '')
    name = tags.get('name', '')
    if bt == 'super_sento' or SUPER.search(name):
        return 'super'
    if bt == 'sento':
        return 'sento'
    # Natural-hot-spring neighbourhood sento are often tagged onsen too; a name ending in 湯 means a sento
    if (bt in ('onsen', 'hot_spring') or ONSEN.search(name)) and not name.endswith('湯'):
        return 'onsen'
    if name.endswith('湯') or '湯温泉' in name:
        return 'sento'
    return ''


def km(a_lat, a_lon, b_lat, b_lon):
    r = math.pi / 180
    x = math.sin((b_lat - a_lat) * r / 2) ** 2 + math.cos(a_lat * r) * math.cos(b_lat * r) * math.sin((b_lon - a_lon) * r / 2) ** 2
    return 12742 * math.asin(math.sqrt(x))


def main():
    print('Downloading public baths in Japan from OpenStreetMap…')
    elements = fetch(QUERY).get('elements', [])
    places, seen = [], set()
    for e in elements:
        t = e.get('tags', {})
        lat = e.get('lat', e.get('center', {}).get('lat'))
        lon = e.get('lon', e.get('center', {}).get('lon'))
        pid = e['type'][0] + str(e['id'])
        if not t.get('name') or lat is None or pid in seen:
            continue
        if t.get('bath:type') == 'foot_bath' or t.get('access') == 'private':
            continue
        if CLOSED.search(t['name']):  # e.g. 竹の湯(跡) = where a sento used to be
            continue
        seen.add(pid)
        p = {'i': pid, 'n': t['name'], 'a': round(lat, 5), 'o': round(lon, 5), 't': kind(t)}
        if t.get('name:en') or t.get('name:ja-Latn'):
            p['e'] = t.get('name:en') or t.get('name:ja-Latn')
        if t.get('opening_hours'):
            p['h'] = t['opening_hours']
        if t.get('website') or t.get('contact:website'):
            p['w'] = t.get('website') or t.get('contact:website')
        places.append(p)
    print(f'{len(places)} places')

    # Popular list: nearest place whose name contains the listed name, within 2.5 km
    popular = json.load(open(POPULAR, encoding='utf-8'))['places']
    missing = []
    for want in popular:
        cands = [(km(want['lat'], want['lon'], p['a'], p['o']), p) for p in places if want['name'] in p['n']]
        cands = [c for c in cands if c[0] <= 2.5]
        if cands:
            min(cands, key=lambda c: c[0])[1]['p'] = 1
        else:
            missing.append(want['name'])
    print(f'popular: {len(popular) - len(missing)} matched' + (f', not found: {", ".join(missing)}' if missing else ''))

    # Split into tiles; only touch files (and the date) when something changed
    tiles = {}
    for p in places:
        key = f"{math.floor(p['a'] / TILE) * TILE:g}_{math.floor(p['o'] / TILE) * TILE:g}"
        tiles.setdefault(key, []).append(p)
    os.makedirs(OUT, exist_ok=True)
    changed = False
    for key, items in tiles.items():
        items.sort(key=lambda p: p['i'])
        text = json.dumps(items, ensure_ascii=False, separators=(',', ':'))
        path = os.path.join(OUT, f'{key}.json')
        if not os.path.exists(path) or open(path, encoding='utf-8').read() != text:
            open(path, 'w', encoding='utf-8').write(text)
            changed = True
    for name in os.listdir(OUT):
        if name.endswith('.json') and name != 'index.json' and name[:-5] not in tiles:
            os.remove(os.path.join(OUT, name))
            changed = True
    index_path = os.path.join(OUT, 'index.json')
    old = json.load(open(index_path)) if os.path.exists(index_path) else {}
    index = {
        'updated': datetime.now(timezone.utc).strftime('%Y-%m-%d') if changed or not old else old['updated'],
        'tile': TILE,
        'count': len(places),
        'tiles': {k: len(v) for k, v in sorted(tiles.items())},
    }
    json.dump(index, open(index_path, 'w'), indent=1)
    print(f"{len(tiles)} tiles, {'updated' if changed else 'no changes'}")


if __name__ == '__main__':
    main()
