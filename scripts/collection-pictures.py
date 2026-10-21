"""A copy of every picture wiki/medals.json and wiki/findings.json link to on
endfield.wiki.gg, saved as WebP in collections/ (medals/, finding-icons/,
findings/), with collections/index.json mapping each wiki URL to its copy.
ItJustLogs swaps the URLs for these copies, so its Achievements and Archives
pages don't load pictures from the wiki (they keep working while it's down,
and visitors don't contact it).

Medal pictures are kept at 144px (twice their size on the page), finding
icons at 128px, and finding pictures at up to 1024px. Like item-icons.py it
goes slowly, one request at a time with a pause, backs off on refusals, and
only fetches pictures it doesn't have yet.

    python scripts/collection-pictures.py

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
OUT = os.path.join(ROOT, 'collections')
UA = {'User-Agent': 'ef-assets wiki snapshot (github.com/ram-prices/ef-assets; ItJustLogs)'}
PAUSE = 2.0
GIVE_UP = 5
# Where each kind of picture goes, and its largest side.
KINDS = {'medals': 144, 'finding-icons': 128, 'findings': 1024}


class Refused(Exception):
    pass


refusals = 0


def get(url):
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


def name_of(url):
    """The file's own name, readable and safe: 'Medal-"Awaken".png' -> 'medal-awaken'."""
    stem = os.path.splitext(urllib.parse.unquote(url.rsplit('/', 1)[-1]))[0]
    return re.sub(r'[^a-z0-9]+', '-', stem.lower()).strip('-')


def wanted():
    """Every picture the two files link to: (wiki URL, kind)."""
    medals = json.load(open(os.path.join(ROOT, 'wiki', 'medals.json'), encoding='utf8'))['medals']
    findings = json.load(open(os.path.join(ROOT, 'wiki', 'findings.json'), encoding='utf8'))['findings']
    out = {}
    for m in medals:
        for url in m.get('images', {}).values():
            out.setdefault(url, 'medals')
    for f in findings:
        if f.get('icon'):
            out.setdefault(f['icon'], 'finding-icons')
        if f.get('image'):
            out.setdefault(f['image'], 'findings')
    return out


def save(url, path, size):
    im = Image.open(io.BytesIO(get(url)))
    im = im.convert('RGBA')
    im.thumbnail((size, size), Image.LANCZOS)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, 'WEBP', quality=88, method=6)


def main():
    index_path = os.path.join(OUT, 'index.json')
    index = json.load(open(index_path, encoding='utf8')) if os.path.exists(index_path) else {}
    want = wanted()
    made, missing = 0, []
    try:
        for url, kind in want.items():
            rel = f'{kind}/{name_of(url)}.webp'
            if os.path.exists(os.path.join(OUT, rel)):
                index[url] = rel
                continue
            try:
                save(url, os.path.join(OUT, rel), KINDS[kind])
            except urllib.error.HTTPError:
                missing.append(url)
                continue
            index[url] = rel
            made += 1
            if made % 25 == 0:
                print(f'  {made} saved...', flush=True)
    except Refused as e:
        print(f'stopped: {e}')
    # Only what the files still link to.
    index = {u: p for u, p in index.items() if u in want}
    os.makedirs(OUT, exist_ok=True)
    with open(index_path, 'w', encoding='utf8', newline='\n') as fh:
        json.dump(index, fh, indent=1, ensure_ascii=False, sort_keys=True)
        fh.write('\n')
    print(f'pictures: {made} new, {len(index)} of {len(want)} saved')
    if missing:
        print(f'gone from the wiki: {len(missing)}: {"; ".join(missing[:10])}')


def report(message):
    print(message, flush=True)
    if os.environ.get('GITHUB_ACTIONS'):
        print(f'::error::{message}', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # noqa: BLE001
        report(f'{type(e).__name__}: {e}')
        raise
