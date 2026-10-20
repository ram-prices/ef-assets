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
//
// Beyond the schedule (built from each version's update notes), the wiki's
// event table (Cargo `Events`) lists the events announced mid-version: those
// go in `extra`, keyed by wiki page, with their UTC start per server. Mode
// entries (Monumental Etching, Echoes of War, Umbral Monument series, Trial
// Algorithmics: counted from income.json) and returning-player events are
// left out. A schedule event's page is the table's row of that name starting
// closest to it (Fortune Connect-and-Win is both a mail and a celebration).
// A page saying you're "guaranteed to earn at least [item]" counts that
// minimum instead of its random prizes. An event whose rewards are spent in a
// shop on another page ("[[Contingency Contract#Secret Sanctuary]]") counts
// that shop's tab for it, item times stock.
//
// Each event also gets its `end` per server from the wiki's event table when
// the table has one (the update notes often say only "until the next version
// update"), and its `phases` when the page lists them: an "Event calendar"
// ("[Phase 2] 22/10/2026 04:00 - ...: what to do") or "Event Phase 2:" with
// its Availability and Content. Phase times are server time (UTC+8 on Asia,
// UTC-5 on Americas/Europe); the first phase starts with the event, and each
// ends when the next starts (the last, with the event).
//
// And what the page says about keeping it: `permanent` when it stays playable
// after it ends ("you can still play this side mission", "will become a
// permanent activity"), with `limitedRewards` when some of its rewards still
// end with it ("no longer be able to ... claim", "rewards of limited-time ...
// will no longer be available"); `days`, how many daily rewards it hands out
// (its "Day N" rows, or "N times"); and `unique`, the rewards that aren't
// general materials or currencies (portraits, frames, stickers, models,
// operators and their tokens, outfits...).

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

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** A server-time moment on each server: the same clock time, UTC+8 on Asia and UTC-5 on Americas/Europe. */
function serverTime(y, mo, d, h, mi) {
  const p = (n) => String(n).padStart(2, '0');
  const local = `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:00`;
  return { asia: `${local}+08:00`, americas: `${local}-05:00` };
}

/** An event's phases from its page, the first starting with the event (start null); none unless there are two or more. */
function phasesOf(text) {
  const out = [];
  // Event calendar: "** [Phase 2] 22/10/2026 04:00 - 26/11/2026 06:00: what to do"
  for (const m of text.matchAll(/^\*+\s*\[Phase (\d+)\]\s*(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})\s*[-–]\s*\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}:?\s*(.*)$/gm))
    out.push({ name: `Phase ${m[1]}`, start: serverTime(m[4], m[3], m[2], m[5], m[6]), about: plain(m[7]) });
  // "* Event Phase 2: ..." then "** '''Availability''': August 15, 2026 at 04:00 (server time)" and "** '''Content''': ..."
  if (!out.length)
    for (const b of text.matchAll(/^\*\s*Event Phase (\d+):?[ \t]*(.*)\n((?:\*\*.*(?:\n|$))*)/gm)) {
      const at = b[3].match(/Availability'*:\s*([A-Za-z]+) (\d{1,2}), (\d{4}) at (\d{1,2}):(\d{2})/);
      const month = at ? MONTHS.indexOf(at[1].toLowerCase()) + 1 : 0;
      const content = b[3].match(/Content'*:\s*(.+)/);
      out.push({
        name: `Phase ${b[1]}`,
        start: at && month ? serverTime(at[3], month, at[2], at[4], at[5]) : null,
        // What it opens, then the line's own note, each a sentence.
        about: [content?.[1], b[2]]
          .map((t) => plain(t))
          .filter(Boolean)
          .map((t) => (/[.!?]$/.test(t) ? t : `${t}.`))
          .join(' '),
      });
    }
  if (out.length < 2) return [];
  return out.map((ph, i) => (i === 0 ? { ...ph, start: null } : ph));
}

/** Whether the event stays playable after it ends, and whether some of its rewards don't. */
function keeping(text) {
  // Markup stripped but templates' words kept: the narrative events say it inside a {{Color|...}}.
  const t = text.replace(/\{\{\w+\||\|\d+\}\}|\[\[|\]\]|[[\]]|'''?/g, ' ').replace(/\s+/g, ' ');
  const permanent = /you can still play|become a permanent|permanently available|remains? (?:open|available) permanently/i.test(t);
  const limitedRewards = permanent && /no longer be able to (?:complete|claim)|rewards of limited-time[^.]*no longer|limited-time rewards/i.test(t);
  return { permanent, limitedRewards };
}

/** How many daily rewards: the highest "Day N" row, else an "Every day, N times" row; null when neither. */
function dailyDays(groups) {
  const labels = groups.flatMap((g) => g.rows.map((r) => r.label));
  const days = labels.map((l) => l.match(/^Day (\d+)\b/i)?.[1]).filter(Boolean).map(Number);
  if (days.length) return Math.max(...days);
  const times = labels.map((l) => l.match(/^every day\b[^,]*,\s*(\d+) times\b/i)?.[1]).filter(Boolean).map(Number);
  return times.length ? Math.max(...times) : null;
}

/** Operator names (for rewards that are an operator), from wiki/operators.json. */
const OPERATORS = new Set(
  Object.values(JSON.parse(await readFile(new URL('../wiki/operators.json', import.meta.url), 'utf8')).operators).map((o) => o.name.toLowerCase()),
);
/** Rewards that aren't general materials or currencies: cosmetics, keepsakes, operators and their tokens. */
const UNIQUE = /\((?:portrait|frame|outfit|attire|skin|title|emote|bgm|theme)\)$|^sticker:|'s token$|\b(?:model|outfit|attire|skin|furniture|decoration|name ?card|medal)\b/i;
const uniqueOf = (totals) => Object.keys(totals).filter((k) => UNIQUE.test(k) || OPERATORS.has(k.toLowerCase()));

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
  // In running text an item may be a plain link with its count after it: "[[Oroberyl]]×200".
  if (prose)
    for (const m of s.matchAll(/\[\[(?:[^|\]]*\|)?([^\]|]+)\]\]\s*[x×]\s*([\d,]+)/g)) out.push([m[1].trim(), Number(m[2].replace(/,/g, ''))]);
  return out;
}

/**
 * How many times a reward handed out "every day" can be claimed, from the
 * page's own words ("can be claimed up to 30 times in total"); null when it
 * doesn't say.
 */
function dailyClaims(text) {
  const m = plain(text).match(/up to (\d+) times/i);
  return m ? Number(m[1]) : null;
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
        let rw = rewardsIn(l, true);
        if (!rw.length) continue;
        let label = heading || 'Rewards';
        // "Log in every day during the event to receive [[Oroberyl]]×200 ..." with
        // "claimed up to 30 times in total": the day's rewards, that many times.
        const claims = /every day|each day|daily/i.test(l) ? dailyClaims(part) : null;
        if (claims) {
          rw = rw.map(([name, n]) => [name, n === null ? null : n * claims]);
          label = `Every day, ${claims} times`;
        }
        rows.push({ label, rewards: rw });
        if (rw.some(([, n]) => n === null) || /other rewards|such as|includ/i.test(l)) partial = true;
      }
    }
    if (rows.length) groups.push({ title: heading || 'Rewards', ...(partial ? { partial: true } : {}), rows });
  }
  return groups;
}

/** "...you are guaranteed to earn at least {{I|Oroberyl|5000}}": the minimum, instead of random prizes. */
function guaranteed(text) {
  const m = text.match(/guaranteed to (?:earn|get|receive) at least[^\n]*?(\{\{\s*(?:I|Item)\s*\|[^{}]*\}\})/i);
  const rw = m ? rewardsIn(m[1]) : [];
  return rw.length ? [{ title: 'Guaranteed minimum', rows: [{ label: 'At least', rewards: rw }] }] : null;
}

/** HTML-table shop rows (Item | Cost | Stock) in a bit of wikitext: item times stock. */
function htmlShop(part) {
  const rows = [];
  for (const tr of part.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (cells.length < 3) continue;
    const item = rewardsIn(cells[0])[0];
    const cost = rewardsIn(cells[1])[0];
    const stock = Number(plain(cells[2]).replace(/,/g, ''));
    if (!item || !Number.isFinite(stock) || stock <= 0) continue;
    rows.push({ label: `${stock} in stock${cost ? ` · ${cost[1]} ${cost[0]} each` : ''}`, rewards: [[item[0], item[1] * stock]], currency: cost?.[0] });
  }
  return rows;
}

const flat = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/**
 * The shop this event's rewards are spent in, when it lives on another page:
 * "[[Contingency Contract#Secret Sanctuary|...]]" and that section's tab named
 * for this event ("Re-Ignition: Experimental Operation").
 */
async function linkedShop(text, eventName) {
  const link = text.match(/\[\[([^\]|#]+)#([^\]|]+)/);
  if (!link) return null;
  const target = (await pages([link[1].trim()])).get(link[1].trim());
  if (!target) return null;
  const at = target.text.search(new RegExp(`^=+\\s*${link[2].trim()}\\s*=+\\s*$`, 'm'));
  if (at < 0) return null;
  const section = target.text.slice(at).split(/\n==[^=]/)[0];
  for (const tab of section.split(/^\|-\|/m)) {
    const label = tab.match(/^\s*([^=\n]+)=/)?.[1];
    if (!label || !flat(eventName).endsWith(flat(label))) continue;
    const rows = htmlShop(tab);
    if (!rows.length) continue;
    const currency = rows.find((r) => r.currency)?.currency;
    if (currency && GENERAL_CURRENCY.test(currency)) return null;
    return [{ title: `${link[2].trim()}`, exchange: currency, rows: rows.map(({ label: l, rewards }) => ({ label: l, rewards })) }];
  }
  return null;
}

/** An event's groups from its page: a guaranteed minimum wins; a shop on another page joins in. */
async function rewardsOf(text, name) {
  const g = guaranteed(text);
  if (g) return g;
  const groups = eventRewards(text);
  const shop = await linkedShop(text, name);
  if (shop) {
    // The shop is where the page's "[Oroberyl] and other rewards" come from: its amounts replace the partial mention.
    return [...groups.filter((x) => !x.partial), ...shop];
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

// The wiki's event table: name, type, and UTC start per server.
const table = [];
for (let offset = 0; ; offset += 500) {
  const d = await api({ action: 'cargoquery', tables: 'Events', fields: '_pageName=page,Event,Type,AsiaStartTime,AmeuStartTime,AsiaEndTime,AmeuEndTime', order_by: 'AsiaStartTime', limit: '500', offset: String(offset) });
  const rows = (d.cargoquery ?? []).map((r) => r.title);
  table.push(...rows);
  if (rows.length < 500) break;
}
const utc = (t) => (t ? `${t.replace(' ', 'T')}Z` : null);
const baseName = (r) => (r.Event || r.page).replace(/\s*\([^)]*\)\s*$/, '');
/** A schedule event's row in the wiki's event table: the one of that name starting closest to it. */
const rowFor = (e) => {
  const at = Date.parse(e.start?.asia ?? '');
  const rows = table.filter((r) => flat(baseName(r)) === flat(e.name));
  if (!rows.length) return null;
  if (!Number.isNaN(at)) rows.sort((a, b) => Math.abs(Date.parse(utc(a.AsiaStartTime)) - at) - Math.abs(Date.parse(utc(b.AsiaStartTime)) - at));
  return rows[0];
};
/** Its end per server from that row, when the wiki has one. */
const endOf = (r) => (r?.AsiaEndTime ? { asia: utc(r.AsiaEndTime), americas: utc(r.AmeuEndTime) ?? utc(r.AsiaEndTime) } : null);
const rowsOf = new Map(events.map((e) => [e, rowFor(e)]));
/** A schedule event's wiki page: its table row's, else the page of that name. */
const pageNames = new Map(events.map((e) => [e, rowsOf.get(e)?.page ?? e.name]));
const found = await pages([...new Set(pageNames.values())]);

const out = {};
const missing = [];
const empty = [];
for (const e of events) {
  const page = found.get(pageNames.get(e));
  if (!page) {
    missing.push(e.name);
    continue;
  }
  const groups = await rewardsOf(page.text, e.name);
  if (!groups.length) empty.push(e.name);
  // Partial: the page names rewards without (all) amounts, so totals are a lower bound.
  const partial = !groups.length || groups.some((g) => g.partial);
  const end = endOf(rowsOf.get(e));
  const phases = phasesOf(page.text);
  const { permanent, limitedRewards } = keeping(page.text);
  const days = dailyDays(groups);
  const totals = totalsOf(groups);
  const unique = uniqueOf(totals);
  out[e.id] = {
    name: e.name,
    page: page.title,
    url: `https://endfield.wiki.gg/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
    ...(end ? { end } : {}),
    ...(phases.length ? { phases } : {}),
    ...(permanent ? { permanent } : {}),
    ...(limitedRewards ? { limitedRewards } : {}),
    ...(days ? { days } : {}),
    ...(unique.length ? { unique } : {}),
    ...(partial ? { partial: true } : {}),
    totals,
    groups,
  };
}

// Events the schedule doesn't have (announced mid-version), from the wiki's event table.
const MODE = /^(Monumental Etching|Echoes of War|Trial Algorithmics)\b/i;
const SKIP_TYPE = /^(Umbral Monument|Echoes of War|Permanent|Return)$/i;
const used = new Set([...pageNames.values(), ...[...found.values()].map((p) => p.title)].map(flat)); // asked names and where they redirect
const scheduled = new Set(events.map((e) => flat(e.name)));
const extraRows = table.filter((r) => !used.has(flat(r.page)) && !SKIP_TYPE.test(r.Type ?? '') && !MODE.test(r.page) && r.AsiaStartTime);
const extraPages = await pages(extraRows.map((r) => r.page));
const extra = {};
for (const r of extraRows) {
  if (scheduled.has(flat(r.page))) continue; // the same event under its own name, already counted
  const page = extraPages.get(r.page);
  if (!page) continue;
  const groups = await rewardsOf(page.text, r.page);
  const partial = !groups.length || groups.some((g) => g.partial);
  extra[r.page] = {
    name: baseName(r),
    type: r.Type ?? '',
    page: page.title,
    url: `https://endfield.wiki.gg/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
    start: { asia: utc(r.AsiaStartTime), americas: utc(r.AmeuStartTime) ?? utc(r.AsiaStartTime) },
    ...(endOf(r) ? { end: endOf(r) } : {}),
    ...(phasesOf(page.text).length ? { phases: phasesOf(page.text) } : {}),
    ...(partial ? { partial: true } : {}),
    totals: totalsOf(groups),
    groups,
  };
}
console.log(`extra events (on the wiki, not in schedule.json): ${Object.keys(extra).length}`);
for (const [k, x] of Object.entries(extra)) console.log(`  ${x.start.asia?.slice(0, 10)} ${k}: Oroberyl ${x.totals.Oroberyl ?? 0}${x.partial ? ' (partial)' : ''}`);

const withRewards = Object.values(out).filter((e) => e.groups.length).length;
const complete = Object.values(out).filter((e) => !e.partial).length;
console.log(`events: ${events.length} in schedule.json, ${Object.keys(out).length} found on the wiki, ${withRewards} with rewards (${complete} complete, the rest partial)`);
const ends = events.filter((e) => !e.end && out[e.id]?.end);
console.log(`end dates from the wiki for events the notes leave open: ${ends.map((e) => e.name).join('; ') || 'none'}`);
console.log(`events with phases: ${Object.values(out).filter((e) => e.phases).map((e) => `${e.name} (${e.phases.length})`).join('; ') || 'none'}`);
console.log(`permanent: ${Object.values(out).filter((e) => e.permanent).map((e) => e.name + (e.limitedRewards ? ' (limited-time rewards)' : '')).join('; ') || 'none'}`);
console.log(`daily rewards: ${Object.values(out).filter((e) => e.days).map((e) => `${e.name} ${e.days}`).join('; ') || 'none'}`);
console.log(`unique rewards: ${Object.values(out).filter((e) => e.unique).map((e) => `${e.name}: ${e.unique.join(', ')}`).join('; ') || 'none'}`);
if (missing.length) console.log(`not on the wiki: ${missing.join('; ')}`);
if (empty.length) console.log(`no reward tables found: ${empty.join('; ')}`);
const oro = Object.values(out).reduce((s, e) => s + (e.totals.Oroberyl ?? 0), 0);
console.log(`Oroberyl across all events: ${oro}`);

if (!DRY) {
  await writeFile(join(ROOT, 'wiki', 'events.json'), JSON.stringify({ attribution: { ...ATTRIBUTION, fetched: TODAY }, fetched: TODAY, events: out, extra }, null, 1) + '\n');
  console.log('wrote wiki/events.json');
}
