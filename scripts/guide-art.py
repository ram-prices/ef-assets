"""Makes the art for unreleased operators and weapons (wiki/previews.json, from
scripts/guide-previews.mjs) out of the official version guide's images, so
they look like everything else before the wiki has them:

- operators/<id>.webp: a 72px portrait icon, cut around the face. The guide's
  thumbnail is a face close-up of its character art, found in the art by
  headhunting-banner.py's locate().
- headhunting/<operator>.webp: their Headhunting banner (headhunting-banner.py,
  guide framing).
- arsenals/<id>.webp: a 72px icon of the weapon render.
- issues/<weapon>.webp: their Arsenal Issue banner (issue-banner.py, --guide).

Only missing files are made; the wiki's art replaces them once it exists (the
usual scripts write over them).

    python scripts/guide-art.py

Needs Pillow and NumPy.
"""
import importlib.util
import io
import json
import os
import re
import urllib.request

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
UA = {'User-Agent': 'Mozilla/5.0 (ef-assets preview bot; github.com/ram-prices/ef-assets)'}
ICON = 72
slug = lambda s: re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), os.path.join(HERE, f'{name}.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def fetch(url):
    data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
    return Image.open(io.BytesIO(data)).convert('RGBA')


def operator_icon(visual, box):
    """A square around the face: it sits ~62% across the guide's thumbnail."""
    x0, y0, x1, y1 = box
    side = (y1 - y0) * 1.3
    cx, cy = x0 + (x1 - x0) * 0.62, (y0 + y1) / 2
    crop = visual.crop((round(cx - side / 2), round(cy - side / 2), round(cx + side / 2), round(cy + side / 2)))
    return crop.resize((ICON, ICON), Image.LANCZOS)


def weapon_icon(visual):
    """The weapon render turned to run corner to corner (like the wiki's icons:
    hilt bottom-left, tip top-right), trimmed and fitted into a square."""
    import math

    import numpy as np

    a = np.asarray(visual.getchannel('A'), dtype=np.float64)
    ys, xs = np.nonzero(a > 128)
    # The render's long axis, from the spread of its opaque pixels.
    cov = np.cov(np.vstack([xs - xs.mean(), ys - ys.mean()]))
    vx, vy = np.linalg.eigh(cov)[1][:, -1]
    angle = math.degrees(math.atan2(-vy, vx))  # counter-clockwise from horizontal
    angle = (angle + 90) % 180 - 90  # the axis, either way round
    w = visual.rotate(45 - angle, expand=True, resample=Image.BICUBIC)
    w = w.crop(w.getchannel('A').getbbox())
    s = ICON / max(w.size)
    w = w.resize((max(1, round(w.width * s)), max(1, round(w.height * s))), Image.LANCZOS)
    out = Image.new('RGBA', (ICON, ICON), (0, 0, 0, 0))
    out.alpha_composite(w, ((ICON - w.width) // 2, (ICON - w.height) // 2))
    return out


def main():
    previews = json.load(open(os.path.join(ROOT, 'wiki', 'previews.json'), encoding='utf-8'))
    hb, ib = module('headhunting-banner'), module('issue-banner')
    made = []
    for cid, o in previews.get('operators', {}).items():
        icon_path = os.path.join(ROOT, 'operators', f'{cid}.webp')
        banner_path = os.path.join(ROOT, 'headhunting', f"{slug(o['name'])}.webp")
        if os.path.exists(icon_path) and os.path.exists(banner_path):
            continue
        art = o.get('art') or {}
        if not art.get('visual') or not art.get('thumbnail'):
            continue
        visual, thumb = fetch(art['visual']), fetch(art['thumbnail'])
        score, box = hb.locate(visual, thumb)
        if score < hb.MIN_SCORE:
            print(f"{o['name']}: face not found in the guide art (score {score:.2f}); skipped")
            continue
        if not os.path.exists(icon_path):
            operator_icon(visual, box).save(icon_path, 'WEBP', lossless=True, method=6)
            made.append(f'operators/{cid}.webp')
        if not os.path.exists(banner_path):
            os.makedirs(os.path.dirname(banner_path), exist_ok=True)
            im, _, _ = hb.banner(cid, visual, thumb, o.get('element'), hb.GUIDE_ZOOM)
            im.save(banner_path, 'WEBP', quality=86)
            made.append(f"headhunting/{slug(o['name'])}.webp")
    for wid, w in previews.get('weapons', {}).items():
        icon_path = os.path.join(ROOT, 'arsenals', f'{wid}.webp')
        issue_path = os.path.join(ROOT, 'issues', f"{slug(w['name'])}.webp")
        if os.path.exists(icon_path) and os.path.exists(issue_path):
            continue
        url = (w.get('art') or {}).get('visual')
        if not url:
            continue
        visual = fetch(url)
        if not os.path.exists(icon_path):
            weapon_icon(visual).save(icon_path, 'WEBP', lossless=True, method=6)
            made.append(f'arsenals/{wid}.webp')
        if not os.path.exists(issue_path):
            os.makedirs(os.path.dirname(issue_path), exist_ok=True)
            ib.banner(wid, visual, True).save(issue_path, 'WEBP', quality=86)
            made.append(f"issues/{slug(w['name'])}.webp")
    for m in made:
        print(f'Made guide art: {m}')


if __name__ == '__main__':
    main()
