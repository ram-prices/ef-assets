"""Makes a text-free New Horizons header art (2048x460) from banners/beginner.webp.

The official banner prints its title and info into the art, which the site
already shows as text. This rebuilds it without lettering, the same way
banners/game/standard.webp (Basic) was made: the art scaled down and held to
the right, the left painted as a smooth dark gradient for the site's text, and
the baked-in title / logo / info / legal lines painted out. The characters and
their name tags are kept.

    python scripts/new-horizons-header.py

Needs Pillow and NumPy.
"""
import os

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'banners', 'beginner.webp')
OUT = os.path.join(HERE, '..', 'banners', 'game', 'beginner.webp')

# Output: wide and short, like the Basic header art, held to the right.
W, H = 2048, 460


def moving_average(col, k):
    """A vertical moving average of a (n,3) array, edge-clamped."""
    p = np.vstack([np.tile(col[0], (k, 1)), col, np.tile(col[-1], (k, 1))])
    c = np.cumsum(p, 0)
    prev = np.vstack([np.zeros((1, col.shape[1])), c[: len(col) - 1]])
    return (c[2 * k:] - prev) / (2 * k + 1)


def smooth_column(im, x, radius=40):
    """A vertically-smoothed sample of column x (per-row colour), as (H,3) float."""
    a = np.asarray(im.convert('RGB'), dtype=np.float64)
    col = a[:, x, :]
    for _ in range(3):
        col = moving_average(col, radius)
    return col


def main():
    im = Image.open(SRC).convert('RGB')
    sw, sh = im.size
    # Scale to the output height, keep aspect.
    scale = H / sh
    nw = round(sw * scale)  # ~817
    art = im.resize((nw, H), Image.LANCZOS)
    art_np = np.asarray(art, dtype=np.float64)

    canvas = np.zeros((H, W, 3), dtype=np.float64)
    # Place the art on the right.
    x0 = W - nw
    canvas[:, x0:, :] = art_np

    # Left part + the art's own left column: a smooth vertical gradient sampled
    # from the art's left edge, so it blends seamlessly into the art. The art's
    # left column (where the logo, title, info and legal lines sit) is painted
    # with the same gradient, taking all that lettering in one pass. The far
    # left is eased a touch darker so the site's text sits on a calmer field.
    left_col = smooth_column(art, 2, radius=60)  # (H,3)
    # Original x=400: past the title's right edge (x~395) and the info text,
    # just before Last Rite's feathers (x~405).
    col_end = round(x0 + 400 * scale)
    for x in range(0, col_end):
        if x < x0:
            t = x / x0  # 0 at far left -> 1 at the art edge
            shade = 0.72 + 0.28 * t  # darker at the far left
            canvas[:, x, :] = left_col * shade
        else:
            canvas[:, x, :] = left_col

    out = Image.fromarray(np.clip(canvas, 0, 255).astype('uint8'))

    # ------------------------------------------------------------------
    # Paint out the remaining lettering in the visible (right) area. Each
    # region (in the original art's coords) is filled with a heavily blurred
    # version of itself: the faint lettering/watermark smooths out to the
    # local backdrop, feathered at the edges so it blends.
    # ------------------------------------------------------------------
    def region(ax0, ay0, ax1, ay1):
        return (round(x0 + ax0 * scale), round(ay0 * scale),
                round(x0 + ax1 * scale), round(ay1 * scale))

    from PIL import ImageDraw

    def feather_paste(box, cx0, cy0):
        f = min(16, box.size[0] // 4, box.size[1] // 4)
        mask = Image.new('L', box.size, 0)
        d = ImageDraw.Draw(mask)
        d.rounded_rectangle((f, f, box.size[0] - f, box.size[1] - f), radius=f, fill=255)
        mask = mask.filter(ImageFilter.GaussianBlur(max(5, f // 3)))
        out.paste(box, (cx0, cy0), mask)

    # The "NEW JOINT" watermark is large and high-contrast, so a blur only
    # softens it. Instead, extend the clean backdrop column just left of each
    # region across it (per-row colour, smoothed), which replaces the letters
    # with the local backdrop.
    for (ax0, ay0, ax1, ay1, sample_x) in [
        (498, 0, 602, 196, 486),   # watermark, left of Pogranichnik
        (944, 0, 1024, 96, 932),   # watermark, top-right corner
    ]:
        cx0, cy0, cx1, cy1 = region(ax0, ay0, ax1, ay1)
        cx0, cy0 = max(0, cx0), max(0, cy0)
        cx1, cy1 = min(W, cx1), min(H, cy1)
        sx = round(x0 + sample_x * scale)
        if cx1 - cx0 < 4 or cy1 - cy0 < 4 or not (0 <= sx < W):
            continue
        ca = np.asarray(out, dtype=np.float64)
        col = ca[cy0:cy1, sx, :]
        for _ in range(3):
            col = moving_average(col, 20)
        patch = np.tile(col[:, None, :], (1, cx1 - cx0, 1))
        feather_paste(Image.fromarray(np.clip(patch, 0, 255).astype('uint8')), cx0, cy0)

    # Smaller lettering: a blur of the local backdrop takes it out.
    for (ax0, ay0, ax1, ay1, blur) in [
        (392, 128, 412, 272, 12),  # the title's closing bracket, at the fill's edge
        (628, 548, 1024, 576, 14), # reference-only disclaimer, bottom-right
    ]:
        cx0, cy0, cx1, cy1 = region(ax0, ay0, ax1, ay1)
        cx0, cy0 = max(0, cx0), max(0, cy0)
        cx1, cy1 = min(W, cx1), min(H, cy1)
        if cx1 - cx0 < 4 or cy1 - cy0 < 4:
            continue
        box = out.crop((cx0, cy0, cx1, cy1))
        feather_paste(box.filter(ImageFilter.GaussianBlur(blur)), cx0, cy0)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    out.save(OUT, 'WEBP', quality=88)
    print(f'{OUT}: {out.size}')


if __name__ == '__main__':
    main()
