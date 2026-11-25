"""Makes the Basic Headhunting banner (2048x1152 webp) from the game's own pictures.

The game's Basic Headhunting screen shows the standard pool's 6-star operators as
slanted cards (one sprite each, gachapool_card_<name>, glass fill included).
Laid out the way the game does it the cards are small; this lays the same
sprites side by side across the whole banner instead (our layout, not the
game's), evenly spaced, the left card on top as in the game, over the
screen's own backdrop (the Basic Headhunting layout without its cards,
lettering and buttons, drawn by operator-banner.py). Each sprite is only
scaled, never edited.

The roster is the standard pool's 6-star list in GachaCharPoolContentTable
(its order is the game's left-to-right order), each operator's card the
gachapool_card_<name>[_<n>].png sprite in ui/sprites/gachapool/. A missing
sprite stops the script. When the standard roster changes, re-run it.

    python scripts/standard-banner.py <EndfieldDataDump> banners/game [--overlap 0.5]

writes banners/game/standard.webp and its two layers for the site's mouse
parallax: banners/game/layers/standard-back.webp (the backdrop) and
standard-op.webp (the cards on transparency); the cards over the backdrop
give back the flat file. --overlap is the share of each card's width the card
to its left covers: the cards carry blurred grey figures on their left side
(in the game the card in front hides them), so more overlap shows less of them.

Needs UnityPy, Pillow and NumPy (as operator-banner.py).
"""
import importlib.util
import json
import os
import re
import sys

import numpy as np
from PIL import Image

sys.dont_write_bytecode = True  # no __pycache__ in scripts/
HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('operator_banner', os.path.join(HERE, 'operator-banner.py'))
ob = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ob)

POOL = 'standard'
W = 2048
SPRITES = 'assets/beyond/arts/ui/sprites/gachapool/'
# The Basic Headhunting layout's nodes left out of the backdrop: its cards (drawn
# here instead), lettering, title strip, rules, Selector widget and buttons.
LEAVE_OUT = {
    'RolePoolNode', 'NameBg', 'StarterTitleNode', 'DetailNode', 'CharChoicePackNode', 'BtnGacha',
}
# The part of the layout drawn (layout units: left, bottom, width, height): the
# backdrop's lines and pale ground at the size the banner shows them.
VIEW = (-514, -293, 1462, 1462 * 9 / 16)
# Where the cards' faces sit: the middle of a card's eye line, as a share of
# the banner's height (the cards' tops and bottoms run off the edges).
EYES = 0.375
EYE_IN_CARD = 0.5  # the eyes' height in a card sprite, roughly the same in all of them


def roster(dump):
    table = json.load(open(os.path.join(dump, 'output', 'Data', 'TableCfg', 'GachaCharPoolContentTable.json'), encoding='utf-8'))
    ids = [e['charId'] for e in table[POOL]['list'] if e.get('starLevel') == 6]
    if not ids:
        sys.exit(f'GachaCharPoolContentTable has no 6-star operators in {POOL!r}')
    return ids


def card_path(game, char_id):
    """The operator's card sprite: gachapool_card_<name>.png, else gachapool_card_<name>_<n>.png."""
    name = char_id.split('_', 2)[-1].lower()  # chr_0009_azrila -> azrila
    pat = re.compile(re.escape(SPRITES) + r'gachapool_card_' + re.escape(name) + r'(?:_(\d+))?\.png$')
    hits = sorted((p for p in game.path_bundle if pat.match(p)), key=lambda p: (pat.match(p).group(1) is not None, p))
    if not hits:
        sys.exit(f'No card sprite for {char_id}: expected {SPRITES}gachapool_card_{name}[_<n>].png in the dump')
    return hits[0]


def card(game, char_id):
    path = card_path(game, char_id)
    sf, obj = game.by_path(path)
    if obj is None:
        sys.exit(f'Card sprite {path} ({char_id}) is listed but not found in its bundle')
    return game.pixels(sf, obj)


def backdrop(game):
    ob.SKIP |= LEAVE_OUT
    ob.VIEW = VIEW
    return ob.render(game, POOL, width=W).convert('RGBA')


def cards_layer(cards, size, overlap):
    """The cards on transparency, evenly spaced over the whole width, the left one on top."""
    w, h = size
    n = len(cards)
    sw, sh = cards[0].size
    cw = w / (1 + (n - 1) * (1 - overlap)) if n > 1 else w * 0.4
    scale = cw / sw
    step = (w - cw) / (n - 1) if n > 1 else 0
    top = EYES * h - EYE_IN_CARD * sh * scale
    layer = Image.new('RGBA', size)
    for i in reversed(range(n)):  # right to left, so each card covers the left edge of the one after it
        c = cards[i]
        c = c.resize((round(c.width * scale), round(c.height * scale)), Image.LANCZOS)
        x, y = round(i * step), round(top)
        # alpha_composite takes no negative offset: crop off what's above or left of the banner.
        layer.alpha_composite(c.crop((max(0, -x), max(0, -y), c.width, c.height)), (max(0, x), max(0, y)))
    return layer


def main():
    args = sys.argv[1:]
    overlap = 0.5
    if '--overlap' in args:
        i = args.index('--overlap')
        overlap = float(args[i + 1])
        del args[i:i + 2]
    if len(args) != 2:
        sys.exit(__doc__)
    dump, out_dir = args
    game = ob.Game(dump)
    ids = roster(dump)
    cards = [card(game, c) for c in ids]
    sizes = {c.size for c in cards}
    if len(sizes) != 1:
        sys.exit(f'Card sprites differ in size: {sizes}')
    back = backdrop(game)
    op = cards_layer(cards, back.size, overlap)
    flat = back.copy()
    flat.alpha_composite(op)
    os.makedirs(os.path.join(out_dir, 'layers'), exist_ok=True)
    flat.convert('RGB').save(os.path.join(out_dir, POOL + '.webp'), 'WEBP', quality=86, method=6)
    back.convert('RGB').save(os.path.join(out_dir, 'layers', POOL + '-back.webp'), 'WEBP', quality=86, method=6)
    op.save(os.path.join(out_dir, 'layers', POOL + '-op.webp'), 'WEBP', quality=86, method=6)
    print(POOL, back.size, 'cards:', ', '.join(ids), 'overlap', overlap)


if __name__ == '__main__':
    main()
