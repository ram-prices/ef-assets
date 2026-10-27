"""Operator card art (operators/card/<id>.webp) for the site's Operators list:
the game's own operator portraits (sprites/charremoteicon700, 700x652, no
background, head and shoulders), cut to the game's operator-list card
(152x212: the middle 467 pixels) and saved at 300x419. Read from the owner's
EndfieldDataDump output: the decrypted bundles that hold that folder (found
through output/asset_index.tsv, since bundle folder names change with
patches). Run by hand after a game patch adds operators:

    python scripts/operator-cards.py C:/Users/Albert/Development/EndfieldDataDump/output

Needs UnityPy and Pillow.
"""
import glob
import json
import os
import re
import sys

import UnityPy
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'operators', 'card')
FOLDER = '/ui/sprites/charremoteicon700/'
# The game's list card is 152x212; its middle of the 700x652 portrait, and the size saved.
WIDTH = round(652 * 152 / 212)
SIZE = (300, 419)


def bundles_of(dump):
    """The decrypted bundle folders the sprites are in, from the dump's asset index."""
    folders = set()
    with open(os.path.join(dump, 'asset_index.tsv'), encoding='utf8') as f:
        for line in f:
            folder, _, path = line.rstrip('\n').partition('\t')
            if FOLDER in path.lower():
                folders.add(os.path.join(dump, 'bundles', folder))
    if not folders:
        raise SystemExit(f'No {FOLDER} in asset_index.tsv: rebuild it (dumper/build_asset_index.py).')
    return sorted(folders)


def listed():
    """The operators the site lists: the wiki's and the version guide's previews."""
    wiki = json.load(open(os.path.join(ROOT, 'wiki', 'operators.json'), encoding='utf8'))['operators']
    previews = json.load(open(os.path.join(ROOT, 'wiki', 'previews.json'), encoding='utf8')).get('operators', {})
    return set(wiki) | set(previews)


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    os.makedirs(OUT, exist_ok=True)
    ids = listed()
    made = []
    for folder in bundles_of(sys.argv[1]):
        # Loaded by path, so UnityPy finds the pixel data (.resS) beside each file.
        for cab in glob.glob(os.path.join(folder, 'CAB-*')):
            if cab.endswith('.resS'):
                continue
            for obj in UnityPy.load(cab).objects:
                if obj.type.name != 'Texture2D':
                    continue
                tex = obj.read()
                # Listed operators only (icon_chr_0005_chen); the folder also has NPCs.
                id = re.fullmatch(r'icon_(chr_\d{4}_\w+)', tex.m_Name)
                if not id or id[1] not in ids:
                    continue
                im = tex.image.convert('RGBA')
                left = (im.width - WIDTH) // 2
                im = im.crop((left, 0, left + WIDTH, im.height)).resize(SIZE, Image.LANCZOS)
                im.save(os.path.join(OUT, id[1] + '.webp'), 'WEBP', quality=80, method=6)
                made.append(id[1])
    print(f'{len(made)} operator cards')


if __name__ == '__main__':
    main()
