"""Full operator art (operators/full/<id>.webp): the game's character portrait
(ui/sprites/characterportrait/<id>.png), the operator merged with their
splash motif on a transparent background, scaled to 1024 on the long side.

It reads the game files a dump of the client made (the EndfieldDataDump
checkout), through operator-banner.py's Game class.

    python scripts/operator-full.py <EndfieldDataDump> [<id>...]

With no ids, every operator the dump has. Needs UnityPy, Pillow and NumPy.
"""
import importlib.util
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), 'operators', 'full')
SPRITES = 'assets/beyond/dynamicassets/gameplay/ui/sprites/characterportrait/'


def main():
    dump = sys.argv[1]
    spec = importlib.util.spec_from_file_location('operator_banner', os.path.join(HERE, 'operator-banner.py'))
    banner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(banner)
    game = banner.Game(dump)
    ids = sys.argv[2:] or sorted(
        p[len(SPRITES):-4] for p in game.path_bundle if p.startswith(SPRITES) and p.endswith('.png'))
    os.makedirs(OUT, exist_ok=True)
    for id in ids:
        sf, obj = game.by_path(SPRITES + id + '.png')
        if not obj:
            print('missing', id)
            continue
        im = game.pixels(sf, obj)
        s = 1024 / max(im.size)
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        r, g, b, a = im.split()
        solid = a.point(lambda v: 255 if v else 0)
        zero = Image.new('L', im.size, 0)
        im = Image.merge('RGBA', [Image.composite(c, zero, solid) for c in (r, g, b)] + [a])
        im.save(os.path.join(OUT, id + '.webp'), 'WEBP', quality=88, method=6)
        print(id)


if __name__ == '__main__':
    main()
