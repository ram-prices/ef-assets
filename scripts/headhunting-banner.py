"""Makes a Headhunting banner (1024x576 webp) for a single-rate-up banner.

The official banners print their names into the art, which the site already
shows as text, and each has its own background. This rebuilds them without
text: a close-up of the operator cut from their 2048px splash art on
endfield.wiki.gg, over a shared dark backdrop with a soft glow in their
element's colour (and the Arsenal banners' cloud backdrop, faint, so both
kinds feel related). A dark corner bottom-left keeps the card's names
readable.

The close-up is framed where the wiki's own close-up ("<Name> Banner.png",
900x352) sits in the splash: found by colour template matching (locate()).
Where that misses, FOCUS gives the box by hand.

    python scripts/headhunting-banner.py <chr id> <splash.png> <closeup.png> <out.webp> [--element Heat] [--guide]

--guide: the art is the version guide's (visual + thumbnail), for operators the
wiki doesn't have yet.

Needs Pillow and NumPy.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ART = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'issue-art')
W, H = 1024, 576
ELEMENT = {'Heat': (255, 106, 61), 'Cryo': (34, 195, 214), 'Electric': (255, 194, 14), 'Nature': (181, 224, 81), 'Physical': (190, 190, 200)}
# The window is ZOOM close-up widths wide, the face at FACE_X across and FACE_Y
# down: right of centre, since the site's names sit bottom-left.
ZOOM, FACE_X, FACE_Y = 1.9, 0.62, 0.36
# Unreleased operators come from the official version guide instead: its
# 1920x897 character art, with its thumbnail (a 350x112 face close-up) as the
# close-up. Operators are drawn smaller there, so the window is wider.
GUIDE_ZOOM = 3.1
# A match scoring under this is treated as a miss.
MIN_SCORE = 0.5
# Close-up boxes (splash pixels) where the match misses.
FOCUS = {
    'chr_0025_ardelia': (790, 585, 1270, 773),
    'chr_0031_mifu': (800, 600, 1333, 808),
}


# ---------------------------------------------------------------------------
# Finding the close-up in the splash
# ---------------------------------------------------------------------------


def rgb(im, size=None):
    im = im.convert('RGBA')
    bg = Image.new('RGBA', im.size, (128, 128, 128, 255))
    bg.alpha_composite(im)
    g = bg.convert('RGB')
    if size:
        g = g.resize(size, Image.BILINEAR)
    return np.asarray(g, dtype=np.float64)


def ncc_map(img, tpl):
    """Normalized cross-correlation of tpl at every valid position in img (one channel)."""
    th, tw = tpl.shape
    t = tpl - tpl.mean()
    tn = max(np.sqrt((t * t).sum()), 1e-9)
    F = np.fft.rfft2(img)
    T = np.fft.rfft2(t[::-1, ::-1], s=img.shape)
    corr = np.fft.irfft2(F * T, s=img.shape)[th - 1 :, tw - 1 :]
    S = np.pad(img, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    S2 = np.pad(img * img, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    win = lambda A: A[th:, tw:] - A[:-th, tw:] - A[th:, :-tw] + A[:-th, :-tw]
    n = th * tw
    s1, s2 = win(S), win(S2)
    var = np.maximum(s2 - s1 * s1 / n, 1e-9)
    # Flat areas (nothing to match) score nothing.
    return np.where(var > n * 25, corr / (np.sqrt(var) * tn), 0)


def ncc(img, tpl):
    th, tw = tpl.shape[:2]
    if th > img.shape[0] or tw > img.shape[1]:
        return -1, 0, 0
    score = sum(ncc_map(img[..., c], tpl[..., c]) for c in range(3)) / 3
    y, x = np.unravel_index(np.argmax(score), score.shape)
    return float(score[y, x]), int(y), int(x)


def locate(splash, closeup):
    """(score, box): where the close-up sits in the splash, coarse then fine."""
    Wd = splash.width
    aspect = closeup.height / closeup.width
    f = 1 / 4
    img = rgb(splash, (round(Wd * f), round(splash.height * f)))
    best = (-1, 0, 0, 0)
    # Some operators are small in their splash, so try region widths down to 12%.
    for ws in range(int(Wd * 0.12), Wd + 1, 16):
        tw, th = round(ws * f), round(ws * aspect * f)
        if tw < 8 or th < 4:
            continue
        s, y, x = ncc(img, rgb(closeup, (tw, th)))
        if s > best[0]:
            best = (s, x / f, y / f, ws)
    _, bx, by, bws = best
    f2 = 1 / 2
    pad = int(bws * 0.12)
    x0, y0 = max(0, int(bx - pad)), max(0, int(by - pad))
    x1, y1 = min(Wd, int(bx + bws + pad)), min(splash.height, int(by + bws * aspect + pad))
    region = splash.crop((x0, y0, x1, y1))
    img2 = rgb(region, (round(region.width * f2), round(region.height * f2)))
    fine = (-1, 0, 0, 0)
    for ws in range(int(bws * 0.94), int(bws * 1.06) + 1, 4):
        tw, th = round(ws * f2), round(ws * aspect * f2)
        s, y, x = ncc(img2, rgb(closeup, (tw, th)))
        if s > fine[0]:
            fine = (s, x0 + x / f2, y0 + y / f2, ws)
    s, x, y, ws = fine
    return s, (round(x), round(y), round(x + ws), round(y + ws * aspect))


# ---------------------------------------------------------------------------
# Drawing
# ---------------------------------------------------------------------------


def backdrop(colour):
    out = Image.new('RGBA', (W, H), (12, 13, 15, 255))
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    cx, cy = int(W * 0.66), int(H * 0.42)
    for r, a in ((380, 34), (260, 44), (150, 50)):
        g.ellipse((cx - r * 1.35, cy - r, cx + r * 1.35, cy + r), fill=(*colour, a))
    out.alpha_composite(glow.filter(ImageFilter.GaussianBlur(120)))
    bg = Image.open(os.path.join(ART, 'background.png')).convert('L')
    s = 0.62
    bg = bg.resize((round(bg.width * s), round(bg.height * s)), Image.LANCZOS)
    cloud = Image.new('RGBA', bg.size, (205, 210, 220, 0))
    cloud.putalpha(bg.point(lambda v: int(v * 0.16)))
    out.alpha_composite(cloud, (W // 2 - bg.width // 2 + 140, H - bg.height + 70))
    return out


def closeup_window(splash, box, zoom=ZOOM):
    x0, y0, x1, y1 = box
    ww = (x1 - x0) * zoom
    wh = ww * H / W
    fx, fy = (x0 + x1) / 2, (y0 + y1) / 2
    left, top = fx - ww * FACE_X, fy - wh * FACE_Y
    # The window may run past the splash: those parts are transparent.
    m = 4000
    pad = Image.new('RGBA', (splash.width + 2 * m, splash.height + 2 * m), (0, 0, 0, 0))
    pad.alpha_composite(splash, (m, m))
    win = pad.crop((round(left + m), round(top + m), round(left + ww + m), round(top + wh + m)))
    return win.resize((W, H), Image.LANCZOS)


def banner(chr_id, splash, closeup, element, zoom=ZOOM):
    """(image, score, box). `zoom`: window width in close-up widths (the
    version guide's art draws operators smaller: GUIDE_ZOOM)."""
    splash = splash.convert('RGBA')
    if chr_id in FOCUS:
        score, box = 1.0, FOCUS[chr_id]
    else:
        score, box = locate(splash, closeup)
        if score < MIN_SCORE:
            raise ValueError(f'{chr_id}: close-up not found (score {score:.2f}); add its box to FOCUS')
    art = closeup_window(splash, box, zoom)
    out = backdrop(ELEMENT.get(element, (200, 200, 200)))
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    shadow.putalpha(art.getchannel('A').point(lambda a: int(a * 0.5)))
    out.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(22)), (10, 14))
    out.alpha_composite(art)
    v = Image.new('L', (W, H), 0)
    ImageDraw.Draw(v).ellipse((-W * 0.45, H * 0.45, W * 0.5, H * 1.55), fill=140)
    shade = Image.new('RGBA', (W, H), (0, 0, 0, 255))
    shade.putalpha(v.filter(ImageFilter.GaussianBlur(80)))
    out.alpha_composite(shade)
    return out.convert('RGB'), score, box


if __name__ == '__main__':
    args = sys.argv[1:]
    element = None
    zoom = ZOOM
    if '--guide' in args:
        args.remove('--guide')
        zoom = GUIDE_ZOOM
    if '--element' in args:
        i = args.index('--element')
        element = args[i + 1]
        del args[i : i + 2]
    if len(args) != 4:
        sys.exit(__doc__)
    chr_id, splash, closeup, out = args
    im, score, box = banner(chr_id, Image.open(splash), Image.open(closeup), element, zoom)
    im.save(out, 'WEBP', quality=86)
    print(f'{chr_id}: score {score:.2f}, box {box}')
