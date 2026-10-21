"""Item icons (icons/items/<slug>.webp, 64px) for every reward the site names
(wiki/events.json), plus the element, class and weapon type icons
(icons/elements/, icons/classes/, icons/weapon-types/), and icons/index.json
mapping each name to its file. The pictures are the wiki's uploads of the
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
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image

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


def key(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def find(files, name, prefixes):
    """The wiki file for a thing: its name with one of the prefixes, any case and spacing, .png/.webp."""
    by_key = {}
    for f in files:
        stem, ext = os.path.splitext(f)
        if ext.lower() in ('.png', '.webp'):
            by_key.setdefault(key(stem), f)
    for p in prefixes:
        hit = by_key.get(key(p + name))
        if hit:
            return hit
    return None


def save(url, path):
    im = Image.open(io.BytesIO(get(url))).convert('RGBA')
    box = im.getbbox()
    if box:
        im = im.crop(box)
    im.thumbnail((SIZE, SIZE), Image.LANCZOS)
    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    canvas.alpha_composite(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    canvas.save(path, 'WEBP', quality=90, method=6)


def wanted():
    """What needs an icon: kind → names."""
    events = json.load(open(os.path.join(ROOT, 'wiki', 'events.json'), encoding='utf8'))
    items = set()
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
            f = find(files, name, PREFIXES[kind])
            if not f:
                missing.append(f'{kind}: {name}')
                continue
            try:
                save(files[f], path)
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
    os.makedirs(OUT, exist_ok=True)
    with open(index_path, 'w', encoding='utf8', newline='\n') as fh:
        json.dump(index, fh, indent=1, ensure_ascii=False, sort_keys=True)
        fh.write('\n')
    print(f'icons: {made} new, {sum(len(v) for v in index.values())} in all')
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
