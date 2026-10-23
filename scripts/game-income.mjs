#!/usr/bin/env node
/**
 * Exact pull income from the game's own tables (the EndfieldData community
 * dump, git.escartem.moe/Endfield/EndfieldData), laid over wiki/income.json.
 * Run it after scripts/income.mjs, which writes that file from the wiki.
 *
 * - daily, weekly: the daily activity rewards and the Weekly Routine milestones.
 * - passes: each Protocol Pass season's free and Originium Supply tracks, by name.
 * - quests: each mission's rewards, by name (the wiki still says which version
 *   released it). Missions the wiki doesn't list are reported, not added.
 * - exploration: each area's chests (`reward_eco_<level>_int_*`) and what they
 *   hold, by the level's name in LevelDescTable, as `chests` and `rewards`. A
 *   level whose name starts with an area's (Marker Stone Interiors) joins
 *   that area's version. Valley's Aberrants (Etchspace Salvage) goes in
 *   `oneTime`, split by how many of its zones each version opened
 *   (`ABERRANT_ZONES`; which chest is in which zone isn't in the tables).
 * - progression: the Authority Level and Operational Manual Node rewards.
 *
 * What the tables don't hold stays the wiki's: when things were released,
 * and the odds inside random crates (the pass's Crate-o-Surprise; the game
 * rolls them on its server). Adds `game` to income.json: where the numbers
 * come from and which parts they replaced.
 *
 *   node scripts/game-income.mjs [--dry-run] [--local <dump output folder>]
 *
 * `--local` reads a dump made with EndfieldDataDumper on this computer
 * (`<folder>/Data/TableCfg`, `<folder>/raw/StreamingAssets/JsonData/Data/Json`)
 * instead of fetching EndfieldData.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DUMP = 'https://git.escartem.moe/Endfield/EndfieldData';
const RAW = `${DUMP}/raw/branch/master`;
const API = 'https://git.escartem.moe/api/v1/repos/Endfield/EndfieldData/contents';
const UA = { 'User-Agent': 'ef-assets income snapshot (github.com/ram-prices/ef-assets; ItJustLogs)' };
const FILE = fileURLToPath(new URL('../wiki/income.json', import.meta.url));
const DRY = process.argv.includes('--dry-run');
const LOCAL = process.argv.includes('--local') ? process.argv[process.argv.indexOf('--local') + 1] : null;

/** Zones of Valley's Aberrants each version opened (the wiki's Etchspace Salvage changelog). */
const ABERRANT_ZONES = { Launch: 3, 'Old Deep Water Dies, by Rising Tide It is Denied': 1, 'At the Wake of Spring': 2 };

/** The tables' text ids are 64-bit: kept as their digits, which JSON.parse would round. */
const parse = (text) => JSON.parse(text, (k, v, ctx) => (typeof v === 'number' && !Number.isSafeInteger(v) && ctx?.source ? ctx.source : v));

async function get(url) {
  for (let tries = 0; ; tries++) {
    const r = await fetch(url, { headers: UA });
    if (r.ok) return parse(await r.text());
    if (tries >= 2 || r.status < 500) throw new Error(`${url}: ${r.status}`);
    await new Promise((ok) => setTimeout(ok, 2000 * (tries + 1)));
  }
}
const table = (name) => (LOCAL ? parse(readFileSync(join(LOCAL, 'Data', 'TableCfg', `${name}.json`), 'utf8')) : get(`${RAW}/TableCfg/${name}.json`));

/** Every mission's meta file (`missionId`, `missionType`, `rewardId`). */
async function missionMetas() {
  if (LOCAL) {
    const dir = join(LOCAL, 'raw', 'StreamingAssets', 'JsonData', 'Data', 'Json', 'MissionRuntimeAsset');
    return readdirSync(dir)
      .filter((f) => f.endsWith('_meta.json'))
      .map((f) => parse(readFileSync(join(dir, f), 'utf8')));
  }
  const list = await get(`${API}/Json/MissionRuntimeAsset?ref=master`);
  const files = list.filter((f) => f.name.endsWith('_meta.json'));
  const out = [];
  // A few at a time: it's someone's own server.
  for (let i = 0; i < files.length; i += 6) out.push(...(await Promise.all(files.slice(i, i + 6).map((f) => get(`${RAW}/${f.path}`)))));
  return out;
}

const [rewards, en, texts, levels, seasons, passLevels, daily, weekly, authority, manual] = await Promise.all(
  [
    'RewardTable',
    'I18nTextTable_EN',
    'TextTable',
    'LevelDescTable',
    'BattlePassSeasonTable',
    'BattlePassLevelTable',
    'DailyActivationRewardTable',
    'ActivityWeeklyTaskMileStoneTable',
    'AdventureLevelTable',
    'AdventureBookStageRewardTable',
  ].map(table),
);
const metas = await missionMetas();

/** The English text a table entry points at, if any. */
const T = (ref) => (ref && ref.id && ref.id !== '0' && ref.id !== 0 ? (en[String(ref.id)] ?? null) : null);

/** Pull currencies, by item id, under the names income.json uses. */
const CURRENCY = {
  item_diamond: 'Oroberyl',
  item_originium_recharge: 'Origeometry',
  item_ticketgacha_special_single: 'Chartered HH Permit',
  item_ticketgacha_special_single_1_lt: 'Chartered HH Permit',
  item_ticketgacha_standard_single: 'Basic HH Permit',
  item_gachabyproducts_weapongold: 'Arsenal Ticket',
};

/** The pull currencies some rewards hand out (fixed amounts only). */
function pays(ids, into = {}) {
  for (const id of ids)
    for (const b of rewards[id]?.itemBundles ?? []) {
      const name = CURRENCY[b.id];
      if (name && b.count > 0) into[name] = (into[name] ?? 0) + b.count;
    }
  return into;
}
const same = (a, b) => JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());
const show = (r) => Object.entries(r).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing';

const income = JSON.parse(readFileSync(FILE, 'utf8'));
const report = [];
/** Puts the game's amounts in place, noting what the wiki said when it differs. */
function set(label, obj, key, game) {
  if (!same(obj[key], game)) report.push(`${label}: ${show(obj[key] ?? {})} → ${show(game)}`);
  obj[key] = game;
}

// Daily and weekly.
set('Daily', income.daily, 'rewards', pays(Object.values(daily).map((d) => d.rewardId)));
const routine = weekly.activity_weekly_task_1 ?? Object.values(weekly)[0];
set('Weekly', income.weekly, 'rewards', pays(Object.values(routine.mileStones).map((m) => m.rewardId)));

// Protocol Pass seasons, by name ("Protocol Pass: Awaken" → Awaken).
const tracks = new Map();
for (const s of Object.values(seasons)) {
  const name = T(s.name)?.replace(/^Protocol Pass:\s*/, '').trim();
  const lv = Object.values(passLevels[s.levelGroupId]?.levelInfos ?? {});
  if (name && lv.length) tracks.set(name, { free: pays(lv.map((l) => l.freeRewardId)), originium: pays(lv.map((l) => l.originiumRewardId)) });
}
for (const p of income.passes) {
  const t = tracks.get(p.name);
  if (!t) {
    report.push(`Pass ${p.name}: not in the game tables`);
    continue;
  }
  set(`Pass ${p.name} free`, p, 'rewards', t.free);
  set(`Pass ${p.name} Originium Supply`, p, 'originium', t.originium);
}

// Missions, by name. A name the wiki lists more than once is left as it is.
const norm = (n) =>
  n
    .toLowerCase()
    .replace(/\/mission$|\s*\((?:mission)\)\s*$/i, '')
    .replace(/\[(.*?)\]/g, '($1)')
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
const missions = new Map();
for (const m of metas) {
  const name = T(texts[`${m.missionId}_name`])?.trim();
  const r = pays([m.rewardId ?? '']);
  if (!Object.keys(r).length) continue;
  const k = name ? norm(name) : `#${m.missionId}`;
  missions.set(k, [...(missions.get(k) ?? []), { id: m.missionId, name, rewards: r }]);
}
const listed = new Map();
for (const list of Object.values(income.quests?.versions ?? {})) for (const q of list) listed.set(norm(q.name), (listed.get(norm(q.name)) ?? 0) + 1);
const matched = new Set();
let questsSet = 0;
for (const list of Object.values(income.quests?.versions ?? {}))
  for (const q of list) {
    const k = norm(q.name);
    const found = missions.get(k);
    if (!found || listed.get(k) > 1) continue;
    matched.add(k);
    questsSet++;
    const total = {};
    for (const m of found) for (const [c, n] of Object.entries(m.rewards)) total[c] = (total[c] ?? 0) + n;
    set(`Mission ${q.name}`, q, 'rewards', total);
  }
for (const [k, list] of missions)
  if (!matched.has(k) && !listed.has(k)) for (const m of list) report.push(`Mission not on the wiki's list: ${m.name ?? '(no English name)'} (${m.id}): ${show(m.rewards)}`);

// Exploration: each level's chests, by the level's English name.
const chests = new Map();
for (const id of Object.keys(rewards)) {
  const level = id.match(/^reward_eco_(.+?)_int_\d+$/)?.[1];
  if (!level) continue;
  const r = pays([id]);
  if (!Object.keys(r).length) continue;
  const c = chests.get(level) ?? { chests: 0, rewards: {} };
  c.chests++;
  for (const [k, n] of Object.entries(r)) c.rewards[k] = (c.rewards[k] ?? 0) + n;
  chests.set(level, c);
}
const levelName = (id) => T(levels[id]?.showName)?.trim() ?? id;
const ex = income.exploration;
const areaOf = new Map();
for (const [version, areas] of Object.entries(ex?.versions ?? {})) for (const a of areas) areaOf.set(a.area, { version, area: a });
let aberrants = null;
for (const [level, c] of chests) {
  const name = levelName(level);
  const hit = areaOf.get(name);
  if (hit) {
    if (hit.area.crates && hit.area.crates !== c.chests) report.push(`${name}: ${hit.area.crates} crates on the wiki, ${c.chests} chests with pull currency in the game`);
    hit.area.chests = c.chests;
    hit.area.rewards = c.rewards;
    continue;
  }
  if (name === "Valley's Aberrants") {
    aberrants = { name, ...c };
    continue;
  }
  // An area's interiors: listed after it, in its version.
  const parent = [...areaOf.values()].find((x) => name.startsWith(`${x.area.area} `));
  if (parent) {
    const list = ex.versions[parent.version];
    const at = list.findIndex((a) => a.area === name);
    const entry = { area: name, url: parent.area.url, crates: 0, aurylene: 0, chests: c.chests, rewards: c.rewards };
    if (at >= 0) list[at] = entry;
    else list.splice(list.indexOf(parent.area) + 1, 0, entry);
    continue;
  }
  report.push(`Chests in ${name} (${level}), in no area the wiki lists: ${c.chests}, ${show(c.rewards)}`);
}
for (const { area } of areaOf.values()) if (!area.rewards) report.push(`${area.area}: no chests found in the game tables`);

// Valley's Aberrants: split over the versions that opened its zones.
const ETCH = 'https://endfield.wiki.gg/wiki/Etchspace_Salvage';
income.oneTime ??= { source: '', versions: {} };
for (const list of Object.values(income.oneTime.versions)) for (let i = list.length - 1; i >= 0; i--) if (list[i].game) list.splice(i, 1);
if (aberrants) {
  const zones = Object.values(ABERRANT_ZONES).reduce((a, b) => a + b, 0);
  for (const [version, n] of Object.entries(ABERRANT_ZONES)) {
    const share = (x) => Math.round((x * n) / zones);
    (income.oneTime.versions[version] ??= []).push({
      name: `Valley's Aberrants chests (${n} of ${zones} zones)`,
      section: 'exploration',
      url: ETCH,
      rewards: Object.fromEntries(Object.entries(aberrants.rewards).map(([k, x]) => [k, share(x)])),
      count: share(aberrants.chests),
      estimate: true,
      game: true,
    });
  }
}

// One-time progression rewards there from launch.
const progression = {
  'Authority Level rewards': pays(Object.values(authority).map((a) => a.rewardId).filter(Boolean)),
  'Operational Manual: Node milestones': pays(Object.values(manual).map((s) => s.rewardId)),
};
for (const item of income.progression?.items ?? []) if (progression[item.name]) set(item.name, item, 'rewards', progression[item.name]);

income.game = {
  source: DUMP,
  note: 'Amounts from the game’s own tables (EndfieldData dump); dates and random crate odds from the wiki.',
  exact: ['daily', 'weekly', 'passes', 'quests', 'exploration', 'progression'],
  quests: questsSet,
};

console.log(`Game tables: ${metas.length} missions, ${chests.size} levels with chests, ${tracks.size} pass seasons.`);
console.log(report.length ? report.map((l) => `  ${l}`).join('\n') : '  Nothing differs from the wiki.');
if (!DRY) writeFileSync(FILE, `${JSON.stringify(income, null, 1)}\n`);
