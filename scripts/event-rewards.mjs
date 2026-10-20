// Snapshots each event's rewards from the community wiki (endfield.wiki.gg)
// into wiki/events.json, keyed by the event's id in schedule.json.
//
//   node scripts/event-rewards.mjs              write wiki/events.json
//   node scripts/event-rewards.mjs --dry-run    print a summary, write nothing
//
// Each event in schedule.json is looked up by name on the wiki (redirects
// followed). Event pages list their rewards in tables: missions ("Critters'
// Tail" → Oroberyl ×300, ...), sign-in days (a "Day" header row, one cell per
// day), milestones. Every table row holding {{I|Item|count}} rewards becomes
// a row here: its label (the first cell's name, or the column's header) and
// its rewards. Shop and exchange sections are skipped (those items cost
// something), except an exchange paid in a currency only the event hands out
// (AIC Support's Goods Exchange, paid in Fruits of Altruism Certs): its whole
// stock counts, as a group with `exchange` naming that currency. `totals`
// adds up every row, so it's what the event hands out in all, as listed on
// the wiki.
//
// Wiki content is CC BY-SA 4.0, so the file carries an `attribution` block and
// the derived data is under the same license.

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

/** Wikitext of up to 50 pages at once: Map asked title → { title, text } (redirects followed). */
async function pages(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const d = await api({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: '1', titles: batch.join('|') });
    const back = new Map();
    for (const n of d.query.normalized ?? []) back.set(n.to, n.from);
    for (const r of d.query.redirects ?? []) back.set(r.to, back.get(r.from) ?? r.from);
    for (const p of d.query.pages) {
      const text = p.revisions?.[0]?.slots?.main?.content;
      if (text != null) out.set(back.get(p.title) ?? p.title, { title: p.title, text });
    }
    await sleep(1200);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Wikitext
// ---------------------------------------------------------------------------

/** Plain text from a bit of wikitext: links to their label, markup and templates dropped. */
function plain(s = '') {
  let t = s;
  t = t.replace(/<!--[\s\S]*?-->/g, '');
  t = t.replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  t = t.replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '');
  for (let i = 0; i < 4; i++) t = t.replace(/\{\{[^{}]*\}\}/g, '');
  t = t.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1');
  t = t.replace(/<\/?br\s*\/?>/gi, ' ');
  t = t.replace(/<[^>]+>/g, '');
  t = t.replace(/'''''|'''|''/g, '');
  t = t.replace(/&nbsp;|&#32;/g, ' ').replace(/&amp;/g, '&');
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * The rewards in a bit of wikitext: {{I|Item|count}} and its cousins
 * ({{Item|...}}, {{Cur|...}}, {{Currency|...}}), named options ignored; a
 * count written after it ("[{{Item|Oroberyl}}]x1200") counts too. In a table
 * an item with no count is one of it; in running text (`prose`) its amount
 * isn't known, so it's null.
 */
function rewardsIn(s, prose = false) {
  const out = [];
  for (const m of s.matchAll(/\{\{\s*(?:I|Item|Cur|Currency)\s*\|([^{}]*)\}\}\]?(?:\s*[x×]\s*([\d,]+))?/gi)) {
    const parts = m[1].split('|').map((p) => p.trim());
    const name = parts[0];
    if (!name) continue;
    const count = parts.slice(1).find((p) => !p.includes('=') && /^[\d,.]+$/.test(p)) ?? m[2];
    out.push([name, count ? Number(count.replace(/,/g, '')) : prose ? null : 1]);
  }
  return out;
}

/** The label a row's first cell gives: its bold name if it has one ("'''Critters' Tail'''<br/>A naughty..."), else its text. */
function labelOf(cell) {
  const bold = cell.match(/'''(.+?)'''/);
  const text = plain(bold ? bold[1] : cell);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

/** A wikitable's rows, each a list of { header, text } cells ("||" and "!!" split cells on one line). */
function tableRows(table) {
  const rows = [];
  let cur = [];
  const flush = () => {
    if (cur.length) rows.push(cur);
    cur = [];
  };
  const lines = table.split('\n').slice(1); // the {| line
  let last = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('|}')) break;
    if (line.startsWith('|-')) {
      flush();
      last = null;
      continue;
    }
    if (line.startsWith('|+')) continue; // caption
    if (line.startsWith('!') || line.startsWith('|')) {
      const header = line.startsWith('!');
      const cells = line.slice(1).split(header ? /\s*!!\s*|\s*\|\|\s*/ : /\s*\|\|\s*/);
      for (let c of cells) {
        // A cell's attributes come before a single "|": "style=...| text".
        const attr = c.match(/^([^|[{]*?=[^|[{]*)\|(?!\|)([\s\S]*)$/);
        if (attr) c = attr[2];
        last = { header, text: c };
        cur.push(last);
      }
    } else if (last) last.text += `\n${raw}`; // a cell running onto more lines
  }
  flush();
  return rows;
}

const SKIP_SECTION = /shop|store|exchange|purchase|cost|navigation|gallery|history|trivia|notes/i;
const SHOP_SECTION = /shop|store|exchange|purchase/i;
/** Currencies a player has anyway: a shop paid in these is spending, not a reward. */
const GENERAL_CURRENCY = /^(Oroberyl|Origeometry|T-Creds|Arsenal Ticket|.*Stock Bills?)$/i;

/**
 * An exchange paid in the event's own currency: one row per item (item cell,
 * stock, cost), the item times its stock, tab by tab ("Phase 1=", "Phase 2=").
 * Null when the section has no such table.
 */
function eventExchange(part, heading) {
  const tabs = part.split(/^\|-\|\s*$/m);
  const groups = [];
  let currency = null;
  for (const tab of tabs) {
    const name = tab.match(/^(?:<tabber>)?\s*([^=\n|{}<]+?)=\s*$/m)?.[1]?.trim();
    const rows = [];
    for (const m of tab.matchAll(/^\{\|[\s\S]*?^\|\}/gm)) {
      const table = tableRows(m[0]);
      const head = table.find((r) => r.some((c) => c.header));
      // The cost column names the currency: "{{Currency|Fruits of Altruism Certs}} Cost" or plain "Fruits of Altruism Certs Cost".
      const cur = head
        ?.map((c) => c.text.match(/\{\{\s*Currency\s*\|([^|}]+)/i)?.[1]?.trim() ?? plain(c.text).match(/^(.+?)\s+Cost\b/i)?.[1]?.trim())
        .find(Boolean);
      if (!cur || GENERAL_CURRENCY.test(cur)) continue;
      currency = cur.replace(/\s*\(.*\)$/, ''); // "Fruits of Altruism Certs (Chubby Lung Attacks)"
      for (const r of table) {
        if (r.some((c) => c.header) || r.length < 3) continue;
        const item = rewardsIn(r[0].text)[0];
        const stock = Number(plain(r[1].text).replace(/,/g, ''));
        if (!item || !Number.isFinite(stock) || stock <= 0) continue;
        // The price ("5000", or "{{Currency|Fruits of Altruism Certs|6000}}") and the discount if any ("(-80%)", "(80% OFF)").
        const price = (rewardsIn(r[2].text)[0]?.[1] ?? Number(plain(r[2].text).match(/^[\d,]+/)?.[0].replace(/,/g, ''))) || null;
        const off = r[2].text.match(/\(\s*-?(\d+)%/)?.[1];
        const cost = price ? `${price.toLocaleString('en-US')} ${currency} each${off ? ` (−${off}%)` : ''}` : plain(r[2].text);
        rows.push({ label: `${stock} in stock · ${cost}`, rewards: [[item[0], item[1] * stock]] });
      }
    }
    if (rows.length) groups.push({ title: name ? `${heading}: ${name}` : heading, exchange: currency, rows });
  }
  return groups;
}

/** An event page's reward rows, by section. */
function eventRewards(text) {
  const groups = [];
  // Sections: the text between headings; a heading ending a skipped section starts afresh.
  const parts = text.split(/^(==+[^=\n].*?==+)\s*$/m);
  let heading = '';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (/^==+/.test(part)) {
      heading = plain(part.replace(/=/g, ''));
      continue;
    }
    if (SKIP_SECTION.test(heading)) {
      if (SHOP_SECTION.test(heading)) groups.push(...eventExchange(part, heading));
      continue;
    }
    const rows = [];
    for (const m of part.matchAll(/^\{\|[\s\S]*?^\|\}/gm)) {
      const table = tableRows(m[0]);
      const head = table.find((r) => r.every((c) => c.header));
      for (const r of table) {
        const rewardCells = r.filter((c) => !c.header && rewardsIn(c.text).length);
        if (!rewardCells.length) continue;
        const labelCell = r.find((c) => !rewardsIn(c.text).length);
        // A sign-in table: one row of rewards, a header row naming the columns (days).
        if (head && rewardCells.length > 1 && head.length >= r.length) {
          r.forEach((c, j) => {
            const rw = c.header ? [] : rewardsIn(c.text);
            if (rw.length) rows.push({ label: `${plain(head[0].text)} ${plain(head[j].text)}`.trim(), rewards: rw });
          });
          continue;
        }
        rows.push({ label: labelCell ? labelOf(labelCell.text) : '', rewards: rewardCells.flatMap((c) => rewardsIn(c.text)) });
      }
    }
    // No tables: rewards named in the text ("complete the side mission to acquire [Oroberyl]×600,
    // [Arms INSP Set] and other rewards"). Amounts only where written; the group is marked partial.
    let partial = false;
    if (!rows.length) {
      for (const l of part.split('\n')) {
        const rw = rewardsIn(l, true);
        if (!rw.length) continue;
        rows.push({ label: heading || 'Rewards', rewards: rw });
        if (rw.some(([, n]) => n === null) || /other rewards|such as|includ/i.test(l)) partial = true;
      }
    }
    if (rows.length) groups.push({ title: heading || 'Rewards', ...(partial ? { partial: true } : {}), rows });
  }
  return groups;
}

function totalsOf(groups) {
  const t = {};
  for (const g of groups) for (const r of g.rows) for (const [name, n] of r.rewards) if (n !== null) t[name] = (t[name] ?? 0) + n;
  return Object.fromEntries(Object.entries(t).sort((a, b) => b[1] - a[1]));
}

// ---------------------------------------------------------------------------

const schedule = JSON.parse(await readFile(join(ROOT, 'schedule.json'), 'utf8'));
const events = schedule.events ?? [];
const names = [...new Set(events.map((e) => e.name))];
const found = await pages(names);

const out = {};
const missing = [];
const empty = [];
for (const e of events) {
  const page = found.get(e.name);
  if (!page) {
    missing.push(e.name);
    continue;
  }
  const groups = eventRewards(page.text);
  if (!groups.length) empty.push(e.name);
  // Partial: the page names rewards without (all) amounts, so totals are a lower bound.
  const partial = !groups.length || groups.some((g) => g.partial);
  out[e.id] = {
    name: e.name,
    page: page.title,
    url: `https://endfield.wiki.gg/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
    ...(partial ? { partial: true } : {}),
    totals: totalsOf(groups),
    groups,
  };
}

const withRewards = Object.values(out).filter((e) => e.groups.length).length;
const complete = Object.values(out).filter((e) => !e.partial).length;
console.log(`events: ${events.length} in schedule.json, ${Object.keys(out).length} found on the wiki, ${withRewards} with rewards (${complete} complete, the rest partial)`);
if (missing.length) console.log(`not on the wiki: ${missing.join('; ')}`);
if (empty.length) console.log(`no reward tables found: ${empty.join('; ')}`);
const oro = Object.values(out).reduce((s, e) => s + (e.totals.Oroberyl ?? 0), 0);
console.log(`Oroberyl across all events: ${oro}`);

if (!DRY) {
  await writeFile(join(ROOT, 'wiki', 'events.json'), JSON.stringify({ attribution: { ...ATTRIBUTION, fetched: TODAY }, fetched: TODAY, events: out }, null, 1) + '\n');
  console.log('wrote wiki/events.json');
}
