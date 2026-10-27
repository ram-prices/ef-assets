"""Operator card art (operators/bust-2/<id>.webp) for the site's Operators list:
head and shoulders, no background, 308x329, from two of the game's sprites of
the same picture, read from the owner's EndfieldDataDump output:

- sprites/chargacha (236x1352): the Headhunting results art. Clean and sharp,
  but only 236 pixels wide, so it fills the middle.
- sprites/charremoteicon700 (700x652): the communication-screen portrait,
  about 1.35x larger and wider, with scanlines (every 4 rows) and grain. Its
  scanlines are averaged out and it is scaled down to the Headhunting art's
  size; it fills the sides.

The Headhunting art is found on the portrait by matching (OpenCV), laid over it
with feathered edges, and the card is cut from the top of the head (y 350 on
the Headhunting art) at 308x329. Where the portrait is a different picture
(Xaihi's), the match is poor and the card is the Headhunting art alone, its
sides fading out. The bundles that hold both folders are found
through output/asset_index.tsv, since bundle folder names change with patches.
Run by hand after a game patch adds operators:

    python scripts/operator-cards.py C:/Users/Albert/Development/EndfieldDataDump/output

A new folder name whenever the art changes: jsDelivr and browsers keep a file a
week. Needs UnityPy, Pillow, NumPy and OpenCV (opencv-python).
"""
import glob
import json
import os
import sys

import cv2
import numpy as np
import UnityPy
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'operators', 'bust-2')
GACHA = '/ui/sprites/chargacha/'
REMOTE = '/ui/sprites/charremoteicon700/'
# The card on the Headhunting art: from y 350 (the top of the head), 329 high, 308 wide.
TOP, HEIGHT, WIDTH = 350, 329, 308
# How far in from the Headhunting art's sides it fades into the portrait.
FEATHER = 24
# Below this the portrait is a different picture: the Headhunting art alone.
SAME_PICTURE = 0.8


def textures(dump, folder):
    """Every texture in the bundles holding that sprite folder: name -> straight RGBA floats."""
    folders = set()
    with open(os.path.join(dump, 'asset_index.tsv'), encoding='utf8') as f:
        for line in f:
            bundle, _, path = line.rstrip('\n').partition('\t')
            if folder in path.lower():
                folders.add(os.path.join(dump, 'bundles', bundle))
    if not folders:
        raise SystemExit(f'No {folder} in asset_index.tsv: rebuild it (dumper/build_asset_index.py).')
    out = {}
    for bundle in sorted(folders):
        # Loaded by path, so UnityPy finds the pixel data (.resS) beside each file.
        for cab in glob.glob(os.path.join(bundle, 'CAB-*')):
            if cab.endswith('.resS'):
                continue
            for obj in UnityPy.load(cab).objects:
                if obj.type.name == 'Texture2D':
                    tex = obj.read()
                    out[tex.m_Name] = np.asarray(tex.image.convert('RGBA'), np.float32) / 255
    return out


def premultiplied(a):
    p = a.copy()
    p[..., :3] *= a[..., 3:4]
    return p


def without_scanlines(p):
    """A vertical 1-2-2-2-1 average: cancels the 4-row scanlines (and any 2-row ripple)."""
    k = np.pad(p, ((2, 2), (0, 0), (0, 0)), mode='edge')
    return (k[:-4] + 2 * k[1:-3] + 2 * k[2:-2] + 2 * k[3:-1] + k[4:]) / 8


def gray(p):
    """Brightness over mid gray, for matching."""
    return (p[..., :3].mean(2) + 0.5 * (1 - p[..., 3])).astype(np.float32)


def card(gacha, remote):
    g = premultiplied(gacha)
    r = without_scanlines(premultiplied(remote))
    # Where the card's part of the Headhunting art sits on the portrait, and at what scale.
    face, rg = gray(g)[TOP:TOP + HEIGHT], gray(r)
    best = (-2.0, 1.0, (0, 0))
    for k in np.arange(1.0, 2.6, 0.01):
        t = cv2.resize(face, (round(face.shape[1] * k), round(HEIGHT * k)), interpolation=cv2.INTER_CUBIC)
        if t.shape[0] > rg.shape[0] or t.shape[1] > rg.shape[1]:
            break
        _, score, _, at = cv2.minMaxLoc(cv2.matchTemplate(rg, t, cv2.TM_CCOEFF_NORMED))
        if score > best[0]:
            best = (score, k, at)
    score, k, (x, y) = best
    w = g.shape[1]
    if score >= SAME_PICTURE:
        # The portrait at the Headhunting art's scale, the art laid over it with feathered sides.
        canvas = cv2.resize(r, (round(r.shape[1] / k), round(r.shape[0] / k)), interpolation=cv2.INTER_AREA)
        ox, oy = round(x / k), round(y / k) - TOP
    else:
        canvas = np.zeros((TOP + HEIGHT, WIDTH, 4), np.float32)
        ox, oy = (WIDTH - w) // 2, 0
    feather = np.clip(np.minimum(np.arange(w) + 1, w - np.arange(w)) / FEATHER, 0, 1)
    ys, ye = max(0, oy), min(canvas.shape[0], oy + g.shape[0])
    xs, xe = max(0, ox), min(canvas.shape[1], ox + w)
    m = feather[xs - ox:xe - ox][None, :, None]
    canvas[ys:ye, xs:xe] = g[ys - oy:ye - oy, xs - ox:xe - ox] * m + canvas[ys:ye, xs:xe] * (1 - m)
    # The card: centred on the Headhunting art, from the top of the head.
    x0 = max(0, min(canvas.shape[1] - WIDTH, ox + w // 2 - WIDTH // 2))
    y0 = max(0, oy + TOP)
    c = canvas[y0:y0 + HEIGHT, x0:x0 + WIDTH]
    alpha = c[..., 3:4]
    rgb = np.where(alpha > 1e-4, c[..., :3] / np.maximum(alpha, 1e-4), 0)
    return Image.fromarray((np.dstack([rgb, alpha]).clip(0, 1) * 255).round().astype(np.uint8)), score


def listed():
    """The operators the site lists: the wiki's and the version guide's previews."""
    wiki = json.load(open(os.path.join(ROOT, 'wiki', 'operators.json'), encoding='utf8'))['operators']
    previews = json.load(open(os.path.join(ROOT, 'wiki', 'previews.json'), encoding='utf8')).get('operators', {})
    return set(wiki) | set(previews)


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    dump = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    gacha = textures(dump, GACHA)
    remote = textures(dump, REMOTE)
    made, weak = 0, []
    for id in sorted(listed()):
        if id not in gacha or f'icon_{id}' not in remote:
            continue
        im, score = card(gacha[id], remote[f'icon_{id}'])
        im.save(os.path.join(OUT, id + '.webp'), 'WEBP', quality=88, method=6)
        made += 1
        if score < SAME_PICTURE:
            weak.append(f'{id} ({score:.2f})')
    print(f'{made} operator cards' + (f'; Headhunting art alone for {", ".join(weak)}' if weak else ''))


if __name__ == '__main__':
    main()
