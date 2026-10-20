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
//   Customized (item3). `freeCrates`: the free track's Exchange Crate-o-
//   Surprise [M] boxes and the Oroberyl they average (the crate page's odds).
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
// - quests: permanent missions' one-time rewards (Main, Side and Exploration
//   Missions on the wiki; Event Missions are temporary and left out, and so is
//   any mission that's also a schedule event, which events.json counts),
//   keyed by the version that released them:
//   - Main Missions follow the story (each page's prev/next) and go to the
//     first version whose "Main Missions available up to [Chapter II Process
//     III: ...]" reaches them (official notes; else the wiki version page).
//   - Others: the version whose wiki page lists them under Missions; else the
//     version whose page lists their region under Areas; else Launch.
// - exploration: the areas each version added (its wiki page's Areas) with
//   their storage crate and Aurylene counts (each area's infobox `chest`,
//   `aether`), and a rough Oroberyl per crate: no open source counts crates
//   by type per area, so `perCrate` averages the per-type Oroberyl
//   (`crateOroberyl`) over one region's known mix (`mix`). Hand-kept values,
//   with their sources; replace them with exact per-area counts when known.
//   Each new outpost's level rewards too (`outposts`, its wiki page).
// - modes: what each version's permanent modes hand out anew, from its
//   official notes' "Event & Gameplay Updates" (Echoes of War seasons,
//   Umbral Monument's Monumental Etching, Delver of the Cryptic, Etchspace
//   Salvage zones, Trial of Swordmancy): the amounts the notes give; where
//   they only say "[Oroberyls]", the wiki page of the challenge event they
//   name; else `partial`. Etchspace Salvage's one-time Operation Metrics
//   milestones are split evenly over the versions its wiki changelog says
//   added to them (it doesn't say which milestones), marked `estimate`.
// - Aurylene (exploration.aurylene): each region's TP Point hand-in table
//   (the wiki's Overworld Content page: Origeometry at running totals) and
//   each area's Aurylene count and region; a version gets what its new areas'
//   Aurylene unlocks on top of the region's earlier areas: only the phases
//   the wiki lists; Aurylene past the table's end counts nothing (`partial`)
//   until the wiki lists more.
// - progression: one-time rewards there from launch: the Operational
//   Manual's Node milestones, the Authority Level rewards and the permanent
//   Authority Level Rewards event's milestones (wiki).
// - exploration.crafting: the Crafting Manual's gathering milestones
//   (Oroberyl per milestone, wiki), by the version that added the area the
//   item is gathered in or the enemy that drops it (its "source" text names
//   it; versions' wiki pages list their new areas and enemies); else Launch.
// - shops.aic: the AIC Quota Exchange's banner HH Permits: per version, the
//   ones its official notes name ("Up to [X HH Permit]×5 can be exchanged"),
//   else (older notes don't say) `perBanner` for each Chartered or Special
//   banner, which the wiki says restocks them; and their price in AIC Quota.
// - shops.bond: the Bond Quota Exchange's Chartered HH Permit price and what
//   duplicate 5★ / 6★ operators give (wiki); the site counts the player's own.
// - shops.credit: the Credit Store's daily stock (its free refresh only):
//   Oroberyl or Arsenal Tickets, never both, so half of each a day on average
//   (wiki's Credit Store table and rules).
// - oneTime: one-time rewards by the version that added them, with where the
//   site lists them (`section`): Operational Manual stages' first clears
//   (Basic Training, Simulations with their bonus goal, RE-Crisis, Crisis
//   Drills, Crisis Fragments: each stage page, version by its area or, for
//   RE-Crisis, its story chapter), Yuanyuan Manor Inn milestones, Regional
//   Development levels (wiki; which version raised a region's cap comes from
//   the notes, to what level mostly not: see RD_CAPS), Intel Gathering (200
//   Oroberyl per investigation, GameWith; version by the areas its page
//   names), mail events (the vouchers' average, wiki) and the launch codes.
// - extras: rewards no wiki page or official post lists with amounts,
//   hand-kept from community guides and posts (sources with each): the
//   version preview livestream, the version survey, Combat Drills (per new
//   Chartered Headhunting banner).
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

/** A `== name ==` section, or '' when the page has none. */
function sectionOr(text, name) {
  try {
    return section(text, name);
  } catch {
    return '';
  }
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

// Exchange Crate-o-Surprise [M]: its Oroberyl odds ("5% chance for {{I|Oroberyl|20}}"), averaged.
const crateText = (await texts(['Exchange Crate-o-Surprise (M)'])).get('Exchange Crate-o-Surprise (M)') ?? '';
const crateAverage = [...crateText.matchAll(/([\d.]+)% chance for \{\{I\|Oroberyl\|(\d+)/g)].reduce((a, m) => a + (Number(m[1]) / 100) * Number(m[2]), 0);

// Passes: the ProtocolPasses Cargo table (times are UTC), then each tier's rewards.
const cargo = await api({ action: 'cargoquery', tables: 'ProtocolPasses', fields: '_pageName=page,Version,AsiaStartTime,AsiaEndTime', order_by: 'AsiaStartTime', limit: '100' });
const utc = (s) => (s ? `${s.replace(' ', 'T')}Z` : null);
const passes = [];
for (const { title: row } of cargo.cargoquery) {
  const text = await page(row.page);
  const tiers = [{}, {}, {}]; // Basic Supply, Originium Supply, Protocol Customized
  let crates = 0;
  for (const m of text.matchAll(/\{\{PP cell([\s\S]*?)\}\}/g)) {
    const lvl = Number(/\|lvl\s*=\s*(\d+)/.exec(m[1])?.[1]);
    if (!(lvl >= 1 && lvl <= 60)) continue;
    tiers.forEach((into, i) => {
      const item = new RegExp(`\\|item${i + 1}\\s*=\\s*([^,\\n]+),\\s*([\\d,]+)`).exec(m[1]);
      if (item) add(into, item[1], Number(item[2].replace(/,/g, '')));
      if (i === 0 && item && /^Exchange Crate-o-Surprise \(M\)$/i.test(item[1].trim())) crates += Number(item[2].replace(/,/g, ''));
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
    ...(crates && crateAverage ? { freeCrates: { item: 'Exchange Crate-o-Surprise [M]', count: crates, oroberyl: Math.round(crates * crateAverage * 10) / 10 } } : {}),
  });
}

// Compensation: each version's Version Update Notes, from the official news feed.
const NEWS = 'https://web-news.gryphline.com/api/bulletin';
const NEWS_Q = 'lang=en-us&code=arknights_endfield_official';
const NEWS_UA = { 'User-Agent': 'Mozilla/5.0 (ef-assets income bot; github.com/ram-prices/ef-assets)' };
const schedule = JSON.parse(await readFile(join(ROOT, 'schedule.json'), 'utf8'));
const compensation = {};
/** How far each version's main story goes: "Chapter II Process III: 'Twas One River That Gave Us Drink". */
const storyCap = {};
/** Each version's Version Update Notes as text. */
const notesText = {};
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
    notesText[v.name] = { cid, text };
    const cap = text.match(/available up to \[([^\]]+)\]/i)?.[1];
    if (cap) storyCap[v.name] = cap;
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

// Quests: permanent missions' rewards, by the version that released them.
/** The schedule's first version is the wiki's "Zeroth Directive". */
const WIKI_VERSION = { Launch: 'Zeroth Directive' };
const norm = (n) => n.toLowerCase().replace(/\s*\((?:mission)\)\s*$/i, '').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const ROMAN = { I: 1, V: 5, X: 10 };
const UNICODE_ROMAN = { 'Ⅰ': 'I', 'Ⅱ': 'II', 'Ⅲ': 'III', 'Ⅳ': 'IV', 'Ⅴ': 'V', 'Ⅵ': 'VI', 'Ⅶ': 'VII', 'Ⅷ': 'VIII', 'Ⅸ': 'IX', 'Ⅹ': 'X' };
function roman(s) {
  const r = String(s ?? '').replace(/[Ⅰ-Ⅹ]/g, (c) => UNICODE_ROMAN[c]).trim().toUpperCase();
  if (/^\d+$/.test(r)) return Number(r);
  let n = 0;
  for (let i = 0; i < r.length; i++) n += (ROMAN[r[i]] ?? 0) < (ROMAN[r[i + 1]] ?? 0) ? -ROMAN[r[i]] : ROMAN[r[i]] ?? 0;
  return n;
}
/** "Chapter II Process III: Name" → { chapter, process, name }. */
function parseCap(s) {
  const m = String(s).match(/Chapter\s+([IVXⅠ-Ⅹ\d]+)\s+Process\s+([IVXⅠ-Ⅹ\d]+)\s*:\s*(?:\[\[)?([^\]\n|]+)/i);
  return m ? { chapter: roman(m[1]), process: roman(m[2]), name: m[3].replace(/[\s.]+$/, '').trim() } : null;
}

async function members(cat) {
  const out = [];
  let cont = {};
  for (;;) {
    const d = await api({ action: 'query', list: 'categorymembers', cmtitle: cat, cmlimit: '500', ...cont });
    out.push(...d.query.categorymembers.filter((m) => m.ns === 0).map((m) => m.title));
    if (!d.continue) return out;
    cont = d.continue;
  }
}
/** Wikitext of many pages: Map asked title → text (redirects followed). */
async function texts(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const d = await api({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: '1', titles: titles.slice(i, i + 50).join('|') });
    const back = new Map((d.query.redirects ?? []).map((r) => [r.to, r.from]));
    for (const p of d.query.pages) {
      const text = p.revisions?.[0]?.slots?.main?.content;
      if (text != null) out.set(back.get(p.title) ?? p.title, text);
    }
    await sleep(1200);
  }
  return out;
}

const field = (w, name) => w.match(new RegExp(`\\|\\s*${name}\\s*=\\s*([^\\n|]*)`))?.[1]?.replace(/\}\}$/, '').trim() ?? '';
const eventNames = new Set((schedule.events ?? []).map((e) => norm(e.name)));
const missionTexts = await texts(await members('Category:Missions'));
const all = [];
for (const [title, w] of missionTexts) {
  const type = field(w, 'type');
  if (!/^(Main|Side|Exploration) Mission$/.test(type) || eventNames.has(norm(title))) continue;
  const rewards = {};
  for (const m of w.matchAll(/\|\s*reward\d*\s*=\s*([^,\n|]+),\s*([\d,]+)/g)) add(rewards, m[1], Number(m[2].replace(/,/g, '')));
  all.push({
    name: title,
    type,
    url: urlOf(title),
    rewards,
    region: field(w, 'region').replace(/\[\[|\]\]/g, ''),
    chapter: roman(field(w, 'chapter')),
    process: roman(field(w, 'process')),
    prev: norm(field(w, 'prev')),
    next: ['next', 'next2', 'next3'].map((k) => norm(field(w, k))).filter(Boolean),
  });
}

// The wiki's version pages: their Missions and Areas sections (comments dropped).
const versionText = await texts(schedule.versions.map((v) => WIKI_VERSION[v.name] ?? v.name));
const subsection = (w, name) => w.replace(/<!--[\s\S]*?-->/g, '').match(new RegExp(`===\\s*${name}\\s*===([\\s\\S]*?)(?=\\n==)`))?.[1] ?? '';
const listedIn = new Map(); // mission → version
const regionIn = new Map(); // region → version
for (const v of schedule.versions) {
  const w = versionText.get(WIKI_VERSION[v.name] ?? v.name) ?? '';
  const missionsPart = subsection(w, 'Missions');
  storyCap[v.name] ??= missionsPart.match(/up to[^\n]*?(Chapter[^\n]*)/i)?.[1];
  const names = [
    ...[...missionsPart.matchAll(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g)].map((m) => m[1]),
    ...[...missionsPart.matchAll(/^\*\*\s*([^\n*[]+?)\s*$/gm)].map((m) => m[1]),
  ];
  for (const n of names) if (!listedIn.has(norm(n))) listedIn.set(norm(n), v.name);
  for (const m of subsection(w, 'Areas').matchAll(/\[\[([^\]|#]+)/g)) if (!regionIn.has(norm(m[1]))) regionIn.set(norm(m[1]), v.name);
}

// Main Missions in story order: by chapter and process; within a process, along
// the prev/next chain (walked from each mission no other mission leads to).
const mains = all.filter((m) => m.type === 'Main Mission');
const byName = new Map(mains.map((m) => [norm(m.name), m]));
const chain = new Map();
const walk = (m) => {
  if (!m || chain.has(m)) return;
  chain.set(m, chain.size);
  for (const n of m.next) walk(byName.get(n));
};
const byStory = (a, b) => a.chapter - b.chapter || a.process - b.process;
for (const m of [...mains].sort(byStory)) if (!byName.has(m.prev)) walk(m);
for (const m of [...mains].sort(byStory)) walk(m);
const order = [...mains].sort((a, b) => byStory(a, b) || chain.get(a) - chain.get(b));

// Each version's cap as a place in that order; a mission goes to the first version reaching it.
const caps = [];
for (const v of schedule.versions) {
  const cap = storyCap[v.name] && parseCap(storyCap[v.name]);
  if (!cap) continue;
  let at = order.findIndex((m) => norm(m.name) === norm(cap.name));
  if (at < 0) at = order.reduce((last, m, i) => (m.chapter < cap.chapter || (m.chapter === cap.chapter && m.process <= cap.process) ? i : last), -1);
  caps.push({ version: v.name, at, cap: `Chapter ${cap.chapter} Process ${cap.process}: ${cap.name}` });
}
const quests = Object.fromEntries(schedule.versions.map((v) => [v.name, []]));
const unplaced = [];
order.forEach((m, i) => {
  const v = caps.find((c) => c.at >= i)?.version;
  if (v) quests[v].push({ ...m, how: 'story' });
  else unplaced.push(m.name);
});
for (const m of all.filter((m) => m.type !== 'Main Mission')) {
  const listed = listedIn.get(norm(m.name));
  const region = regionIn.get(norm(m.region));
  quests[listed ?? region ?? schedule.versions[0].name].push({ ...m, how: listed ? 'listed' : region ? 'region' : 'launch' });
}
// Exploration: each version's new areas and their crate counts.
/** Oroberyl per storage crate type (GameWith, "Oroberyl Yield per Crate Rarity", Mar 30, 2026). */
const CRATE_OROBERYL = { white: 15, blue: 30, yellow: 60, locked: 100, gold: 150 };
/** Wuling's crates by type (Gamer Guides' Wuling map, Oct 2026; Gear Template crates left out: the wiki counts them apart). */
const CRATE_MIX = { white: 61, blue: 45, yellow: 27, gold: 1, locked: 21 };
const mixCount = Object.values(CRATE_MIX).reduce((a, b) => a + b, 0);
const perCrate = Object.entries(CRATE_MIX).reduce((a, [k, n]) => a + n * CRATE_OROBERYL[k], 0) / mixCount;
const areaLinks = new Map(); // area → version
for (const v of schedule.versions) {
  const w = versionText.get(WIKI_VERSION[v.name] ?? v.name) ?? '';
  for (const m of subsection(w, 'Areas').matchAll(/\[\[([^\]|#]+)/g)) if (!areaLinks.has(m[1].trim())) areaLinks.set(m[1].trim(), v.name);
}
const isArea = (w) => /\{\{\s*Location infobox/i.test(w ?? '');
const areaText = await texts([...areaLinks.keys()]);
// A link may land on a namesake (Qingbo Stockade the faction): try "<name> (location)".
const others = [...areaLinks.keys()].filter((a) => !isArea(areaText.get(a)));
for (const [t, w] of await texts(others.map((a) => `${a} (location)`))) areaText.set(t, w);
const areas = Object.fromEntries(schedule.versions.map((v) => [v.name, []]));
for (const [area, v] of areaLinks) {
  const page = isArea(areaText.get(area)) ? area : `${area} (location)`;
  const w = areaText.get(page);
  if (!isArea(w)) continue;
  const crates = Number(field(w, 'chest')) || 0;
  const aurylene = Number(field(w, 'aether')) || 0;
  const region = field(w, 'part').replace(/\[\[|\]\]/g, '');
  if (crates || aurylene) areas[v].push({ area, url: urlOf(page), region, crates, aurylene }); // regions and outposts count nothing of their own
}
// Outposts the versions added: their level rewards.
const outposts = Object.fromEntries(schedule.versions.map((v) => [v.name, []]));
for (const [area, v] of areaLinks) {
  const w = areaText.get(area) ?? '';
  if (!/Outpost Prosperity Level/i.test(w)) continue;
  const rewards = itemsIn(w);
  if (Object.keys(rewards).length) outposts[v].push({ outpost: area, url: urlOf(area), rewards });
}

// Aurylene: each region's TP Point table (phase, count, running total, rewards).
const overworld = (await texts(['Overworld Content'])).get('Overworld Content') ?? '';
const tpPoint = sectionOr(overworld, 'TP Point');
const tables = {};
for (const m of tpPoint.matchAll(/^===\s*([^=\n]+?)\s*===\s*$([\s\S]*?)(?=^===|$(?![\s\S]))/gm)) {
  const rows = [];
  for (const r of m[2].matchAll(/^\|\s*\d+\s*\|\|\s*\d+\s*\|\|\s*(\d+)\s*\|\|(.*)$/gm)) rows.push({ total: Number(r[1]), rewards: itemsIn(r[2]) });
  if (rows.length) tables[m[1].trim()] = rows;
}
/** What handing in `n` Aurylene in a region pays in all: every phase the wiki lists up to `n`. */
const paidAt = (region, n) => {
  const out = {};
  for (const r of tables[region] ?? []) if (r.total <= n) for (const [k, c] of Object.entries(r.rewards)) out[k] = (out[k] ?? 0) + c;
  return out;
};
const aurylene = Object.fromEntries(schedule.versions.map((v) => [v.name, { rewards: {} }]));
const sofar = {};
for (const v of schedule.versions) {
  for (const a of areas[v.name]) {
    if (!a.aurylene || !tables[a.region]) continue;
    const before = paidAt(a.region, sofar[a.region] ?? 0);
    sofar[a.region] = (sofar[a.region] ?? 0) + a.aurylene;
    const end = tables[a.region].at(-1)?.total ?? 0;
    if (sofar[a.region] > end) aurylene[v.name].partial = `${a.region}'s table on the wiki ends at ${end} Aurylene; its areas so far have ${sofar[a.region]}`;
    for (const [k, c] of Object.entries(paidAt(a.region, sofar[a.region]))) {
      const d = c - (before[k] ?? 0);
      if (d) aurylene[v.name].rewards[k] = (aurylene[v.name].rewards[k] ?? 0) + d;
    }
  }
}

// Crafting Manual: each gathered item's milestones; the area its source names gives the version.
const crafting = Object.fromEntries(schedule.versions.map((v) => [v.name, { rewards: {}, items: 0 }]));
const craftText = (await texts(['Crafting/Crafting Manual'])).get('Crafting/Crafting Manual') ?? '';
const areaNames = [...areaLinks.keys()].sort((a, b) => b.length - a.length);
// Each version's new enemies (its wiki page's Enemies section: links and "|elite = A; B" lists).
const enemyIn = new Map();
for (const v of schedule.versions) {
  const part = subsection(versionText.get(WIKI_VERSION[v.name] ?? v.name) ?? '', 'Enemies');
  const names = [
    ...[...part.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1]),
    ...[...part.matchAll(/^\|\s*\w+\s*=\s*([^\n]+)$/gm)].flatMap((m) => m[1].split(/;\s*/)),
  ];
  for (const n of names) if (n.trim() && !enemyIn.has(norm(n))) enemyIn.set(norm(n), v.name);
}
let craftRegion = null;
for (const part of craftText.split(/^(===[^=\n]+===)\s*$/m)) {
  const head = part.match(/^===\s*([^=]+?)\s*===$/);
  if (head) {
    craftRegion = head[1];
    continue;
  }
  for (const m of part.matchAll(/\{\{Crafting milestone([\s\S]*?)\n\}\}/g)) {
    const rewards = {};
    for (const it of m[1].matchAll(/\|item\d+\s*=\s*([^,\n]+),\s*([\d,]+)/g)) add(rewards, it[1], Number(it[2].replace(/,/g, '')));
    if (!Object.keys(rewards).length) continue;
    const source = m[1].match(/\|source\s*=\s*([^\n]*)/)?.[1] ?? '';
    const area = areaNames.find((a) => source.includes(a)) ?? (craftRegion && areaLinks.has(craftRegion) ? craftRegion : null);
    // "Chance drop: [[Rockhowler]]": the version that added the enemy.
    const enemy = [...source.matchAll(/\[\[([^\]|#]+)/g)].map((x) => enemyIn.get(norm(x[1]))).find(Boolean);
    const v = enemy ?? (area && areaLinks.get(area)) ?? schedule.versions[0].name;
    for (const [k, n] of Object.entries(rewards)) crafting[v].rewards[k] = (crafting[v].rewards[k] ?? 0) + n;
    crafting[v].items++;
  }
}

// Progression: the Operational Manual's Node milestones, the Authority Level rewards and the permanent
// "Authority Level Rewards" event (Event Center milestones), one time, from launch.
const authorityPages = await texts(['Authority Level', 'Authority Level Rewards']);
const authority = authorityPages.get('Authority Level') ?? '';
const progression = {
  version: schedule.versions[0].name,
  items: [
    { name: 'Operational Manual: Node milestones', url: urlOf('Operational Manual') + '#Node', rewards: itemsIn(sectionOr(manual, 'Node')) },
    { name: 'Authority Level rewards', url: urlOf('Authority Level'), rewards: itemsIn(sectionOr(authority, 'Reward')) },
    { name: 'Authority Level Rewards event', url: urlOf('Authority Level Rewards'), rewards: itemsIn(sectionOr(authorityPages.get('Authority Level Rewards') ?? '', 'Missions')) },
  ].filter((x) => Object.keys(x.rewards).length),
};

// One-time rewards, by the version that added them. `section` is where the site lists them.
const oneTime = Object.fromEntries(schedule.versions.map((v) => [v.name, []]));
const launch = schedule.versions[0].name;
const vIndex = (v) => schedule.versions.findIndex((x) => x.name === v);
const later = (...vs) => vs.filter(Boolean).sort((a, b) => vIndex(b) - vIndex(a))[0] ?? null;
const byPlace = new Map([...areaLinks].map(([a, v]) => [norm(a.replace(/\s*\(location\)$/i, '')), v]));
for (const [r, v] of regionIn) if (!byPlace.has(r)) byPlace.set(r, v);
/** "[[Wuling City]]", "Valley IV": the version that added that area or region. */
const placeVersion = (s) => byPlace.get(norm(String(s ?? '').replace(/\[\[|\]\]/g, '').split('|')[0].replace(/\s*\(location\)$/i, ''))) ?? null;
/** "Chapter II: Process VIII" in a page's text: the first version whose main story reaches it. */
const storyVersion = (text) => {
  const m = String(text ?? '').match(/Chapter\s+([IVXⅠ-Ⅹ\d]+):?\s+Process\s+([IVXⅠ-Ⅹ\d]+)/i);
  if (!m) return null;
  const [c, p] = [roman(m[1]), roman(m[2])];
  return caps.find((x) => {
    const cap = parseCap(x.cap);
    return cap && (cap.chapter > c || (cap.chapter === c && cap.process >= p));
  })?.version ?? null;
};
const addOneTime = (version, item) => {
  const list = oneTime[version ?? launch];
  const same = list.find((x) => x.name === item.name && x.section === item.section);
  if (!same) return list.push({ count: 1, ...item });
  same.count += item.count ?? 1;
  for (const [k, n] of Object.entries(item.rewards)) same.rewards[k] = (same.rewards[k] ?? 0) + n;
  if (item.estimate) same.estimate = true;
};

// Operational Manual stages: each stage page's first clear (and Simulations' bonus goal), once.
// Version: the area its page names (location or region); RE-Crisis: where the story unlocks it.
const STAGES = {
  'Basic Training': { name: 'Basic Training', anchor: 'Training' },
  Simulation: { name: 'Simulations', anchor: 'Simulation' },
  'RE-Crisis': { name: 'RE-Crisis', anchor: 'RE-Crisis' },
  'Crisis Drills': { name: 'Crisis Drills', anchor: 'Crisis_Drills' },
  'Crisis Fragment': { name: 'Crisis Fragments', anchor: 'Crisis_Fragment' },
};
const guideTitles = [];
for (let cont = {}; ; ) {
  const d = await api({ action: 'query', list: 'embeddedin', eititle: 'Template:Guide', einamespace: '0', eilimit: '500', ...cont });
  guideTitles.push(...d.query.embeddedin.map((p) => p.title));
  if (!d.continue) break;
  cont = d.continue;
}
const guideText = await texts(guideTitles);
const bosses = [...new Set([...guideText].filter(([, w]) => field(w, 'type') === 'RE-Crisis').map(([t]) => `RE-Crisis: ${t.split(': ').slice(1).join(': ')}`))];
const bossText = await texts(bosses);
let stageCount = 0;
for (const [title, w] of guideText) {
  const type = w.slice(w.search(/\{\{Guide\s*\n/)).match(/\|\s*type\s*=\s*([^\n|]*)/)?.[1]?.trim();
  const stage = STAGES[type];
  if (!stage) continue;
  const rewards = {};
  for (const k of ['first', 'bonus']) itemsIn(w.match(new RegExp(`\\|\\s*${k}\\s*=([^\\n]*)`))?.[1] ?? '', rewards);
  if (!Object.keys(rewards).length) continue;
  const place = placeVersion(field(w, 'location')) ?? placeVersion(field(w, 'region'));
  const story = type === 'RE-Crisis' ? storyVersion(bossText.get(`RE-Crisis: ${title.split(': ').slice(1).join(': ')}`)) : null;
  addOneTime(later(place, story), { name: stage.name, section: 'modes', url: urlOf('Operational Manual') + '#' + stage.anchor, rewards });
  stageCount++;
}

// Yuanyuan Manor Inn: its milestone rewards, by the story chapter that unlocks it.
const innText = (await texts(['Yuanyuan Manor Inn'])).get('Yuanyuan Manor Inn') ?? '';
const innRewards = itemsIn(sectionOr(innText, 'Inn Milestone Phase'));
if (Object.keys(innRewards).length) {
  // Unlocked by a side mission after a main mission its page names; else its region.
  addOneTime(later(storyVersion(innText), placeVersion(field(innText, 'region'))), { name: 'Yuanyuan Manor Inn milestones', section: 'modes', url: urlOf('Yuanyuan Manor Inn'), rewards: innRewards });
}

// Regional Development: each level's rewards (wiki). The notes say when a region's level cap rose, not
// to what: levels up to a known cap go to that version; the rest are split evenly over the later raises.
/** Known caps (hand-kept): Wuling reached level 9 in 1.1 (Icy Veins); its launch cap of 6 is our guess. */
const RD_CAPS = { Wuling: { [launch]: 6, [schedule.versions[1].name]: 9 } };
const RD_SOURCES = ['https://www.icy-veins.com/arknights-endfield/how-to-reach-wulings-level-9-regional-development-in-arknights-endfield'];
const rdText = (await texts(['Regional Development'])).get('Regional Development') ?? '';
const rdLevels = {};
for (const m of rdText.matchAll(/\{\{Regional Development Metric level\|(\d+)\|([^|\n]+)\|[^\n]*\n\|items\s*=\s*([^\n]*)/g)) {
  const rewards = {};
  for (const it of m[3].matchAll(/([^,:]+):\s*([\d,]+)/g)) add(rewards, it[1], Number(it[2].replace(/,/g, '')));
  (rdLevels[m[2].trim()] ??= []).push({ level: Number(m[1]), rewards });
}
const REGION_PAGE = { Valley: 'Valley IV', Wuling: 'Wuling' };
for (const [region, levels] of Object.entries(rdLevels)) {
  const known = RD_CAPS[region] ?? {};
  const raised = schedule.versions
    .filter((v) => new RegExp(`Regional Development Level cap for (?:the )?\\[${region}`, 'i').test(notesText[v.name]?.text ?? ''))
    .map((v) => v.name);
  const top = Math.max(...levels.map((l) => l.level));
  // Each version's cap: known ones, then the remaining levels split evenly over later raises.
  const capOf = { ...known };
  const lastKnown = Object.keys(known).sort((a, b) => vIndex(b) - vIndex(a))[0];
  const rest = raised.filter((v) => !lastKnown || vIndex(v) > vIndex(lastKnown));
  let from = lastKnown ? known[lastKnown] : top;
  if (!lastKnown) capOf[launch] = top;
  rest.forEach((v, i) => {
    from += Math.ceil((top - from) / (rest.length - i));
    capOf[v] = from;
  });
  const capVersions = Object.keys(capOf).sort((a, b) => vIndex(a) - vIndex(b));
  for (const l of levels) {
    const v = capVersions.find((x) => capOf[x] >= l.level) ?? capVersions.at(-1);
    const guessed = v !== schedule.versions[1].name; // only 1.1's cap has a source
    addOneTime(v, {
      name: `Regional Development: ${REGION_PAGE[region] ?? region}`,
      section: 'exploration',
      url: urlOf('Regional Development'),
      rewards: l.rewards,
      ...(region in RD_CAPS && guessed ? { estimate: true } : {}),
    });
  }
}

// Intel Gathering: each investigation pays 200 Oroberyl (GameWith); by the latest area its page names.
const INTEL_OROBERYL = 200;
const intelList = [...(sectionOr((await texts(['Intel Gathering'])).get('Intel Gathering') ?? '', 'List of Intel Gathering')).matchAll(/\[\[([^\]|]+)/g)].map((m) => m[1]).filter((t) => !/^Category:/i.test(t));
const intelText = await texts(intelList);
for (const t of intelList) {
  const w = intelText.get(t) ?? '';
  const v = later(...[...byPlace.keys()].filter((p) => p.length > 3 && norm(w).includes(p)).map((p) => byPlace.get(p)));
  addOneTime(v, { name: 'Intel Gathering', section: 'exploration', url: urlOf('Intel Gathering'), rewards: { Oroberyl: INTEL_OROBERYL } });
}

// Mail events (the wiki's Event table, type "mail"): their reward vouchers, at the average of what each
// voucher holds, times the days it's sent ("on the first, second and seventh day").
const eventsFile = JSON.parse(await readFile(join(ROOT, 'wiki', 'events.json'), 'utf8'));
const counted = new Set(Object.values(eventsFile.extra ?? {}).map((e) => e.page));
const mailRows = (await api({ action: 'cargoquery', tables: 'Events', fields: '_pageName=page,Type', where: 'Type="mail"', limit: '50' })).cargoquery.map((r) => r.title.page);
const ORDINAL = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth)\b/gi;
const wikiVersion = Object.fromEntries(schedule.versions.map((v) => [WIKI_VERSION[v.name] ?? v.name, v.name]));
for (const [page, w] of await texts(mailRows.filter((p) => !counted.has(p)))) {
  const rewards = {};
  const vouchers = [...new Set([...sectionOr(w, 'Mail').matchAll(/\{\{I\|([^|}]+)\|\d+/g)].map((m) => m[1].trim()))];
  const voucherText = await texts(vouchers);
  for (const [name, iw] of voucherText) {
    const options = [...sectionOr(iw, 'Usage').matchAll(/\{\{I\|Oroberyl\|(\d+)/g)].map((m) => Number(m[1]));
    const days = (sectionOr(iw, 'Acquisition').match(ORDINAL) ?? []).length;
    if (options.length && days) add(rewards, 'Oroberyl', Math.round((options.reduce((a, b) => a + b, 0) / options.length) * days));
  }
  itemsIn(sectionOr(w, 'Mail'), rewards);
  const v = wikiVersion[field(w, 'version').replace(/\[\[|\]\]/g, '')] ?? launch;
  if (Object.keys(rewards).length) addOneTime(v, { name: page, section: 'mailbox', url: urlOf(page), rewards, estimate: true });
}

// Launch codes (hand-kept; expired): ALLFIELD and RETURNOFALL (KeenGamer), ENDFIELDGIFT (GameWith).
const LAUNCH_CODES = { ALLFIELD: 1500, RETURNOFALL: 500, ENDFIELDGIFT: 150 };
addOneTime(launch, {
  name: 'Launch codes',
  section: 'mailbox',
  url: 'https://www.keengamer.com/articles/guides/arknights-endfield-all-codes-how-to-redeem/',
  rewards: { Oroberyl: Object.values(LAUNCH_CODES).reduce((a, b) => a + b, 0) },
  count: Object.keys(LAUNCH_CODES).length,
});
const oneTimeOut = {
  source:
    'endfield.wiki.gg (stage pages, Regional Development, Yuanyuan Manor Inn, Intel Gathering list, mail events); hand-kept: Intel Gathering 200 Oroberyl each (GameWith), Wuling Regional Development caps, launch codes',
  sources: ['https://gamewith.net/akendfield/73034', ...RD_SOURCES, 'https://www.keengamer.com/articles/guides/arknights-endfield-all-codes-how-to-redeem/', 'https://gamewith.net/akendfield/72499'],
  codes: LAUNCH_CODES,
  versions: oneTime,
};

const exploration = {
  source: 'endfield.wiki.gg area pages (crate and Aurylene counts); crate Oroberyl: GameWith; crate mix: Gamer Guides (Wuling)',
  crateOroberyl: CRATE_OROBERYL,
  mix: CRATE_MIX,
  perCrate: Math.round(perCrate * 10) / 10,
  sources: ['https://gamewith.net/akendfield/72617', 'https://www.gamerguides.com/arknights-endfield/maps/wuling'],
  versions: areas,
  outposts,
  crafting: { url: urlOf('Crafting/Crafting Manual'), versions: crafting },
  aurylene: { url: urlOf('Overworld Content') + '#TP_Point', tables, versions: aurylene },
};

// Shops: the AIC Quota Exchange's banner permits (official notes, else per banner) and the Bond Quota Exchange.
const aicPermits = {};
for (const v of schedule.versions) {
  const notes = notesText[v.name]?.text.replace(/\n/g, ' ') ?? '';
  const named = [...notes.matchAll(/exchange for \[([^\]]+HH Permit)\][^.]*?\[AIC Quota Exchange\]\.\s*Up to \[[^\]]+\]\s*[x×]\s*(\d+)/g)].map((m) => ({ permit: m[1], count: Number(m[2]) }));
  if (named.length) aicPermits[v.name] = named;
}
const quotaPrice = (shop, item) => {
  const part = sectionOr(center, shop);
  const row = part.split('\n').find((l) => l.includes(item) && /Currency\|/.test(l)) ?? part.match(new RegExp(`${item}[\\s\\S]{0,120}?\\{\\{Currency\\|[^|}]+\\|(\\d+)`))?.[0] ?? '';
  return Number(row.match(/\{\{Currency\|[^|}]+\|(\d+)/)?.[1]) || null;
};
const bondItem = (await texts(['Bond Quota'])).get('Bond Quota') ?? '';
const shops = {
  aic: {
    url: urlOf('Acquisition Center') + '#AIC_Quota_Exchange',
    price: quotaPrice('AIC Quota Exchange', 'HH Permit'),
    perBanner: 5,
    kinds: ['chartered', 'special'],
    versions: aicPermits,
  },
  bond: {
    url: urlOf('Acquisition Center') + '#Bond_Quota_Exchange',
    price: quotaPrice('Bond Quota Exchange', 'Chartered HH Permit'),
    duplicate: {
      5: Number(bondItem.match(/(\d+) Bond Quota from pulling a 5★/)?.[1]) || null,
      6: Number(bondItem.match(/(\d+) Bond Quota from pulling a 6★/)?.[1]) || null,
    },
  },
};
// The Credit Store: one stock a day holds Oroberyl or Arsenal Tickets (never both): half of each on average.
const creditTable = sectionOr(center, 'Credit Store');
const creditOffer = (item) => Number(creditTable.match(new RegExp(`\\{\\{I\\|${item}\\|(\\d+)`))?.[1]) || 0;
shops.credit = {
  url: urlOf('Acquisition Center') + '#Credit_Store',
  perDay: { Oroberyl: creditOffer('Oroberyl') / 2, 'Arsenal Ticket': creditOffer('Arsenal Ticket') / 2 },
};
if (!shops.aic.price || !shops.bond.price || !shops.credit.perDay.Oroberyl || !shops.bond.duplicate[5] || !shops.bond.duplicate[6]) throw new Error('income: shop prices not found; the wiki layout may have changed');

// Hand-kept: rewards no wiki page or official post lists with amounts.
const extras = {
  livestream: {
    label: 'Version preview livestream',
    note: 'Sent by mail (or claimed on the New Version Guide page) after each version preview program; launch had codes instead, not counted.',
    perVersion: { Oroberyl: 1000 },
    fromVersion: 1,
    confirmed: ['Old Deep Water Dies, by Rising Tide It is Denied', 'Dreamscape of Wind and Snow', 'Sanctuary of Ink'],
    sources: [
      'https://www.gamsgo.com/blog/arknights-endfield-codes',
      'https://game8.co/games/Arknights-Endfield/archives/601880',
      'https://www.topuplive.com/news/arknights-endfield-version-1-6-pull-count.html',
    ],
  },
  survey: {
    label: 'Version survey',
    note: 'Completing each version survey.',
    perVersion: { Oroberyl: 300 },
    fromVersion: 0,
    sources: ['https://x.com/IAMCha0tik/status/2022427377570320425', 'https://www.topuplive.com/news/arknights-endfield-version-1-4-pull-count.html'],
  },
  combatDrills: {
    label: 'Combat Drills',
    note: "Each new Chartered Headhunting banner's trial stages for its rate-up operator.",
    perBanner: { Oroberyl: 100 },
    kinds: ['chartered'],
    sources: ['https://www.topuplive.com/news/arknights-endfield-version-1-4-pull-count.html'],
  },
};

// Permanent modes: each version's notes, "■ Event & Gameplay Updates" (or "Gameplay Updates"), item by item.
const eventNames2 = new Set((schedule.events ?? []).map((e) => norm(e.name)));
const etchspace = (await texts(['Etchspace Salvage'])).get('Etchspace Salvage') ?? '';
const notesItems = (text) => {
  const at = text.search(/■\s*(?:Events?\s*&\s*)?Gameplay Updates/);
  if (at < 0) return [];
  const rest = text.slice(at).split('\n').slice(1);
  const end = rest.findIndex((l) => /^\s*[■▼※]/.test(l));
  const body = (end < 0 ? rest : rest.slice(0, end)).join('\n');
  return body.split(/\n(?=\s*\d+\.\s)/).map((t) => t.trim()).filter((t) => /^\d+\.\s/.test(t));
};
/** "[Oroberyl]×1200" amounts in a bit of notes text. */
const notesAmounts = (t) => {
  const out = {};
  for (const m of t.matchAll(/\[([^\]]+)\]\s*[x×]\s*([\d,]+)/g)) add(out, m[1], Number(m[2].replace(/,/g, '')));
  return out;
};
const modes = Object.fromEntries(schedule.versions.map((v) => [v.name, []]));
const wikiChecks = [];
for (const v of schedule.versions) {
  const notes = notesText[v.name];
  if (!notes) continue;
  for (const item of notesItems(notes.text)) {
    const name = item.match(/^\d+\.\s*\[([^\]]+)\]/)?.[1] ?? item.split('\n')[0].replace(/^\d+\.\s*/, '').slice(0, 60);
    const brackets = [...new Set([...item.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]))];
    if (brackets.some((b) => eventNames2.has(norm(b)))) continue; // a schedule event: events.json counts it
    if (name === 'Etchspace Salvage') continue; // its milestones: below
    const named = notesAmounts(item);
    if (Object.keys(named).length) modes[v.name].push({ name, from: 'notes', url: `https://endfield.gryphline.com/en-us/news/${notes.cid}`, rewards: named });
    else wikiChecks.push({ version: v.name, name, brackets, cid: notes.cid, mentions: /\[Oroberyls?\]/i.test(item) });
  }
}
// Items naming rewards without amounts: the wiki page of the challenge event they name (an Event infobox page).
const candidates = [...new Set(wikiChecks.flatMap((c) => c.brackets))];
const candText = candidates.length ? await texts(candidates) : new Map();
for (const c of wikiChecks) {
  // The challenge event is named last ("[Umbral Monument] ... [Turbidity Manifest] ... [Monumental Etching: Corrupting Surge]").
  const page = c.brackets.findLast((b) => /\{\{\s*Event infobox/i.test(candText.get(b) ?? ''));
  const w = page ? candText.get(page) : '';
  // Reward tables only: drop shop sections.
  const rewards = page ? itemsIn(w.split(/^==+[^=\n]*(?:shop|store|exchange)[^=\n]*==+\s*$/im)[0]) : {};
  if (!Object.keys(rewards).length && !c.mentions) continue; // nothing to count, and the notes name no pull currency
  modes[c.version].push({
    name: page ?? c.name,
    from: page ? 'wiki' : 'notes',
    url: page ? urlOf(page) : `https://endfield.gryphline.com/en-us/news/${c.cid}`,
    rewards,
    ...(Object.keys(rewards).length ? {} : { partial: true }),
  });
}
// Etchspace Salvage: its Operation Metrics milestones, split over the versions that added to them.
const metrics = itemsIn(sectionOr(etchspace, 'Operation Metrics'));
const changelog = sectionOr(etchspace, 'Changelog');
const etchVersions = schedule.versions.filter((v) => {
  const wikiName = WIKI_VERSION[v.name] ?? v.name;
  const at = changelog.indexOf(`[[${wikiName}]]`);
  if (at < 0) return false;
  const entry = changelog.slice(at, changelog.indexOf("*'''", at + 5) >>> 0);
  return /Operation Metrics reward|Game released/i.test(entry);
});
if (Object.keys(metrics).length && etchVersions.length)
  for (const v of etchVersions)
    modes[v.name].push({
      name: 'Etchspace Salvage: Operation Metrics milestones',
      from: 'wiki',
      url: urlOf('Etchspace Salvage'),
      rewards: Object.fromEntries(Object.entries(metrics).map(([k, n]) => [k, Math.round((n / etchVersions.length) * 10) / 10])),
      estimate: true,
    });

const questsOut = {
  source: 'endfield.wiki.gg mission pages (rewards); version: official Version Update Notes (main story), wiki version pages (others)',
  caps: Object.fromEntries(caps.map((c) => [c.version, c.cap])),
  versions: Object.fromEntries(
    Object.entries(quests).map(([v, list]) => [
      v,
      list.filter((m) => Object.keys(m.rewards).length).map(({ name, type, url, rewards, how }) => ({ name, type, url, rewards, how })),
    ]),
  ),
  ...(unplaced.length ? { unplaced } : {}),
};

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
  quests: questsOut,
  exploration,
  extras,
  shops,
  progression,
  oneTime: oneTimeOut,
  modes: { source: 'Official Version Update Notes, "Event & Gameplay Updates"; amounts the notes leave out from endfield.wiki.gg', versions: modes },
};

const fmt = (r) => Object.entries(r).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing';
console.log(`income: daily ${fmt(daily)}; weekly ${fmt(weekly)}`);
console.log(`  Originium Supply costs ${fmt(originiumCost)}; Protocol Customized ${customizedPrice}, gives ${fmt(customizedBonus)} on purchase`);
console.log(`  Monthly Pass ${monthly.price}/${monthly.days} days: ${fmt(perPurchase)} per purchase, ${fmt(perDay)} a day`);
for (const [v, c] of Object.entries(compensation)) console.log(`  compensation ${v}: ${c.rows.map((r) => `${r.label} ${fmt(r.rewards)}`).join('; ')}`);
for (const [v, list] of Object.entries(questsOut.versions)) {
  const t = list.reduce((a, m) => { for (const [k, n] of Object.entries(m.rewards)) a[k] = (a[k] ?? 0) + n; return a; }, {});
  const how = list.reduce((a, m) => ((a[m.how] = (a[m.how] ?? 0) + 1), a), {});
  console.log(`  quests ${v}: ${list.length} with rewards (${fmt(how)}), ${fmt(t)}${questsOut.caps[v] ? `; story up to ${questsOut.caps[v]}` : ''}`);
}
if (unplaced.length) console.log(`  main missions past every version's cap (left out): ${unplaced.join('; ')}`);
console.log(`  crates: ~${exploration.perCrate} Oroberyl each (estimate)`);
for (const [v, r] of Object.entries(aurylene)) console.log(`  aurylene ${v}: ${fmt(r.rewards)}${r.partial ? ` PARTIAL (${r.partial})` : ''}`);
console.log(`  shops: AIC Quota ${shops.aic.price} a banner permit (${Object.entries(aicPermits).map(([v, l]) => `${v}: ${l.map((x) => `${x.permit} ×${x.count}`).join(', ')}`).join('; ')}); Bond Quota ${shops.bond.price} a Chartered HH Permit, duplicates ${shops.bond.duplicate[5]}/${shops.bond.duplicate[6]}`);
for (const [v, list] of Object.entries(oneTime)) if (list.length) console.log(`  oneTime ${v}: ${list.map((x) => `${x.name} ×${x.count} ${fmt(x.rewards)}${x.estimate ? ' ESTIMATE' : ''}`).join('; ')}`);
console.log(`  stages counted: ${stageCount}; Credit Store a day: ${fmt(shops.credit.perDay)}`);
console.log(`  progression (${progression.version}): ${progression.items.map((x) => `${x.name} ${fmt(x.rewards)}`).join('; ')}`);
for (const [v, c] of Object.entries(crafting)) if (c.items) console.log(`  crafting ${v}: ${c.items} items, ${fmt(c.rewards)}`);
for (const [v, list] of Object.entries(outposts)) if (list.length) console.log(`  outposts ${v}: ${list.map((o) => `${o.outpost} ${fmt(o.rewards)}`).join('; ')}`);
for (const [v, list] of Object.entries(modes)) console.log(`  modes ${v}: ${list.map((m) => `${m.name} [${m.from}] ${fmt(m.rewards)}${m.partial ? ' PARTIAL' : ''}${m.estimate ? ' ESTIMATE' : ''}`).join('; ') || 'none'}`);
for (const [v, list] of Object.entries(areas)) console.log(`  areas ${v}: ${list.map((a) => `${a.area} ${a.crates} crates, ${a.aurylene} Aurylene`).join('; ') || 'none'}`);
for (const p of passes) console.log(`  pass ${p.name} (${p.start?.slice(0, 10)}): free ${fmt(p.rewards)}; Originium ${fmt(p.originium)}; Customized ${fmt(p.customized)}`);

if (!DRY) {
  await writeFile(join(ROOT, 'wiki', 'income.json'), JSON.stringify(out, null, 1) + '\n');
  console.log('wrote wiki/income.json');
}
