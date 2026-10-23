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
/** The order of lines and replies from the game's dialogue trees (scripts/dialog-order.mjs, run on an export of the bundles). */
const ORDER_FILE = fileURLToPath(new URL('../dialog/order.json', import.meta.url));
const ORDER = existsSync(ORDER_FILE) ? JSON.parse(readFileSync(ORDER_FILE, 'utf8')).trees : {};

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
// Main story processes the wiki doesn't list yet, kept by hand (same title
// style as the wiki's: chapter · region · process · name), placed after
// their chapter's last process; the wiki's own list takes over once it has them.
const MAIN_EXTRA = [
  { after: 'Chapter 2', title: 'Chapter 2 · Wuling · VIII · Paint with Fresh Ink', missions: ['Freedom of Expansion', 'Enter the Painted World', 'Learn of Rise and Fall', 'Witness the Game Unfold', 'See Through the Self', 'Paint with Fresh Ink'] },
];
const mainWiki = sectionsOf(mainText);
const wikiListed = new Set(mainWiki.flatMap((s) => s.missions));
for (const x of MAIN_EXTRA) {
  const missions = x.missions.filter((name) => !wikiListed.has(name));
  if (!missions.length) continue;
  const last = mainWiki.map((s) => s.title.startsWith(x.after)).lastIndexOf(true);
  mainWiki.splice(last < 0 ? mainWiki.length : last + 1, 0, { title: x.title, missions });
}
const main = place(mainWiki);
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
/**
 * A scene's flow from the dialogue trees, by index: a number is a line (in
 * `lines`), { r: [[reply, Flow], ...] } a choice with what each reply leads
 * to, "back" a return to the last choice, "end" the end of the conversation
 * (in a branch), { v: [Flow, ...], w: [label, ...] }
 * ways the scene goes by a condition (w names them; an empty way: nothing
 * extra). A tree can hold several scenes (a condition picking which plays):
 * each scene takes its part of the tree that has most of its lines, and a
 * condition that only chose between scenes drops out.
 */
const treesOf = new Map(); // scene id → trees with its lines
for (const [tree, flow] of Object.entries(ORDER)) {
  for (const id of JSON.stringify(flow).match(/"dlg_[^"]+_\d+"/g) ?? []) {
    const sid = id.slice(1, -1).replace(/_\d+$/, '');
    if (!treesOf.has(sid)) treesOf.set(sid, new Set());
    treesOf.get(sid).add(tree);
  }
}

/** Objective text by quest id (e1m3_q#52 → "Meet the Endfield operator"), from each mission's runtime data. */
const objectives = new Map();
async function objective(questId) {
  if (objectives.has(questId)) return objectives.get(questId);
  const mission = questId.replace(/_q#.*$/, '');
  let found = null;
  try {
    const m = await get(`${DUMP}/Json/MissionRuntimeAsset/${mission}.json`);
    const textOf = (q) => {
      const key = m?.questDic?.[q]?.objectiveList?.[0]?.description?.key;
      const t = key ? T(texts[key]) : null;
      return t ? versions(t)[0].replace(/<[^>]*>/g, '').replace(/⟦\w+\|([^⟧]*)⟧/g, '$1') : null;
    };
    // A hidden step (no objective text) goes by the step before it that has one.
    let q = questId;
    for (let back = 0; q && back < 4; back++) {
      const t = textOf(q);
      if (t) {
        found = { text: t, before: back > 0 };
        break;
      }
      q = m?.questDic?.[q]?.prevQuestIdList?.[0];
    }
  } catch {
    found = null;
  }
  objectives.set(questId, found);
  return found;
}

/** What a condition's two ways are called. */
async function labels(c, s) {
  const done = (what) => [`Once ${what} is done`, 'Before that'];
  switch (c?.t) {
    // Quest state 3 is the current objective (Wellmorin's shop talk plays only while it's "Buy Tartpepper Seeds from Wellmorin");
    // mission state 3 is done, 2 under way (Innovate to Cultivate: "We can finally catch a breath" / "Let's hope everything goes smoothly").
    case 'CheckQuestState': {
      const o = await objective(c.questId);
      if (c.targetQuestState !== 3) return ['At one point', 'Otherwise'];
      if (!o) return ['At this point in the mission', 'Otherwise'];
      // A hidden step is current right after the step before it.
      return [o.before ? `After “${o.text}”` : `While the objective is “${o.text}”`, 'Otherwise'];
    }
    case 'CheckMissionState': {
      const name = names[c.missionId] ? `“${names[c.missionId]}”` : 'the mission';
      return c.targetMissionState === 3 ? done(name) : [`While ${name} is under way`, 'Otherwise'];
    }
    case 'CheckTalkOptionFinish':
      return ["If you've talked before", 'The first time'];
    case 'CheckOptionSelectedInCurDialog': {
      const m = new RegExp(`^option_${s.sid}_(\\d+)_(\\d+)$`).exec(c.optionId ?? '');
      const text = m ? s.options.get(Number(m[1]))?.find((o) => o.n === Number(m[2]))?.text : null;
      return text ? [`If you picked “${text}”`, 'Otherwise'] : ['Depending on your reply', 'Otherwise'];
    }
    case 'CheckPlayerGender':
    case 'CheckNarrativeGender':
      return ['For one Endministrator', 'For the other'];
    case 'PlayerHasItemInItemBag':
    case 'CheckItemBagCanPutInServer':
      return ['If you have the items', 'Otherwise'];
    default:
      return ['Sometimes', 'Otherwise'];
  }
}

async function flowOf(s, lines) {
  const at = new Map(lines.map((l, i) => [l.n, i]));
  const own = new RegExp(`^${s.sid}_(\\d+)$`);
  const reply = (id) => {
    const m = new RegExp(`^option_${s.sid}_(\\d+)_(\\d+)$`).exec(id);
    return m ? s.options.get(Number(m[1]))?.find((o) => o.n === Number(m[2]))?.text : undefined;
  };
  const has = (steps) => steps.some((x) => typeof x === 'number' || (typeof x === 'object' && x !== null));
  const walk = async (steps) => {
    const out = [];
    for (const x of steps) {
      if (x === 'back' || x === 'end') out.push(x);
      else if (typeof x === 'string') {
        const m = own.exec(x);
        if (m && at.has(Number(m[1]))) out.push(at.get(Number(m[1])));
      } else if (x.r) {
        const r = [];
        for (const [id, then] of x.r) {
          const text = reply(id);
          if (text) r.push([text, await walk(then)]);
          // Another scene's choice: whatever of this scene follows it stays in place.
          else out.push(...(await walk(then)));
        }
        if (r.length) out.push({ r });
      } else {
        const ways = [];
        for (const v of x.v) ways.push(await walk(v));
        const kept = ways.filter(has).length;
        // Ways that were empty to begin with mean "nothing extra" (an "only when" split); ways with
        // only other scenes' lines mean the condition chose the scene: then this scene's way is the scene.
        const trulyEmpty = x.v.some((v) => !v.length);
        if (!kept) continue;
        if (kept === 1 && !trulyEmpty) out.push(...ways.find(has));
        else out.push({ v: ways, w: x.c ? await labels(x.c, s) : ways.map(() => 'Or') });
      }
    }
    return out;
  };
  let best = null;
  let bestCount = -1;
  for (const tree of treesOf.get(s.sid) ?? []) {
    const flow = await walk(ORDER[tree]);
    const count = (JSON.stringify(flow).match(/\d+/g) ?? []).length;
    if (count > bestCount) (best = flow), (bestCount = count);
  }
  return best && best.length ? best : null;
}

// Every scene's flow first (labels may need a mission's runtime data).
const flowByScene = new Map();
for (const id of known)
  for (const s of missions.get(id).values()) {
    if (!s.lines.length) continue;
    const sid = `dlg_${id}_${s.key}`;
    const flow = await flowOf({ ...s, sid }, [...s.lines].sort((a, b) => a.n - b.n));
    if (flow) flowByScene.set(sid, flow);
  }

let partial = 0;
let ordered = 0;
for (const id of known) {
  const scenes = [...missions.get(id).values()].sort((a, b) => a.n - b.n || a.branch.localeCompare(b.branch));
  const out = scenes
    .filter((s) => s.lines.length)
    .map((s) => {
      const sid = `dlg_${id}_${s.key}`;
      const sorted = s.lines.sort((a, b) => a.n - b.n);
      // Where the tree is known, the flow places the replies (options stays for pages that don't read it).
      const flow = flowByScene.get(sid) ?? null;
      if (flow) ordered++;
      return {
        id: sid,
        ...(T(summaries[summaryMap[sid]]) ? { summary: versions(T(summaries[summaryMap[sid]]))[0] } : {}),
        lines: sorted.map(({ n, ...l }) => l),
        ...(s.options.size ? { options: [...s.options].sort((a, b) => a[0] - b[0]).map(([, o]) => o.sort((a, b) => a.n - b.n).map((x) => x.text)) } : {}),
        ...(flow ? { flow } : {}),
      };
    });
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
console.log(`dialogue order: ${ordered} scenes from the game's dialogue trees${Object.keys(ORDER).length ? '' : ' (no dialog/order.json)'}`);
console.log(`unlisted: ${groups.flatMap((g) => g.sections.filter((s) => s.unlisted).flatMap((s) => s.missions.map((id) => names[id]))).join('; ') || 'none'}`);
