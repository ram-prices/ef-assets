"""Operator card art (operators/bust-3/<id>.webp) for the site's Operators list:
the official site's operator pictures (endfield.gryphline.com/en-us/operator:
clean upper-body art, no background, 303x386), cut from the top to the
card's shape (303x324). The page lists each one as an element with
data-key="<key>" and the picture as its background-image; a key is an
operator's id ending (jsspsi), name (lastrite for Last Rite), or one of the
Endministrators (endministrator1 is the female, 2 the male). Operators that
already have a card are skipped, so a run only fetches new ones; the weekly
update-wiki workflow runs it.

    python scripts/operator-cards.py

A new folder name whenever the art changes: jsDelivr and browsers keep a file a
week. Needs Pillow.
"""
import io
import json
import os
import re
import sys
import urllib.request

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'operators', 'bust-3')
PAGE = 'https://endfield.gryphline.com/en-us/operator'
UA = {'User-Agent': 'ef-assets wiki snapshot (github.com/ram-prices/ef-assets; ItJustLogs)'}
# The card's shape (308:329), the picture's full width.
WIDTH, HEIGHT = 303, 324
KEYS = {'endministrator1': 'chr_0003_endminf', 'endministrator2': 'chr_0002_endminm'}


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()


def operators():
    """Every listed operator (the wiki's and the version guide's previews) by the keys the page may use."""
    wiki = json.load(open(os.path.join(ROOT, 'wiki', 'operators.json'), encoding='utf8'))['operators']
    previews = json.load(open(os.path.join(ROOT, 'wiki', 'previews.json'), encoding='utf8')).get('operators', {})
    by_key = {}
    for id, o in {**previews, **wiki}.items():
        by_key[id.split('_', 2)[2]] = id
        by_key[re.sub(r'[^a-z0-9]', '', o['name'].lower())] = id
    by_key.update(KEYS)
    return by_key


def main():
    page = get(PAGE).decode('utf8')
    pictures = re.findall(r'data-key="([^"]+)"[^>]*?background-image:url\(([^)]+\.png)\)', page)
    if not pictures:
        sys.exit(f'no operator pictures found on {PAGE}: the page changed')
    ids = operators()
    os.makedirs(OUT, exist_ok=True)
    made, unknown = 0, []
    for key, url in pictures:
        id = ids.get(key)
        if not id:
            unknown.append(key)
            continue
        path = os.path.join(OUT, f'{id}.webp')
        if os.path.exists(path):
            continue
        im = Image.open(io.BytesIO(get(url))).convert('RGBA')
        im.crop((0, 0, im.width, round(im.width * HEIGHT / WIDTH))).save(path, 'WEBP', quality=90, method=6)
        made += 1
        print(f'  operators/bust-3/{id}.webp  <- {url.rsplit("/", 1)[1]}', flush=True)
    print(f'operator cards: {made} new')
    if unknown:
        print(f'not matched to an operator: {", ".join(unknown)}')


if __name__ == '__main__':
    main()
