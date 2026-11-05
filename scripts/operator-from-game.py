"""Builds a new operator's wiki/operators.json entry from the game's own tables,
for operators the wiki doesn't have numbers for yet.

The wiki fills in a new operator's stats and skills some time after release,
and scripts/update-wiki.mjs skips an operator with no game id. This reads the
same numbers from a dump of the client (the EndfieldDataDump checkout's
output\\Data\\TableCfg) and writes them in the same shape, using the markup
update-wiki.mjs documents. What the tables don't hold (faction, race, birthday,
quote, profile, tags, hobbies...) comes from the operator's wiki page.

    python scripts/operator-from-game.py <EndfieldDataDump> <operator id>...
    python scripts/operator-from-game.py <EndfieldDataDump> --check <operator id>

writes wiki/operators-game.json, which update-wiki.mjs merges into
operators.json until the wiki has the operator (delete the entry then).
--check prints how an operator the wiki already has compares, to test this.
"""
import json
import math
import os
import re
import sys
import urllib.parse
import urllib.request

sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'wiki', 'operators-game.json')
API = 'https://endfield.wiki.gg/api.php'
UA = 'ef-assets wiki snapshot (github.com/ram-prices/ef-assets; ItJustLogs)'

# Game text colours -> the site's markup classes (ba.vup: numbers).
CLASS = {
    'pd': 'phys', 'fire': 'heat', 'cryst': 'cryo', 'pulse': 'elec', 'natural': 'nature',
    'poise': 'stagger', 'vup': 'num', 'vdown': 'num', 'key': 'key', 'info': 'muted',
}
ATTR = {39: 'Strength', 40: 'Agility', 41: 'Intellect', 42: 'Will'}
SKILL_TYPE = {'NormalAttack': 'Basic Attack', 'NormalSkill': 'Battle Skill', 'ComboSkill': 'Combo Skill', 'UltimateSkill': 'Ultimate'}
# SpaceshipSkillTable room types.
FACILITY = {0: 'Control Nexus', 1: 'Manufacturing Cabin', 2: 'Growth Chamber', 5: 'Reception Room'}
LEVELS = [(1, 0), (20, 1), (40, 2), (60, 3), (80, 4), (90, 4)]


def fmt(v):
    """A number as the game prints it: no trailing .0, float noise rounded."""
    r = round(v, 3)
    return str(int(r)) if r == int(r) else str(r)


class Tables:
    def __init__(self, dump):
        self.dir = os.path.join(dump, 'output', 'Data', 'TableCfg')
        self.en = self.load('I18nTextTable_EN')
        self.growth = self.load('CharGrowthTable')
        self.chars = self.load('CharacterTable')
        self.patch = self.load('SkillPatchTable')
        self.effects = self.load('PotentialTalentEffectTable')
        self.potentials = self.load('CharacterPotentialTable')
        self.ship_chars = self.load('SpaceshipCharSkillTable')
        self.ship = self.load('SpaceshipSkillTable')
        self.items = self.load('ItemTable')

    def load(self, name):
        with open(os.path.join(self.dir, name + '.json'), encoding='utf-8') as f:
            return json.load(f)

    def text(self, o):
        return self.en.get(str(o['id']), '') if isinstance(o, dict) else (o or '')


def fill(text, board):
    """Replaces {key:format} with its value; unknown keys stay, for the check."""
    def one(m):
        calc = re.fullmatch(r'1([-+])(\w+)|(\w+)\+1', m.group(1))  # {1-costvalue:0%}, {1+x:0.0}, {x+1:0.0}
        if calc:
            inner = calc.group(2) or calc.group(3)
            if inner not in board:
                return m.group(0)
            value = 1 - board[inner] if calc.group(1) == '-' else 1 + board[inner]
            return fill('{_:' + (m.group(2) or '0') + '}', {'_': value})
        key, form = m.group(1), m.group(2) or '0'
        sign = form.startswith('+')
        form = form.lstrip('+')
        if key not in board and key.lower() in board:
            key = key.lower()
        if key not in board:
            return m.group(0)
        v = board[key]
        if form.endswith('%'):
            decimals = len(form.split('.')[1]) - 1 if '.' in form else 0
            out = f'{v * 100:.{decimals}f}%'
        else:
            decimals = len(form.split('.')[1]) if '.' in form else 0
            out = f'{v:.{decimals}f}'
        return ('+' if sign and v >= 0 else '') + out
    return re.sub(r'\{([A-Za-z_0-9.+-]+)(?::([^}]*))?\}', one, text)


def markup(text):
    def tag(m):
        kind, name, body = m.group(1), m.group(2), m.group(3)
        cls = CLASS.get(name) or ('key' if kind == '#' else None)
        return f'⟪{cls}|{body}⟫' if cls else body
    while True:  # innermost first; a nested highlight keeps only the outer one
        text, n = re.subn(r'<([@#])ba\.([a-z_0-9]+)>([^<]*)</>', tag, text)
        if not n:
            break
    while re.search(r'⟪[^⟪⟫]*⟪', text):
        text = re.sub(r'(⟪[^⟪⟫]*)⟪[a-z]+\|([^⟪⟫]*)⟫', lambda m: m.group(1) + m.group(2), text)
    return text.replace('⟪', '⟦').replace('⟫', '⟧')


def skill_text(desc, board):
    t = markup(fill(desc, board)).replace('\r', '')
    t = re.sub(r'[ \t]+\n', '\n', t.strip())
    t = re.sub(r'\n{2,}', '\n', t)
    # Headed parts: "BASIC ATTACK:\n...", "COMBO TRIGGER: ...\n..."
    heads = re.findall(r'^([A-Z][A-Z ]+):', t, flags=re.M)
    if 'COMBO TRIGGER' in heads:
        first, _, rest = t.partition('\n')
        return f"**COMBO TRIGGER:** {first.split(':', 1)[1].strip()}\n**SKILL DESCRIPTION:** {rest}"
    if heads:
        return re.sub(r'^([A-Z][A-Z ]+):\s*', lambda m: f'**{m.group(1)}:**\n', t, flags=re.M)
    return f'**SKILL DESCRIPTION:** {t}'


def skills(g, t):
    out = []
    for kind, type_name in SKILL_TYPE.items():
        group = next(v for k, v in g['skillGroupMap'].items() if k.endswith(kind))
        bundles = [t.patch[i]['SkillPatchDataBundle'] for i in group['skillIdList'] if i in t.patch]
        board = {}
        for b in bundles:
            for row in b[0]['blackboard']:
                board[row['key']] = row['value']  # the last skill wins: a Final Strike's Stagger
        rows, seen = [], set()
        for b in bundles:
            for i, sub in enumerate(b[0]['subDescDataList']):
                label = t.text(sub['name'])
                if label in seen:
                    continue
                seen.add(label)
                rows.append({'label': label, 'ranks': [x['subDescDataList'][i]['desc'] for x in b]})
        first = bundles[0]
        if kind == 'NormalSkill':
            rows.insert(0, {'label': 'SP Cost', 'ranks': [fmt(x['costValue']) for x in first]})
        elif kind == 'ComboSkill':
            rows.insert(0, {'label': 'Cooldown', 'ranks': [fmt(x['coolDown']) for x in first]})
        elif kind == 'UltimateSkill':
            rows.insert(0, {'label': 'Ultimate Energy Cost', 'ranks': [fmt(x['costValue']) for x in first]})
        out.append({'name': t.text(group['name']), 'type': type_name,
                    'description': skill_text(t.text(group['desc']), board), 'values': rows})
    return out


def effect_board(e):
    board = {}
    for d in e['dataList']:
        for src in (d['attachBuff'], d['attachSkill']):
            for row in src['blackboard']:
                board[row['key']] = row['value']
        m = d['skillBbModifier']
        if m['bbKey']:
            board[m['bbKey']] = m['floatValue']
        a = d['attrModifier']
        if a['attrType'] in ATTR:  # {Str:0}, {Will:0}
            board[ATTR[a['attrType']][:3]] = board[ATTR[a['attrType']]] = a['attrValue']
        elif a['attrType']:  # the only other attribute named so far
            board.setdefault('PhysicalAndSpellInflictionEnhance', a['attrValue'])
        p = d['skillParamModifier']
        if p['skillId']:  # paramType 1: cost, 2: cooldown
            board['costvalue' if p['paramType'] == 1 else 'coolDown'] = p['paramValue']
    return board


def effect_text(e, t):
    return markup(fill(t.text(e['desc']), effect_board(e))).replace('\r', '').strip()


def stats(c):
    rows = c['attributes']

    def at(level, stage):
        return next(r for r in rows if r['breakStage'] == stage and r['Attribute']['attrs'][0]['attrValue'] == level)

    attrs = [{a['attrType']: a['attrValue'] for a in at(l, s)['Attribute']['attrs']} for l, s in LEVELS]
    get = lambda k: [math.floor(a[k] * 1000 + 1e-6) / 1000 for a in attrs]
    return {
        'levels': [{'level': l, 'promotion': s} for l, s in LEVELS],
        'hp': [round(a[1]) for a in attrs], 'atk': [round(a[2]) for a in attrs],
        'strength': get(39), 'agility': get(40), 'intellect': get(41), 'will': get(42),
        'critRate': 0.05, 'attackSpeed': 100,
    }


def talents(g, t):
    nodes = g['talentNodeMap'].values()
    out = []
    attr = sorted((n['attributeNodeInfo'] for n in nodes if n['nodeType'] == 3), key=lambda a: a['breakStage'])
    out.append({'name': t.text(attr[0]['title']), 'levels': [
        {'requires': f"Elite {a['breakStage']}", 'description': t.text(a['desc'])} for a in attr]})
    passive = [n['passiveSkillNodeInfo'] for n in nodes if n['nodeType'] == 4]
    for index in sorted({p['index'] for p in passive}):
        group = sorted((p for p in passive if p['index'] == index), key=lambda p: p['level'])
        out.append({'name': t.text(group[0]['name']), 'levels': [
            {'requires': f"Elite {p['breakStage']}", 'description': effect_text(t.effects[p['talentEffectId']], t)} for p in group]})
    gear = sorted((c for k, c in g['charBreakCostMap'].items() if k.startswith('equipBreak')), key=lambda c: c['breakStage'])
    out.append({'name': 'Outfitting', 'levels': [
        {'requires': f"Elite {c['breakStage']}", 'description': t.text(c['description'])} for c in gear]})
    return out


def promotions(g, t):
    rows = []
    costs = sorted((c for k, c in g['charBreakCostMap'].items() if k.startswith('charBreak')), key=lambda c: c['breakStage'])
    for c in costs:
        rows.append({'stage': c['breakStage'], 'cost': [{'item': t.text(t.items[i['id']]['name']), 'count': i['count']} for i in c['requiredItem']]})
    return rows


def base_skills(cid, t):
    rows = t.ship_chars[cid]['skillList']
    out = []
    for index in sorted({r['skillIndex'] for r in rows}):
        group = [r for r in rows if r['skillIndex'] == index]
        skills_ = [t.ship[r['skillId']] for r in group]
        levels = []
        for s, r in zip(skills_, group):
            hint = t.text(r['unlockHint'])
            levels.append({'grade': t.text(s['name']).split()[-1], 'requires': 'Elite ' + re.search(r'E(\d)', hint).group(1),
                           'description': markup(t.text(s['desc'])).strip()})
        out.append({'name': ' '.join(t.text(skills_[0]['name']).split()[:-1]), 'facility': FACILITY.get(skills_[0].get('roomType'), ''), 'levels': levels})
    return out


def wiki_page(name):
    q = urllib.parse.urlencode({'action': 'parse', 'page': name.replace(' ', '_'), 'prop': 'wikitext', 'format': 'json'})
    req = urllib.request.Request(f'{API}?{q}', headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)['parse']['wikitext']['*']


def infobox(text):
    return {m.group(1): m.group(2).strip() for m in re.finditer(r'^\|(\w+) = ?(.*)$', text, flags=re.M)}


def build(cid, t):
    c, g = t.chars[cid], t.growth[cid]
    name = c['engName']
    page = wiki_page(name)
    box = infobox(page)
    profile = re.search(r'==Profile==\n(.*?)\n==', page, flags=re.S)
    profile = re.sub(r'\n(?=[a-z])', ' ', profile.group(1).strip()) if profile else ''
    tags = [x.strip() for x in box.get('tags', '').split(',') if x.strip()]
    potentials = [{'rank': p['level'], 'name': t.text(p['name']),
                   'description': effect_text(t.effects[p['potentialEffectId']], t)}
                  for p in t.potentials[cid]['potentialUnlockBundle']]
    return {
        'name': name, 'rarity': c['rarity'], 'class': box.get('class'), 'element': box.get('element'),
        'weapon': box.get('weapon'), 'faction': box.get('faction'), 'race': box.get('race'),
        'gender': box.get('gender'), 'birthday': box.get('birthdate'), 'tags': tags,
        'mainAttribute': ATTR[c['mainAttrType']], 'secondaryAttribute': ATTR[c['subAttrType']],
        'headhunting': box.get('headhunting'), 'quote': box.get('quote'), 'profile': profile,
        'expertise': [box[k] for k in ('exp1', 'exp2') if box.get(k)],
        'hobbies': [box[k] for k in ('hb1', 'hb2') if box.get(k)], 'gift': box.get('prefer'),
        'stats': stats(c), 'potentials': potentials, 'promotions': promotions(g, t),
        'skills': skills(g, t), 'talents': talents(g, t), 'baseSkills': base_skills(cid, t),
        'page': 'https://endfield.wiki.gg/wiki/' + name.replace(' ', '_'),
    }


def compare(a, b, path=''):
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            compare(a.get(k), b.get(k), f'{path}.{k}')
    elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        for i, (x, y) in enumerate(zip(a, b)):
            compare(x, y, f'{path}[{i}]')
    elif a != b:
        print(path, '\n   game:', json.dumps(a, ensure_ascii=False)[:260], '\n   wiki:', json.dumps(b, ensure_ascii=False)[:260])


def main():
    args = sys.argv[1:]
    check = '--check' in args
    args = [a for a in args if a != '--check']
    t = Tables(args[0])
    if check:
        wiki = json.load(open(os.path.join(ROOT, 'wiki', 'operators.json'), encoding='utf-8'))
        ops = wiki.get('operators', wiki)
        for cid in args[1:]:
            compare(build(cid, t), ops[cid])
        return
    data = {cid: build(cid, t) for cid in args[1:]}
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print('wrote', ', '.join(data))


if __name__ == '__main__':
    main()
