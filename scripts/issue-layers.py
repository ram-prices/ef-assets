"""Splits the Arsenal Issue banners into layers, so a site can move the weapon
apart from its backdrop (a parallax):

- banners/layers/issue-back.webp: the backdrop and the dotted rule, the same
  on every Issue banner (issue-banner.py's backdrop() and rule).
- banners/layers/issue-front.webp: the ornaments drawn over the weapon
  (header, UP glyphs), transparent elsewhere.
- banners/layers/<pool id>.webp: that banner's weapon alone, transparent
  elsewhere, cut out of banners/<pool id>.webp where it differs from the
  backdrop. Under the ornaments it's left empty (the front layer covers it).

Every layer is 1024x576 like the banners, so they stack exactly.

    python scripts/issue-layers.py [--all]

Only banners without a weapon layer yet, unless --all. Needs Pillow and NumPy.
"""
import glob
import importlib.util
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'banners', 'layers')

spec = importlib.util.spec_from_file_location('issue_banner', os.path.join(ROOT, 'scripts', 'issue-banner.py'))
ib = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ib)

# How far a pixel must differ from the backdrop to count as weapon, and how
# quickly it turns opaque past that (JPEG-like noise in the webp stays out).
NOISE, RAMP = 14, 10


def save(im, name):
    im.save(os.path.join(OUT, name), 'WEBP', quality=86, alpha_quality=90, method=6)


def main():
    os.makedirs(OUT, exist_ok=True)
    rule, rest = ib.ornaments()
    back = ib.backdrop()
    back.alpha_composite(rule)
    save(back.convert('RGB'), 'issue-back.webp')
    save(rest, 'issue-front.webp')

    base = back.copy()
    base.alpha_composite(rest)
    b = np.asarray(base.convert('RGB')).astype(np.float32)
    # Under the ornaments and the rule the banner shows those, not the weapon.
    covered = np.asarray(rest.getchannel('A').filter(ImageFilter.MaxFilter(5))) > 20
    covered |= np.asarray(rule.getchannel('A').filter(ImageFilter.MaxFilter(3))) > 20

    pools = sorted(glob.glob(os.path.join(ROOT, 'banners', 'weponbox_*.webp')) + glob.glob(os.path.join(ROOT, 'banners', 'weaponbox_constant_*.webp')))
    made = []
    for path in pools:
        name = os.path.basename(path)
        if '--all' not in sys.argv and os.path.exists(os.path.join(OUT, name)):
            continue
        f = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
        alpha = np.clip((np.abs(f - b).max(axis=2) - NOISE) * RAMP, 0, 255)
        alpha[covered] = 0
        mask = Image.fromarray(alpha.astype(np.uint8))
        # Drop specks; close the thin gaps the ornaments and the rule leave.
        mask = mask.filter(ImageFilter.MedianFilter(5)).filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(7))
        mask = mask.filter(ImageFilter.GaussianBlur(0.7))
        weapon = Image.fromarray(f.astype(np.uint8)).convert('RGBA')
        weapon.putalpha(mask)
        save(weapon, name)
        made.append(f'banners/layers/{name}')
    print(f"Issue layers: {', '.join(made) if made else 'none new'}")


if __name__ == '__main__':
    main()
