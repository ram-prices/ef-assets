// Snapshots operator, weapon and gear data from the community wiki
// (endfield.wiki.gg) into wiki/operators.json, wiki/weapons.json and
// wiki/gear.json, keyed by game id (chr_..., wpn_..., item_equip_...).
//
//   node scripts/update-wiki.mjs              write the three files
//   node scripts/update-wiki.mjs --dry-run    print a summary, write nothing
//
// Sources (MediaWiki API, no login):
//   Cargo tables Operators, AbilityMatrixUpgrades, Weapons, WeaponSkills,
//     Gears, GearSets, GearStats: names, ids, rarity, class, element, tags,
//     promotion costs, gear stats.
//   Operator and weapon page wikitext: the numbers Cargo doesn't hold. Operator
//     pages' {{Operator data}} has HP/ATK/attributes at 6 levels and the 5
//     potentials, {{Combat skill}} each skill's description and per-rank
//     values (12 ranks), {{Operator talent}} / {{Operator base skill}} the
//     talents and base skills. Weapon pages' {{Weapon data}} has base ATK at 6
//     levels, the potential and tuning costs.
//   Module:Weapon skill/data: every weapon skill's text and its values at
//     ranks 1-9.
// The Cargo Abilities table is skipped: it only covers a handful of skills.
//
// Wiki content is CC BY-SA 4.0, so every file carries an `attribution` block
// and the derived data is under the same license. No images are copied here:
// the site uses ef-assets' own operators/ and arsenals/ art, and gear icons
// come from scripts/gear-icons.py.
//
// Text fields use a small markup instead of HTML so the site can escape them:
//   **bold**    ⟦class|text⟧ (highlight; class is num, key, phys, heat, cryo,
//   elec, nature, stagger, heal, muted or accent)    \n line break.
// Weapon skill text keeps {0}, {1}... placeholders for its `values` columns.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://endfield.wiki.gg/api.php';
const UA = { 'User-Agent': 'ef-assets wiki snapshot (github.com/ram-prices/ef-assets; ItJustLogs)' };
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DRY = process.argv.includes('--dry-run');

const ATTRIBUTION = {
  source: 'endfield.wiki.gg',
  url: 'https://endfield.wiki.gg/',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  note: 'Derived from the Arknights: Endfield Wiki (endfield.wiki.gg) by its contributors. This data is shared under the same license.',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const warnings = [];
const warn = (msg) => warnings.push(msg);

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function api(params) {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ format: 'json', formatversion: '2', ...params })) url.searchParams.set(k, v);
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(`${json.error.code}: ${json.error.info}`);
      return json;
    } catch (e) {
      if (attempt >= 4) throw new Error(`${url}: ${e.message}`);
      await sleep(1500 * attempt);
    }
  }
}

async function cargo(table) {
  const fields = Object.keys((await api({ action: 'cargofields', table })).cargofields);
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const res = await api({
      action: 'cargoquery',
      tables: table,
      fields: ['_pageName=Page', ...fields.map((f) => `${f}=${f}`)].join(','),
      limit: '500',
      offset: String(offset),
    });
    const batch = res.cargoquery.map((r) => r.title);
    rows.push(...batch);
    if (batch.length < 500) return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, decode(String(v ?? ''))])));
  }
}

/** Page title → wikitext, 50 titles per request. */
async function pages(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const res = await api({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: titles.slice(i, i + 50).join('|') });
    for (const p of res.query.pages) if (p.revisions) out.set(p.title, p.revisions[0].slots.main.content);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Wikitext
// ---------------------------------------------------------------------------

function decode(s) {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&ndash;/g, '–').replace(/&amp;/g, '&');
}

/** Index just past the `}}` matching the `{{` at `start`. */
function closeOf(text, start) {
  let depth = 0;
  for (let i = start; i < text.length - 1; i++) {
    if (text[i] === '{' && text[i + 1] === '{') { depth++; i++; }
    else if (text[i] === '}' && text[i + 1] === '}') { depth--; i++; if (depth === 0) return i + 1; }
  }
  return text.length;
}

/** Splits template inner text on `|` outside nested {{ }} and [[ ]]. */
function splitParams(inner) {
  const parts = [];
  let depth = 0, cur = '';
  for (let i = 0; i < inner.length; i++) {
    const two = inner.slice(i, i + 2);
    if (two === '{{' || two === '[[') { depth++; cur += two; i++; continue; }
    if ((two === '}}' || two === ']]') && depth > 0) { depth--; cur += two; i++; continue; }
    if (inner[i] === '|' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += inner[i];
  }
  parts.push(cur);
  return parts;
}

/** One template call → { name, args } with positional args as '1', '2', ... */
function parseCall(call) {
  const [name, ...rest] = splitParams(call.slice(2, -2));
  const args = {};
  let pos = 0;
  for (const part of rest) {
    const eq = part.indexOf('=');
    const before = eq < 0 ? '' : part.slice(0, eq);
    if (eq > 0 && !/[{[<]/.test(before)) args[before.trim()] = part.slice(eq + 1).trim();
    else args[String(++pos)] = part.trim();
  }
  return { name: name.trim().replace(/_/g, ' '), args };
}

/** Every top-level call of template `name` in `text`. */
function templates(text, name) {
  const out = [];
  const want = name.toLowerCase();
  for (let i = text.indexOf('{{'); i >= 0; ) {
    const end = closeOf(text, i);
    const call = parseCall(text.slice(i, end));
    if (call.name.toLowerCase() === want) out.push(call.args);
    i = text.indexOf('{{', end);
  }
  return out;
}

const COLOR_CLASS = {
  '0': 'accent', '1': 'phys', '1a': 'accent', '1b': 'cryo', '1c': 'heal', '1d': 'num', '1e': 'accent',
  '2': 'stagger', '3': 'heat', '4': 'cryo', '5': 'nature', '6': 'elec', '7': 'key', '8': 'stagger', '9': 'muted',
};
const SKILL_TYPES = { 1: 'Basic Attack', 2: 'Battle Skill', 3: 'Combo Skill', 4: 'Ultimate' };

const flat = (s) => s.replace(/⟦\w+\|(.*?)⟧/g, '$1').replace(/\*\*/g, '');
const hl = (cls, s) => {
  const t = flat(s).trim();
  return t ? `⟦${cls}|${t}⟧` : '';
};

/** Wikitext → plain text with the **bold** / ⟦class|text⟧ / \n markup. */
function text(src) {
  if (!src) return '';
  let s = decode(src).replace(/<!--[\s\S]*?-->/g, '');
  // Templates, innermost first.
  for (let guard = 0; guard < 50 && s.includes('{{'); guard++) {
    s = s.replace(/\{\{([^{}]*)\}\}/g, (call) => {
      const { name, args } = parseCall(call);
      const n = name.toLowerCase();
      if (n === 'color') return hl(COLOR_CLASS[args['2'] ?? '1'] ?? 'accent', args['1'] ?? '');
      if (n === 'g') return hl('key', args['2'] || args['1'] || '');
      if (n === 'i') return `${args['1'] ?? ''}${args['2'] ? ` ×${args['2']}` : ''}`;
      if (n === 'sb') return SKILL_TYPES[args['1']] ?? '';
      if (n === 'quote') return `"${args['1'] ?? ''}"`;
      if (n === 'upcoming' || n === 'changelog') return '';
      warn(`unknown template {{${name}}}`);
      return args['2'] ?? args['1'] ?? '';
    });
  }
  return s
    .replace(/\[\[File:[^\]]*\]\]/gi, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+ ([^\]]+)\]/g, '$1')
    .replace(/'''(.*?)'''/g, '**$1**')
    .replace(/''(.*?)''/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<b>([\s\S]*?)<\/b>/gi, (_, b) => `**${flat(b)}**`)
    // Weapon skill data's own colour tags.
    .replace(/<(blue|green|key|grey|stagger)>([\s\S]*?)<\/span>/g, (_, c, t) => hl({ blue: 'num', green: 'heal', key: 'key', grey: 'muted', stagger: 'stagger' }[c], t))
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const list = (s) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const num = (s) => (s === '' || s == null || Number.isNaN(Number(s)) ? null : Number(s));

/** "Protodisk x8, Pink Bolete x3" → [{ item, count }] */
function costs(s) {
  return list(s.replace(/;$/, '')).map((part) => {
    const m = part.match(/^(.*?)\s+x\s*([\d,]+)$/i);
    return m ? { item: m[1].trim(), count: Number(m[2].replace(/,/g, '')) } : { item: part, count: 1 };
  });
}

/** Text between `==Heading==` and the next level-2 heading. */
function section(wikitext, heading) {
  const m = wikitext.match(new RegExp(`^==\\s*${heading}\\s*==\\s*$`, 'm'));
  if (!m) return '';
  const rest = wikitext.slice(m.index + m[0].length);
  const next = rest.search(/^==[^=].*==\s*$/m);
  return next < 0 ? rest : rest.slice(0, next);
}

const LEVELS = [
  { level: 1, promotion: 0 },
  { level: 20, promotion: 1 },
  { level: 40, promotion: 2 },
  { level: 60, promotion: 3 },
  { level: 80, promotion: 4 },
  { level: 90, promotion: 4 },
];

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

function operatorFromPage(row, wikitext) {
  const info = templates(wikitext, 'Operator infobox')[0] ?? {};
  const data = templates(wikitext, 'Operator data')[0];
  const series = (k) => (data?.[k] ? list(data[k]).map(num) : null);

  const stats = data && {
    levels: LEVELS,
    hp: series('HP'),
    atk: series('ATK'),
    strength: series('STR'),
    agility: series('AGL'),
    intellect: series('INT'),
    will: series('WIL'),
    critRate: num(data.CR),
    attackSpeed: num(data.AS),
    range: data.AR || null,
  };

  const potentials = [];
  for (let i = 1; i <= 5; i++) {
    if (data?.[`pot${i}`]) potentials.push({ rank: i, name: text(data[`pot${i}t`]), description: text(data[`pot${i}`]) });
  }

  const promotions = [];
  for (let i = 1; i <= 4; i++) if (data?.[`e${i}`]) promotions.push({ stage: i, cost: costs(data[`e${i}`]) });

  // Some operators switch skill sets (Arcane's stances): the wiki puts each set
  // in a <tabber> tab, "Label=" then the skills, tabs separated by |-|.
  const combat = section(wikitext, 'Combat Skills');
  const tabs = /<tabber>/.test(combat)
    ? combat.replace(/<\/?tabber>/g, '').split(/^\|-\|\s*$/m).map((t) => {
        const m = t.match(/^\s*([^\n{=]+)=\s*\n/);
        return { variant: m ? text(m[1]) : null, body: t };
      })
    : [{ variant: null, body: combat || wikitext }];
  const skills = tabs.flatMap(({ variant, body }) => templates(body, 'Combat skill').map((s) => ({ variant, s }))).map(({ variant, s }) => {
    const values = [];
    for (let i = 1; i <= 20; i++) {
      if (!s[`stat${i}`]) continue;
      const [label, ...v] = s[`stat${i}`].split(/,\s+/);
      values.push({ label: text(label), ranks: v.map((x) => x.trim()) });
    }
    return {
      name: text(s.name),
      type: text(s.type),
      variant: variant ?? undefined,
      description: text(s.desc),
      info: text(s.info) || undefined,
      values,
    };
  });

  const talents = templates(wikitext, 'Operator talent').map((t) => {
    const levels = [];
    for (let i = 1; i <= 6; i++) if (t[`desc${i}`]) levels.push({ requires: text(t[`cond${i}`]), description: text(t[`desc${i}`]) });
    return { name: text(t.name), levels };
  });

  const baseSkills = templates(wikitext, 'Operator base skill').map((b) => {
    const levels = [];
    for (let i = 1; i <= 4; i++) if (b[`desc${i}`]) levels.push({ grade: b[`postfix${i}`] || '', requires: text(b[`cond${i}`]), description: text(b[`desc${i}`]) });
    return { name: text(b.name), facility: text(b.facility), levels };
  });

  const profile = text(section(wikitext, 'Profile'));

  return {
    name: row.Operator,
    rarity: num(row.Rarity),
    class: row.Class,
    element: row.Element,
    weapon: row.Weapon,
    faction: row.Faction || null,
    race: text(info.race) || null,
    gender: row.Gender || null,
    birthday: row.BirthDate || null,
    tags: list(row.Tags),
    mainAttribute: row.MainAttr || null,
    secondaryAttribute: row.SubAttr || null,
    headhunting: row.Headhunting || null,
    quote: text(row.Quote) || null,
    profile: profile || null,
    expertise: [row.Expertise1, row.Expertise2].filter(Boolean),
    hobbies: [row.Hobby1, row.Hobby2].filter(Boolean),
    gift: row.Prefer || null,
    stats,
    potentials,
    promotions,
    skills,
    talents,
    baseSkills,
    page: wikiUrl(row.Page),
  };
}

const wikiUrl = (title) => `https://endfield.wiki.gg/wiki/${encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/')}`;

async function buildOperators() {
  const rows = await cargo('Operators');
  const text_ = await pages([...new Set(rows.map((r) => r.Page))]);
  const out = {};
  for (const row of rows) {
    const wt = text_.get(row.Page);
    if (!row.Id) { warn(`operator ${row.Operator}: no game id on the wiki yet, skipped`); continue; }
    if (!wt) { warn(`operator ${row.Operator}: page missing`); continue; }
    const op = operatorFromPage(row, wt);
    if (!op.stats) warn(`operator ${row.Operator}: no {{Operator data}} (stats/potentials)`);
    if (!op.skills.length) warn(`operator ${row.Operator}: no combat skills`);
    out[row.Id] = op;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

async function weaponSkillData() {
  const src = (await api({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: 'Module:Weapon skill/data' }))
    .query.pages[0].revisions[0].slots.main.content;
  const out = {};
  const line = /^\s*\["([^"]+)"\]\s*=\s*\{text\s*=\s*"((?:[^"\\]|\\.)*)",\s*values\s*=\s*(\{.*\})\s*\},?\s*$/;
  for (const l of src.split('\n')) {
    const m = l.match(line);
    if (!m) continue;
    const values = JSON.parse(m[3].replace(/\{/g, '[').replace(/\}/g, ']'));
    out[m[1]] = { text: text(m[2].replace(/\\"/g, '"')), values: Array.isArray(values[0]) ? values : [values] };
  }
  return out;
}

async function buildWeapons() {
  const [rows, skillRows, skillData] = await Promise.all([cargo('Weapons'), cargo('WeaponSkills'), weaponSkillData()]);
  const skillsOf = new Map(skillRows.map((r) => [r.Page, r]));
  const text_ = await pages([...new Set(rows.map((r) => r.Page))]);
  const out = {};
  for (const row of rows) {
    if (!row.Id) { warn(`weapon ${row.Weapon}: no game id, skipped`); continue; }
    const wt = text_.get(row.Page) ?? '';
    const data = templates(wt, 'Weapon data')[0];
    const desc = templates(wt, 'Item description')[0];
    const sr = skillsOf.get(row.Page);
    const skills = sr
      ? [[sr.Skill1, sr.SkillTag1], [sr.Skill2, sr.SkillTag2], [sr.Skill3, sr.SkillTag3]]
          .filter(([name]) => name)
          .map(([name, tag]) => {
            const d = skillData[name];
            if (!d) warn(`weapon ${row.Weapon}: no data for skill "${name}"`);
            return { name, tag: tag || null, text: d?.text ?? null, values: d?.values ?? [] };
          })
      : [];
    if (!data) warn(`weapon ${row.Weapon}: no {{Weapon data}}`);
    const tuning = [];
    for (let i = 1; i <= 4; i++) {
      if (!data?.[`t${i}`]) continue;
      tuning.push({ stage: i, cost: [...data[`t${i}`].matchAll(/\{\{I\|([^|}]+)\|([\d,]+)\}\}/g)].map((m) => ({ item: m[1].trim(), count: Number(m[2].replace(/,/g, '')) })) });
    }
    out[row.Id] = {
      name: row.Weapon,
      rarity: num(row.Rarity),
      type: row.Type,
      source: text(row.Source) || null,
      description: desc ? [desc['1'], desc['2']].filter(Boolean).map(text) : [],
      stats: data?.BATK ? { levels: LEVELS.map((l) => l.level), baseAtk: list(data.BATK).map(num) } : null,
      potential: data?.pot ? text(data.pot) : null,
      tuning,
      skills,
      page: wikiUrl(row.Page),
    };
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

// ---------------------------------------------------------------------------
// Gear
// ---------------------------------------------------------------------------

async function buildGear() {
  const [gears, stats, sets] = await Promise.all([cargo('Gears'), cargo('GearStats'), cargo('GearSets')]);
  const statsOf = new Map(stats.map((s) => [s.Gear, s]));
  const items = {};
  for (const g of gears) {
    if (!g.Id) continue;
    const s = statsOf.get(g.Gear);
    const stat = (p) => s?.[`${p}Stat`] ? { stat: s[`${p}Stat`], values: [0, 1, 2, 3].map((i) => num(s[`${p}Value${i}`])).filter((v) => v != null) } : null;
    if (!s) warn(`gear ${g.Gear}: no stats row`);
    items[g.Id] = {
      name: g.Gear,
      type: g.Type,
      rarity: num(g.Rarity),
      level: num(g.Level),
      artifice: g.Artifice === '1',
      region: g.Region || null,
      set: s?.SetName || null,
      defense: num(s?.Defense),
      stats: ['P', 'S', 'T'].map(stat).filter(Boolean),
      source: g.Source || null,
      page: wikiUrl(g.Page),
    };
  }
  const setOut = {};
  for (const s of sets) {
    setOut[s.Page] = { name: s.Page, level: num(s.Level), region: text(s.Region) || null, manufacturer: text(s.Manufacturer) || null, effect: text(s.Effect), page: wikiUrl(s.Page) };
  }
  return {
    items: Object.fromEntries(Object.entries(items).sort(([a], [b]) => a.localeCompare(b))),
    sets: Object.fromEntries(Object.entries(setOut).sort(([a], [b]) => a.localeCompare(b))),
  };
}

// ---------------------------------------------------------------------------

const fetched = new Date().toISOString().slice(0, 10);
const wrap = (key, data) => ({ attribution: { ...ATTRIBUTION, fetched }, [key]: data });

const operators = await buildOperators();
const weapons = await buildWeapons();
const gear = await buildGear();

const count = (o) => Object.keys(o).length;
console.log(`operators: ${count(operators)} (${Object.values(operators).filter((o) => o.stats).length} with stats, ${Object.values(operators).filter((o) => o.skills.length).length} with skills)`);
console.log(`weapons:   ${count(weapons)} (${Object.values(weapons).filter((w) => w.stats).length} with stats, ${Object.values(weapons).filter((w) => w.skills.every((s) => s.text)).length} with all skill text)`);
console.log(`gear:      ${count(gear.items)} items, ${count(gear.sets)} sets`);
const uniq = [...new Set(warnings)];
if (uniq.length) console.log(`\n${uniq.length} warnings:\n  ${uniq.join('\n  ')}`);

if (!DRY) {
  const dir = join(ROOT, 'wiki');
  await mkdir(dir, { recursive: true });
  for (const [file, key, data] of [['operators.json', 'operators', operators], ['weapons.json', 'weapons', weapons], ['gear.json', 'gear', gear]]) {
    const path = join(dir, file);
    // Leave unchanged files alone so `fetched` alone never makes a diff.
    const old = existsSync(path) ? JSON.parse(await readFile(path, 'utf8')) : null;
    if (old && JSON.stringify(old[key]) === JSON.stringify(data)) { console.log(`wiki/${file}: unchanged`); continue; }
    await writeFile(path, JSON.stringify(wrap(key, data), null, 1) + '\n');
    console.log(`wiki/${file}: written`);
  }
}
