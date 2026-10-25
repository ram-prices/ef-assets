"""The game's enemy icons (icons/enemies/<template id>.webp, eny_0082_hsbear.webp), the big ones its enemy handbook
shows, read from the owner's EndfieldDataDump output: the decrypted bundle that holds the folder
assets/beyond/dynamicassets/gameplay/ui/sprites/monstericonbig (found through output/asset_index.tsv, since bundle
folder names change with patches). Run by hand after a game patch:

    python scripts/enemy-icons.py C:/Users/Albert/Development/EndfieldDataDump/output

Needs UnityPy (decodes the icons' textures) and Pillow.
"""
import glob
import os
import sys

import UnityPy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'icons', 'enemies')
FOLDER = 'assets/beyond/dynamicassets/gameplay/ui/sprites/monstericonbig/'


def bundles_of(dump):
    """The decrypted bundle folders the icon folder is in, from the dump's asset index (patched copies last)."""
    found = []
    with open(os.path.join(dump, 'asset_index.tsv'), encoding='utf8') as f:
        for line in f:
            folder, _, path = line.rstrip('\n').partition('\t')
            if path.lower().startswith(FOLDER) and folder not in found:
                found.append(folder)
    if not found:
        raise SystemExit(f'No {FOLDER} in asset_index.tsv: rebuild it (dumper/build_asset_index.py).')
    found.sort(key=lambda x: x.startswith('Persistent'))
    return [os.path.join(dump, 'bundles', x) for x in found]


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    dump = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    names = set()
    for folder in bundles_of(dump):
        # Loaded by path, so UnityPy finds the pixel data (.resS) beside each file.
        for cab in glob.glob(os.path.join(folder, 'CAB-*')):
            if cab.endswith('.resS'):
                continue
            for obj in UnityPy.load(cab).objects:
                if obj.type.name != 'Texture2D':
                    continue
                tex = obj.read()
                # Enemies only (the folder also has the training targets, tatget_*).
                if not tex.m_Name.startswith('eny_'):
                    continue
                tex.image.save(os.path.join(OUT, tex.m_Name + '.webp'), 'WEBP', quality=90, method=6)
                names.add(tex.m_Name)
    print(f'{len(names)} enemy icons')


if __name__ == '__main__':
    main()
