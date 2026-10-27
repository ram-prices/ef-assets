"""Makes a Headhunting banner (1024x576 webp) from the game's own banner screen.

Each Headhunting pool has a UI layout in the game client (its uiPrefab) that
stacks a few hundred image layers: the operator art merged with the banner's
motif, the tinted shapes behind it, glows, lines and masks, the name and title
lettering, and the screen's buttons and texts. This lays that screen out the
way Unity's UI does (anchors, pivots, sizes, scales, turns, layout groups,
masks, tints, group alphas), at the end of its opening animation, and draws
only the art: no lettering, title strip, buttons, texts or particles, so it
reads like the official banner minus its text (the site prints the names).

It reads the game files a dump of the client made (the EndfieldDataDump
checkout: its output\\ folder and dumper\\map_banner_layers.py, which also
finds each pool's layout). Pictures it decodes are cached in
output\\banners\\sprites\\.

The operator's small second figure is part of the motif art, so it stays,
as on the official banners. The screen's own backdrop (a white fill and a
line pattern) shows wherever a banner draws nothing, as in the game.

    python scripts/operator-banner.py <EndfieldDataDump> banners/game <pool id>... [--full]

writes banners/game/<pool id>.webp for each pool (special_1_6_1,
rerun_chr_tangtang, ...); --full also writes <pool id>-full.png, the whole
layout with its buttons and lettering, zoomed out, for checking.

It also writes the same banner in two layers, so a page can move the
operator a little against the rest (the site's mouse parallax):
banners/game/layers/<pool id>-back.webp, the banner without its operator
(the MainRoleImage node: the operator's figure; the motif behind them,
MainShowImage, stays in the backdrop), and <pool id>-op.webp, the operator
on transparency. The operator layer's
colours and coverage are solved from the flat banner, so the operator over
the backdrop gives back the flat picture exactly (whatever later layers
blend over the operator is baked into it).

Needs UnityPy, Pillow and NumPy.
"""
import math
import os
import sys
import json
import warnings

import numpy as np
from PIL import Image

warnings.filterwarnings('ignore')
# The Headhunting screen every banner layout sits in: its backdrop (a plain
# fill and a line pattern) shows wherever a banner draws nothing.
PANEL = 'assets/beyond/dynamicassets/gameplay/ui/prefabs/gacha/gachapoolpanel.prefab'
W, H = 1024, 576
# The game lays a banner out on a 1920x1080 screen, where its art is a
# close-up. The official banners show more of it: the same layout on a bigger
# screen (the stretched backdrops grow, the art keeps its size). VIEW is the
# part of that screen drawn, in layout units (x, y of its bottom-left corner
# from the centre, width, height). It sits SHIFT units left of centre, so the
# art lands right of the middle, clear of the names the site prints bottom-left.
SHIFT = 256
VIEW = (-1280 - SHIFT, -720, 2560, 1440)
# Layout nodes left out: the screen's buttons, texts and timers, the operator
# name and banner title lettering, particles, and the shading the game puts
# under its buttons. Node names.
SKIP = {
    'TopInfo', 'MiddleInfo', 'BottomInfo', 'GachaBtnNode', 'FreeTenNode', 'JumpBtnNaviGroup',
    'ControllerHintPlaceholder', 'ControllerFocusHintRoot', 'Particle', 'ParticalFire',
    'NameDeco', 'NameDeco01', 'BlackText', 'LimitedNameImage', 'LimitedNameImage01',
    'TopBgImage', 'DownBgImage',
}
# Lettering drawn into a banner's backdrop (the operator's or banner's name,
# big or letter by letter), left out wherever it sits. Sprite names.
LETTERING = {
    'gachapool_deco_text_aglina', 'gachapool_1_1_2_text_deco', 'gachapool_deco_camille_text',
    'gachapool_deco_twinkle_text', 'deco_name_twinkle_1', 'deco_name_twinkle_2',
    'deco_mifu_name_01', 'deco_mifu_name_02', 'deco_mifu_name_03', 'deco_mifu_name_05', 'deco_mifu_name_shadow',
    'bg_gachapool_texture_03', 'deco_gacha_jsspsi_text',
    'gachapool_1_4_1_text_a', 'gachapool_1_4_1_text_r', 'gachapool_1_4_1_text_c',
    'gachapool_1_4_1_text_n', 'gachapool_1_4_1_text_e',
}


# ---------------------------------------------------------------------------
# Reading the layout from the game files
# ---------------------------------------------------------------------------


class Game:
    def __init__(self, dump):
        sys.path.insert(0, os.path.join(dump, 'dumper'))
        import map_banner_layers as mbl  # the dump's own bundle resolver
        import UnityPy
        self.mbl, self.UnityPy = mbl, UnityPy
        self.res = mbl.Resolver(UnityPy, mbl.load_cab_index())
        self.path_bundle = {}
        with open(os.path.join(mbl.OUT, 'asset_index.tsv'), encoding='utf-8') as f:
            for line in f:
                rel, path = line.rstrip('\n').split('\t')
                self.path_bundle[path.lower()] = rel
        self.envs = {}
        self.cache = os.path.join(mbl.OUT, 'banners', 'sprites')
        os.makedirs(self.cache, exist_ok=True)

    def prefab(self, pool_id):
        layers = json.load(open(os.path.join(self.mbl.OUT, 'banner_layers.json'), encoding='utf-8'))
        return self.layout(next(b for b in layers if b['pool_id'] == pool_id)['prefab_bundle'])

    def panel(self):
        return self.layout(self.path_bundle[PANEL])

    def layout(self, rel):
        man = json.load(open(os.path.join(self.mbl.BUNDLES, rel, 'manifest.json'), encoding='utf-8'))
        node = next(n for p in man['parts'] for n in p['nodes'] if not n['path'].lower().endswith('.ress'))
        return self.res.serialized(rel, node['file'])

    def env(self, rel):
        if rel not in self.envs:
            d = os.path.join(self.mbl.BUNDLES, rel)
            self.envs[rel] = self.UnityPy.load(*[os.path.join(d, f) for f in os.listdir(d) if f.startswith('CAB-')])
        return self.envs[rel]

    def pixels(self, sfile, obj):
        """The sprite's or texture's pixels (cached as PNG under output\\banners\\sprites)."""
        rel = self.mbl.bundle_of(self.res, sfile)
        name = obj.peek_name()
        png = os.path.join(self.cache, '%s_%s_%d.png' % (os.path.basename(rel), name, obj.path_id & 0xffffffff))
        if not os.path.exists(png):
            hit = next(o for o in self.env(rel).objects if o.path_id == obj.path_id and o.type.name == obj.type.name)
            hit.read().image.save(png)
        return Image.open(png).convert('RGBA')

    def by_path(self, path):
        """(SerializedFile, Sprite object) for an asset path the layout loads by path."""
        rel = self.path_bundle.get(path.lower())
        if not rel:
            return None, None
        stem = os.path.splitext(path.rsplit('/', 1)[-1])[0].lower()
        for fname in os.listdir(os.path.join(self.mbl.BUNDLES, rel)):
            if not fname.startswith('CAB-') or fname.lower().endswith('.ress'):
                continue
            sf = self.res.serialized(rel, fname)
            for o in sf.objects.values():
                if o.type.name == 'Sprite' and o.peek_name().lower() == stem:
                    return sf, o
        return None, None


def v2(d, k, default=(0.0, 0.0)):
    x = d.get(k)
    return (x['x'], x['y']) if x else default


class Node:
    def __init__(self):
        self.children = []
        self.graphic = None  # dict: kind, color, image, type, border, uv, ...
        self.alpha = 1.0     # CanvasGroup
        self.ignore_parent_groups = False
        self.mask = None     # 'rect', 'soft', 'stencil'
        self.mask_padding = (0, 0, 0, 0)
        self.show_mask_graphic = True
        self.layout = None
        self.layout_element = {}


def script_name(game, sf, data):
    ssf, so = game.res.follow(sf, data.get('m_Script', {}))
    return so.read_typetree().get('m_ClassName', '') if so else ''


def read_tree(game, sf):
    transforms = {pid: o.read_typetree() for pid, o in sf.objects.items() if o.type.name in ('Transform', 'RectTransform')}
    root = next(pid for pid, t in transforms.items() if not t.get('m_Father', {}).get('m_PathID'))

    def build(pid, path):
        t = transforms[pid]
        go = sf.objects[t['m_GameObject']['m_PathID']].read_typetree()
        n = Node()
        n.name = go['m_Name']
        n.path = path + '/' + n.name if path else n.name
        n.active = bool(go.get('m_IsActive', 1))
        n.a_min, n.a_max = v2(t, 'm_AnchorMin'), v2(t, 'm_AnchorMax')
        n.pivot = v2(t, 'm_Pivot', (0.5, 0.5))
        n.pos, n.size = list(v2(t, 'm_AnchoredPosition')), list(v2(t, 'm_SizeDelta'))
        s = t.get('m_LocalScale', {'x': 1, 'y': 1})
        n.scale = (s['x'], s['y'])
        q = t.get('m_LocalRotation', {'z': 0, 'w': 1})
        n.angle = 2 * math.atan2(q['z'], q['w'])
        for comp in go.get('m_Component', []):
            ref = comp.get('component', comp.get('second', {}))
            o = sf.objects.get(ref.get('m_PathID')) if not ref.get('m_FileID') else None
            if o is None:
                continue
            if o.type.name == 'CanvasGroup':
                c = o.read_typetree()
                if c.get('m_Enabled', 1):
                    n.alpha = c.get('m_Alpha', 1.0)
                    n.ignore_parent_groups = bool(c.get('m_IgnoreParentGroups', 0))
            elif o.type.name == 'MonoBehaviour':
                try:
                    c = o.read_typetree()
                except Exception:
                    continue
                cls = script_name(game, sf, c)
                if not c.get('m_Enabled', 1):
                    continue
                if 'm_Sprite' in c or 'm_Texture' in c:
                    n.graphic = read_graphic(game, sf, c)
                elif cls in ('RectMask2D', 'UIRectMask2D') or (cls.endswith('RectMask2D')):
                    n.mask = 'rect'
                    p = c.get('m_Padding', {})
                    n.mask_padding = (p.get('x', 0), p.get('y', 0), p.get('z', 0), p.get('w', 0))
                elif 'SoftMask' in cls and 'Maskable' not in cls:
                    n.mask = 'soft'
                elif cls in ('Mask', 'UIMask'):
                    n.mask = 'stencil'
                    n.show_mask_graphic = bool(c.get('m_ShowMaskGraphic', 1))
                elif cls in ('HorizontalLayoutGroup', 'VerticalLayoutGroup'):
                    n.layout = dict(c, kind=cls[0])
                elif cls == 'LayoutElement':
                    n.layout_element = c
                elif 'AnimationWrapper' in cls:
                    n.anim_in = c.get('_animationIn')
        for ch in t.get('m_Children', []):
            if ch['m_PathID'] in transforms:
                n.children.append(build(ch['m_PathID'], n.path))
        return n

    tree = build(root, '')
    return tree


def read_graphic(game, sf, c):
    col = c.get('m_Color', {})
    g = {'color': [col.get(k, 1.0) for k in 'rgba'], 'type': c.get('m_Type', 0),
         'fill_center': c.get('m_FillCenter', 1), 'ppu_mult': c.get('m_PixelsPerUnitMultiplier', 1.0) or 1.0,
         'preserve': c.get('m_PreserveAspect', 0), 'fill': c.get('m_FillAmount', 1.0),
         'fill_method': c.get('m_FillMethod', 4), 'fill_origin': c.get('m_FillOrigin', 0),
         'blend': 'normal', 'image': None}
    mat = c.get('m_Material', {})
    if mat.get('m_PathID'):
        msf, mo = game.res.follow(sf, mat)
        if mo is not None:
            m = mo.read_typetree()
            ssf, so = game.res.follow(msf, m.get('m_Shader', {}))
            shader = ''
            if so is not None:
                try:
                    shader = so.read_typetree().get('m_ParsedForm', {}).get('m_Name', '')
                except Exception:
                    shader = so.peek_name() or ''
            g['material'] = m.get('m_Name', '')
            g['shader'] = shader
            low = (shader + ' ' + g['material']).lower()
            if 'add' in low:
                g['blend'] = 'add'
            elif 'screen' in low:
                g['blend'] = 'screen'
    if 'm_Texture' in c:
        g['kind'] = 'raw'
        uv = c.get('m_UVRect', {})
        g['uv'] = (uv.get('x', 0), uv.get('y', 0), uv.get('width', 1), uv.get('height', 1))
        isf, io = game.res.follow(sf, c['m_Texture'])
    else:
        g['kind'] = 'image'
        isf, io = game.res.follow(sf, c['m_Sprite'])
        if io is None and c.get('imgUsePathReference') and c.get('imgRefPath'):
            isf, io = game.by_path(c['imgRefPath'])
    if io is None and not (c.get('imgUsePathReference') and c.get('imgRefPath')):
        # No picture: Unity draws the rect in its colour. Banner backdrops
        # (GroundBg) are built from these; elsewhere they wait for a picture or
        # effect set while playing, so only backdrops draw them.
        g['image'] = 'flat'
    if io is not None:
        g['name'] = io.peek_name()
        g['image'] = (isf, io)
        if io.type.name == 'Sprite':
            d = io.read_typetree()
            b = d.get('m_Border', {})
            ppu = d.get('m_PixelsToUnits', 100) or 100
            g['border'] = (b.get('x', 0), b.get('y', 0), b.get('z', 0), b.get('w', 0))  # left, bottom, right, top (pixels)
            g['ppu'] = ppu
            r = d.get('m_Rect', {})
            g['native'] = (r.get('width', 0), r.get('height', 0))
            # A tightly packed sprite keeps only the part of its picture that
            # isn't empty (textureRect, textureRectOffset px in from its
            # rect's bottom-left); the rest of the rect is transparent.
            off = d.get('m_RD', {}).get('textureRectOffset', {})
            g['trim'] = (off.get('x', 0), off.get('y', 0))
        else:
            d = io.read_typetree()
            g['native'] = (d.get('m_Width', 0), d.get('m_Height', 0))
            g['ppu'] = 100
    return g


# ---------------------------------------------------------------------------
# The opening animation's last frame
# ---------------------------------------------------------------------------


def apply_clip(game, sf, owner, ref):
    """Sets every property the clip animates to its value at the clip's end."""
    csf, co = game.res.follow(sf, ref)
    if co is None:
        return
    clip = co.read_typetree()
    by_path = {}

    def index(n, rel):
        by_path[rel] = n
        for ch in n.children:
            index(ch, (rel + '/' if rel else '') + ch.name)
    index(owner, '')
    for fc in clip.get('m_FloatCurves', []):
        keys = fc['curve']['m_Curve']
        n = by_path.get(fc['path'])
        if not keys or n is None:
            continue
        v = keys[-1]['value']
        a = fc['attribute']
        if a == 'm_Alpha':
            n.alpha = v
        elif a.startswith('m_Color.') and n.graphic:
            n.graphic['color']['rgba'.index(a[-1])] = v
        elif a == 'm_AnchoredPosition.x':
            n.pos[0] = v
        elif a == 'm_AnchoredPosition.y':
            n.pos[1] = v
        elif a == 'm_SizeDelta.x':
            n.size[0] = v
        elif a == 'm_SizeDelta.y':
            n.size[1] = v
        elif a == 'm_IsActive':
            n.active = v > 0.5
        elif a == 'm_FillAmount' and n.graphic:
            n.graphic['fill'] = v
        elif a == 'm_Enabled' and n.graphic:
            n.graphic['enabled'] = v > 0.5
    for sc in clip.get('m_ScaleCurves', []):
        keys = sc['curve']['m_Curve']
        n = by_path.get(sc['path'])
        if keys and n is not None:
            n.scale = (keys[-1]['value']['x'], keys[-1]['value']['y'])
    for ec in clip.get('m_EulerCurves', []):
        keys = ec['curve']['m_Curve']
        n = by_path.get(ec['path'])
        if keys and n is not None:
            n.angle = math.radians(keys[-1]['value']['z'])


def opening_state(game, sf, tree):
    """Plays each animation wrapper's opening ('in') clip to its end."""
    def walk(n):
        ref = getattr(n, 'anim_in', None)
        if ref and ref.get('m_PathID'):
            apply_clip(game, sf, n, ref)
        for ch in n.children:
            walk(ch)
    walk(tree)


# ---------------------------------------------------------------------------
# Layout (Unity RectTransform)
# ---------------------------------------------------------------------------


def affine(tx, ty, angle, sx, sy):
    c, s = math.cos(angle), math.sin(angle)
    return np.array([[c * sx, -s * sy, tx], [s * sx, c * sy, ty], [0, 0, 1]])


def layout_children(n):
    """Rects a horizontal/vertical layout group gives its children (local to n), by child."""
    L = n.layout
    horiz = L['kind'] == 'H'
    pad = L.get('m_Padding', {})
    x0, y0, w, h = n.rect
    left, right, top, bottom = pad.get('m_Left', 0), pad.get('m_Right', 0), pad.get('m_Top', 0), pad.get('m_Bottom', 0)
    kids = [c for c in n.children if c.active and not c.layout_element.get('m_IgnoreLayout')]
    if not kids:
        return {}
    if L.get('m_ReverseArrangement'):
        kids.reverse()
    spacing = L.get('m_Spacing', 0)
    main = (w - left - right if horiz else h - top - bottom) - spacing * (len(kids) - 1)
    cross = h - top - bottom if horiz else w - left - right
    force = L.get('m_ChildForceExpandWidth' if horiz else 'm_ChildForceExpandHeight', 1)
    control = L.get('m_ChildControlWidth' if horiz else 'm_ChildControlHeight', 1)
    key = 'Width' if horiz else 'Height'

    def native(c):
        g = c.graphic
        if g and g.get('native') and g['type'] in (0, 3):
            return g['native'][0 if horiz else 1] * 100 / g.get('ppu', 100)
        return 0
    sizes = []
    if control:
        mins = [max(0, c.layout_element.get('m_Min' + key, -1)) for c in kids]
        prefs = []
        for c, mn in zip(kids, mins):
            p = c.layout_element.get('m_Preferred' + key, -1)
            prefs.append(max(mn, p if p >= 0 else native(c)))
        flex = []
        for c in kids:
            f = c.layout_element.get('m_Flexible' + key, -1)
            f = f if f >= 0 else 0
            flex.append(max(f, 1) if force else f)
        if main <= sum(prefs):
            t = 0 if sum(prefs) == sum(mins) else max(0, (main - sum(mins)) / (sum(prefs) - sum(mins)))
            sizes = [mn + (p - mn) * min(1, t) for mn, p in zip(mins, prefs)]
        else:
            extra = main - sum(prefs)
            tf = sum(flex)
            sizes = [p + (extra * f / tf if tf else 0) for p, f in zip(prefs, flex)]
    else:
        sizes = [c.size[0 if horiz else 1] for c in kids]
    cross_control = L.get('m_ChildControlHeight' if horiz else 'm_ChildControlWidth', 1)
    out, at = {}, (left if horiz else top)
    for c, sz in zip(kids, sizes):
        cs = cross if cross_control else c.size[1 if horiz else 0]
        if horiz:
            out[id(c)] = (x0 + at, y0 + bottom + (cross - cs) / 2, sz, cs)
        else:
            out[id(c)] = (x0 + left + (cross - cs) / 2, y0 + h - at - sz, cs, sz)
        at += sz + spacing
    return out


def place(n, parent_rect, parent_m, slot=None):
    """n.rect (local, around its pivot) and n.m (local -> screen)."""
    if slot is not None:
        sx0, sy0, w, h = slot
        px, py = sx0 + n.pivot[0] * w, sy0 + n.pivot[1] * h
    else:
        x0, y0, pw, ph = parent_rect
        ax0, ay0 = x0 + n.a_min[0] * pw, y0 + n.a_min[1] * ph
        ax1, ay1 = x0 + n.a_max[0] * pw, y0 + n.a_max[1] * ph
        w, h = ax1 - ax0 + n.size[0], ay1 - ay0 + n.size[1]
        px = ax0 + (ax1 - ax0) * n.pivot[0] + n.pos[0]
        py = ay0 + (ay1 - ay0) * n.pivot[1] + n.pos[1]
    n.rect = (-n.pivot[0] * w, -n.pivot[1] * h, w, h)
    n.m = parent_m @ affine(px, py, n.angle, n.scale[0], n.scale[1])
    slots = layout_children(n) if n.layout else {}
    for c in n.children:
        place(c, n.rect, n.m, slots.get(id(c)))


# ---------------------------------------------------------------------------
# Drawing
# ---------------------------------------------------------------------------


def nine_slice(img, border, w, h, fill_center=True):
    """A sliced sprite drawn at w x h pixels; border = left, bottom, right, top."""
    l, b, r, t = [int(round(x)) for x in border]
    iw, ih = img.size
    s = min(1.0, w / max(1, l + r), h / max(1, t + b))
    L, R, T, B = round(l * s), round(r * s), round(t * s), round(b * s)
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    xs = [(0, l, 0, L), (l, iw - r, L, w - R), (iw - r, iw, w - R, w)]
    ys = [(0, t, 0, T), (t, ih - b, T, h - B), (ih - b, ih, h - B, h)]
    for j, (sy0, sy1, dy0, dy1) in enumerate(ys):
        for i, (sx0, sx1, dx0, dx1) in enumerate(xs):
            if i == 1 and j == 1 and not fill_center:
                continue
            if sx1 <= sx0 or sy1 <= sy0 or dx1 <= dx0 or dy1 <= dy0:
                continue
            out.paste(img.crop((sx0, sy0, sx1, sy1)).resize((dx1 - dx0, dy1 - dy0), Image.LANCZOS), (dx0, dy0))
    return out


def tiled(img, w, h, scale):
    tw, th = max(1, round(img.width * scale)), max(1, round(img.height * scale))
    tile = img.resize((tw, th), Image.LANCZOS)
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    for y in range(h - th, -th, -th):  # tiles start bottom-left
        for x in range(0, w, tw):
            out.paste(tile, (x, y))
    return out


def untrim(img, g):
    """A sprite's decoded picture (only its packed part) back on its whole rect,
    so it isn't stretched over the empty margins the packing cut off."""
    if 'trim' not in g:
        return img
    rw, rh = round(g['native'][0]), round(g['native'][1])
    if img.size == (rw, rh):
        return img
    ox, oy = g['trim']
    out = Image.new('RGBA', (rw, rh), (0, 0, 0, 0))
    out.paste(img, (round(ox), rh - round(oy) - img.height))
    return out


def graphic_pixels(game, g, w, h, scale):
    """The graphic as an RGBA picture at w x h output pixels (its rect, tinted)."""
    if g['image'] == 'flat':
        return np.ones((h, w, 4), np.float32) * np.array(g['color'], dtype=np.float32)
    sfile, obj = g['image']
    img = untrim(game.pixels(sfile, obj), g)
    if g['kind'] == 'raw':
        u, v, uw, vh = g['uv']
        if (u, v, uw, vh) != (0, 0, 1, 1):
            iw, ih = img.size
            img = img.crop((round(u * iw), round((1 - v - vh) * ih), round((u + uw) * iw), round((1 - v) * ih)))
        pic = img.resize((w, h), Image.LANCZOS)
    elif g['type'] == 1 and any(g.get('border', (0,) * 4)):
        k = scale * 100 / g.get('ppu', 100) / g['ppu_mult']
        bl, bb, br, bt = g['border']
        pic = nine_slice(img, (bl, bb, br, bt), w, h, g['fill_center']) if k == 1 else \
            nine_slice(img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS),
                       (bl * k, bb * k, br * k, bt * k), w, h, g['fill_center'])
    elif g['type'] == 2:
        pic = tiled(img, w, h, scale * 100 / g.get('ppu', 100) / g['ppu_mult'])
    else:
        pic = img.resize((w, h), Image.LANCZOS)
        if g['type'] == 3 and g['fill'] < 1:
            a = np.asarray(pic).copy()
            if g['fill_method'] == 0:  # horizontal
                cut = round(w * g['fill'])
                if g['fill_origin'] == 0:
                    a[:, cut:, 3] = 0
                else:
                    a[:, :w - cut, 3] = 0
            elif g['fill_method'] == 1:  # vertical
                cut = round(h * g['fill'])
                if g['fill_origin'] == 0:
                    a[:h - cut, :, 3] = 0
                else:
                    a[cut:, :, 3] = 0
            pic = Image.fromarray(a)
    a = np.asarray(pic).astype(np.float32) / 255
    a = a * np.array(g['color'], dtype=np.float32)
    return a


def to_screen(view, k):
    """Screen units (origin centre, y up) -> output pixels for a view of the screen."""
    vx0, vy0, vw, vh = view
    sx = k
    return np.array([[sx, 0, -vx0 * sx], [0, -sx, (vy0 + vh) * sx], [0, 0, 1]])


def warp(arr, M, size):
    """Draws a w x h float RGBA picture whose pixel (0, 0) is its top-left, with M: picture px -> out px."""
    inv = np.linalg.inv(M)
    img = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8), 'RGBA')
    # premultiply so edges blend right when resampled
    pm = np.asarray(img).astype(np.float32) / 255
    pm[..., :3] *= pm[..., 3:4]
    chans = [Image.fromarray(pm[..., i], 'F').transform(size, Image.AFFINE, tuple(inv[:2].ravel()), Image.BILINEAR)
             for i in range(4)]
    return np.stack([np.asarray(c) for c in chans], axis=-1)  # premultiplied


class Canvas:
    def __init__(self, view, k):
        self.view, self.k = view, k
        self.size = (round(view[2] * k), round(view[3] * k))
        self.px = np.zeros((self.size[1], self.size[0], 4), np.float32)  # premultiplied
        self.base = to_screen(view, k)
        self.flat = False  # draw pictureless graphics (see read_graphic)
        self.part = None  # None: everything; 'back': all but the operator art; 'op': only it

    def node_to_px(self, n, w, h):
        """Matrix from the node's graphic picture (w x h px, top-left origin) to output px."""
        x0, y0, rw, rh = n.rect
        pic = np.array([[rw / w, 0, x0], [0, -rh / h, y0 + rh], [0, 0, 1]])
        return self.base @ n.m @ pic

    def footprint(self, n):
        x0, y0, rw, rh = n.rect
        M = self.base @ n.m
        pts = [M @ np.array([x, y, 1]) for x in (x0, x0 + rw) for y in (y0, y0 + rh)]
        sc = math.hypot(M[0, 0], M[1, 0])
        return pts, sc


def draw(game, canvas, n, alpha, masks, full, inside=False):
    if not n.active:
        return
    if not full and n.name in SKIP:
        return
    if abs(np.linalg.det(n.m[:2, :2])) < 1e-9:  # scaled to nothing
        return
    alpha = n.alpha if n.ignore_parent_groups else alpha * n.alpha
    # The operator's figure (MainRoleImage) and everything under it.
    inside = inside or n.path.endswith('/Main/Bg/MainRoleImage')
    g = n.graphic
    own = None
    if g and g.get('image') is not None and (g['image'] != 'flat' or canvas.flat or (g['kind'] == 'image' and '/GroundBg/' in n.path)) and g.get('enabled', True) and n.rect[2] > 0.5 and n.rect[3] > 0.5:
        pts, sc = canvas.footprint(n)
        w = max(1, min(8000, round(n.rect[2] * sc)))
        h = max(1, min(8000, round(n.rect[3] * sc)))
        arr = graphic_pixels(game, g, w, h, sc)
        if g.get('preserve') and g['kind'] == 'image' and g.get('native'):
            nw, nh = g['native']
            f = min(w / nw, h / nh)
            fw, fh = max(1, round(nw * f)), max(1, round(nh * f))
            inner = graphic_pixels(game, dict(g, preserve=0), fw, fh, sc)
            arr = np.zeros((h, w, 4), np.float32)
            ox, oy = round((w - fw) * n.pivot[0]), round((h - fh) * (1 - n.pivot[1]))
            arr[oy:oy + fh, ox:ox + fw] = inner
        M = canvas.node_to_px(n, w, h)
        own = warp(arr, M, canvas.size)
        if n.mask in ('soft', 'stencil'):
            m = own[..., 3] / max(1e-6, g['color'][3]) if g['color'][3] > 0 else warp(
                graphic_pixels(game, dict(g, color=[1, 1, 1, 1]), w, h, sc), M, canvas.size)[..., 3]
            if n.mask == 'stencil':
                m = (m > 0.01).astype(np.float32)
            child_masks = masks + [np.clip(m, 0, 1)]
        show = not (n.mask == 'stencil' and not n.show_mask_graphic) and (full or g.get('name') not in LETTERING)
        show = show and (canvas.part is None or (canvas.part == 'op') == inside)
        if show and alpha > 0:
            layer = own * alpha
            for m in masks:
                layer = layer * m[..., None]
            if g['blend'] == 'add':
                canvas.px[..., :3] += layer[..., :3]
            elif g['blend'] == 'screen':
                canvas.px[..., :3] = 1 - (1 - canvas.px[..., :3]) * (1 - layer[..., :3])
            else:
                canvas.px = layer + canvas.px * (1 - layer[..., 3:4])
    if n.mask == 'rect':
        pts, _ = canvas.footprint(n)
        l, b, r, t = n.mask_padding
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        sc = canvas.k
        m = np.zeros(canvas.px.shape[:2], np.float32)
        x0, x1 = int(max(0, min(xs) + l * sc)), int(min(canvas.size[0], max(xs) - r * sc))
        y0, y1 = int(max(0, min(ys) + t * sc)), int(min(canvas.size[1], max(ys) - b * sc))
        if x1 > x0 and y1 > y0:
            m[y0:y1, x0:x1] = 1
        child_masks = masks + [m]
    elif n.mask is None or own is None:
        child_masks = masks
    for c in n.children:
        draw(game, canvas, c, alpha, child_masks, full, inside)


def render(game, pool_id, view=None, width=W, full=False, part=None):
    """The banner (RGB image), or with part='back' / 'op' that part's premultiplied pixels."""
    view = view or VIEW
    sf = game.prefab(pool_id)
    tree = read_tree(game, sf)
    opening_state(game, sf, tree)
    # The screen, centred on the layout, just big enough to cover the view.
    hw, hh = max(-view[0], view[0] + view[2]), max(-view[1], view[1] + view[3])
    root_rect = (-hw, -hh, 2 * hw, 2 * hh)
    tree.a_min, tree.a_max, tree.size, tree.pos = (0, 0), (1, 1), [0, 0], [0, 0]
    place(tree, root_rect, np.eye(3))
    canvas = Canvas(view, width / view[2])
    canvas.part = part
    panel = read_tree(game, game.panel())
    panel.a_min, panel.a_max, panel.size, panel.pos, panel.scale = (0, 0), (1, 1), [0, 0], [0, 0], (1, 1)
    place(panel, root_rect, np.eye(3))
    backdrop = next(c for c in panel.children if c.name == 'Main').children
    canvas.flat = True
    for c in backdrop:
        if c.name == 'DecoLineNode':
            draw(game, canvas, c, 1.0, [], False)
    canvas.flat = False
    draw(game, canvas, tree, 1.0, [], full)
    if part:
        return canvas.px
    out = np.clip(canvas.px[..., :3], 0, 1)  # premultiplied, over black
    return Image.fromarray((out * 255).astype(np.uint8), 'RGB')


def layers(game, pool_id):
    """(backdrop RGB, operator RGBA): the operator over the backdrop is the flat banner."""
    flat = np.clip(np.asarray(render(game, pool_id), np.float32) / 255, 0, 1)
    # 8-bit like render() makes the flat file (truncated, not rounded).
    back = np.floor(np.clip(render(game, pool_id, part='back')[..., :3], 0, 1) * 255) / 255
    a = np.clip(render(game, pool_id, part='op')[..., 3], 0, 1)
    # The least coverage that lets a colour in 0..1 give the flat pixel over
    # the backdrop, per channel: more where the flat is brighter or darker
    # than the backdrop (additive glows, layers blended over the operator).
    up = np.where(flat > back, (flat - back) / np.maximum(1 - back, 1e-6), 0)
    down = np.where(flat < back, (back - flat) / np.maximum(back, 1e-6), 0)
    a = np.maximum(a, np.maximum(up, down).max(axis=2))
    a = np.where(np.abs(flat - back).max(axis=2) < 0.5 / 255, 0, a)  # the same pixel: no operator there
    a = np.clip(np.ceil(a * 255) / 255, 0, 1)  # rounded up, so the colour stays in range
    safe = np.maximum(a, 1e-6)[..., None]
    col = np.clip((flat - (1 - a[..., None]) * back) / safe, 0, 1)
    col = np.where(a[..., None] > 0, col, 0)
    op = np.dstack([col, a])
    return (Image.fromarray(np.round(back * 255).astype(np.uint8), 'RGB'),
            Image.fromarray(np.round(op * 255).astype(np.uint8), 'RGBA'))


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a != '--full']
    if len(args) < 3:
        sys.exit(__doc__)
    dump, out_dir, pools = args[0], args[1], args[2:]
    game = Game(dump)
    for pool_id in pools:
        render(game, pool_id).save(os.path.join(out_dir, pool_id + '.webp'), 'WEBP', quality=86, method=6)
        back, op = layers(game, pool_id)
        os.makedirs(os.path.join(out_dir, 'layers'), exist_ok=True)
        back.save(os.path.join(out_dir, 'layers', pool_id + '-back.webp'), 'WEBP', quality=86, method=6)
        op.save(os.path.join(out_dir, 'layers', pool_id + '-op.webp'), 'WEBP', quality=86, method=6)
        if '--full' in sys.argv:
            render(game, pool_id, view=(-1920, -1080, 3840, 2160), width=1920, full=True).save(
                os.path.join(out_dir, pool_id + '-full.png'))
        print(pool_id)
