"""Art that Potentials unlock (operators/potential/<id>-p<n>.webp and
operators/potential/index.json): each operator's pictures the game gives at
P1, P3 and P5 (CharacterPotentialTable's unlockCharPictureItemList, through
PictureItemTable and PictureTable), from the poster-sized copies
(ui/textures/spaceship/imageposter/largesize/<imgId>.png), at most 1920 px
wide. A picture beyond the first at one Potential (Perlica's P1) is
<id>-p<n>-<extra>.webp. After a change, purge each file on jsDelivr
(purge.jsdelivr.net/gh/ram-prices/ef-assets@main/<path>).

index.json: {"<operator id>": {"<Potential>": ["<file>", ...]}}, every
operator the dump's table lists, so the site knows which levels have art,
and "focus": {"<file>": [x, y]}, the point the site's banner keeps in view
(the face and upper body, as fractions of the width and height). Points are
set by hand from a contact sheet; a run keeps them, and a new picture has
none (the site centres it) until one is added.

Pictures already exported are kept, so a run after a game patch (run_all.bat
in the dump) only adds new operators. It reads the game files a dump of the
client made (the EndfieldDataDump checkout), through operator-banner.py's
Game class, like operator-full.py.

    python scripts/potential-art.py <EndfieldDataDump> [--all]

--all exports every picture again. Needs UnityPy, Pillow and NumPy.
"""
import importlib.util
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), 'operators', 'potential')
POSTERS = 'assets/beyond/dynamicassets/gameplay/ui/textures/spaceship/imageposter/largesize/'
WIDTH = 1920


def table(dump, name):
    with open(os.path.join(dump, 'output', 'Data', 'TableCfg', name + '.json'), encoding='utf-8') as f:
        return json.load(f)


def pictures(dump):
    """[(operator id, Potential, picture id, file)] in the table's order."""
    items = table(dump, 'PictureItemTable')
    pics = table(dump, 'PictureTable')
    out = []
    for char in table(dump, 'CharacterPotentialTable').values():
        for level in char['potentialUnlockBundle']:
            for item in level['unlockCharPictureItemList']:
                pic = pics.get(items.get(item, ''))
                # pic_<n>[_<extra>]_<operator id>; the shared Endministrator row lists both of theirs again.
                m = pic and re.fullmatch(r'pic_(\d+)(?:_(\w+?))?_(chr_\d{4}_\w+)', pic['imgId'])
                if not m:
                    print('skipped', item)
                    continue
                n, extra, op = m.groups()
                file = f'{op}-p{n}' + (f'-{extra}' if extra else '') + '.webp'
                if not any(o[3] == file for o in out):
                    out.append((op, int(n), pic['imgId'], file))
    return out


def poster(game, img):
    """The poster's pixels: a Texture2D (Game.by_path finds sprites only)."""
    rel = game.path_bundle.get((POSTERS + img + '.png').lower())
    if not rel:
        return None
    for o in game.env(rel).objects:
        if o.type.name in ('Texture2D', 'Sprite') and o.peek_name().lower() == img.lower():
            return o.read().image.convert('RGB')
    return None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    again = '--all' in sys.argv
    dump = args[0]
    spec = importlib.util.spec_from_file_location('operator_banner', os.path.join(HERE, 'operator-banner.py'))
    banner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(banner)
    game = None
    os.makedirs(OUT, exist_ok=True)
    index = {}
    old = os.path.join(OUT, 'index.json')
    focus = {}
    if os.path.exists(old):
        with open(old, encoding='utf-8') as f:
            focus = json.load(f).get('focus', {})
    for op, n, img, file in pictures(dump):
        path = os.path.join(OUT, file)
        if again or not os.path.exists(path):
            game = game or banner.Game(dump)
            im = poster(game, img)
            if not im:
                print('missing', img)
                continue
            if im.width > WIDTH:
                im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), 3)
            im.save(path, 'WEBP', quality=88, method=6)
            print(file, im.size)
        index.setdefault(op, {}).setdefault(str(n), []).append(file)
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8', newline='\n') as f:
        files = {name for levels in index.values() for names in levels.values() for name in names}
        index = dict(sorted(index.items()))
        index['focus'] = {k: v for k, v in sorted(focus.items()) if k in files}
        json.dump(index, f, indent=1)
        f.write('\n')
    print(len(index) - 1, 'operators,', len(files - set(focus)), 'pictures without a focus point')


if __name__ == '__main__':
    main()
