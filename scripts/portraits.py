"""Operator and weapon portraits (operators/<id>.webp, arsenals/<id>.webp) at
the game's own icon size, from the wiki's uploads: "<Name>_icon.png", 120px
for operators (the face close-up the site has always used) and 256px for
weapons. The two Endministrators have their own files, "(Female)" and
"(Male)".

A portrait larger than the old 72px icons is kept, so a run after the first
only fetches new operators and weapons, and replaces the version guide's
72px stand-ins (guide-art.py) once the wiki has the real icon. A weapon icon
a little off square is centred on a clear square. It goes as slowly
as item-icons.py, whose wiki helpers it uses.

    python scripts/portraits.py

Needs Pillow.
"""
import importlib.util
import io
import json
import os
import sys
import urllib.error

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
spec = importlib.util.spec_from_file_location('item_icons', os.path.join(HERE, 'item-icons.py'))
icons = importlib.util.module_from_spec(spec)
spec.loader.exec_module(icons)

# Folder, wiki file, and the size the game's icon comes in.
KINDS = {
    'operators': ('operators', 120),
    'weapons': ('arsenals', 256),
}
# The size of the icons these replace.
STAND_IN = 72
# Operators who share a name: their own files.
NAMES = {'chr_0003_endminf': 'Endministrator (Female)', 'chr_0002_endminm': 'Endministrator (Male)'}


def save(url, path, size):
    im = Image.open(io.BytesIO(icons.get(url))).convert('RGBA')
    # Never larger than the game's icon; smaller uploads are kept as they are.
    if max(im.size) > size:
        im.thumbnail((size, size), Image.LANCZOS)
    if im.width != im.height:
        im = square(im)
    im.save(path, 'WEBP', quality=92, method=6)


def square(im):
    """A few weapon icons are a little off square (254x246): centred on a clear square, as all portraits are."""
    side = max(im.size)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.alpha_composite(im, ((side - im.width) // 2, (side - im.height) // 2))
    return canvas


def main():
    print("listing the wiki's files...", flush=True)
    try:
        files = icons.wiki_files()
    except icons.Refused as e:
        sys.exit(f'stopped while listing files: {e}')
    made, missing = 0, []
    for kind, (folder, size) in KINDS.items():
        items = json.load(open(os.path.join(ROOT, 'wiki', f'{kind}.json'), encoding='utf8'))[kind]
        os.makedirs(os.path.join(ROOT, folder), exist_ok=True)
        for id, item in items.items():
            path = os.path.join(ROOT, folder, f'{id}.webp')
            # Only missing ones and the 72px stand-ins (the old icons, guide-art.py's previews).
            if os.path.exists(path) and min(Image.open(path).size) > STAND_IN:
                continue
            name = NAMES.get(id, item['name'])
            f = icons.find(files, [f'{name} icon'], [''])
            if not f:
                missing.append(name)
                continue
            try:
                save(files[f], path, size)
            except icons.Refused as e:
                print(f'stopped: {e}')
                break
            except urllib.error.HTTPError:
                missing.append(name)
                continue
            made += 1
            print(f'  {folder}/{id}.webp  <- {f}', flush=True)
        else:
            continue
        break
    print(f'portraits: {made} new or sharper')
    if missing:
        print(f'no icon on the wiki for: {"; ".join(missing)}')


if __name__ == '__main__':
    try:
        main()
    except SystemExit as e:
        if isinstance(e.code, str):
            icons.report(e.code)
            sys.exit(1)
        raise
    except Exception as e:  # noqa: BLE001
        icons.report(f'{type(e).__name__}: {e}')
        raise
