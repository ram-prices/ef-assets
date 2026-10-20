// Snapshots the parts of the community "Endfield Bookkeeping" spreadsheet
// that no wiki page or official post lists with amounts into
// wiki/bookkeeping.json, for ItJustLogs' pulls per patch.
//
//   node scripts/bookkeeping.mjs              write wiki/bookkeeping.json
//   node scripts/bookkeeping.mjs --dry-run    print a summary, write nothing
//
// Run by hand (not in the weekly workflow): it reads someone's public sheet,
// whose layout may change. Each version tab ("1.4: Homecoming") has sections
// (EVENTS, PERMANENT CONTENT, MAILBOX & WEB EVENTS, RECURRING SOURCES), groups
// (a row with no amounts) and items (indented rows) with five amounts:
// Oroberyl, Chartered HH Permits, Basic HH Permits, Origeometry, Arsenal
// Tickets. Kept per version:
// - permanent: the groups ItJustLogs has no other source for (Operational
//   Manual nodes and stages, Authority Level, Regional Development, Stock
//   Redistribution, Early Warning Terminals, Intel Gathering, Crafting Manual,
//   Etchspace Salvage...). Missions, exploration, Aurylene and modes are left
//   out: income.json counts them from the wiki and official notes.
// - mailbox: mail and web rewards, less those income.json already counts
//   (maintenance and bug fix compensation, daily web sign-in, version survey,
//   preview stream gifts).
// - named: every row by name, for filling in events and modes whose amounts
//   the wiki doesn't give ("Rossi: The Red Knight" 600).
// - creditPerDay: the Credit Store Oroberyl a day the sheet assumes.

import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SHEET = '1zGNuQ53R7c190RG40dHxcHv8tJuT3cBaclm8CjI-luY';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET}/`;
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DRY = process.argv.includes('--dry-run');
const TODAY = new Date().toISOString().slice(0, 10);
const UA = { 'User-Agent': 'ef-assets bookkeeping snapshot (github.com/ram-prices/ef-assets; ItJustLogs)' };
/** The schedule's first version is the sheet's "Zeroth Directive". */
const SHEET_VERSION = { 'Zeroth Directive': 'Launch' };

const PERMANENT = /^(Node|Authority Level|RE:Crisis|Crisis Drills|Crisis Fragment|Energy Alluvium|Basic Training|Operator Guide|.*AIC Simulation|Regional Development|Stock Redistribution|Early Warning Terminal|Athletic Race|Intel Gathering|Crafting Manual|Inn Milestones|Etchspace Salvage)\b/i;
const MAILBOX_SKIP = /^(Daily Sign-in|Sign-in Bonus|Maintenance Compensation|Version Bug Fix Compensation|Version Experience Survey|.*Preview Stream Gift)$/i;
const KEYS = ['Oroberyl', 'Chartered HH Permit', 'Basic HH Permit', 'Origeometry', 'Arsenal Ticket'];

/** A small CSV reader (quoted cells, doubled quotes). */
function csv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') row.push(cell), (cell = '');
    else if (c === '\n') row.push(cell), rows.push(row), (row = []), (cell = '');
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows;
}

const get = async (url) => {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
};

// The tabs: every gid the sheet's page names, kept when its first cell is a version ("1.4: Homecoming").
const view = await get(`${SHEET_URL}htmlview`);
const gids = [...new Set([...view.matchAll(/gid=(\d+)/g)].map((m) => m[1]))];
const schedule = JSON.parse(await readFile(join(ROOT, 'schedule.json'), 'utf8'));
const versionNames = new Set(schedule.versions.map((v) => v.name));
const out = {};
for (const gid of gids) {
  const rows = csv(await get(`${SHEET_URL}gviz/tq?tqx=out:csv&gid=${gid}`));
  const title = rows[0]?.[0]?.match(/^\d+\.\d+:\s*(.+)$/)?.[1]?.trim();
  if (!title) continue;
  const version = SHEET_VERSION[title] ?? title;
  if (!versionNames.has(version)) continue;
  const v = { permanent: {}, mailbox: [], named: {}, creditPerDay: null };
  let section = null;
  let group = null;
  for (const r of rows) {
    const raw = r[0] ?? '';
    const name = raw.trim();
    if (!name) continue;
    if (/^(EVENTS|PERMANENT CONTENT|MAILBOX & WEB EVENTS|RECURRING SOURCES|TOTAL F2P)/.test(name)) {
      section = name.split(' ')[0] === 'TOTAL' ? null : name;
      group = null;
      continue;
    }
    if (!section) continue;
    const amounts = r.slice(1, 6).map((c) => (/^-?[\d.]+$/.test(c.trim()) ? Number(c) : 0));
    const has = amounts.some(Boolean);
    const indented = /^\s/.test(raw);
    if (!has) {
      if (!indented) group = name;
      continue;
    }
    const rewards = Object.fromEntries(KEYS.map((k, i) => [k, amounts[i]]).filter(([, n]) => n));
    // "Rossi: The Red Knight", "[Sign-In] A Forest Mantled in Snow": by the event's own name too.
    const label = name.replace(/^\[[^\]]+\]\s*/, '');
    const addNamed = (key) => {
      const into = (v.named[key] ??= {});
      for (const [k, n] of Object.entries(rewards)) into[k] = (into[k] ?? 0) + n;
    };
    addNamed(label);
    // "Wulfgard: Lone Wolf" is also "Lone Wolf"; rows under a "Rossi: The Red Knight" group add up to "The Red Knight".
    if (/^[^:]{1,30}: /.test(label)) addNamed(label.replace(/^[^:]+:\s*/, ''));
    if (indented && group && /^[^:]{1,30}: /.test(group)) addNamed(group.replace(/^[^:]+:\s*/, ''));
    if (section === 'RECURRING SOURCES' && /^Daily Activity$/i.test(name)) v.creditPerDay = Number((r[6] ?? '').match(/(\d+) Oroberyl\/day from Credits/i)?.[1]) || null;
    if (section === 'PERMANENT CONTENT') {
      const key = indented ? group : name;
      if (key && PERMANENT.test(key)) {
        const g = (v.permanent[key] ??= { rewards: {}, items: 0 });
        for (const [k, n] of Object.entries(rewards)) g.rewards[k] = (g.rewards[k] ?? 0) + n;
        g.items++;
      }
    }
    if (section === 'MAILBOX & WEB EVENTS' && !MAILBOX_SKIP.test(name)) v.mailbox.push({ name, rewards });
  }
  out[version] = v;
}
if (!Object.keys(out).length) throw new Error('bookkeeping: no version tabs read; the sheet may have moved or changed');

const fmt = (r) => Object.entries(r).map(([k, n]) => `${k} ${Math.round(n)}`).join(', ');
for (const [v, x] of Object.entries(out)) {
  const perm = Object.values(x.permanent).reduce((a, g) => a + (g.rewards.Oroberyl ?? 0), 0);
  const mail = x.mailbox.reduce((a, m) => a + (m.rewards.Oroberyl ?? 0), 0);
  console.log(`${v}: permanent ${Object.keys(x.permanent).length} groups (${perm} Oroberyl), mailbox ${x.mailbox.length} (${mail} Oroberyl), credit ${x.creditPerDay}/day`);
}

if (!DRY) {
  const file = {
    attribution: {
      source: 'Endfield Bookkeeping (community spreadsheet)',
      url: SHEET_URL,
      note: "Amounts as listed by the sheet's author, for what no wiki page or official post lists.",
      fetched: TODAY,
    },
    fetched: TODAY,
    versions: out,
  };
  await writeFile(join(ROOT, 'wiki', 'bookkeeping.json'), JSON.stringify(file, null, 1) + '\n');
  console.log('wrote wiki/bookkeeping.json');
}
