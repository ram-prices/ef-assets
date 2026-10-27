"""The rainbow smoke the game draws at the bottom of 6★ item icons (effects/six-star/), read from the owner's
EndfieldDataDump output. The game's material is assets/beyond/arts/effects/ui/material/gacha/m_fx_sixstar_bg.mat: it
holds a rainbow texture still (_VFXMainTex, tiled 0.16 x 1) and shifts it sideways by two scrolling noise textures
(_DisturbTex1 tiled 0.2 x 0.2, U intensity 0.05; _DisturbTex2 tiled 0.1 x 0.5, U intensity 0.1; both -0.1 UV/s),
under a static mask (_MaskTex tiled 0.2 x 0.5, offset 1 x 0: the bottom left of the fade), at 60% opacity. The site
redraws it with an SVG filter from these:

    smoke.webp   t_fx_flow_302_d, the rainbow (256x256, tiles)
    mask.png     t_ui_6starcolour_mask, the fade (128x64, white in the red channel; saved as alpha here)
    noise-1.png  t_fx_flow_326_m, _DisturbTex1 (256x256, grey)
    noise-2.png  t_fx_flow_407_m, _DisturbTex2 (128x128, grey)

Bundle folders are found through output/asset_index.tsv, since their names change with patches. Run by hand:

    python scripts/six-star-smoke.py C:/Users/Albert/Development/EndfieldDataDump/output

Needs UnityPy and Pillow.
"""
import os
import sys

import UnityPy
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), 'effects', 'six-star')
WANT = {
    'assets/beyond/arts/effects/commonassets/arts/t_texture/color/noise/t_fx_flow_302_d.png': 'smoke.webp',
    'assets/beyond/arts/effects/ui/sprites/common/t_ui_6starcolour_mask.png': 'mask.png',
    'assets/beyond/arts/effects/commonassets/arts/t_texture/mask/noise/t_fx_flow_326_m.png': 'noise-1.png',
    'assets/beyond/arts/effects/commonassets/arts/t_texture/mask/noise/t_fx_flow_407_m.png': 'noise-2.png',
}


def texture(dump, folder, name):
    d = os.path.join(dump, 'bundles', folder)
    env = UnityPy.load(*[os.path.join(d, f) for f in os.listdir(d) if f.startswith('CAB-')])
    for obj in env.objects:
        if obj.type.name == 'Texture2D' and obj.peek_name().lower() == name:
            return obj.read().image
    raise SystemExit(f'No texture {name} in {d}')


def main(dump):
    os.makedirs(OUT, exist_ok=True)
    found = {}
    with open(os.path.join(dump, 'asset_index.tsv'), encoding='utf8') as f:
        for line in f:
            folder, _, path = line.rstrip('\n').partition('\t')
            if path.lower() in WANT:
                found[path.lower()] = folder
    for path, out in WANT.items():
        if path not in found:
            raise SystemExit(f'No {path} in asset_index.tsv: rebuild it (dumper/build_asset_index.py).')
        im = texture(dump, found[path], os.path.splitext(os.path.basename(path))[0])
        if out == 'mask.png':
            alpha = im.convert('RGBA').getchannel('R')
            im = Image.new('RGBA', im.size, (255, 255, 255, 0))
            im.putalpha(alpha)
            im.save(os.path.join(OUT, out), optimize=True)
        elif out.startswith('noise'):
            im.convert('L').save(os.path.join(OUT, out), optimize=True)
        else:
            im.convert('RGB').save(os.path.join(OUT, out), quality=90, method=6)
        print(out, im.size)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
