// Snapshots the game's regular income from the community wiki
// (endfield.wiki.gg) into wiki/income.json: what a player earns without
// events, for ItJustLogs' pulls per patch.
//
//   node scripts/income.mjs              write wiki/income.json
//   node scripts/income.mjs --dry-run    print a summary, write nothing
//
// - daily: the Operational Manual's Daily section (Activity milestones, every
//   day).
// - weekly: the Weekly Routine's points milestones (every week, from Monday).
// - passes: every Protocol Pass season (the wiki's ProtocolPasses Cargo
//   table) with each tier's rewards, levels 1–60 (the levels past 60 repeat
//   crates, not currency): `rewards` = Basic Supply (free, item1 of each
//   level), `originium` = Originium Supply (item2), `customized` = Protocol
//   Customized (item3).
// - passTiers: what the paid tiers cost (Originium Supply: Origeometry;
//   Protocol Customized: real money, plus Origeometry handed out on purchase),
//   from the Protocol Pass page.
// - monthly: the Monthly Pass (Acquisition Center): its price, Origeometry
//   per purchase, and what it gives every day for 30 days.
// - compensation: what each version's official Version Update Notes hand out
//   in the mail ("· Update & Maintenance Compensation: [Oroberyl]×900",
//   "· Bug Fix Compensation: [Oroberyl]×900"), keyed by the version's name in
//   schedule.json, whose `posts` list each version's notes. This part comes
//   from the official news feed, not the wiki. (The Pre-Download notices
//   repeat the first line, so only the Version Update Notes are read.)
//
// Only pull currencies are kept: Oroberyl, Origeometry, Arsenal Tickets and
// HH Permits. Wiki content is CC BY-SA 4.0, so the file carries an
// `attribution` block and the derived data is under the same license.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const API = 'https://endfield.wiki.gg/api.php';
const UA = { 'User-Agent': 'ef-assets wiki snapshot (github.com/ram-prices/ef-assets; ItJustLogs)' };
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DRY = process.argv.includes('--dry-run');
const TODAY = new Date().toISOString().slice(0, 10);

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
  for (const m of s.matchAll(/\{\{\s*(?:I|Item|Currency)\s*\|([^|}]+)\|([\d,]+)/g)) add(into, m[1], Number(m[2].replace(/,/g, '')));
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

// Paid pass tiers: their cost, from the Protocol Pass page's overview
// ("Originium Supply are unlocked with {{Currency|Origeometry|29}}",
// "Protocol Customized are unlocked with in-game purchase for $9.99. It
// provides an extra 12,500 {{Item|Pass Experience|g=0}} and 20
// {{Item|Origeometry|g=0}} upon purchase").
const passPage = await page('Protocol Pass');
const tierLine = (name) => passPage.split('\n').find((l) => l.includes(name) && /unlock/i.test(l)) ?? '';
const originiumCost = itemsIn(tierLine('Originium Supply'));
const customizedLine = tierLine('Protocol Customized');
const customizedPrice = customizedLine.match(/\$\s?\d+(?:\.\d+)?/)?.[0] ?? null;
const customizedBonus = {};
for (const m of customizedLine.matchAll(/([\d,]+)\s*\{\{\s*(?:I|Item)\|([^|}]+)/g)) add(customizedBonus, m[2], Number(m[1].replace(/,/g, '')));
const passTiers = {
  url: urlOf('Protocol Pass'),
  originium: { cost: originiumCost },
  customized: { price: customizedPrice, onPurchase: customizedBonus },
};

// Monthly Pass: the Acquisition Center's Store cell ("{{I|Origeometry|12|g=0}} per purchase",
// "{{I|Oroberyl|200|g=0}}, ... every day", "|price = 4.99/30 days").
const center = await page('Acquisition Center');
const cell = section(center, 'Monthly Pass');
const perPurchase = itemsIn(cell.split('\n').find((l) => /per purchase/i.test(l)) ?? '');
const perDay = itemsIn(cell.split('\n').find((l) => /every day/i.test(l)) ?? '');
const priceM = cell.match(/\|\s*price\s*=\s*([\d.]+)\s*\/\s*(\d+)\s*days/i);
const monthly = {
  url: urlOf('Acquisition Center') + '#Monthly_Pass',
  price: priceM ? `$${priceM[1]}` : null,
  days: priceM ? Number(priceM[2]) : 30,
  onPurchase: perPurchase,
  daily: perDay,
};

// Passes: the ProtocolPasses Cargo table (times are UTC), then each tier's rewards.
const cargo = await api({ action: 'cargoquery', tables: 'ProtocolPasses', fields: '_pageName=page,Version,AsiaStartTime,AsiaEndTime', order_by: 'AsiaStartTime', limit: '100' });
const utc = (s) => (s ? `${s.replace(' ', 'T')}Z` : null);
const passes = [];
for (const { title: row } of cargo.cargoquery) {
  const text = await page(row.page);
  const tiers = [{}, {}, {}]; // Basic Supply, Originium Supply, Protocol Customized
  for (const m of text.matchAll(/\{\{PP cell([\s\S]*?)\}\}/g)) {
    const lvl = Number(/\|lvl\s*=\s*(\d+)/.exec(m[1])?.[1]);
    if (!(lvl >= 1 && lvl <= 60)) continue;
    tiers.forEach((into, i) => {
      const item = new RegExp(`\\|item${i + 1}\\s*=\\s*([^,\\n]+),\\s*([\\d,]+)`).exec(m[1]);
      if (item) add(into, item[1], Number(item[2].replace(/,/g, '')));
    });
  }
  const [rewards, originium, customized] = tiers;
  passes.push({
    name: row.page.replace(/^Protocol Pass:\s*/, ''),
    version: (row.Version ?? '').replace(/\[\[|\]\]/g, '') || null,
    start: utc(row.AsiaStartTime),
    end: utc(row.AsiaEndTime),
    url: urlOf(row.page),
    rewards,
    originium,
    customized,
  });
}

// Compensation: each version's Version Update Notes, from the official news feed.
const NEWS = 'https://web-news.gryphline.com/api/bulletin';
const NEWS_Q = 'lang=en-us&code=arknights_endfield_official';
const NEWS_UA = { 'User-Agent': 'Mozilla/5.0 (ef-assets income bot; github.com/ram-prices/ef-assets)' };
const schedule = JSON.parse(await readFile(join(ROOT, 'schedule.json'), 'utf8'));
const compensation = {};
for (const v of schedule.versions) {
  for (const cid of v.posts ?? []) {
    const res = await fetch(`${NEWS}/${cid}?${NEWS_Q}`, { headers: NEWS_UA });
    if (!res.ok) throw new Error(`news ${cid}: HTTP ${res.status}`);
    const post = (await res.json()).data;
    await sleep(200);
    if (!/Version Update Notes/i.test(post.title ?? '')) continue;
    const text = String(post.data ?? '')
      .replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&');
    const rows = [];
    for (const line of text.split('\n')) {
      // "· Update & Maintenance Compensation: [Oroberyl]×900" (several items: "[A]×1, [B]×2").
      const m = line.match(/^\s*[·•]\s*([^:：]*Compensation)\s*[:：]\s*(.+)$/i);
      if (!m) continue;
      const rewards = {};
      for (const it of m[2].matchAll(/\[([^\]]+)\]\s*[x×]\s*([\d,]+)/g)) rewards[it[1].trim()] = (rewards[it[1].trim()] ?? 0) + Number(it[2].replace(/,/g, ''));
      if (Object.keys(rewards).length) rows.push({ label: m[1].trim(), rewards });
    }
    if (rows.length) compensation[v.name] = { url: `https://endfield.gryphline.com/en-us/news/${cid}`, rows };
  }
}

if (!Object.keys(compensation).length) throw new Error('income: no compensation found in the version notes; their wording may have changed');
if (!daily.Oroberyl || !weekly.Oroberyl || !passes.length || !originiumCost.Origeometry || !customizedPrice || !monthly.price || !monthly.daily.Oroberyl)
  throw new Error('income: a source came back empty; the wiki layout may have changed');

const out = {
  attribution: { ...ATTRIBUTION, fetched: TODAY },
  fetched: TODAY,
  daily: { url: urlOf('Operational Manual') + '#Daily', rewards: daily },
  weekly: { url: urlOf('Weekly Routine'), rewards: weekly },
  passTiers,
  monthly,
  passes,
  compensation: { source: 'Official Version Update Notes (endfield.gryphline.com news)', versions: compensation },
};

const fmt = (r) => Object.entries(r).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing';
console.log(`income: daily ${fmt(daily)}; weekly ${fmt(weekly)}`);
console.log(`  Originium Supply costs ${fmt(originiumCost)}; Protocol Customized ${customizedPrice}, gives ${fmt(customizedBonus)} on purchase`);
console.log(`  Monthly Pass ${monthly.price}/${monthly.days} days: ${fmt(perPurchase)} per purchase, ${fmt(perDay)} a day`);
for (const [v, c] of Object.entries(compensation)) console.log(`  compensation ${v}: ${c.rows.map((r) => `${r.label} ${fmt(r.rewards)}`).join('; ')}`);
for (const p of passes) console.log(`  pass ${p.name} (${p.start?.slice(0, 10)}): free ${fmt(p.rewards)}; Originium ${fmt(p.originium)}; Customized ${fmt(p.customized)}`);

if (!DRY) {
  await writeFile(join(ROOT, 'wiki', 'income.json'), JSON.stringify(out, null, 1) + '\n');
  console.log('wrote wiki/income.json');
}
