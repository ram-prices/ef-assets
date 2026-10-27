"""Operator card art (operators/bust/<id>.webp) for the site's Operators list:
the game's clean Headhunting results art (sprites/chargacha, 236x1352, no
background, every operator's face at the same height), cut to the game's
operator-list card shape (152:212) from the top of the head down, starting
where the game's own list icon (sprites/charremoteicon) starts, at full
resolution (236x329). The wider charremoteicon700 portraits are communication-screen art
with scanlines and grain, so they aren't used. Read from the owner's
EndfieldDataDump output: the decrypted bundles that hold that folder (found
through output/asset_index.tsv, since bundle folder names change with
patches). Run by hand after a game patch adds operators:

    python scripts/operator-cards.py C:/Users/Albert/Development/EndfieldDataDump/output

Needs UnityPy and Pillow.
"""
import glob
import json
import os
import sys

import UnityPy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
# A new folder name whenever the art changes: jsDelivr and browsers keep a file a week.
OUT = os.path.join(ROOT, 'operators', 'bust')
FOLDER = '/ui/sprites/chargacha/'
# The crop: the sprite's full width at 152:212, from y 350 (where the list icon's
# top falls on these sprites, measured by matching the two).
HEIGHT = round(236 * 212 / 152)
TOP = 350


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
                if tex.m_Name not in ids:
                    continue
                im = tex.image.convert('RGBA')
                im = im.crop((0, TOP, im.width, TOP + HEIGHT))
                im.save(os.path.join(OUT, tex.m_Name + '.webp'), 'WEBP', quality=88, method=6)
                made.append(tex.m_Name)
    print(f'{len(made)} operator cards')


if __name__ == '__main__':
    main()
