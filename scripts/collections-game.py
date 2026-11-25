"""Medals and Intel Archives the wiki doesn't list yet, from a local EndfieldData dump: wiki/medals-game.json
and wiki/findings-game.json, plus their pictures in collections/ (game-*.webp, keyed "game:<sprite path>" in
collections/index.json). scripts/wiki-collections.mjs merges both files into wiki/medals.json and
wiki/findings.json on every run, so a weekly wiki run keeps them, and once the wiki lists one of them the wiki's
entry takes its place under the same id (players' progress is kept by id). Run by hand after a game update:

    python scripts/collections-game.py C:/Users/Albert/Development/EndfieldDataDump/output
    node scripts/wiki-collections.mjs --merge-only

What it reads: AchievementTable/AchievementTypeTable (medals; names and texts from I18nTextTable_EN),
PrtsFirstLv/PrtsAllItem/PrtsInvestigate (archives), RichContentTable and RadioTable (their text),
LevelDescTable and DomainDataTable (region and area, from the level a text belongs to), TimeRangeTable (when a
medal shows and when an event medal ends), and the medal/archive sprites from the decrypted bundles (found
through output/asset_index.tsv). An entry is new when neither its name nor the start of its text matches a wiki
entry of the same category. Wiki-only fields the game doesn't have: a Nexus File's `unlock`.

The text is Gryphline's (game data, not CC BY-SA). Needs UnityPy and Pillow.
"""
import collections
import datetime
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPRITES = 'assets/beyond/dynamicassets/gameplay/ui/sprites/'
TODAY = datetime.date.today().isoformat()


def norm(s):
    return re.sub(r'[^a-z0-9]', '', clean(s or '').lower())


def clean(s):
    """The game's rich-text markup out: <@nar.mark>x</> keeps x, <br> is a line break, <image> lines go."""
    s = re.sub(r'<image[^>]*>[^<]*</image>', '', s or '')
    s = re.sub(r'<br\s*/?>', '\n', s)
    s = re.sub(r'</?[@#a-zA-Z][^>]*>|</>', '', s)
    return '\n'.join(l.strip() for l in s.split('\n')).strip()


def slug(s):
    import unicodedata
    s = unicodedata.normalize('NFD', s)
    s = re.sub(r'[\u0300-\u036f]', '', s).lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


class Dump:
    def __init__(self, out):
        self.out = out
        self.tables = os.path.join(out, 'Data', 'TableCfg')
        self.en = self.load('I18nTextTable_EN')

    def load(self, name):
        return json.load(open(os.path.join(self.tables, name + '.json'), encoding='utf8'))

    def t(self, x):
        if isinstance(x, dict):
            return self.en.get(str(x.get('id')), x.get('text') or '') if x.get('id') else (x.get('text') or '')
        return x or ''


def text_key(s):
    """The start of a text, to know an entry the wiki names differently."""
    k = norm(s)[:80]
    return k if len(k) >= 30 else None


# --- Medals ------------------------------------------------------------------

def medals(d, wiki):
    achv, types, times = d.load('AchievementTable'), d.load('AchievementTypeTable'), d.load('TimeRangeTable')
    group_of = {}
    for ty in types.values():
        for g in ty['achievementGroupData']:
            group_of[g['groupId']] = (d.t(ty['categoryName']), d.t(g['groupName']) or None, ty['noObtainCanView'], ty['categoryPriority'])
    by_name = {(m['category'], norm(m['name'])): m for m in wiki}
    by_text = {(m['category'], text_key(m['desc'])): m for m in wiki if text_key(m['desc'])}
    names = {norm(m['name']) for m in wiki}
    rows = []
    for a in achv.values():
        cat, group, visible, prio = group_of[a['groupId']]
        levels = sorted(a['levelInfos'].values(), key=lambda l: l['achieveLevel'])
        first = levels[0]
        conds = list(dict.fromkeys(d.t(c['desc']) for c in first['conditions']))
        m = {
            'id': slug(clean(d.t(a['name']))),
            'name': clean(d.t(a['name'])),
            'category': cat,
            'group': group,
            'desc': clean(d.t(first['completeDesc']) or d.t(a['desc'])),
            'cond': '' if not visible else clean('; '.join(conds)),
        }
        if not visible:
            m['secret'] = clean('; '.join(conds))
        m['reforge'] = [{'desc': clean(d.t(l['completeDesc'])), 'cond': clean('; '.join(dict.fromkeys(d.t(c['desc']) for c in l['conditions'])))} for l in levels[1:]]
        if a['canBePlated'] and a['plateConditions']:
            m['trim'] = clean(d.t(a['plateConditions'][0]['desc']))
        span = (times.get(a['displayTimeId']) or {}).get('timeRangeList') or []
        if cat == 'Event':
            m['group'] = 'Permanent' if re.search(r'challenge_dung|puzzle', a['achieveId']) else 'Time-Limited'
            close = span[0]['closeTime'] if span else ''
            if close:
                y, mo, da = close.split(' ')[0].split('/')
                m['end'] = f'{y}/{int(mo):02d}/{int(da):02d}'
        if span and span[0]['openTime']:
            y, mo, da = span[0]['openTime'].split(' ')[0].split('/')
            shows = f'{y}-{int(mo):02d}-{int(da):02d}'
            if shows > TODAY:
                m['from'] = shows
        lv = [l['achieveLevel'] for l in levels]
        sprite = f"medalicon/{a['achieveId']}_lv{lv[0]:02d}"
        m['images'] = {'base': sprite}
        if len(lv) > 1:
            m['images']['r2'] = f"medalicon/{a['achieveId']}_lv{lv[1]:02d}"
        if len(lv) > 2:
            m['images']['r3'] = f"medalicon/{a['achieveId']}_lv{lv[2]:02d}"
        if 'trim' in m:
            m['images']['trim'] = f"medalicon/{a['achieveId']}_lv{lv[-1]:02d}_plating"
        m['gameId'] = a['achieveId']
        rows.append((prio, a['groupId'], a['order'], m))
    rows.sort(key=lambda r: r[:3])
    out, prev = [], {}
    for prio, gid, order, m in rows:
        w = by_name.get((m['category'], norm(m['name']))) or by_text.get((m['category'], text_key(m['desc'])))
        # The wiki's "Ultimate Weaponry" is the game's "Ultimate Weapon": a name that starts the other's, same category.
        if not w:
            w = next((x for x in wiki if x['category'] == m['category'] and (norm(x['name']).startswith(norm(m['name'])) or norm(m['name']).startswith(norm(x['name'])))), None)
        if w:
            prev[m['category']] = w['id']
            continue
        if m['id'] in names or any(x['id'] == m['id'] for x in out):
            m['id'] = f"{slug(m['category'])}-{m['id']}"
        m['after'] = prev.get(m['category'])
        prev[m['category']] = m['id']
        out.append(m)
    return out


# --- Intel Archives ----------------------------------------------------------

CATEGORY = {'paper': 'Manuscripts', 'digital': 'E-Files', 'collection': 'Peculiars', 'media': 'Audio Records', 'document': 'Nexus Files'}


def findings(d, wiki):
    first, items, inv = d.load('PrtsFirstLv'), d.load('PrtsAllItem'), d.load('PrtsInvestigate')
    rich, radio = d.load('RichContentTable'), d.load('RadioTable')
    levels, domains = d.load('LevelDescTable'), d.load('DomainDataTable')
    region_of = {'map01': d.t(domains['domain_1']['domainName']), 'map02': d.t(domains['domain_2']['domainName'])}

    def content(cid):
        if cid in rich:
            parts = [d.t(c['content']) for c in rich[cid]['contentList']]
            pics = [m.group(1) for p in parts for m in [re.search(r'<image[^>]*>([^<]+)</image>', p)] if m]
            return '\n\n'.join(p for p in (clean(x) for x in parts) if p), pics
        if cid in radio:
            lines = [f"{clean(d.t(l['actorName']))}: {clean(d.t(l['radioText']))}" for l in radio[cid]['radioSingleDataList'] if d.t(l['radioText'])]
            return '\n\n'.join(lines), []
        return '', []

    def place(cid):
        m = re.search(r'(map0\d)_(lv\d{3})', cid or '')
        if not m:
            return None, None
        lv = levels.get(f'{m.group(1)}_{m.group(2)}')
        return region_of.get(m.group(1)), (d.t(lv['showName']) if lv else None) or None

    # Dump entries in the game's order, one per archive tile (PrtsFirstLv); a tile of several texts has them
    # all, each under its own title. `_names` and `_texts` are what a wiki entry may be listed under.
    entries = []
    for fl in sorted(first.values(), key=lambda f: (f['categoryId'], f['order'])):
        cat = CATEGORY.get(fl['categoryId'])
        if not cat:
            continue
        its = sorted((items[i] for i in fl['itemIds'] if i in items), key=lambda i: i['order'])
        if not its:
            continue
        parts = [(clean(d.t(it['name'])), *content(it['contentId'])) for it in its]
        name = clean(d.t(fl['name'])) or parts[0][0]
        if len(parts) == 1:
            text = parts[0][1]
        else:
            text = '\n\n'.join(f'{n}\n\n{t}' if t else n for n, t, _ in parts)
        region, area = place(its[0]['contentId'])
        if not region and fl['order'] >= 10**8:
            region = region_of.get(f"map0{str(fl['order'])[0]}")
        e = {'name': name, 'category': cat, 'region': region, 'area': area, 'parts': len(parts) if len(parts) > 1 else None, 'text': text or None,
             '_icon': fl['icon'], '_pics': [p for _, _, ps in parts for p in ps], 'gameId': fl['firstLvId'],
             '_names': [name] + [n for n, _, _ in parts], '_texts': [t for _, t, _ in parts]}
        entries.append(e)
    for r in sorted(inv.values(), key=lambda r: (r['index'], r['domainId'])):
        rep = items.get(r['unlockPrts'])
        text, _ = content(rep['contentId']) if rep else ('', [])
        entries.append({'name': clean(d.t(r['name'])), 'category': 'Intel Gathering', 'type': 'Investigation', 'parts': len(r['collectionIdList']) or None, 'text': text or None, 'gameId': r['id']})

    by_name = {(f['category'], norm(f['name'])): f for f in wiki}
    by_text = {(f['category'], text_key(f.get('text'))): f for f in wiki if text_key(f.get('text'))}
    # A dump icon's wiki type and picture, from the entries both have.
    types, icons = collections.defaultdict(collections.Counter), collections.defaultdict(collections.Counter)
    def find(e):
        for n in e.get('_names', [e['name']]):
            if (e['category'], norm(n)) in by_name:
                return by_name[(e['category'], norm(n))]
        for t in e.get('_texts', [e.get('text')]):
            if (e['category'], text_key(t)) in by_text:
                return by_text[(e['category'], text_key(t))]
        # A name the wiki lengthened or shortened ('Search results for: "Chi Xiao" (transl. Crimson Sky)').
        n = norm(e['name'])
        if len(n) >= 12:
            return next((f for f in wiki if f['category'] == e['category'] and (norm(f['name']).startswith(n) or n.startswith(norm(f['name'])) and len(norm(f['name'])) >= 12)), None)
        return None

    matched = []
    for e in entries:
        w = find(e)
        matched.append(w)
        if w and e.get('_icon'):
            if w.get('type'):
                types[e['_icon']][w['type']] += 1
            if w.get('icon'):
                icons[e['_icon']][w['icon']] += 1
    used = {f['id'] for f in wiki}
    out, prev = [], {}
    for e, w in zip(entries, matched):
        if w:
            prev[e['category']] = w['id']
            continue
        icon = e.pop('_icon', None)
        pics = e.pop('_pics', [])
        e.pop('_names', None)
        e.pop('_texts', None)
        if icon:
            if types[icon] and e['category'] != 'Peculiars':
                e['type'] = types[icon].most_common(1)[0][0]
            # A type icon the wiki already has (Finding Note...), else the game's own sprite.
            common = icons[icon].most_common(1)
            e['icon'] = common[0][0] if common and common[0][1] >= 2 else f'prts/icon/{icon}'
            if pics:
                e['image'] = f'reading/{pics[0].split("/")[-1]}'
            elif e['category'] == 'Peculiars':
                e['image'] = f'itemiconbig/{icon}'
        e['id'] = slug(f"{e['category']}-{e['name']}")
        while e['id'] in used:
            e['id'] += '-2'
        used.add(e['id'])
        e['after'] = prev.get(e['category'])
        prev[e['category']] = e['id']
        out.append({k: v for k, v in e.items() if v not in (None, '', [])} | {'after': e['after']})
    return out


# --- Pictures ----------------------------------------------------------------

KINDS = {'medals': 144, 'finding-icons': 128, 'findings': 1024}


def sprite_index(dump):
    """Sprite path under SPRITES (lowercase, no extension) -> bundle folders, Persistent first."""
    idx = collections.defaultdict(list)
    with open(os.path.join(dump, 'asset_index.tsv'), encoding='utf8') as f:
        for line in f:
            folder, _, path = line.rstrip('\n').partition('\t')
            p = path.lower()
            if p.startswith(SPRITES) and p.endswith('.png'):
                idx[p[len(SPRITES):-4]].append(folder)
    for v in idx.values():
        v.sort(key=lambda x: not x.startswith('Persistent'))
    return idx


def save_pictures(dump, wanted):
    """wanted: sprite path -> kind. Saves collections/<kind>/game-<name>.webp; returns sprite -> relative path."""
    import UnityPy
    from PIL import Image
    idx = sprite_index(dump)
    by_folder = collections.defaultdict(set)
    missing = []
    # "fm//x" is a picture the game has per Endministrator (x_f, x_m: the first found is kept); an animated
    # one (frameCount) is x_001, x_002...: its first frame stands for it.
    real = {}
    for s in wanted:
        base = s.lower().replace('fm//', '')
        hit = next((c for c in (base, base + '_f', base + '_m', base + '_001') if idx.get(c)), None)
        if hit:
            real[s] = hit
            by_folder[idx[hit][0]].add(hit)
        else:
            missing.append(s)
    done = {}
    for folder, names in by_folder.items():
        stems = {n.split('/')[-1]: n for n in names}
        for cab in glob.glob(os.path.join(dump, 'bundles', folder, 'CAB-*')):
            if cab.endswith('.resS'):
                continue
            for obj in UnityPy.load(cab).objects:
                if obj.type.name not in ('Sprite', 'Texture2D'):
                    continue
                o = obj.read()
                n = stems.get(o.m_Name.lower())
                if not n or (n in done and obj.type.name == 'Texture2D'):
                    continue
                kind = next(wanted[s] for s in wanted if real.get(s) == n)
                im = o.image.convert('RGBA')
                im.thumbnail((KINDS[kind], KINDS[kind]), Image.LANCZOS)
                rel = f"{kind}/game-{re.sub(r'[^a-z0-9]+', '-', n.split('/')[-1])}.webp"
                os.makedirs(os.path.join(ROOT, 'collections', kind), exist_ok=True)
                im.save(os.path.join(ROOT, 'collections', rel), 'WEBP', quality=88, method=6)
                done[n] = rel
    missing += [s for s in real if real[s] not in done]
    return {s: done[real[s]] for s in real if real[s] in done}, missing


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    dump = sys.argv[1]
    d = Dump(dump)
    wiki_m = [m for m in json.load(open(os.path.join(ROOT, 'wiki', 'medals.json'), encoding='utf8'))['medals'] if m.get('source') != 'game']
    wiki_f = [f for f in json.load(open(os.path.join(ROOT, 'wiki', 'findings.json'), encoding='utf8'))['findings'] if f.get('source') != 'game']
    # Entries made before keep their ids, so a player's progress on them stays.
    old = {}
    for name in ('medals-game', 'findings-game'):
        p = os.path.join(ROOT, 'wiki', name + '.json')
        if os.path.exists(p):
            for x in json.load(open(p, encoding='utf8'))[name.split('-')[0]]:
                old[x['gameId']] = x['id']
    m, f = medals(d, wiki_m), findings(d, wiki_f)
    for x in m + f:
        x['id'] = old.get(x['gameId'], x['id'])
    wanted = {}
    for x in m:
        for s in x['images'].values():
            wanted[s] = 'medals'
    for x in f:
        if x.get('icon', '').startswith('prts/'):
            wanted[x['icon']] = 'finding-icons'
        if x.get('image'):
            wanted[x['image']] = 'findings'
    saved, missing = save_pictures(dump, wanted)
    index_path = os.path.join(ROOT, 'collections', 'index.json')
    index = json.load(open(index_path, encoding='utf8'))
    index = {k: v for k, v in index.items() if not k.startswith('game:')}
    for s, rel in saved.items():
        index[f'game:{s}'] = rel
    # Pictures without a sprite are left out; the others point at their copy by key.
    for x in m:
        x['images'] = {k: f'game:{s}' for k, s in x['images'].items() if s in saved}
    for x in f:
        for k in ('icon', 'image'):
            if x.get(k) and not x[k].startswith('http'):
                if x[k] in saved:
                    x[k] = f'game:{x[k]}'
                else:
                    del x[k]
    with open(index_path, 'w', encoding='utf8', newline='\n') as fh:
        json.dump(index, fh, indent=1, ensure_ascii=False, sort_keys=True)
        fh.write('\n')
    note = {'source': 'the game files (a local EndfieldDataDump)', 'note': 'Game data (c) Gryphline / Hypergryph. Entries endfield.wiki.gg does not list yet; scripts/wiki-collections.mjs merges them.', 'fetched': TODAY}
    for name, key, rows in (('medals-game', 'medals', m), ('findings-game', 'findings', f)):
        with open(os.path.join(ROOT, 'wiki', name + '.json'), 'w', encoding='utf8', newline='\n') as fh:
            json.dump({**note, key: rows}, fh, indent=1, ensure_ascii=False)
            fh.write('\n')
    print(f'medals not on the wiki: {len(m)}; archives: {len(f)} ({dict(collections.Counter(x["category"] for x in f))}); pictures {len(saved)}')
    if missing:
        print(f'no sprite for: {", ".join(missing)}')


if __name__ == '__main__':
    main()
