"""Item icons (icons/items/<slug>.webp, 64px) for every reward the site names
(wiki/events.json) and the pull currencies its Stats page counts, plus the element, class and weapon type icons
(icons/elements/, icons/classes/, icons/weapon-types/), and icons/index.json
mapping each name to its file, with each banner HH Permit's main colour
under "colors" (the site writes its amounts in it). The pictures are the wiki's uploads of the
game's icons: the script lists the wiki's files once, then picks the file
named after each thing ("Oroberyl.png", "Item Oroberyl.png", "Heat.png",
"Element Heat.png", "Class Guard.png"...).

endfield.wiki.gg sits behind Cloudflare, which turns scripts away when they
ask too much, so this goes slowly: one request at a time with a pause
between them, backing off on any refusal and giving up after a few in a row.
Only missing icons are downloaded, so a run after the first is quick.

    python scripts/item-icons.py

Needs Pillow.
"""
import colorsys
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'icons')
API = 'https://endfield.wiki.gg/api.php'
UA = {'User-Agent': 'ef-assets wiki snapshot (github.com/ram-prices/ef-assets; ItJustLogs)'}
SIZE = 64
PAUSE = 2.0  # seconds between requests
GIVE_UP = 5  # refusals in a row


class Refused(Exception):
    pass


refusals = 0


def get(url):
    """One polite request: a pause first; on a refusal wait longer (Retry-After if given) and try again."""
    global refusals
    wait = PAUSE
    while True:
        time.sleep(wait)
        try:
            data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
            refusals = 0
            return data
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise
            refusals += 1
            if refusals >= GIVE_UP:
                raise Refused(f'{e.code} {GIVE_UP} times in a row: the wiki is turning us away, try again later')
            wait = float(e.headers.get('Retry-After') or 0) or min(300, 30 * 2 ** (refusals - 1))
            print(f'  {e.code}: waiting {wait:.0f}s', flush=True)
        except urllib.error.URLError as e:
            refusals += 1
            if refusals >= GIVE_UP:
                raise Refused(str(e))
            wait = min(300, 30 * 2 ** (refusals - 1))


def api(**params):
    data = get(API + '?' + urllib.parse.urlencode({'format': 'json', 'formatversion': 2, **params}))
    try:
        return json.loads(data)
    except json.JSONDecodeError:
        raise Refused('the API answered with a page, not JSON')


def wiki_files():
    """Every file on the wiki: name → url (one listing, 500 at a time)."""
    files, cont = {}, {}
    while True:
        r = api(action='query', list='allimages', ailimit=500, aiprop='url', **cont)
        for f in r['query']['allimages']:
            files[f['name']] = f['url']
        if 'continue' not in r:
            return files
        cont = r['continue']


ROMAN = {'Ⅰ': 'i', 'Ⅱ': 'ii', 'Ⅲ': 'iii', 'Ⅳ': 'iv', 'Ⅴ': 'v'}


def key(s):
    """A name to match files by: lower case, letters and digits only ("Crate Ⅰ" as "Crate I")."""
    for k, v in ROMAN.items():
        s = s.replace(k, v)
    return re.sub(r'[^a-z0-9]', '', s.lower())


def names_for(kind, name):
    """The names a thing's file may go by: a portrait reward is its picture's "<name>_profile" file."""
    if kind == 'classes':
        return [name, CLASS_FILES.get(name, name)]
    portrait = re.match(r'^(.*) \(Portrait\)$', name)
    if portrait:
        return [f'{portrait[1]} profile', name, portrait[1]]
    return [name]


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def find(files, names, prefixes):
    """The wiki file for a thing: one of its names with one of the prefixes, any case and spacing, .png/.webp."""
    by_key = {}
    for f in files:
        stem, ext = os.path.splitext(f)
        if ext.lower() in ('.png', '.webp'):
            by_key.setdefault(key(stem), f)
    for name in names:
        for p in prefixes:
            hit = by_key.get(key(p + name))
            if hit:
                return hit
    return None


def is_light_square(im):
    """A white tile with the glyph cut out of it or drawn dark on it (some class and
    weapon type icons), rather than a light glyph on nothing."""
    alpha = im.getchannel('A')
    n = im.width * im.height
    opaque = sum(1 for a in alpha.getdata() if a > 200) / n
    lit = [v for v, a in zip(im.convert('L').getdata(), alpha.getdata()) if a > 200]
    return opaque > 0.5 and bool(lit) and sum(lit) / len(lit) > 200


def white_on_clear(im):
    """Such a tile as a white glyph on nothing, like the element icons: what was
    dark or cut out turns white, the white tile turns clear, and whatever lay
    outside the tile (its rounded corners) stays clear."""
    alpha = im.getchannel('A')
    lum = im.convert('L')
    # Ink: dark or see-through pixels inside the tile.
    ink = Image.new('L', im.size)
    ink.putdata([255 - min(a, v) for a, v in zip(alpha.getdata(), lum.getdata())])
    # Outside the tile: the see-through area reachable from the corners.
    outside = alpha.point(lambda a: 255 if a < 40 else 0)
    for corner in ((0, 0), (im.width - 1, 0), (0, im.height - 1), (im.width - 1, im.height - 1)):
        if outside.getpixel(corner) == 255:
            ImageDraw.floodfill(outside, corner, 128)
    ink.putdata([0 if o == 128 else v for v, o in zip(ink.getdata(), outside.getdata())])
    out = Image.new('RGBA', im.size, (255, 255, 255, 0))
    out.putalpha(ink)
    return out


def save(url, path, kind):
    im = Image.open(io.BytesIO(get(url))).convert('RGBA')
    if kind != 'items' and is_light_square(im):
        im = white_on_clear(im)
    box = im.getbbox()
    if box:
        im = im.crop(box)
    im.thumbnail((SIZE, SIZE), Image.LANCZOS)
    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    canvas.alpha_composite(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    canvas.save(path, 'WEBP', quality=90, method=6)


# Pull currencies ItJustLogs' Stats page shows with their icon, whether or not an event gives them.
CURRENCIES = ['Oroberyl', 'Origeometry', 'Chartered HH Permit', 'Basic HH Permit', 'Arsenal Ticket']


def wanted():
    """What needs an icon: kind → names."""
    events = json.load(open(os.path.join(ROOT, 'wiki', 'events.json'), encoding='utf8'))
    items = set(CURRENCIES)
    for ev in [*events['events'].values(), *events.get('extra', {}).values()]:
        for g in ev['groups']:
            for r in g['rows']:
                items.update(name for name, _ in r['rewards'])
    ops = json.load(open(os.path.join(ROOT, 'wiki', 'operators.json'), encoding='utf8'))['operators'].values()
    weps = json.load(open(os.path.join(ROOT, 'wiki', 'weapons.json'), encoding='utf8'))['weapons'].values()
    return {
        'items': sorted(items),
        'elements': sorted({o['element'] for o in ops if o.get('element')}),
        'classes': sorted({o['class'] for o in ops if o.get('class')}),
        'weapon-types': sorted({w['type'] for w in weps if w.get('type')}),
    }


PREFIXES = {
    'items': ['', 'Item ', 'Item_', 'Icon '],
    'elements': ['Element ', 'Icon Element ', '', 'Attribute '],
    'classes': ['Class ', 'Icon Class ', 'Profession ', ''],
    'weapon-types': ['Weapon Type ', 'Icon Weapon ', 'Weapon ', ''],
}
# Classes whose icon file is named otherwise.
CLASS_FILES = {'Supporter': 'Support'}


def main_colour(path, name):
    """The icon's main colour, readable on a dark page: the most common
    saturated hue, its pixels averaged, lightness and saturation evened out.
    A banner HH Permit's shared corner badge and its "1" pane don't count."""
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    permit = name.endswith('HH Permit')
    bins = [[0.0, 0, 0, 0, 0] for _ in range(24)]  # weight, r, g, b, count
    for y in range(h):
        for x in range(w):
            r, g, b, a = im.getpixel((x, y))
            if a < 200 or (permit and ((x < w * 0.45 and y > h * 0.6) or x > w * 0.7)):
                continue
            hh, ss, vv = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if ss < 0.3 or vv < 0.3:
                continue
            bn = bins[int(hh * 24) % 24]
            bn[0] += ss * vv
            bn[1] += r
            bn[2] += g
            bn[3] += b
            bn[4] += 1
    best = max(bins, key=lambda bn: bn[0])
    if not best[4]:
        return None
    r, g, b = (best[i] / best[4] / 255 for i in (1, 2, 3))
    hh, ll, ss = colorsys.rgb_to_hls(r, g, b)
    r, g, b = colorsys.hls_to_rgb(hh, min(max(ll, 0.58), 0.7), max(ss, 0.55))
    return '#%02x%02x%02x' % tuple(round(c * 255) for c in (r, g, b))


def main():
    want = wanted()
    index_path = os.path.join(OUT, 'index.json')
    index = json.load(open(index_path, encoding='utf8')) if os.path.exists(index_path) else {}
    print('listing the wiki\'s files...', flush=True)
    try:
        files = wiki_files()
    except Refused as e:
        sys.exit(f'stopped while listing files: {e}')
    print(f'{len(files)} files', flush=True)
    missing, made = [], 0
    for kind, names in want.items():
        index.setdefault(kind, {})
        for name in names:
            path = os.path.join(OUT, kind, f'{slug(name)}.webp')
            if os.path.exists(path):
                index[kind][name] = f'{kind}/{slug(name)}.webp'
                continue
            f = find(files, names_for(kind, name), PREFIXES[kind])
            if not f:
                missing.append(f'{kind}: {name}')
                continue
            try:
                save(files[f], path, kind)
            except Refused as e:
                print(f'stopped: {e}')
                break
            except urllib.error.HTTPError:
                missing.append(f'{kind}: {name}')
                continue
            index[kind][name] = f'{kind}/{slug(name)}.webp'
            made += 1
            print(f'  {kind}/{slug(name)}.webp  <- {f}', flush=True)
        else:
            continue
        break
    index['colors'] = {}
    for name, file in index.get('items', {}).items():
        if name.endswith('HH Permit') and name not in ('Chartered HH Permit', 'Basic HH Permit'):
            colour = main_colour(os.path.join(OUT, file), name)
            if colour:
                index['colors'][name] = colour
    os.makedirs(OUT, exist_ok=True)
    with open(index_path, 'w', encoding='utf8', newline='\n') as fh:
        json.dump(index, fh, indent=1, ensure_ascii=False, sort_keys=True)
        fh.write('\n')
    print(f'icons: {made} new, {sum(len(v) for k, v in index.items() if k != "colors")} in all; {len(index["colors"])} permit colours')
    if missing:
        print(f'no icon on the wiki for: {"; ".join(missing)}')


def report(message):
    """On GitHub Actions, also as an annotation: the run's page shows it without signing in."""
    print(message, flush=True)
    if os.environ.get('GITHUB_ACTIONS'):
        print(f'::error::{message}', flush=True)


if __name__ == '__main__':
    try:
        main()
    except SystemExit as e:
        if isinstance(e.code, str):
            report(e.code)
            sys.exit(1)
        raise
    except Exception as e:  # noqa: BLE001
        report(f'{type(e).__name__}: {e}')
        raise
