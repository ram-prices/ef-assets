"""Rebuilds cc/ (Contingency Contract: seasons, criteria, waves, missions, shop, art) from the owner's
EndfieldDataDump output and the wiki. A new season needs no code: every row of
ActivityContingencyContractTable becomes a season.

Rerun it locally after a game patch (the dump exists only on the owner's PC):

    1. Open the game once so it downloads the patch, then run EndfieldDataDump\\run_all.bat.
    2. python scripts/update-cc.py C:/Users/Albert/Development/EndfieldDataDump/output
    3. Read the gap list it prints, commit cc/ and purge the art paths on jsDelivr.

Flags: --no-art skips the pictures, --no-wiki uses only the tables.
Needs UnityPy and Pillow. The wiki is read through its API, as scripts/update-wiki.mjs does.

Sources and the schema are in cc/README.md. Wiki text is CC BY-SA 4.0, so any file holding some carries
an `attribution` block. Dates come from the tables, never the wiki.
"""
import datetime
import json
import math
import os
import re
import sys
import urllib.parse
import urllib.request
import warnings

warnings.filterwarnings('ignore')
sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CC = os.path.join(ROOT, 'cc')
args = [a for a in sys.argv[1:] if not a.startswith('--')]
DUMP = args[0] if args else r'C:\Users\Albert\Development\EndfieldDataDump\output'
TABLES = os.path.join(DUMP, 'Data', 'TableCfg')
PERSISTENT = os.path.join(DUMP, 'jsondata', 'Persistent')
NO_ART = '--no-art' in sys.argv
NO_WIKI = '--no-wiki' in sys.argv
API = 'https://endfield.wiki.gg/api.php'
UA = 'ef-assets wiki snapshot (github.com/ram-prices/ef-assets; ItJustLogs)'
ATTRIBUTION = {'text': 'endfield.wiki.gg, CC BY-SA 4.0', 'url': 'https://endfield.wiki.gg', 'license': 'CC BY-SA 4.0'}
ROMAN = {'Ⅰ': 'I', 'Ⅱ': 'II', 'Ⅲ': 'III', 'Ⅳ': 'IV', 'Ⅴ': 'V', 'Ⅵ': 'VI', 'Ⅶ': 'VII', 'Ⅷ': 'VIII', 'Ⅸ': 'IX', 'Ⅹ': 'X'}
ZONES = {'asia': (1, '+08:00'), 'americas': (2, '-05:00')}  # entry of TimeRangeTable's list, offset. Entries are local time.
HP_BONUS_BUFF = 'buff_common_maxhpup'
# What a wave file is for isn't in the data: these are read from what differs, so they're marked inferred.
VARIANT_NOTES = {
    ('indie_contract001', 2): 'Final-wave Heavy Ram and Heavy Sting become their α forms, likely Ambient: RE-Construct I',
    ('indie_contract001', 3): 'Third and fourth wave Heavy Ram and Heavy Sting become their α forms, likely Ambient: RE-Construct II',
    ('indie_contract002', 0): 'On-looking Rockhowlers, likely Edit: Fruity Slippers',
    ('indie_contract002', 2): 'Adds a second Armored Manglerbeast, likely Edit: Team Mangler',
}
tables = {}


def table(name):
    if name not in tables:
        with open(os.path.join(TABLES, name + '.json'), encoding='utf-8') as f:
            tables[name] = json.load(f)
    return tables[name]


def text(v):
    """English for a {id, text} field, or None when the table has no text for that id yet."""
    if not isinstance(v, dict) or not v.get('id'):
        return None
    return table('I18nTextTable_EN').get(str(v['id'])) or None


def roman(s):
    for a, b in ROMAN.items():
        s = s.replace(a, b)
    return s


def plain(s):
    """Game text without its markup."""
    if s is None:
        return None
    s = re.sub(r'<image=[^>]*>', '', s)
    s = re.sub(r'</?[@a-zA-Z#][^>]*>|</>', '', s)
    return roman(re.sub(r'[ \t]+', ' ', s)).strip()


def iso(stamp, offset):
    """'2026/11/5 12:00:00' -> ISO with the server's offset."""
    d = datetime.datetime.strptime(stamp, '%Y/%m/%d %H:%M:%S')
    return d.strftime('%Y-%m-%dT%H:%M:%S') + offset


def when(time_id, field):
    """{asia, americas} for a TimeRangeTable row's openTime or closeTime, or None."""
    row = table('TimeRangeTable').get(time_id)
    if not row:
        return None
    out = {}
    for server, (i, offset) in ZONES.items():
        stamp = row['timeRangeList'][i][field]
        if not stamp:
            return None
        out[server] = iso(stamp, offset)
    return out


def rel(path):
    return os.path.relpath(path, ROOT).replace('\\', '/')


def wiki_pages(titles):
    """title -> wikitext, skipping pages that don't exist."""
    out = {}
    if NO_WIKI:
        return out
    for t in titles:
        q = urllib.parse.urlencode({'action': 'query', 'prop': 'revisions', 'rvprop': 'content', 'rvslots': 'main', 'format': 'json', 'titles': t})
        req = urllib.request.Request(API + '?' + q, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=30) as f:
            page = next(iter(json.load(f)['query']['pages'].values()))
        if 'revisions' in page:
            out[t] = page['revisions'][0]['slots']['main']['*']
    return out


def wiki_clean(s):
    """Wikitext to plain text."""
    s = re.sub(r'<i>.*?</i>', '', s, flags=re.S)
    s = re.sub(r'<br\s*/?>', '\n', s)
    for _ in range(3):
        s = re.sub(r'\{\{Color\|([^|{}]*)\|[^{}]*\}\}', r'\1', s)
        s = re.sub(r'\{\{G\|[^|{}]*\|([^|{}]*)\}\}', r'\1', s)
        s = re.sub(r'\{\{[GIE]\|([^|{}]*)[^{}]*\}\}', r'\1', s)
    s = re.sub(r'\[\[[^\]|]*\|([^\]]*)\]\]', r'\1', s)
    s = re.sub(r'\[\[([^\]]*)\]\]', r'\1', s)
    s = re.sub(r"'''?", '', s)
    return re.sub(r'<[^>]+>', '', s).strip()


def wiki_criteria(wikitext):
    rows = []
    for block in re.findall(r'\{\{RiskTableRow[^\n]*\n(.*?)\n\}\}', wikitext or '', re.S):
        d = {k.strip(): v.strip() for k, v in re.findall(r'^\|\s*([a-z0-9 ]+?)\s*=\s*(.*)$', block, re.M)}
        name = roman(d.get('name', '').strip())
        m = re.match(r'^(.*?)(?:\s+(I{1,3}))?$', name)
        rows.append({'name': name, 'base': m.group(1), 'numeral': m.group(2) or '', 'points': int(d.get('criterion level') or d.get('risk level') or 0),
                     'desc': wiki_clean(d.get('description', '')), 'kind': d.get('properties', '').strip()})
    return rows


class Art:
    """Pictures from the decrypted bundles. Patched (Persistent) copies come first."""

    def __init__(self):
        self.index = {}
        with open(os.path.join(DUMP, 'asset_index.tsv'), encoding='utf-8') as f:
            for line in f:
                folder, _, path = line.rstrip('\n').partition('\t')
                name = os.path.splitext(path.split('/')[-1])[0].lower()
                self.index.setdefault(name, []).append((folder, path))
        for v in self.index.values():
            v.sort(key=lambda x: not x[0].startswith('Persistent'))
        self.bundles = {}

    def textures(self, folder):
        if folder not in self.bundles:
            import UnityPy
            found = {}
            root = os.path.join(DUMP, 'bundles', folder)
            for f in os.listdir(root):
                if f == 'manifest.json' or f.endswith('.resS'):
                    continue
                for o in UnityPy.load(os.path.join(root, f)).objects:
                    if o.type.name == 'Texture2D':
                        t = o.read()
                        found.setdefault(t.m_Name.lower(), t)
            self.bundles[folder] = found
        return self.bundles[folder]

    def get(self, name, where=''):
        """The picture called name, in a path containing `where`, as RGBA. None if it isn't there."""
        for folder, path in self.index.get(name.lower(), []):
            if where in path:
                t = self.textures(folder).get(name.lower())
                if t is not None:
                    return t.image.convert('RGBA')
        return None


def save_art(im, path, width=None, lossless=True):
    from PIL import Image
    if width and im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if lossless:
        im.save(path, 'WEBP', lossless=True, quality=100, method=6, exact=True)
    else:
        im.convert('RGB').save(path, 'WEBP', quality=90, method=6)


def grid_of(game):
    cols = {}
    for col, c in game['contractColMap'].items():
        for row, r in c['contractRowMap'].items():
            cols.setdefault(int(col), {})[int(row)] = r
    return cols


def signature(c):
    kind = 'key' if c['key'] else 'lock' if c['locks'] else ''
    return (c['points'], c['numeral'], kind)


def icon_vector(im):
    from PIL import Image
    return list(im.convert('RGBA').getchannel('A').resize((24, 24), Image.BILINEAR).getdata())


def match_wiki(criteria, rows, reference, art):
    """Ties wiki rows to criteria that have no text yet. Returns {criterion id: (row, how)}.

    Criteria of the later phase aren't on the wiki, so they're left out. First whole tiers (one conflict
    group against one wiki name) where the shape of the tier is unique, then single rows, then whatever
    an earlier season's identical icon settles.
    """
    pool = [c for c in criteria if c['unlockPhase'] == 1]
    out, left = {}, list(rows)
    groups = {}
    for c in pool:
        groups.setdefault(c['conflict'] or c['id'], []).append(c)
    names = {}
    for r in rows:
        names.setdefault(r['base'], []).append(r)
    shape = lambda sigs: tuple(sorted(sigs))
    by_shape = {}
    for g in groups.values():
        by_shape.setdefault(shape(signature(c) for c in g), []).append(g)
    wiki_shape = {}
    for base, rs in names.items():
        wiki_shape.setdefault(shape((r['points'], r['numeral'], r['kind']) for r in rs), []).append(rs)
    done = set()

    def assign(g, rs, how):
        for c in g:
            r = next(x for x in rs if (x['points'], x['numeral'], x['kind']) == signature(c))
            out[c['id']] = (r, how)
            done.add(c['id'])
            left.remove(r)

    def by_elimination():
        for s, gs in by_shape.items():
            open_groups = [g for g in gs if not any(c['id'] in done for c in g)]
            open_rows = [x for x in wiki_shape.get(s, []) if all(r in left for r in x)]
            if len(open_groups) == 1 and len(open_rows) == 1:
                assign(open_groups[0], open_rows[0], 'signature')

    by_elimination()
    if reference:
        import numpy
        ref = {}
        for name, vector in reference:
            base = re.sub(r'\s+I{1,3}$', '', name)
            ref.setdefault(base, []).append(numpy.array(vector, dtype=float))
        for s, gs in by_shape.items():
            for g in gs:
                if any(c['id'] in done for c in g):
                    continue
                scored = []
                for n, x in enumerate(w for w in wiki_shape.get(s, []) if all(r in left for r in w)):
                    if x[0]['base'] in ref and all(c.get('_vector') for c in g):
                        dist = [min(numpy.abs(v - numpy.array(c['_vector'], dtype=float)).mean() for v in ref[x[0]['base']]) for c in g]
                        scored.append((max(dist), n, x))
                scored.sort(key=lambda z: z[:2])
                if scored and scored[0][0] < 25 and (len(scored) == 1 or scored[1][0] > 40):
                    assign(g, scored[0][2], 'icon')
        by_elimination()
    return out


def key_ok(chosen, c, by_key):
    return all(any(k['id'] in chosen and k['id'] != c['id'] for k in by_key.get(lock, [])) for lock in c['locks'])


def max_total(criteria):
    """Highest legal total: at most one per conflict group, and a locked criterion needs a key of each of
    its locks selected. Keys are the only choice that changes what else is legal, so every way of picking
    the key criteria is tried, then each conflict group takes its best legal criterion."""
    by_key = {}
    for c in criteria:
        if c['key']:
            by_key.setdefault(c['key'], []).append(c)
    key_tags = [c for c in criteria if c['key']]
    best = 0
    for mask in range(1 << len(key_tags)):
        picked = [c for i, c in enumerate(key_tags) if mask >> i & 1]
        groups = [c['conflict'] for c in picked if c['conflict']]
        if len(groups) != len(set(groups)):
            continue
        chosen = {c['id'] for c in picked}
        total = sum(c['points'] for c in picked)
        taken = {}
        for c in criteria:
            if c['key'] or c['conflict'] in groups or not key_ok(chosen, c, by_key):
                continue
            k = c['conflict'] or c['id']
            taken[k] = max(taken.get(k, 0), c['points'])
        best = max(best, total + sum(taken.values()))
    return best


ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'


def share_encode(criteria, cols, ids):
    value = 0
    for c in criteria:
        if c['id'] in ids:
            value += (1 << (c['row'] - 1)) << (3 * (c['col'] - 1))
    length = math.ceil(cols * 3 / 5)
    out = ''
    while value:
        out = ALPHABET[value % 32] + out
        value //= 32
    return out.rjust(length, '0')


def share_decode(criteria, cols, code):
    value = 0
    for ch in code.upper():
        value = value * 32 + ALPHABET.index(ch)
    return sorted(c['id'] for c in criteria if value >> (3 * (c['col'] - 1) + c['row'] - 1) & 1)


def lua_convert(digits, base_from, base_to):
    """_ConvertBase from ContingencyContractUtils.lua, line for line, to check share_encode against."""
    working = list(digits)
    result = []
    while working:
        next_working, remainder = [], 0
        for d in working:
            cur = remainder * base_from + d
            q = cur // base_to
            remainder = cur % base_to
            if q > 0 or next_working:
                next_working.append(q)
        result.insert(0, remainder)
        working = next_working
    return result


def share_check(criteria, cols, ids, code):
    values = {}
    for c in criteria:
        if c['id'] in ids:
            values[c['col']] = values.get(c['col'], 0) + (1 << (c['row'] - 1))
    octal = [values.get(cols - i, 0) for i in range(cols)]
    lua = ''.join(ALPHABET[d] for d in lua_convert(octal, 8, 32)).rjust(math.ceil(cols * 3 / 5), '0')
    assert lua == code, (lua, code)
    assert share_decode(criteria, cols, code) == sorted(ids), code


def item_of(item_id):
    return table('ItemTable').get(item_id) or {}


def main():
    art = None if NO_ART else Art()
    rows_cc = table('ActivityContingencyContractTable')
    seasons = {}
    for activity_id, cfg in rows_cc.items():
        a = table('ActivityTable')[activity_id]
        seasons[activity_id] = (a, cfg, when(a['timeId'], 'openTime'))
    order = sorted(seasons, key=lambda k: seasons[k][2]['asia'])
    pages = wiki_pages([p for k in order for p in [text(seasons[k][0]['name']) + '/Test Criteria']])
    used_items, index, gaps = {}, [], {}
    reference = []

    def icon_for(item_id):
        icon = item_of(item_id).get('iconId') or item_id
        used_items[icon] = True
        return f'cc/art/items/{icon}.webp'

    def rewards_of(reward_id, overview=False):
        row = table('RewardTable').get(reward_id)
        if not row:
            return []
        shown = row.get('itemBundleVisibleList') or []
        # Overview lists only mean their count where the visible flag says so; the rest hold a placeholder 1.
        out = []
        for i, b in enumerate(row['itemBundles']):
            count = None if overview and not (i < len(shown) and shown[i]) else b['count']
            out.append({'item': plain(text(item_of(b['id']).get('name'))), 'count': count, 'icon': icon_for(b['id'])})
        return out

    for activity_id in order:
        a, cfg, start = seasons[activity_id]
        game_id = cfg['gameId']
        full = text(a['name'])
        short = full.split(':', 1)[-1].replace('Experimental Operation', '').strip()
        slug = re.sub(r'[^a-z0-9]+', '-', short.lower()).strip('-')
        game = table('ContingencyContractTable')[game_id]
        dungeon = table('DungeonTable')[game_id]
        level_rewards = {}
        for lv, r in table('ContingencyContractLevelTable')[game_id]['levelMap'].items():
            level_rewards[int(lv)] = table('RewardTable')[r['firstReward']]['itemBundles'][0]
        currency_id = level_rewards[1]['id']
        stage_ids = sorted(table('ActivityConditionalMultiStageTable')[activity_id]['stageList'].values(), key=lambda s: s['sortId'])
        phases = {s['stageId']: i + 1 for i, s in enumerate(stage_ids)}
        grid = grid_of(game)
        criteria = []
        for col in sorted(grid):
            for row in sorted(grid[col]):
                r = grid[col][row]
                t = table('CcTagTable')[str(r['tagId'])]
                base = plain(text(t['name']))
                numeral = roman(t['romanNumSuffix'])
                criteria.append({'id': r['tagId'], 'col': col, 'row': row, 'points': t['score'],
                                 'name': (base + ' ' + numeral).strip() if base else None, 'numeral': numeral,
                                 'desc': plain(text(t['desc'])), 'descSource': 'game', 'icon': f"cc/art/tags/{r['tagId']}.webp",
                                 'conflict': r['conflictId'] or None, 'key': r['keyId'] or None, 'locks': r['lockIds'],
                                 'unlockTotal': r['unlockScore'], 'unlockPhase': phases.get(r['unlockActivityStage'], 1),
                                 'firstClear': level_rewards[t['score']]['count'], '_icon': t['icon']})
        rows = wiki_criteria(pages.get(full + '/Test Criteria'))
        wiki_used = False
        by_name = {r['name'].lower(): r for r in rows}
        for c in criteria:
            r = by_name.get((c['name'] or '').lower())
            has_slots = c['desc'] is not None and '{' in c['desc']
            if r:
                if has_slots:
                    c['desc'], c['descSource'] = r['desc'], 'wiki'
                    wiki_used = True
            elif has_slots:
                c['desc'] = None
            if c['desc'] is None:
                c['descSource'] = None
        for c in criteria:
            saved = os.path.join(CC, 'art', 'tags', f"{c['id']}.webp")
            if art:
                im = art.get(c['_icon'], '/contingencycontract/')
                if im is None:
                    print('MISSING icon', c['_icon'])
                    continue
                save_art(im, saved)
            elif os.path.exists(saved):  # --no-art still matches icons, from the pictures already here
                from PIL import Image
                im = Image.open(saved)
            else:
                continue
            c['_vector'] = icon_vector(im)
        unnamed = [c for c in criteria if c['name'] is None]
        if unnamed and rows:
            found = match_wiki(unnamed, rows, reference, art)
            for c in unnamed:
                if c['id'] in found:
                    r, how = found[c['id']]
                    c['name'], c['desc'], c['descSource'], c['matchedBy'] = r['name'], r['desc'], 'wiki', how
                    wiki_used = True
        reference += [(c["name"], c["_vector"]) for c in criteria if c["name"] and c.get("_vector") and not c.get("matchedBy")]
        for c in criteria:
            del c['_icon']
        cols, n_rows = cfg['tagMaxColumn'], 3

        keys = {}
        for k in sorted({c['key'] for c in criteria if c['key']} | {x for c in criteria for x in c['locks']}):
            row = table('ContingencyContractKeyLockTable')[k]
            keys[k] = {'color': '#' + row['color'], 'keyLabel': text(row['keyName']), 'lockLabel': text(row['lockName'])}

        scene = dungeon['sceneId']
        folder = os.path.join(PERSISTENT, 'SpawnerConfig', scene)
        waves, variants, enemies = [], [], {}

        def enemy(entry):
            eid = entry['enemyId']
            if eid in enemies:
                return
            r = table('EnemyTable')[eid]
            attr = table('EnemyAttributeTemplateTable').get(r['attrTemplateId']) or table('EnemyAttributeTemplateTable')[r['templateId']]
            level = {x['attrType']: x['attrValue'] for x in attr['levelDependentAttributes'][entry['enemyLevel'] - 1]['attrs']}
            shown = table('EnemyDisplayInfoTable').get(eid, {})
            template = table('EnemyTemplateDisplayInfoTable').get(r['templateId'], {})
            bonus = next((b['blackboard'][0]['valueFloat'] for b in entry['bornBuffList'] if b['buffId'] == HP_BONUS_BUFF and b['blackboard']), 0)
            abilities = []
            for aid in shown.get('abilityDescIds') or template.get('abilityDescIds') or []:
                row = table('EnemyAbilityDescTable').get(aid)
                if row:
                    name, desc = plain(text(row['name'])), plain(text(row['description']))
                    if desc:
                        abilities.append(f'{name}: {desc}' if name else desc)
            portrait = f"icons/enemies/{r['templateId']}.webp"
            enemies[eid] = {'name': plain(text(shown.get('name'))) or plain(text(template.get('name'))), 'level': entry['enemyLevel'],
                            'hp': round(level[1]), 'atk': round(level[2]), 'def': round(level[3]), 'hpBonus': bonus,
                            'stagger': attr.get('maxResilience'),
                            'res': {k[:-len('Resistance')]: v for k, v in attr.items() if k.endswith('Resistance')},
                            'abilities': abilities, 'portrait': portrait if os.path.exists(os.path.join(ROOT, portrait)) else None,
                            'desc': plain(text(template.get('description')))}

        for f in sorted(os.listdir(folder)):
            with open(os.path.join(folder, f), encoding='utf-8') as fh:
                data = json.load(fh)['data']
            variant = int(re.search(r'(\d)\.json$', f).group(1))
            lib = {e['key']: e for e in data['enemyLibrary']}
            note = VARIANT_NOTES.get((game_id, variant))
            variants.append({'id': variant, 'note': note, 'inferred': note is not None})
            number = 0
            for w in data['waveMap'].values():
                counts = {}
                for g in w['groupMap'].values():
                    for act in g['actionMap'].values():
                        if act.get('libraryKey') in lib:
                            eid = lib[act['libraryKey']]['enemyId']
                            enemy(lib[act['libraryKey']])
                            counts[eid] = counts.get(eid, 0) + act.get('spawnCount', 1)
                if counts:
                    number += 1
                    waves.append({'variant': variant, 'wave': number, 'enemies': [{'id': k, 'count': v} for k, v in counts.items()]})

        config = table('ActivityConditionalMultiStageTaskConfigTable')[activity_id]['TaskConfigMap']
        groups = table('ActivityContingencyContractTaskGroupTable')
        missions = []
        for t in sorted(config.values(), key=lambda x: x['sortId']):
            missions.append({'id': t['taskId'], 'group': text(groups[t['taskGroupId']]['name']), 'name': plain(text(t['taskName'])), 'desc': plain(text(t['desc'])),
                             'reward': rewards_of(t['rewardId']), 'opens': when(t['unlockTimeId'], 'openTime') if t['unlockTimeId'] else start})
        shop = []
        goods = [g for g in table('ShopGoodsTable').values() if g['goodsId'].startswith(cfg['shopGroupId'] + '_')]
        for g in sorted(goods, key=lambda x: (x['sortId'], x['goodsId'])):
            for r in rewards_of(g['rewardId']):
                shop.append({'id': g['goodsId'], 'item': r['item'], 'count': r['count'], 'price': g['price'], 'limit': g['limitCount'], 'icon': r['icon']})

        achievement = table('AchievementTable')[table('ActivityAchievementDataTable')[activity_id]['achievementId']]
        level = next(iter(achievement['levelInfos'].values()))
        cond = level['conditions'][0]
        plate = achievement.get('plateConditions') or []
        medal = {'name': plain(text(achievement['name'])).strip('"'), 'desc': plain(text(level['completeDesc'])), 'howTo': plain(text(cond['desc'])), 'needs': cond['progressToCompare'],
                 'icon': f'cc/art/medals/{slug}.webp', 'plate': plain(text(plate[0]['desc'])) if plate else None, 'plateIcon': f'cc/art/medals/{slug}-plated.webp' if plate else None}

        by_phase = {}
        for p in sorted({c['unlockPhase'] for c in criteria}):
            by_phase[str(p)] = max_total([c for c in criteria if c['unlockPhase'] <= p])
        keyed = [c for c in criteria if c['key']]
        locked = [c for c in criteria if keyed and keyed[0]['key'] in c['locks']]
        basics = [c for c in criteria if c['unlockTotal'] == 0]
        examples = [[basics[0]['id'], basics[-1]['id']], [basics[0]['id'], keyed[0]['id'], locked[0]['id']]]
        share = {'digits': 'octal', 'bitsPerColumn': 3, 'rowWeights': [1, 2, 4], 'alphabet': ALPHABET, 'length': math.ceil(cols * 3 / 5), 'wrap': '<CODE>',
                 'columns': [{'col': col, 'rows': [grid.get(col, {}).get(r, {}).get('tagId') for r in (1, 2, 3)]} for col in range(1, cols + 1)], 'examples': []}
        for ids in examples:
            code = share_encode(criteria, cols, ids)
            share_check(criteria, cols, ids, code)
            share['examples'].append({'criteria': ids, 'total': sum(c['points'] for c in criteria if c['id'] in ids), 'code': code})

        for c in criteria:
            c.pop('_vector', None)
        stage2 = next((s for s in stage_ids if phases[s['stageId']] == 2), None)
        last = stage_ids[-1]
        row = {'id': slug, 'activityId': activity_id, 'gameId': game_id, 'name': short + ' Experimental Operation', 'shortName': short, 'fullName': full,
               'desc': plain(text(a['desc'])), 'currency': {'name': text(item_of(currency_id)['name']), 'icon': icon_for(currency_id)},
               'start': start, 'batch2': when(stage2['timeId'], 'openTime'), 'end': when(stage2['timeId'], 'closeTime'), 'shopClose': when(last['timeId'], 'closeTime'),
               'art': f'cc/art/{slug}/key.webp', 'banner': f'cc/art/{slug}/banner.webp', 'criteria': len(criteria),
               'complete': all(c['name'] and c['desc'] for c in criteria)}
        index.insert(0, row)
        ib = table('InstructionBook').get(activity_id, {})
        season = {'id': slug, 'rules': plain(text(ib.get('content'))), 'feature': plain(text(dungeon['featureDesc'])), 'stageRules': plain(text(dungeon['dungeonDesc'])),
                  'recommendLv': dungeon['recommendLv'], 'timer': None, 'maxTotal': by_phase[max(by_phase)], 'maxTotalByPhase': by_phase,
                  'ratingBands': cfg['rangeArray'], 'importWarning': cfg['scoreBand'], 'grid': {'cols': cols, 'rows': n_rows}, 'keys': keys, 'criteria': criteria,
                  'variants': variants, 'waves': waves, 'enemies': enemies, 'missions': missions, 'shop': shop, 'medal': medal, 'rewards': rewards_of(a['rewardId'], True),
                  'shareCode': share}
        if wiki_used:
            season = {'attribution': ATTRIBUTION, **season}
        os.makedirs(os.path.join(CC, 'seasons'), exist_ok=True)
        with open(os.path.join(CC, 'seasons', slug + '.json'), 'w', encoding='utf-8', newline='\n') as f:
            json.dump(season, f, ensure_ascii=False, indent=1)
            f.write('\n')
        gaps[slug] = {'noName': [c['id'] for c in criteria if not c['name']], 'noDesc': [c['id'] for c in criteria if not c['desc']],
                      'matched': {k: sum(1 for c in criteria if c.get('matchedBy') == k) for k in ('signature', 'icon')}, 'wikiRows': len(rows), 'maxTotalByPhase': by_phase}
        if art:
            n = activity_id.rsplit('_', 1)[1]
            key = art.get(f'bg_loading_dung_contract_{n}_01')
            push = art.get('bg_push_contingency' + ('_' + str(int(n) + 1) if int(n) else ''))
            if key:
                save_art(key, os.path.join(CC, 'art', slug, 'key.webp'), 1280, lossless=False)
            if push:
                save_art(push, os.path.join(CC, 'art', slug, 'banner.webp'), 1160, lossless=False)
            aid = achievement['achieveId']
            big = art.get(f'{aid}_lv03', 'medaliconbig')
            if big:
                save_art(big, os.path.join(CC, 'art', 'medals', slug + '.webp'), 512)
            plated = art.get(f'{aid}_lv03_plating', 'medaliconbig')
            if plate and plated:
                save_art(plated, os.path.join(CC, 'art', 'medals', slug + '-plated.webp'), 512)

    if art:
        logo = art.get('deco_contingency_07_5')
        points = art.get('icon_contingency_contract_entry')
        save_art(logo, os.path.join(CC, 'art', 'logo.webp'), 512)
        save_art(points, os.path.join(CC, 'art', 'points.webp'))
        for icon in used_items:
            im = art.get(icon, 'itemicon')
            if im is None:
                print('MISSING item icon', icon)
                continue
            save_art(im, os.path.join(CC, 'art', 'items', icon + '.webp'))
    out = {'seasons': index}
    if any(os.path.exists(os.path.join(CC, 'seasons', s['id'] + '.json')) and '"attribution"' in open(os.path.join(CC, 'seasons', s['id'] + '.json'), encoding='utf-8').read(400) for s in index):
        out = {'attribution': {**ATTRIBUTION, 'fetched': datetime.date.today().isoformat()}, **out}
    with open(os.path.join(CC, 'index.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(json.dumps(gaps, indent=1))


main()
