#!/usr/bin/env node
/**
 * The game's story text, from the EndfieldData community dump
 * (git.escartem.moe/Endfield/EndfieldData, made with EndfieldDataDumper):
 * every mission's dialogue in English, with who says each line, the replies
 * the player can pick, and the game's own summary of each scene. Written as
 *
 * - story/index.json: the missions that have dialogue, grouped and ordered
 *   as the wiki's Mission/Main and Mission/Side pages list them (chapter,
 *   process), then the dump's other families (events, outposts...). A
 *   section the wiki doesn't index yet is `unlisted` (possibly unreleased:
 *   spoilers).
 * - story/<mission id>.json: its scenes in order, each with the game's
 *   summary, its lines ({ who, actor, text }: the speaker's name, the
 *   operator's id when it's one; neither for narration) and the replies
 *   offered in the scene (where in the scene isn't in the dump). A line
 *   worded differently for the male Endministrator ("{F}…{M}…" in the
 *   dump) carries that wording as `textM`.
 * - story/search.json: every line as plain text ("Who: text"), by mission
 *   and scene, in the same order as the mission files, for searching the
 *   whole story at once (the site loads it only when someone searches).
 *
 * Text markup becomes the site's (⟦key|…⟧, ⟦num|…⟧; domain/wiki.ts). Lines
 * without English text (not released in English yet) are left out, and a
 * mission with none is skipped. The game text is Gryphline's; this only
 * reads what the dump holds.
 *
 *   node scripts/story.mjs
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DUMP = 'https://git.escartem.moe/Endfield/EndfieldData/raw/branch/master';
const DUMP_PAGE = 'https://git.escartem.moe/Endfield/EndfieldData';
const DUMPER = 'https://git.escartem.moe/Escartem/EndfieldDataDumper';
const WIKI = 'https://endfield.wiki.gg/api.php';
const UA = { 'User-Agent': 'ef-assets story snapshot (github.com/ram-prices/ef-assets; ItJustLogs)' };
const OUT = fileURLToPath(new URL('../story/', import.meta.url));

/** The tables' text ids are 64-bit: kept as their digits, which JSON.parse would round. */
const parse = (text) => JSON.parse(text, (k, v, ctx) => (typeof v === 'number' && !Number.isSafeInteger(v) && ctx?.source ? ctx.source : v));

async function get(url, json = true) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return json ? parse(await r.text()) : r.text();
}
const table = (name) => get(`${DUMP}/TableCfg/${name}.json`);

const [en, dialog, options, summaries, summaryMap, texts] = await Promise.all(
  ['I18nTextTable_EN', 'DialogTextTable', 'DialogOptionTable', 'DialogSummaryTable', 'DialogSummaryMapTable', 'TextTable'].map(table),
);
/** The English text a table entry points at, if any. */
const T = (ref) => (ref && ref.id && ref.id !== 0 && ref.id !== '0' ? (en[String(ref.id)] ?? null) : null);

/** The game's inline markup as the site's. */
const markup = (s) =>
  s
    .replace(/<@(?:qu|gd)\.key>(.*?)<\/>/gs, '⟦key|$1⟧')
    .replace(/<@qu\.(?:num|largenum)(?:up|down)>(.*?)<\/>/gs, '⟦num|$1⟧')
    .replace(/<@[^>]*>(.*?)<\/>/gs, '$1')
    .replace(/<entry=[^>]*>/g, '')
    .replace(/<\/?[a-z@][^>]*>/g, '')
    .replace(/<\/>/g, '')
    .replace(/\{player\}/g, 'Endmin')
    .replace(/\r/g, '')
    .trim();
/** The female Endministrator's wording, and the male one's where it differs ("{F}…{M}…"). */
function versions(s) {
  const f = s.indexOf('{F}');
  const m = s.indexOf('{M}');
  if (f < 0 || m < 0) return [markup(s.replace(/\{[FM]\}/g, ''))];
  const female = markup(s.slice(f + 3, m > f ? m : undefined));
  const male = markup(s.slice(m + 3, f > m ? f : undefined));
  return male === female ? [female] : [female, male];
}
/** A speaker's name without the dump's own tag ("UWST Crew Mate {e1m2_Hammer Crew}"). */
const speaker = (s) => s.replace(/\s*\{[^}]*\}/g, '').trim();

// Mission names: TextTable "<mission id>_name".
const names = {};
for (const [k, v] of Object.entries(texts)) {
  const m = k.match(/^([a-z]+\d[a-z0-9]*)_name$/);
  const name = m && T(v);
  if (name) names[m[1]] = name.trim();
}

// Who speaks: operator ids from wiki/operators.json, by the id's suffix (chr_0004_pelica → pelica) or the name.
const ops = JSON.parse(readFileSync(new URL('../wiki/operators.json', import.meta.url), 'utf8')).operators;
const bySuffix = new Map();
const byName = new Map();
for (const [id, o] of Object.entries(ops)) {
  bySuffix.set(id.split('_').slice(2).join('_'), id);
  byName.set(o.name.toLowerCase(), id);
}
const actorOf = (actorId, who) => bySuffix.get(actorId) ?? (who ? byName.get(who.toLowerCase()) : undefined);

// Every line, by mission and scene: dlg_<mission>_<scene>[<branch>]_<line>.
const LINE = /^dlg_([a-z]+\d[a-z0-9]*?)_(\d+)([a-z]\d+)?_(\d+)$/;
const OPTION = /^option_dlg_([a-z]+\d[a-z0-9]*?)_(\d+)([a-z]\d+)?_(\d+)_(\d+)$/;
const missions = new Map(); // id → Map(sceneKey → { n, branch, lines: [], options: Map(group → []) })
const scene = (mid, n, branch) => {
  let m = missions.get(mid);
  if (!m) missions.set(mid, (m = new Map()));
  const key = `${n}${branch ?? ''}`;
  let s = m.get(key);
  if (!s) m.set(key, (s = { key, n: Number(n), branch: branch ?? '', lines: [], options: new Map() }));
  return s;
};
let dropped = 0;
for (const [k, v] of Object.entries(dialog)) {
  const m = k.match(LINE);
  if (!m) continue;
  const text = T(v.dialogText);
  if (!text) {
    dropped++;
    continue;
  }
  const who = v.actorNameId ? T(v.actorName) : null;
  const [female, male] = versions(text);
  const line = { n: Number(m[4]), text: female, ...(male ? { textM: male } : {}) };
  if (who) {
    line.who = speaker(who);
    const actor = actorOf(v.actorNameId, line.who);
    if (actor) line.actor = actor;
  }
  scene(m[1], m[2], m[3]).lines.push(line);
}
for (const [k, v] of Object.entries(options)) {
  const m = k.match(OPTION);
  const text = m && T(v.optionText);
  if (!text) continue;
  const s = scene(m[1], m[2], m[3]);
  const group = Number(m[4]);
  if (!s.options.has(group)) s.options.set(group, []);
  s.options.get(group).push({ n: Number(m[5]), text: versions(text)[0] });
}

// The wiki's order: Mission/Main (chapter, region, process) and Mission/Side (its headings).
async function wikiText(title) {
  const r = await get(`${WIKI}?${new URLSearchParams({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: title, format: 'json', formatversion: '2' })}`);
  return r.query.pages[0].revisions[0].slots.main.content;
}
function sectionsOf(text) {
  const out = [];
  let chapter = '';
  let region = '';
  let proc = '';
  let procName = '';
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^==([^=]+)==$/))) {
      chapter = m[1].trim();
      region = proc = procName = '';
      current = null;
    } else if ((m = line.match(/^\|\s*region\s*=\s*(.+)$/))) region = m[1].trim();
    else if ((m = line.match(/^\|\s*([IVX]+|\d+)$/))) {
      proc = m[1];
      procName = '';
      current = null;
    } else if ((m = line.match(/^!\s*scope="row"\s*\|\s*(.+)$/))) {
      procName = m[1].trim();
      current = null;
    } else if ((m = line.match(/^#\s*\[\[([^\]|]+)/))) {
      if (!current) {
        const title = [chapter, region, proc && proc !== '0' ? proc : '', procName && procName !== 'N/A' ? procName : ''].filter(Boolean).join(' · ');
        current = { title, missions: [] };
        out.push(current);
      }
      current.missions.push(m[1].trim());
    }
  }
  return out.filter((s) => !/^Navigation/.test(s.title));
}
const [mainText, sideText] = await Promise.all([wikiText('Mission/Main'), wikiText('Mission/Side')]);

// Missions with English dialogue, by name (a name can be several ids: the one with the most lines).
const usable = [...missions].filter(([id, scenes]) => names[id] && [...scenes.values()].some((s) => s.lines.length));
const idsByName = new Map();
for (const [id] of usable) idsByName.set(names[id], [...(idsByName.get(names[id]) ?? []), id]);
const linesOf = (id) => [...missions.get(id).values()].reduce((n, s) => n + s.lines.length, 0);
const pick = (name) => (idsByName.get(name) ?? []).sort((a, b) => linesOf(b) - linesOf(a))[0];
const placed = new Set();
const place = (wikiSections) =>
  wikiSections
    .map((s) => ({ title: s.title, missions: s.missions.map(pick).filter((id) => id && !placed.has(id) && placed.add(id)) }))
    .filter((s) => s.missions.length);
const main = place(sectionsOf(mainText));
const side = place(sectionsOf(sideText));

// The rest by the id's family; ids in their natural order.
const natural = (a, b) => a.localeCompare(b, 'en', { numeric: true });
const family = (id) => id.match(/^[a-z]+/)[0];
const rest = usable.map(([id]) => id).filter((id) => !placed.has(id)).sort(natural);
const of = (...families) => rest.filter((id) => families.includes(family(id)));
const FAMILIES = [
  ['Events', of('a')],
  ['Outposts and development', of('f')],
  ['Other missions', of('gm', 'c', 'db', 'm', 'dm')],
];
const groups = [
  { title: 'Main story', sections: [...main, ...(of('e').length ? [{ title: "Not in the wiki's index yet", unlisted: true, missions: of('e') }] : [])] },
  { title: 'Side missions', sections: [...side, ...(of('sm').length ? [{ title: "Not in the wiki's index yet", unlisted: true, missions: of('sm') }] : [])] },
  ...FAMILIES.filter(([, ids]) => ids.length).map(([title, ids]) => ({ title, sections: [{ title: '', missions: ids }] })),
];
const known = new Set(groups.flatMap((g) => g.sections.flatMap((s) => s.missions)));
const left = rest.filter((id) => !known.has(id));
if (left.length) groups.push({ title: 'Other', sections: [{ title: '', missions: left }] });

// Write.
mkdirSync(OUT, { recursive: true });
const written = new Set(['index.json', 'search.json']);
/** Plain text for searching: the site's markup dropped. */
const plain = (s) => s.replace(/⟦\w+\|([^⟧]*)⟧/g, '$1');
const search = {};
const index = {
  attribution: { source: 'EndfieldData', url: DUMP_PAGE, dumper: DUMPER, fetched: new Date().toISOString().slice(0, 10), note: 'Game text © Gryphline / Hypergryph' },
  groups,
  missions: {},
};
let partial = 0;
for (const id of known) {
  const scenes = [...missions.get(id).values()].sort((a, b) => a.n - b.n || a.branch.localeCompare(b.branch));
  const out = scenes
    .filter((s) => s.lines.length)
    .map((s) => ({
      id: `dlg_${id}_${s.key}`,
      ...(T(summaries[summaryMap[`dlg_${id}_${s.key}`]]) ? { summary: versions(T(summaries[summaryMap[`dlg_${id}_${s.key}`]]))[0] } : {}),
      lines: s.lines.sort((a, b) => a.n - b.n).map(({ n, ...l }) => l),
      ...(s.options.size ? { options: [...s.options].sort((a, b) => a[0] - b[0]).map(([, o]) => o.sort((a, b) => a.n - b.n).map((x) => x.text)) } : {}),
    }));
  const all = Object.keys(dialog).filter((k) => k.startsWith(`dlg_${id}_`) && LINE.test(k)).length;
  const lines = out.reduce((n, s) => n + s.lines.length, 0);
  const isPartial = lines < all;
  if (isPartial) partial++;
  index.missions[id] = { name: names[id], lines, scenes: out.length, ...(isPartial ? { partial: true } : {}) };
  search[id] = out.map((s) => s.lines.map((l) => plain(l.who ? `${l.who}: ${l.text}` : l.text)));
  writeFileSync(`${OUT}${id}.json`, JSON.stringify({ id, name: names[id], ...(isPartial ? { partial: true } : {}), scenes: out }) + '\n');
  written.add(`${id}.json`);
}
writeFileSync(`${OUT}index.json`, JSON.stringify(index, null, 1) + '\n');
writeFileSync(`${OUT}search.json`, JSON.stringify(search) + '\n');
for (const f of readdirSync(OUT)) if (!written.has(f) && existsSync(`${OUT}${f}`)) unlinkSync(`${OUT}${f}`);

const count = (g) => g.sections.reduce((n, s) => n + s.missions.length, 0);
console.log(`story: ${known.size} missions (${groups.map((g) => `${g.title} ${count(g)}`).join(', ')}), ${Object.values(index.missions).reduce((n, m) => n + m.lines, 0)} lines; ${partial} partly in English; ${dropped} lines without English text left out`);
console.log(`unlisted: ${groups.flatMap((g) => g.sections.filter((s) => s.unlisted).flatMap((s) => s.missions.map((id) => names[id]))).join('; ') || 'none'}`);
