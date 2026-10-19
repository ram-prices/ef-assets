"""Makes an Arsenal Issue banner (1024x576 webp) from a weapon's full render.

The official Issue banners print the weapon's and the banner's names into the
art, which the site already shows as text. This rebuilds the same look
without any text: the cloud/mountain backdrop and the ENDFIELD ARMAMENTS / UP
ornaments from the official version guide (scripts/issue-art/, its big
ARMAMENTS lettering erased), with the weapon placed and turned the way the
official banners show its type. Positions are measured off those banners.

    python scripts/issue-banner.py <weaponId> <render.png> <out.webp> [--guide]

<render.png> is a transparent full render of the weapon: the wiki's
(endfield.wiki.gg/images/<Weapon_Name>.png, blades and lances standing
tip-up, guns pointing left) or, with --guide, the version guide's weapon
"visual", which is already turned the official way.

Needs Pillow and NumPy.
"""
import math
import os
import sys

import numpy as np
from PIL import Image

ART = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'issue-art')
W, H = 1024, 576
# The official banners put the weapon on the left and their title on the
# right. The site lays the names over the left of the art instead, so the
# whole scene (ornaments, weapon, rock) slides right by this much.
SHIFT = 300

# The ornament layer is the guide's 1693x1006 weapon layout, drawn 1.2x on the
# banner with its UP glyph at (255, 140) like the official banners.
ORNAMENTS_AT, ORNAMENTS_SIZE = (-130 + SHIFT, 28), (1256, 748)
# Its big ARMAMENTS lettering, shadow, and the small glyphs framing it, erased.
ARMAMENTS = (830, 425, 1610, 720)

# Where the weapon goes on the banner (x0, y0, x1, y1).
LONG_BOX = (25 + SHIFT, 65, 665 + SHIFT, 525)      # swords, greatswords, lances
PISTOL_BOX = (120 + SHIFT, 190, 580 + SHIFT, 480)
COMPACT_SIZE, COMPACT_CENTRE = 310, (405 + SHIFT, 300)  # arts units
# Lances slide this far up-left along their shaft, bringing the head up to
# the UP ornaments; the butt may leave the banner.
LANCE_SLIDE = 140

# Turning a wiki render the official way, degrees counter-clockwise: blades
# hilt top-right, tip down-left; lances butt top-left, head down-right
# (33 degrees below level); arts units mirrored. Guns are mirrored to point
# right, then tilted muzzle up-right, grip down.
TURN = {'sword': 135, 'claym': 118, 'lance': -123, 'pistol': 30, 'funnel': 0}
LANCE_ANGLE = math.radians(33)
# Weapons whose official banner shows them mirrored.
MIRRORED = {'wpn_sword_0022'}  # Lupine Scarlet


def backdrop():
    bg = Image.open(os.path.join(ART, 'background.png')).convert('RGBA')
    s = 0.74  # puts the rock's peak (1040, 250 in the file) at (360, 140), then shifted
    bg = bg.resize((round(bg.width * s), round(bg.height * s)), Image.LANCZOS)
    out = Image.new('RGBA', (W, H), (12, 13, 14, 255))
    out.alpha_composite(bg, (360 + SHIFT - round(1040 * s), 140 - round(250 * s)))
    # The official backdrop is a little darker and cooler.
    out.alpha_composite(Image.new('RGBA', (W, H), (8, 14, 22, 60)))
    return out


def ornaments():
    layer = Image.open(os.path.join(ART, 'ornaments.webp')).convert('RGBA')
    layer.paste((0, 0, 0, 0), ARMAMENTS)
    # The guide fades its ornaments; the banners print the coloured ones solid.
    px = np.asarray(layer).astype(np.float32)
    coloured = (px[..., :3].max(axis=2) - px[..., :3].min(axis=2)) > 80
    px[..., 3] = np.where(coloured, np.minimum(255, px[..., 3] * 2.4), px[..., 3])
    layer = Image.fromarray(px.astype(np.uint8), 'RGBA').resize(ORNAMENTS_SIZE, Image.LANCZOS)
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    x, y = ORNAMENTS_AT
    out.alpha_composite(layer, (max(0, x), y), (max(0, -x), 0))
    return out


def trim(im):
    return im.crop(im.getchannel('A').getbbox())


def orient(weapon, weapon_id):
    kind = weapon_id.split('_')[1]
    if kind in ('funnel', 'pistol') or weapon_id in MIRRORED:
        weapon = weapon.transpose(Image.FLIP_LEFT_RIGHT)
    if TURN[kind]:
        weapon = trim(weapon.rotate(TURN[kind], expand=True, resample=Image.BICUBIC))
    return weapon


def fit(weapon, box):
    x0, y0, x1, y1 = box
    s = min((x1 - x0) / weapon.width, (y1 - y0) / weapon.height)
    weapon = weapon.resize((max(1, round(weapon.width * s)), max(1, round(weapon.height * s))), Image.LANCZOS)
    return weapon, ((x0 + x1 - weapon.width) // 2, (y0 + y1 - weapon.height) // 2)


def banner(weapon_id, render, from_guide=False):
    kind = weapon_id.split('_')[1]
    weapon = trim(render.convert('RGBA'))
    if not from_guide:
        weapon = orient(weapon, weapon_id)
    if kind == 'funnel':
        (cx, cy), h = COMPACT_CENTRE, COMPACT_SIZE // 2
        weapon, at = fit(weapon, (cx - h, cy - h, cx + h, cy + h))
    else:
        weapon, at = fit(weapon, PISTOL_BOX if kind == 'pistol' else LONG_BOX)
    if kind == 'lance':
        at = (at[0] - round(LANCE_SLIDE * math.cos(LANCE_ANGLE)), at[1] - round(LANCE_SLIDE * math.sin(LANCE_ANGLE)))
    out = backdrop()
    out.alpha_composite(weapon, at)
    out.alpha_composite(ornaments())  # in front of the weapon, like the official banners
    return out.convert('RGB')


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a != '--guide']
    if len(args) != 3:
        sys.exit(__doc__)
    weapon_id, render, out = args
    banner(weapon_id, Image.open(render), '--guide' in sys.argv).save(out, 'WEBP', quality=86)
