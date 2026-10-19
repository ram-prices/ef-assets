// Saves what the official New Version Guide says about operators and weapons
// the wiki doesn't have yet (wiki/previews.json), so the site can show them
// before they're released: name, rarity, class, element, weapon type, tags,
// the kit summary and their banner, plus the guide's art (made into icons and
// banners by scripts/guide-art.py). An entry is dropped once wiki/operators.json
// or wiki/weapons.json has it, and kept while the guide moves on to the next
// version, so nothing disappears before the wiki catches up.
//
//   node scripts/guide-previews.mjs [--dry-run]
//
// The guide (endfield.gryphline.com/version_briefing/latest) is a script
// bundle; this reads it as text and runs nothing in it.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const GUIDE = 'https://endfield.gryphline.com/version_briefing/latest';
const UA = { 'User-Agent': 'Mozilla/5.0 (ef-assets preview bot; github.com/ram-prices/ef-assets)' };
const DRY = process.argv.includes('--dry-run');

/** The guide's weapon type codes, named as the wiki names them. */
const WEAPON_TYPE = { 1: 'Sword', 2: 'Arts Unit', 3: 'Great Sword', 5: 'Polearm', 6: 'Handcannon' };

/** A JS string literal's contents, unescaped (\', \xNN, \uNNNN). */
const unescapeJs = (s) =>
  s.replace(/\\(?:x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|(.))/g, (_, x, u, c) => (x || u ? String.fromCharCode(parseInt(x || u, 16)) : c));
const STR = '"((?:[^"\\\\]|\\\\.)*)"';
/** The English text of a localised field: "name":{..."en-us":"Argent Flow"...}. */
const en = (body, field) => {
  const m = body.match(new RegExp(`"${field}":\\{[^{}]*?"en-us":${STR}`));
  return m ? unescapeJs(m[1]) : null;
};
const num = (body, field) => {
  const m = body.match(new RegExp(`"${field}":(\\d+)`));
  return m ? Number(m[1]) : null;
};
/** Guide markup (<@ct.key>...</>) as plain text. */
const plain = (s) => s && s.replace(/<[@/][^>]*>/g, '').replace(/<\/>/g, '').trim();

/** The entries of a top-level list ("characters", "weapons"), each a slice of the bundle. */
function entries(bundle, list, idPrefix) {
  const start = bundle.indexOf(`"${list}":[{"id":"${idPrefix}`);
  if (start < 0) return [];
  const out = [];
  const re = new RegExp(`\\{"id":"(${idPrefix}[^"]+)","gachaPoolId"`, 'g');
  re.lastIndex = start;
  const hits = [];
  for (let m; (m = re.exec(bundle)) && m.index < start + 200000; ) hits.push(m);
  hits.forEach((m, i) => out.push({ id: m[1], body: bundle.slice(m.index, hits[i + 1]?.index ?? m.index + 20000) }));
  return out;
}

const page = await fetch(GUIDE, { headers: UA, signal: AbortSignal.timeout(20000) }).then((r) => r.text());
const script = page.match(/<script[^>]+src="(https:\/\/[^"]+\/_version_briefing\/[^"]+\.js)"/)?.[1];
if (!script) throw new Error('no guide script on the page');
const bundle = await fetch(script, { headers: UA, signal: AbortSignal.timeout(30000) }).then((r) => r.text());
const base = script.slice(0, script.lastIndexOf('/') + 1);
const assets = Object.fromEntries([...bundle.matchAll(/"((?:characters|weapons)\.\d+\.[A-Za-z]+)":\w+\.p\+"(assets\/[^"]+)"/g)].map((m) => [m[1], base + m[2]]));
const asset = (body, kind) => {
  const key = body.match(new RegExp(`"${kind}":\\{[^{}]*"assetKey":"([^"]+)"`))?.[1];
  return key ? assets[key] ?? null : null;
};

const wikiOps = JSON.parse(await readFile(join(ROOT, 'wiki', 'operators.json'), 'utf8')).operators;
const wikiWeps = JSON.parse(await readFile(join(ROOT, 'wiki', 'weapons.json'), 'utf8')).weapons;
let previous = { operators: {}, weapons: {} };
try {
  previous = JSON.parse(await readFile(join(ROOT, 'wiki', 'previews.json'), 'utf8'));
} catch {
  /* first run */
}

const operators = { ...previous.operators };
for (const { id, body } of entries(bundle, 'characters', 'chr_')) {
  operators[id] = {
    name: en(body, 'name'),
    rarity: num(body, 'rarity'),
    class: en(body, 'profession'),
    element: en(body, 'element'),
    weapon: WEAPON_TYPE[num(body, 'weaponTypeCode')] ?? null,
    tags: [...body.matchAll(new RegExp(`\\{"id":"tag_\\d+","name":\\{[^{}]*?"en-us":${STR}`, 'g'))].map((m) => unescapeJs(m[1])),
    summary: plain(en(body, 'highlight')),
    banner: { name: en(body, 'gachaPoolName'), poolId: body.match(/"gachaPoolId":"([^"]+)"/)?.[1] ?? null },
    art: { visual: asset(body, 'visual'), thumbnail: asset(body, 'thumbnail') },
  };
}
const weapons = { ...previous.weapons };
for (const { id, body } of entries(bundle, 'weapons', 'wpn_')) {
  weapons[id] = {
    name: en(body, 'name'),
    rarity: num(body, 'rarity'),
    type: WEAPON_TYPE[num(body, 'weaponTypeCode')] ?? null,
    traits: [...(body.match(/"traits":\[(.*?)\]/)?.[1] ?? '').matchAll(new RegExp(`"en-us":${STR}`, 'g'))].map((m) => unescapeJs(m[1])),
    banner: { name: en(body, 'gachaPoolName'), poolId: body.match(/"gachaPoolId":"([^"]+)"/)?.[1] ?? null },
    art: { visual: asset(body, 'visual'), thumbnail: asset(body, 'thumbnail') },
  };
}
// The wiki takes over once it has them.
for (const id of Object.keys(operators)) if (wikiOps[id]) delete operators[id];
for (const id of Object.keys(weapons)) if (wikiWeps[id]) delete weapons[id];

const out = {
  attribution: { source: 'Arknights: Endfield New Version Guide', url: GUIDE, fetched: new Date().toISOString().slice(0, 10) },
  operators,
  weapons,
};
const json = JSON.stringify(out, null, 1) + '\n';
if (DRY) process.stdout.write(json);
else await writeFile(join(ROOT, 'wiki', 'previews.json'), json);
console.error(`Previews: ${Object.values(operators).map((o) => o.name).join(', ') || 'no operators'}; ${Object.values(weapons).map((w) => w.name).join(', ') || 'no weapons'}`);
