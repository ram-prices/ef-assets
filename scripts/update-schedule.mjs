// Builds schedule.json (every banner's dates, rate-ups and version) from the
// official Arknights: Endfield news feed, and adds newly opened banners to
// banners.json with their art.
//
//   node scripts/update-schedule.mjs                write schedule.json
//   node scripts/update-schedule.mjs --dry-run      print it, write nothing
//   node scripts/update-schedule.mjs --find-pools   also look up the pool id of
//                                                  banners that are open now and
//                                                  add them to banners.json + art
//   --cache <dir>   keep downloaded posts in <dir> (handy while developing)
//
// Sources, both official and needing no login:
//   web-news.gryphline.com/api/bulletin   the news page's posts. Every banner has
//     a post ("[Rejuvenation] Chartered Headhunting", "[Seal of Jade Issue] LTO
//     Details", ...) giving its rate-up and availability; each version's
//     "Version Update Notes" lists all its banners; the post cover is the
//     banner art used in banners/.
//   ef-webview.gryphline.com/api/content  pool details by pool id, for pools
//     that are open right now (used only to find a new banner's pool id).
//
// Times: banner dates are "server time", i.e. local time on each server
// (Americas/Europe UTC-5, Asia UTC+8), so the same date opens 13 hours apart.
// Version updates happen at one instant on both. Every time in schedule.json is
// given for both servers as ISO strings with their offset.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const NEWS = 'https://web-news.gryphline.com/api/bulletin';
const NEWS_Q = 'lang=en-us&code=arknights_endfield_official';
const POOL = 'https://ef-webview.gryphline.com/api/content';
const UA = { 'User-Agent': 'Mozilla/5.0 (ef-assets schedule bot; github.com/ram-prices/ef-assets)' };
const REGIONS = { americas: -300, asia: 480 }; // UTC offset in minutes

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const FIND_POOLS = args.includes('--find-pools');
const CACHE = args.includes('--cache') ? args[args.indexOf('--cache') + 1] : null;
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt >= 3) throw new Error(`${url}: ${e.message}`);
      await sleep(1000 * attempt);
    }
  }
}

async function cached(name, load) {
  if (!CACHE) return load();
  const file = join(CACHE, `${name}.json`);
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  const data = await load();
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, JSON.stringify(data));
  return data;
}

/** Every post in the feed (title, time, cover), newest first. */
async function loadPostList() {
  return cached('list', async () => {
    const posts = [];
    for (let page = 1; ; page++) {
      const { data } = await getJson(`${NEWS}?${NEWS_Q}&page=${page}&pageSize=20`);
      posts.push(...data.list);
      if (!data.list.length || posts.length >= data.total) return posts;
      await sleep(200);
    }
  });
}

/** A post's body as plain text lines. */
async function loadPostText(cid) {
  const body = await cached(cid, async () => {
    await sleep(150);
    return (await getJson(`${NEWS}/${cid}?${NEWS_Q}`)).data;
  });
  const html = String(body.data ?? '')
    .replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return html.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// "Feb. 7, 2026 at 12:00", "Sept. 30, 2026, 11:59", "September 02, 2026 at 06:00",
// "Feb. 7, 2026 at 11:59 AM", "2026/03/29 11:59"
const DATE_RE =
  /(?:(Jan|Feb|Mar|Apr|May|June?|July?|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})(?:,|\s+at)?\s+(\d{1,2}):(\d{2})(?:\s*([AP]M))?|(\d{4})\/(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2}))/gi;

/** All dates in a string as wall-clock times {y, mo, d, h, mi, index}. */
function findDates(s) {
  const out = [];
  for (const m of s.matchAll(DATE_RE)) {
    if (m[1]) {
      let h = Number(m[4]);
      if (m[6]?.toUpperCase() === 'PM' && h < 12) h += 12;
      if (m[6]?.toUpperCase() === 'AM' && h === 12) h = 0;
      out.push({ y: +m[3], mo: MONTHS[m[1].slice(0, 3).toLowerCase()], d: +m[2], h, mi: +m[5], index: m.index });
    } else {
      out.push({ y: +m[7], mo: +m[8], d: +m[9], h: +m[10], mi: +m[11], index: m.index });
    }
  }
  return out;
}

const wallToMs = (w, offset) => Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - offset * 60000;
/** The same wall-clock time on each server (how "server time" dates work). */
const serverTime = (w) => Object.fromEntries(Object.entries(REGIONS).map(([r, off]) => [r, wallToMs(w, off)]));
/** One instant, the same on both servers. */
const instant = (ms) => Object.fromEntries(Object.keys(REGIONS).map((r) => [r, ms]));

function iso(ms, offset) {
  const t = new Date(ms + offset * 60000);
  const p = (n) => String(n).padStart(2, '0');
  const sign = offset < 0 ? '-' : '+';
  const o = Math.abs(offset);
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}T${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:00${sign}${p(o / 60)}:${p(o % 60)}`;
}
const isoBoth = (time) => (time ? Object.fromEntries(Object.entries(REGIONS).map(([r, off]) => [r, iso(time[r], off)])) : null);

// ---------------------------------------------------------------------------
// Reading posts
// ---------------------------------------------------------------------------

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const stripType = (s) => s.replace(/\s*\([^)]*\)\s*$/, '').trim(); // "Jade Vessel (Greatsword)" -> "Jade Vessel"

/**
 * The availability text of a dedicated banner post: the "Availability" line, or
 * the lines under it. Prefers the Americas/Europe line when servers are listed
 * separately (they have always matched).
 */
function availabilityOf(lines) {
  const i = lines.findIndex((l) => /Availability/i.test(l));
  if (i < 0) return null;
  const inline = lines[i].replace(/^.*?Availability:?\s*/i, '').trim();
  if (inline) return inline;
  const block = [];
  for (const l of lines.slice(i + 1)) {
    if (/^(·|▼|\[|※ The Rate)/.test(l) || /features the Rate-UP/.test(l)) break;
    if (/Time Zone/i.test(l)) continue;
    block.push(l);
  }
  const americas = block.find((l) => /^Americas/i.test(l));
  return (americas ?? block[0] ?? '').replace(/^(Americas \/ Europe|Asia)( Server)?:\s*/i, '').trim() || null;
}

/** "[Name] ... 6★ operator [X]" pairs in a post: banner name -> rate-up names. */
function rateUpsIn(text) {
  const map = new Map();
  const add = (name, up) => {
    const k = norm(name);
    map.set(k, [...new Set([...(map.get(k) ?? []), stripType(up)])]);
  };
  for (const m of text.matchAll(/During \[([^\]]+)\][^!]*?6★ (?:operator|weapon) \[([^\]]+)\] is Rate-UP/g)) add(m[1], m[2]);
  for (const m of text.matchAll(/\[([^\]]+)\][^·\[]{0,60}?features the Rate-UP 6★ (?:operator|weapon) \[([^\]]+)\]/g)) add(m[1], m[2]);
  return map;
}

const KIND_OF_TITLE = [
  [/\[([^\]]+)\] Chartered Headhunting/, 'chartered'],
  [/\[([^\]]+)\] Special Headhunting/, 'special'],
  [/\[([^\]]+)\] RE-Factor Headhunting/, 'refactor'],
  [/\[([^\]]+)\] RE-Factor Issue/, 'refactorIssue'],
  [/\[([^\]]+ Issue)\] (?:LTO|Limited-Time Offer) Details/, 'issue'],
];

const VERSION_TITLE = /^\[([^\]]+)\] Version (?:Update Notes|Pre-Download & Update Notice|Update & Maintenance Preview)/;

/** Banner facts from one post: [{name, kind, rateUps, avail, post}]. */
function bannersInPost(post, lines) {
  const text = lines.join('\n');
  const ups = rateUpsIn(text);
  const found = [];
  for (const [re, kind] of KIND_OF_TITLE) {
    const m = post.title.match(re);
    if (m) found.push({ name: m[1].trim(), kind });
  }
  if (found.length) {
    // RE-Factor posts hold two banners and one shared availability block.
    const avail = availabilityOf(lines);
    return found.map((b) => ({ ...b, rateUps: ups.get(norm(b.name)) ?? [], avail, post: post.cid }));
  }
  if (!VERSION_TITLE.test(post.title)) return [];
  // Version notes: each "· Availability:" line is followed by its banner's details.
  const out = [];
  let avail = null;
  for (const l of lines) {
    const a = l.match(/^· Availability:\s*(.+)$/);
    if (a) {
      avail = a[1];
      continue;
    }
    const d = l.match(/^· (Headhunting|Issue) Details: \[([^\]]+)\]\s*(.*?)features the Rate-UP 6★ (?:operator|weapon) \[([^\]]+)\]/);
    if (!d) continue;
    const refactor = /RE-Factor/i.test(d[3]);
    const kind = d[1] === 'Issue' ? (refactor ? 'refactorIssue' : 'issue') : refactor ? 'refactor' : /Special/i.test(d[3]) ? 'special' : 'chartered';
    out.push({ name: d[2].trim(), kind, rateUps: [stripType(d[4])], avail, post: post.cid });
  }
  return out;
}

/** Version maintenance windows, from version notices: {name, start, end, post}. */
function versionInPost(post, lines) {
  const m = post.title.match(VERSION_TITLE);
  if (!m) return null;
  for (const l of lines) {
    const w = l.match(/^(Americas \/ Europe|Asia)(?: Server)?:\s*(.+?)\s*\(UTC([+-]\d+)\)/);
    if (!w) continue;
    const dates = findDates(w[2]);
    if (dates.length < 2) continue;
    const off = Number(w[3]) * 60;
    return { name: m[1].trim(), start: wallToMs(dates[0], off), end: wallToMs(dates[1], off), post: post.cid };
  }
  return { name: m[1].trim(), start: null, end: null, post: post.cid };
}

/** Launch: "will officially release worldwide on Jan. 22, 2026 at 11:00 AM (UTC+8)". */
function launchInPost(post, lines) {
  for (const l of lines) {
    const m = l.match(/officially release worldwide on (.+?)\(UTC([+-]\d+)\)/);
    if (m) {
      const [date] = findDates(m[1]);
      if (date) return { name: 'Launch', start: null, end: wallToMs(date, Number(m[2]) * 60), post: post.cid };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Availability rules -> times
// ---------------------------------------------------------------------------

/**
 * Turns an availability text into start/end rules:
 *   start: {date} | {version: name} | {launch: true}
 *   end:   {date} | {nextVersion: true} | {afterChartered: name} | {sameAs: name}
 */
function parseAvailability(text) {
  if (!text) return { start: null, end: null };
  const dash = text.search(/\s[–—-]\s|;|, and ends|, ends/);
  const head = dash < 0 ? text : text.slice(0, dash);
  const tail = dash < 0 ? '' : text.slice(dash);
  let start = null;
  if (/official release/i.test(head)) start = { launch: true };
  else {
    const v = head.match(/After \[([^\]]+)\] version|Opens after \[([^\]]+)\] version/i);
    if (v) start = { version: (v[1] ?? v[2]).trim() };
    else {
      const [d] = findDates(head);
      if (d) start = { date: d };
    }
  }
  let end = null;
  const after = text.match(/ends after 3 \[?Chartered Headhunting\]? banners \((?:starting|counting) from \[([^\]]+)\]\)/i);
  const same = text.match(/ends at the same time as \[([^\]]+)\]/i);
  if (after) end = { afterChartered: after[1].trim() };
  else if (same) end = { sameAs: same[1].trim() };
  else if (/Before version update and maintenance/i.test(tail)) end = { nextVersion: true };
  else {
    const dates = findDates(tail);
    if (dates.length) end = { date: dates[dates.length - 1] };
  }
  return { start, end };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function build() {
  const list = await loadPostList();
  const posts = [...list].sort((a, b) => Number(a.displayTime) - Number(b.displayTime));
  const facts = [];
  const versionParts = [];
  for (const post of posts) {
    const t = post.title;
    const relevant =
      KIND_OF_TITLE.some(([re]) => re.test(t)) || VERSION_TITLE.test(t) || /Pre-Download/i.test(t);
    if (!relevant) continue;
    const lines = await loadPostText(post.cid);
    facts.push(...bannersInPost(post, lines));
    const v = versionInPost(post, lines);
    if (v) versionParts.push(v);
    const launch = launchInPost(post, lines);
    if (launch) versionParts.push(launch);
  }

  // Versions: merge the notices of each version; release = end of maintenance.
  const versions = [];
  for (const p of versionParts) {
    let v = versions.find((x) => norm(x.name) === norm(p.name));
    if (!v) versions.push((v = { name: p.name, maintenance: null, release: null, posts: [] }));
    v.posts.push(p.post);
    if (p.end != null && v.release == null) {
      v.release = p.end;
      if (p.start != null) v.maintenance = p.start;
    }
  }
  versions.sort((a, b) => (a.release ?? Infinity) - (b.release ?? Infinity));
  const versionByName = (name) => versions.find((v) => norm(v.name) === norm(name));
  const launch = versions.find((v) => v.name === 'Launch');

  // Banners: one entry per name; a banner's own post wins over version notes.
  const banners = [];
  const posted = new Map(posts.map((p) => [p.cid, p]));
  for (const f of facts) {
    let b = banners.find((x) => norm(x.name) === norm(f.name));
    if (!b) banners.push((b = { name: f.name, kind: f.kind, rateUps: [], avail: null, posts: [], cover: null }));
    const own = KIND_OF_TITLE.some(([re]) => re.test(posted.get(f.post).title));
    if (own) {
      b.kind = f.kind;
      if (!b.cover) b.cover = posted.get(f.post).cover || null;
      if (f.avail) b.avail = f.avail;
    } else if (!b.avail && f.avail) b.avail = f.avail;
    b.rateUps = [...new Set([...b.rateUps, ...f.rateUps])];
    if (!b.posts.includes(f.post)) b.posts.push(f.post);
  }

  // A Chartered banner can be known only from an Issue's "starting from [X]"
  // (its own post is missing from the feed): it opened with that Issue and,
  // like every mid-version banner, ran until the next version update.
  const db = JSON.parse(await readFile(join(ROOT, 'banners.json'), 'utf8'));
  for (const b of [...banners]) {
    const ref = parseAvailability(b.avail).end?.afterChartered;
    if (!ref || banners.some((x) => norm(x.name) === norm(ref))) continue;
    const entry = Object.values(db).find((e) => norm(e.name) === norm(ref));
    banners.push({
      name: ref,
      kind: 'chartered',
      rateUps: entry ? [].concat(entry.rateupName ?? []) : [],
      avail: null,
      inferredFrom: b.name,
      posts: [],
      cover: null,
    });
  }

  // Resolve rules to times, a few passes since rules point at other banners.
  for (const b of banners) {
    b.rule = b.inferredFrom ? { start: { sameAsStart: b.inferredFrom }, end: { nextVersion: true } } : parseAvailability(b.avail);
    b.start = null;
    b.end = null;
  }
  const findBanner = (name) => banners.find((x) => norm(x.name) === norm(name));
  const nextVersionAfter = (t) => versions.find((v) => v.maintenance != null && v.maintenance > t.americas);
  for (let pass = 0; pass < 6; pass++) {
    const chartered = banners.filter((b) => b.kind === 'chartered' && b.start).sort((a, b) => a.start.americas - b.start.americas);
    for (const b of banners) {
      const { start: s, end: e } = b.rule;
      if (!b.start && s) {
        if (s.date) b.start = serverTime(s.date);
        else if (s.launch && launch) b.start = instant(launch.release);
        else if (s.version && versionByName(s.version)?.release != null) b.start = instant(versionByName(s.version).release);
        else if (s.sameAsStart && findBanner(s.sameAsStart)?.start) b.start = findBanner(s.sameAsStart).start;
      }
      if (!b.end && e && b.start) {
        if (e.date) b.end = serverTime(e.date);
        else if (e.nextVersion) {
          const v = nextVersionAfter(b.start);
          if (v) b.end = instant(v.maintenance);
        } else if (e.sameAs && findBanner(e.sameAs)?.end) b.end = findBanner(e.sameAs).end;
        else if (e.afterChartered) {
          const i = chartered.findIndex((c) => norm(c.name) === norm(e.afterChartered));
          const third = i >= 0 ? chartered[i + 2] : null;
          if (third?.end) b.end = third.end;
        }
      }
    }
  }

  // Version of each banner, pool ids from banners.json.
  const poolIdOf = (name) => Object.entries(db).find(([id, e]) => norm(e.name) === norm(name) && !id.includes('constant'))?.[0] ?? null;
  const versionAt = (t) => [...versions].reverse().find((v) => v.release != null && v.release <= t.americas + 60000);
  const KIND_ORDER = ['chartered', 'special', 'refactor', 'issue', 'refactorIssue'];
  banners.sort((a, b) => (a.start?.americas ?? Infinity) - (b.start?.americas ?? Infinity) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));

  const review = [];
  const out = banners.map((b) => {
    const notes = [];
    if (b.inferredFrom) notes.push(`No post of its own: dates inferred from [${b.inferredFrom}]`);
    if (!b.start) notes.push(`Start not resolved: ${b.avail ?? 'no availability text'}`);
    if (!b.end) {
      const e = b.rule.end;
      if (e?.nextVersion) notes.push('Ends at the next version update (not announced yet)');
      else if (e?.afterChartered) notes.push(`Ends with the 3rd Chartered banner from [${e.afterChartered}] (not announced yet)`);
      else notes.push(`End not resolved: ${b.avail ?? 'no availability text'}`);
    }
    const unresolved = !b.start || (!b.end && !b.rule.end?.nextVersion && !b.rule.end?.afterChartered);
    if (unresolved || b.inferredFrom) review.push(b.name);
    return {
      name: b.name,
      kind: b.kind,
      rateUps: b.rateUps,
      poolId: poolIdOf(b.name),
      version: b.start ? versionAt(b.start)?.name ?? null : null,
      start: isoBoth(b.start),
      end: isoBoth(b.end),
      availability: b.avail,
      art: b.cover,
      posts: b.posts,
      ...(notes.length ? { notes } : {}),
      ...(unresolved || b.inferredFrom ? { needsReview: true } : {}),
    };
  });

  return {
    schedule: {
      source: 'https://endfield.gryphline.com/en-us/news (web-news.gryphline.com)',
      timeZones: { americas: 'UTC-05:00 (Americas / Europe servers)', asia: 'UTC+08:00 (Asia server)' },
      versions: versions.map((v) => ({
        name: v.name,
        release: v.release != null ? isoBoth(instant(v.release)) : null,
        maintenance: v.maintenance != null ? isoBoth(instant(v.maintenance)) : null,
        posts: v.posts,
      })),
      banners: out,
    },
    review,
    db,
  };
}

// ---------------------------------------------------------------------------
// New pools: find the pool id of open banners, add them to banners.json + art
// ---------------------------------------------------------------------------

/** Pool ids to try for a banner: the game numbers them <type>_<major>_<minor>_<n>. */
function candidateIds(banner, db, versionIndex) {
  const minor = versionIndex;
  const n = (prefix) => Object.keys(db).filter((id) => id.startsWith(`${prefix}_1_${minor}_`)).length;
  if (banner.kind === 'chartered') return [1, 2, 3].map((k) => `special_1_${minor}_${n('special') + k}`);
  if (banner.kind === 'issue')
    return [1, 2, 3].flatMap((k) => [`weaponbox_1_${minor}_${n('weponbox') + k}`, `weponbox_1_${minor}_${n('weponbox') + k}`]);
  return []; // Special / RE-Factor pools use ids we haven't seen yet
}

async function findPools(schedule, db) {
  const now = Date.now();
  const added = [];
  const missingIcons = [];
  const open = schedule.banners.filter((b) => {
    if (b.poolId || !b.start) return false;
    const s = Date.parse(b.start.americas);
    const e = b.end ? Date.parse(b.end.americas) : Infinity;
    return s <= now && now <= e;
  });
  for (const b of open) {
    const vi = schedule.versions.filter((v) => v.release).findIndex((v) => v.name === b.version);
    let found = null;
    for (const id of candidateIds(b, db, vi)) {
      const res = await getJson(`${POOL}?lang=en-us&pool_id=${id}&server_id=2`).catch(() => null);
      await sleep(400);
      if (res?.code === 0 && norm(res.data.pool.pool_name) === norm(b.name)) {
        found = { id: id.replace(/^weaponbox_(?!constant)/, 'weponbox_'), pool: res.data.pool };
        break;
      }
    }
    if (!found) {
      added.push({ name: b.name, poolId: null });
      continue;
    }
    const all = found.pool.all ?? [];
    const ids = b.rateUps.map((n) => all.find((x) => norm(x.name) === norm(n))?.id).filter(Boolean);
    db[found.id] = { name: b.name, rateUpIds: ids, rateupName: b.rateUps, type: b.kind === 'issue' ? 'Weapon' : 'Special' };
    b.poolId = found.id;
    if (b.art && !DRY) await saveArt(b.art, join(ROOT, 'banners', `${found.id}.webp`));
    for (const id of ids) {
      const dir = id.startsWith('wpn_') ? 'arsenals' : 'operators';
      if (!existsSync(join(ROOT, dir, `${id}.webp`))) missingIcons.push(`${dir}/${id}.webp`);
    }
    added.push({ name: b.name, poolId: found.id });
  }
  return { added, missingIcons };
}

/** The post cover, 1024x576 webp like the rest of banners/. */
async function saveArt(url, file) {
  const sharp = (await import('sharp')).default;
  const res = await fetch(url, { headers: UA });
  const buf = Buffer.from(await res.arrayBuffer());
  await sharp(buf).resize(1024, 576, { fit: 'cover' }).webp({ quality: 82 }).toFile(file);
}

// ---------------------------------------------------------------------------

const { schedule, review, db } = await build();
let report = '';
if (FIND_POOLS) {
  const { added, missingIcons } = await findPools(schedule, db);
  for (const a of added) report += a.poolId ? `Added ${a.name} as ${a.poolId}\n` : `Could not find the pool id of ${a.name}\n`;
  for (const m of missingIcons) report += `Needs an icon: ${m}\n`;
  if (!DRY && added.some((a) => a.poolId)) await writeFile(join(ROOT, 'banners.json'), JSON.stringify(db, null, 2) + '\n');
}

const json = JSON.stringify(schedule, null, 2) + '\n';
if (DRY) process.stdout.write(json);
else await writeFile(join(ROOT, 'schedule.json'), json);

const counts = schedule.banners.length;
console.error(`${counts} banners across ${schedule.versions.length} versions.`);
if (review.length) console.error(`Needs review: ${review.join(', ')}`);
if (report) console.error(report.trim());
