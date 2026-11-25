"""Operator portraits (operators/<id>.webp: the square face in the 6-star strip,
the ruler, Loadout, the database lists and Discord embeds): the game's own
remote icon, charremoteicon/icon_<id>.png, from a local dump of the client
(EndfieldDataDump, the newest output/v*-bundle-assets folder). They replace
the wiki's 120px icons (portraits.py), which stay the fallback for an operator
the dump lacks.

The game's icon is 200x200 with a cut-out background (transparent behind the
character, as the old icons were) and its outer edge fading to transparent.
The fade isn't the same everywhere: the first operators' fade 20px on every
side, later ones about 24px at the top and 22px at the right. So each edge of
each file is measured (the depth from which the middle of that edge stays
opaque, ignoring the character's own cut-out gaps), cut one pixel deeper (the
corners fade a pixel further), trimmed to a centred square, and saved at that
size (about 154px; the site shows 26 to 96px).

    python scripts/operator-icons.py <EndfieldDataDump> [<id>...]

With no ids, every operator in wiki/operators.json. It overwrites existing
portraits, and a changed file keeps its URL, so browsers keep the old picture
for a week: run it for a new operator before the first push, and after
replacing existing ones bump the site's portrait URL (ItJustLogs
src/domain/banners.ts PORTRAIT_V). Needs Pillow and NumPy.
"""
import glob
import json
import os
import re
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'operators')
# The game's other id for an operator, where ef-assets files the picture under it.
PICTURE_ID = {'chr_0034_typhoeus': 'chr_0034_typhoea'}
# Alpha that counts as opaque (250/255 can't be told from solid).
SOLID = 250
# The corners fade this much deeper than the edges.
CORNER = 1
# An edge that never measures (the character cut away all along it): the deepest fade seen.
DEEPEST = 25
MAX_MARGIN = 40


def icon_dir(dump):
    """charremoteicon in the newest vX.Y-N-bundle-assets folder of the dump's output."""
    def version(path):
        m = re.search(r'v(\d+)\.(\d+)-(\d+)-bundle-assets', path)
        return tuple(int(x) for x in m.groups()) if m else (-1,)
    dirs = sorted(glob.glob(os.path.join(dump, 'output', 'v*-bundle-assets', 'Characters', 'charremoteicon')), key=version)
    if not dirs:
        sys.exit(f'no output/v*-bundle-assets/Characters/charremoteicon under {dump}: extract the bundles first')
    return dirs[-1]


def depth(line):
    """Where one edge's fade ends: the first depth from which, four pixels on,
    its middle stays SOLID (90th percentile, so the character's own cut-out
    gaps don't count). `line(d)` is the edge's middle at depth d."""
    return next((d for d in range(MAX_MARGIN) if all(np.percentile(line(x), 90) >= SOLID for x in range(d, d + 4))), DEEPEST)


def crop_box(a):
    """The square left after cutting each edge's fade (left, top, right, bottom)."""
    h, w = a.shape
    lo, hi = w // 5, w - w // 5
    top = depth(lambda d: a[d, lo:hi]) + CORNER
    bottom = h - depth(lambda d: a[h - 1 - d, lo:hi]) - CORNER
    left = depth(lambda d: a[lo:hi, d]) + CORNER
    right = w - depth(lambda d: a[lo:hi, w - 1 - d]) - CORNER
    side = min(right - left, bottom - top)
    # Trim the longer way to a square, evenly from both ends.
    left += (right - left - side) // 2
    top += (bottom - top - side) // 2
    return left, top, left + side, top + side


def main():
    src = icon_dir(sys.argv[1])
    print('from', src)
    ids = sys.argv[2:] or sorted(json.load(open(os.path.join(ROOT, 'wiki', 'operators.json'), encoding='utf-8'))['operators'])
    missing = []
    for id in ids:
        pic = PICTURE_ID.get(id, id)
        path = os.path.join(src, f'icon_{pic}.png')
        if not os.path.exists(path):
            missing.append(id)
            continue
        im = Image.open(path).convert('RGBA')
        box = crop_box(np.asarray(im)[:, :, 3])
        im = im.crop(box)
        im.save(os.path.join(OUT, f'{pic}.webp'), 'WEBP', quality=92, method=6)
        print(f'{pic}: {im.width}px, cut at {box}')
    if missing:
        print('no remote icon in the dump (kept the old portrait):', ', '.join(missing))


if __name__ == '__main__':
    main()
