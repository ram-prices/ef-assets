// Snapshots the game's regular free income from the community wiki
// (endfield.wiki.gg) into wiki/income.json: what a player earns without
// events, for ItJustLogs' free pulls per patch.
//
//   node scripts/income.mjs              write wiki/income.json
//   node scripts/income.mjs --dry-run    print a summary, write nothing
//
// - daily: the Operational Manual's Daily section (Activity milestones, every
//   day).
// - weekly: the Weekly Routine's points milestones (every week, from Monday).
// - passes: every Protocol Pass season (the wiki's ProtocolPasses Cargo
//   table) with its Basic Supply (free track) rewards, i.e. item1 of each
//   level, levels 1–60 (the levels past 60 repeat crates, not currency).
//
// Only pull currencies are kept: Oroberyl, Origeometry, Arsenal Tickets and
// HH Permits. Wiki content is CC BY-SA 4.0, so the file carries an
// `attribution` block and the derived data is under the same license.

import { writeFile } from 'node:fs/promises';
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

/** Wikitext of one page (redirects followed). */
async function page(title) {
  const d = await api({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: '1', titles: title });
  const text = d.query.pages[0]?.revisions?.[0]?.slots?.main?.content;
  if (text == null) throw new Error(`no wiki page "${title}"`);
  await sleep(1200);
  return text;
}

const urlOf = (title) => `https://endfield.wiki.gg/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

const CURRENCY = /^(Oroberyl|Origeometry|Arsenal Ticket)$|HH Permit/;

/** Adds every {{I|Item|count}} (and "Item,count" template parameter) of a pull currency in `s` to `into`. */
function add(into, item, count) {
  item = item.trim();
  if (!CURRENCY.test(item) || /selection|designation/i.test(item)) return;
  into[item] = (into[item] ?? 0) + count;
}
function itemsIn(s, into = {}) {
  for (const m of s.matchAll(/\{\{I\|([^|}]+)\|([\d,]+)/g)) add(into, m[1], Number(m[2].replace(/,/g, '')));
  return into;
}

/** The text of the `== name ==` section (up to the next heading of the same or higher level). */
function section(text, name) {
  const m = new RegExp(`^(=+)\\s*${name}\\s*\\1\\s*$`, 'm').exec(text);
  if (!m) throw new Error(`no "${name}" section`);
  const rest = text.slice(m.index + m[0].length);
  const next = new RegExp(`^={1,${m[1].length}}[^=]`, 'm').exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/** The first wikitable in `s` whose text matches `test`. */
function table(s, test) {
  for (const m of s.matchAll(/\{\|[\s\S]*?\n\|\}/g)) if (test.test(m[0])) return m[0];
  throw new Error(`no table matching ${test}`);
}

// Daily: the Operational Manual's Daily section, the table of Activity milestones and rewards.
const manual = await page('Operational Manual');
const daily = itemsIn(table(section(manual, 'Daily'), /Rewards/));

// Weekly: the Weekly Routine's points milestone table.
const routine = await page('Weekly Routine');
const weekly = itemsIn(table(routine, /Points Milestone/));

// Passes: the ProtocolPasses Cargo table (times are UTC), then each season's free track.
const cargo = await api({ action: 'cargoquery', tables: 'ProtocolPasses', fields: '_pageName=page,Version,AsiaStartTime,AsiaEndTime', order_by: 'AsiaStartTime', limit: '100' });
const utc = (s) => (s ? `${s.replace(' ', 'T')}Z` : null);
const passes = [];
for (const { title: row } of cargo.cargoquery) {
  const text = await page(row.page);
  const rewards = {};
  for (const m of text.matchAll(/\{\{PP cell([\s\S]*?)\}\}/g)) {
    const lvl = Number(/\|lvl\s*=\s*(\d+)/.exec(m[1])?.[1]);
    const item = /\|item1\s*=\s*([^,\n]+),\s*([\d,]+)/.exec(m[1]);
    if (lvl >= 1 && lvl <= 60 && item) add(rewards, item[1], Number(item[2].replace(/,/g, '')));
  }
  passes.push({
    name: row.page.replace(/^Protocol Pass:\s*/, ''),
    version: (row.Version ?? '').replace(/\[\[|\]\]/g, '') || null,
    start: utc(row.AsiaStartTime),
    end: utc(row.AsiaEndTime),
    url: urlOf(row.page),
    rewards,
  });
}

if (!daily.Oroberyl || !weekly.Oroberyl || !passes.length) throw new Error('income: a source came back empty; the wiki layout may have changed');

const out = {
  attribution: ATTRIBUTION,
  fetched: new Date().toISOString().slice(0, 10),
  daily: { url: urlOf('Operational Manual') + '#Daily', rewards: daily },
  weekly: { url: urlOf('Weekly Routine'), rewards: weekly },
  passes,
};

const fmt = (r) => Object.entries(r).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing';
console.log(`income: daily ${fmt(daily)}; weekly ${fmt(weekly)}`);
for (const p of passes) console.log(`  pass ${p.name} (${p.start?.slice(0, 10)}): ${fmt(p.rewards)}`);

if (!DRY) {
  await writeFile(join(ROOT, 'wiki', 'income.json'), JSON.stringify(out, null, 1) + '\n');
  console.log('wrote wiki/income.json');
}
