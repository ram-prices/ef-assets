"""The game's in-battle buff and debuff icons (icons/buffs/<sprite>.webp, 84px as the game has them) and which buff
uses which (icons/buffs/index.json: buff id -> sprite), read from the owner's EndfieldDataDump output: the decrypted
bundle that holds the folder assets/beyond/dynamicassets/gameplay/ui/sprites/bufficon (found through
output/asset_index.tsv, since bundle folder names change with patches) and the decoded BuffData files, whose
data.iconConfig._spritePath names a buff's icon (only buffs with data.hasIcon). Run by hand after a game patch:

    python scripts/buff-icons.py C:/Users/Albert/Development/EndfieldDataDump/output

It also writes icons/buffs/main-only.json: the buffs whose icon the game draws only on the controlled operator's row
(iconConfig.onlyShowForMainCharacter). `--main-only` after the path writes just that list.

Needs UnityPy (decodes the icons' BC7 textures) and Pillow.
"""
import glob
import json
import os
import sys

import UnityPy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'icons', 'buffs')
FOLDER = 'assets/beyond/dynamicassets/gameplay/ui/sprites/bufficon/'


def bundle_of(dump):
    """The decrypted bundle folder the icon folder is in, from the dump's asset index."""
    with open(os.path.join(dump, 'asset_index.tsv'), encoding='utf8') as f:
        for line in f:
            folder, _, path = line.rstrip('\n').partition('\t')
            if path.lower().startswith(FOLDER):
                return os.path.join(dump, 'bundles', folder)
    raise SystemExit(f'No {FOLDER} in asset_index.tsv: rebuild it (dumper/build_asset_index.py).')


def buff_uses(dump):
    """Each buff's icon, patched copies (Persistent) over the base ones, and the buffs only the controlled operator shows."""
    uses = {}
    main_only = set()
    for root in ('StreamingAssets', 'Persistent'):
        for path in glob.glob(os.path.join(dump, 'jsondata', root, 'BuffData', '*.json')):
            data = json.load(open(path, encoding='utf8')).get('data', {})
            config = data.get('iconConfig') or {}
            sprite = config.get('_spritePath')
            buff = os.path.splitext(os.path.basename(path))[0]
            if str(data.get('hasIcon')) == 'True' and sprite:
                uses[buff] = sprite
            else:
                uses.pop(buff, None)
            if str(config.get('onlyShowForMainCharacter')) == 'True':
                main_only.add(buff)
            else:
                main_only.discard(buff)
    return uses, main_only


def write_main_only(buffs):
    with open(os.path.join(OUT, 'main-only.json'), 'w', encoding='utf8', newline='\n') as f:
        json.dump(buffs, f, indent=1, ensure_ascii=False)
        f.write('\n')


def main():
    # Only the main-only list, without the bundle (no UnityPy needed): --main-only.
    if len(sys.argv) > 2 and sys.argv[2] == '--main-only':
        uses, main_only = buff_uses(sys.argv[1])
        index = json.load(open(os.path.join(OUT, 'index.json'), encoding='utf8'))
        write_main_only(sorted(b for b in main_only if b in index))
        print(f'{len(main_only & set(index))} buffs shown only on the controlled operator')
        return
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    dump = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    folder = bundle_of(dump)
    names = []
    # Loaded by path, so UnityPy finds the pixel data (.resS) beside each file.
    for cab in glob.glob(os.path.join(folder, 'CAB-*')):
        if cab.endswith('.resS'):
            continue
        for obj in UnityPy.load(cab).objects:
            if obj.type.name != 'Texture2D':
                continue
            tex = obj.read()
            tex.image.save(os.path.join(OUT, tex.m_Name + '.webp'), 'WEBP', lossless=True)
            names.append(tex.m_Name)
    uses, main_only = buff_uses(dump)
    have = set(names)
    index = {b: s for b, s in sorted(uses.items()) if s in have}
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf8', newline='\n') as f:
        json.dump(index, f, indent=1, ensure_ascii=False)
        f.write('\n')
    # Buffs the game draws only on the controlled operator's row (iconConfig.onlyShowForMainCharacter: Last Rite's
    # Perfusion is on the whole team, its icon only on whoever is controlled).
    write_main_only(sorted(b for b in main_only if b in index))
    missing = sorted(set(uses.values()) - have)
    print(f'{len(names)} icons, {len(index)} buffs mapped' + (f'; sprites with no icon: {missing}' if missing else ''))


if __name__ == '__main__':
    main()
