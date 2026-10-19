"""Gear icons (gear/<item id>.webp, 72px like operators/ and arsenals/) for
every gear piece in wiki/gear.json, so the site can show what an operator
has equipped. The icon file each piece uses comes from the wiki's Cargo
table Gears (its Icon field), else a file named after the piece; the
picture is the wiki's upload of the game icon. Only missing icons are
fetched, so a run after the first is quick.

    python scripts/gear-icons.py

Needs Pillow.
"""
import io
import json
import os
import re
import time
import urllib.parse
import urllib.request

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'gear')
API = 'https://endfield.wiki.gg/api.php'
UA = {'User-Agent': 'ef-assets wiki snapshot (github.com/ram-prices/ef-assets; ItJustLogs)'}
SIZE = 72


def get(url, tries=4):
    for attempt in range(1, tries + 1):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
        except Exception:
            if attempt == tries:
                raise
            time.sleep(1.5 * attempt)


def api(**params):
    q = urllib.parse.urlencode({'format': 'json', 'formatversion': '2', **params})
    return json.loads(get(f'{API}?{q}'))


def icon_names():
    """Item id -> the wiki file its icon is (from Cargo, 500 rows a page)."""
    out = {}
    offset = 0
    while True:
        rows = api(action='cargoquery', tables='Gears', fields='Id=Id,Icon=Icon', limit='500', offset=str(offset))['cargoquery']
        for r in rows:
            t = r['title']
            if t.get('Id') and t.get('Icon'):
                name = t['Icon'] if t['Icon'].lower().startswith('file:') else f"File:{t['Icon']}"
                out[t['Id']] = name if '.' in name else f'{name}.png'
        if len(rows) < 500:
            return out
        offset += 500


def file_urls(files):
    """Wiki file title -> its full-size URL, 50 titles a request."""
    out = {}
    files = sorted(set(files))
    for i in range(0, len(files), 50):
        res = api(action='query', titles='|'.join(files[i:i + 50]), prop='imageinfo', iiprop='url')
        norm = {n['to']: n['from'] for n in res['query'].get('normalized', [])}
        for p in res['query']['pages']:
            info = p.get('imageinfo')
            if info:
                out[norm.get(p['title'], p['title'])] = info[0]['url']
    return out


def icon(data):
    """The picture trimmed to what's drawn and fitted, centred, into 72x72."""
    im = Image.open(io.BytesIO(data)).convert('RGBA')
    box = im.getchannel('A').getbbox()
    if box:
        im = im.crop(box)
    s = SIZE / max(im.size)
    im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    out = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    out.alpha_composite(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2))
    return out


def main():
    gear = json.load(open(os.path.join(ROOT, 'wiki', 'gear.json'), encoding='utf-8'))['gear']['items']
    os.makedirs(OUT, exist_ok=True)
    missing = [gid for gid in gear if not os.path.exists(os.path.join(OUT, f'{gid}.webp'))]
    if not missing:
        print('Gear icons: all present')
        return
    names = icon_names()

    # Some pieces have no Icon in Cargo; their picture is usually uploaded
    # under the piece's own name, or under the base piece's for a "T1" copy.
    def candidates(gid):
        name = gear[gid]['name']
        base = re.sub(r'\s+T\d+$', '', name)
        return [n for n in (names.get(gid), f'File:{name}.png', f'File:{base}.png') if n]

    urls = file_urls([c for g in missing for c in candidates(g)])
    made, failed = 0, []
    for gid in missing:
        url = next((urls[c] for c in candidates(gid) if c in urls), None)
        if not url:
            failed.append(f"{gear[gid]['name']} ({gid}): no icon on the wiki")
            continue
        try:
            icon(get(url)).save(os.path.join(OUT, f'{gid}.webp'), 'WEBP', lossless=True, method=6)
            made += 1
        except Exception as e:
            failed.append(f"{gear[gid]['name']} ({gid}): {e}")
    print(f'Gear icons: made {made}' + (f', {len(failed)} missing' if failed else ''))
    for f in failed:
        print(f'  {f}')


if __name__ == '__main__':
    main()
