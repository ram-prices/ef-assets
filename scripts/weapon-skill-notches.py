"""The game's weapon skill level notches (icons/weapon-skill/), read from the owner's EndfieldDataDump output: the
sprites WeaponSkillCell's notch cells use (ui/prefabs/weaponinfo/widget/weaponskillcell.prefab, WeaponSkillNotchCell):

- notch.png (charinfo/weaponinfo/deco_groove): the filled notch. The game tints it white for the weapon's own levels
  (Progress), #FFF100 for levels the essence adds (ProgressGem) and black at 20% for levels it could still reach
  (Available).
- notch-outline.png (deco_groove01) with notch-slash.png (deco_groove02) through it: a level it can't reach at its
  tuning and Potential (NotAvailable, both black at 20%).

White on transparent, as the game has them, for the site to tint (CSS masks). Run by hand after a game patch:

    python scripts/weapon-skill-notches.py C:/Users/Albert/Development/EndfieldDataDump/output

Needs UnityPy and Pillow.
"""
import glob
import os
import sys

import UnityPy

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), 'icons', 'weapon-skill')
SPRITES = {
    'assets/beyond/arts/ui/sprites/charinfo/weaponinfo/deco_groove.png': 'notch',
    'assets/beyond/arts/ui/sprites/charinfo/weaponinfo/deco_groove01.png': 'notch-outline',
    'assets/beyond/arts/ui/sprites/charinfo/weaponinfo/deco_groove02.png': 'notch-slash',
}


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    dump = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    folders = {}
    with open(os.path.join(dump, 'asset_index.tsv'), encoding='utf8') as f:
        for line in f:
            folder, _, path = line.rstrip('\n').partition('\t')
            if path.lower() in SPRITES:
                folders[SPRITES[path.lower()]] = os.path.join(dump, 'bundles', folder)
    for name, folder in sorted(folders.items()):
        for cab in glob.glob(os.path.join(folder, 'CAB-*')):
            if cab.endswith(('.resS', '.json')):
                continue
            for obj in UnityPy.load(cab).objects:
                if obj.type.name == 'Sprite':
                    obj.read().image.save(os.path.join(OUT, f'{name}.png'))
                    print(name)
    missing = set(SPRITES.values()) - set(folders)
    if missing:
        raise SystemExit(f'Not in asset_index.tsv: {sorted(missing)}')


if __name__ == '__main__':
    main()
