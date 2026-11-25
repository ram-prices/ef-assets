// Makes the files the site (ItJustLogs) loads for each banner out of the ones
// the art scripts write, and lists what is still missing.
//
//   node scripts/site-art.mjs [--wiki-report report.txt] [--dry] [--now 2026-05-01]
//
// 1. Flat banner art: the site loads banners/<pool id>.webp, the art scripts
//    write issues/<weapon>.webp and headhunting/<operator>.webp (what
//    schedule.json's `art` points at). A banner whose pool file is missing gets
//    a byte copy of its `art` file.
// 2. Game-screen art: banners.json gets `"gameArt": true` on each pool whose
//    banners/game/<pool>.webp and both layers (banners/game/layers/<pool>-back
//    and -op) exist, with an -op layer over 10 KB (1.7's first build had an
//    empty one). The site shows banners/game/ art only for flagged pools. HOLD
//    pools are never flagged. Only the flag lines change in banners.json.
// 3. needs.md (not committed): a checklist of what is still missing for every
//    banner open or upcoming in schedule.json, each line with the command that
//    fixes it. With --wiki-report, the warnings update-wiki.mjs printed go in
//    too. Empty file = nothing missing. The workflows put it in the
//    "ef-assets: needs attention" issue (scripts/needs-issue.mjs).
//
// Node built-ins only.
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const reportAt = args.indexOf('--wiki-report');
const wikiReport = reportAt >= 0 ? args[reportAt + 1] : null;

// Pools whose game-screen art must not be shown (a broken file): add one here
// until it's rebuilt and checked. Empty: Arcane's stretched special_1_4_1 was
// fixed in 6e84af1.
const HOLD = new Set([]);
const MIN_OP_LAYER = 10 * 1024;

const at = (p) => join(ROOT, p);
const has = (p) => existsSync(at(p));
const size = (p) => (has(p) ? statSync(at(p)).size : 0);
const canonical = (pool) => pool.trim().toLowerCase().replace(/^weaponbox_(?!constant)/, 'weponbox_');
// ef-assets keeps Typhoeus' pictures under the game's other id for him (like the site's itemIconUrl).
const PICTURE_ID = { chr_0034_typhoeus: 'chr_0034_typhoea' };

const schedule = JSON.parse(readFileSync(at('schedule.json'), 'utf8'));
const bannersText = readFileSync(at('banners.json'), 'utf8');
const db = JSON.parse(bannersText);
const entryOf = (pool) => db[pool] ?? db[pool.replace(/^weponbox_/, 'weaponbox_')];

// --- 1. Flat banner art --------------------------------------------------------
/** The ef-assets path an `art` URL points at, if it's an issues/ or headhunting/ file. */
function artPath(url) {
  const m = /ef-assets(?:@[^/]+|\/[^/]+)\/((?:issues|headhunting)\/[\w.-]+\.webp)(?:[?#].*)?$/.exec(url ?? '');
  return m ? m[1] : null;
}

const copied = [];
for (const b of schedule.banners) {
  if (!b.poolId) continue;
  const target = `banners/${canonical(b.poolId)}.webp`;
  const source = artPath(b.art);
  if (has(target) || !source || !has(source)) continue;
  if (!DRY) copyFileSync(at(source), at(target));
  copied.push(`${source} -> ${target}`);
}
console.log(copied.length ? `copied banner art:\n  ${copied.join('\n  ')}` : 'banner art: nothing to copy');

// --- 1b. Event art ---------------------------------------------------------------
// update-schedule.mjs saves the version guide's event art to events/<slug>.webp
// but only sets `art` on events it adds from the news feed; events from the game
// dump never got theirs (1.7). Link every saved picture to its event.
const EVENT_ART = 'https://raw.githubusercontent.com/ram-prices/ef-assets/main/events';
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const linked = [];
schedule.events = (schedule.events ?? []).map((e) => {
  const file = `events/${slug(e.name)}.webp`;
  if (e.art || !has(file)) return e;
  linked.push(e.name);
  // Keep `source` last, as the hand-written entries have it.
  const { source, ...rest } = e;
  return source === undefined ? { ...rest, art: `${EVENT_ART}/${slug(e.name)}.webp` } : { ...rest, art: `${EVENT_ART}/${slug(e.name)}.webp`, source };
});
if (linked.length && !DRY) writeFileSync(at('schedule.json'), JSON.stringify(schedule, null, 2) + '\n');
console.log(linked.length ? `event art linked: ${linked.join(', ')}` : 'event art: nothing to link');

// --- 2. gameArt flags in banners.json ------------------------------------------
const gameFiles = (pool) => [`banners/game/${pool}.webp`, `banners/game/layers/${pool}-back.webp`, `banners/game/layers/${pool}-op.webp`];
/** Why a pool's game-screen art can't be shown, or null when it can. */
function gameArtProblem(pool) {
  if (HOLD.has(pool)) return 'is on site-art.mjs HOLD list';
  const missing = gameFiles(pool).filter((f) => !has(f));
  if (missing.length) return `${missing.join(', ')} missing`;
  if (size(gameFiles(pool)[2]) <= MIN_OP_LAYER) return `${gameFiles(pool)[2]} is empty (${size(gameFiles(pool)[2])} bytes)`;
  return null;
}

// Edit the text line by line, so the diff is only the flag lines (banners.json
// is hand-formatted: arrays on one line, which JSON.stringify wouldn't keep).
const lines = bannersText.split('\n');
const flagLine = /^\s*"gameArt": true,?\r?$/;
const changed = [];
for (const pool of Object.keys(db)) {
  const want = !gameArtProblem(pool);
  // (Entries only hold strings and arrays, so a `"<key>": {` line opens a pool, whatever its indent.)
  const start = lines.findIndex((l) => l.replace(/\r$/, '').trim() === `${JSON.stringify(pool)}: {`);
  if (start < 0) throw new Error(`banners.json: can't find the line opening "${pool}"`);
  let end = start + 1;
  while (end < lines.length && !/^  \}/.test(lines[end])) end++;
  const flag = lines.slice(start + 1, end).findIndex((l) => flagLine.test(l));
  if (want && flag < 0) {
    const eol = lines[start].endsWith('\r') ? '\r' : '';
    lines.splice(start + 1, 0, `    "gameArt": true,${eol}`);
    changed.push(`+ ${pool}`);
  } else if (!want && flag >= 0) {
    const i = start + 1 + flag;
    // The flag was the entry's last key: the key before it loses its comma.
    if (!lines[i].replace(/\r$/, '').endsWith(',')) lines[i - 1] = lines[i - 1].replace(/,(\r?)$/, '$1');
    lines.splice(i, 1);
    changed.push(`- ${pool} (${gameArtProblem(pool)})`);
  }
}
if (changed.length) {
  const text = lines.join('\n');
  const check = JSON.parse(text); // still valid, and only the flags differ
  for (const [k, v] of Object.entries(check)) {
    const { gameArt, ...rest } = v;
    const { gameArt: _, ...before } = db[k];
    if (JSON.stringify(rest) !== JSON.stringify(before)) throw new Error(`banners.json: editing ${k} changed more than its flag`);
  }
  if (!DRY) writeFileSync(at('banners.json'), text);
  console.log(`banners.json gameArt:\n  ${changed.join('\n  ')}`);
} else console.log('banners.json gameArt: unchanged');
const flagged = new Set(Object.keys(db).filter((p) => !gameArtProblem(p)));

// --- 3. needs.md -----------------------------------------------------------------
// --now <date> checks as of another day (to test the list); --dry writes only needs.md.
const nowAt = args.indexOf('--now');
const now = nowAt >= 0 ? Date.parse(args[nowAt + 1]) : Date.now();
const DUMP = '<EndfieldDataDump>';
const times = (t) => Object.values(t ?? {}).map((s) => Date.parse(s)).filter((n) => !Number.isNaN(n));
const stillOn = (b) => !b.end || !times(b.end).length || Math.max(...times(b.end)) > now;
const HEADHUNTING = new Set(['chartered', 'refactor']);
const ISSUE = new Set(['issue', 'refactorIssue']);

const needs = [];
const need = (what, fix) => needs.push(`- ${what}: ${fix}`);
const ids = new Set();

for (const b of schedule.banners.filter(stillOn)) {
  const name = `${b.name} (${b.poolId ?? 'no pool id yet'})`;
  if (!b.poolId) {
    if (!b.art) need(`${name} has no banner art and no pool id`, 'run `node scripts/update-schedule.mjs --find-pools` once it opens, or add its pool id and art to schedule.json');
    continue;
  }
  const pool = canonical(b.poolId);
  const entry = entryOf(pool);
  if (!entry) need(`${name} is not in banners.json`, 'run `node scripts/update-schedule.mjs --find-pools`');
  for (const id of entry?.rateUpIds ?? []) ids.add(id);
  const flat = has(`banners/${pool}.webp`);
  if (HEADHUNTING.has(b.kind) && !flagged.has(pool)) {
    const why = gameArtProblem(pool);
    const fix = `run \`python scripts/operator-banner.py ${DUMP} banners/game ${pool}\` locally — needs the game dump${HOLD.has(pool) ? ', then check it and take it off HOLD in scripts/site-art.mjs' : ''}`;
    need(flat ? `${name} has no game-screen art (${why})` : `${name} has no banner art at all (${why})`, fix);
  } else if (ISSUE.has(b.kind)) {
    if (!flat) need(`${name} has no banner art at all (banners/${pool}.webp)`, `run \`python scripts/issue-banner.py <weapon id> <render.png> banners/${pool}.webp\``);
    else if (!has(`banners/layers/${pool}.webp`)) need(`${name} has no weapon layer (banners/layers/${pool}.webp)`, 'run `python scripts/issue-layers.py`');
  } else if (b.kind === 'special' && !has('banners/joint_1_2_2.webp')) {
    need(`${name} has no banner art at all (the site shows banners/joint_1_2_2.webp for every Joint pool)`, 'add banners/joint_1_2_2.webp');
  } else if (!HEADHUNTING.has(b.kind) && !ISSUE.has(b.kind) && b.kind !== 'special' && !flat) {
    need(`${name} has no banner art at all (banners/${pool}.webp)`, 'add it');
  }
}

const wikiOps = JSON.parse(readFileSync(at('wiki/operators.json'), 'utf8')).operators ?? {};
for (const id of [...ids].sort()) {
  const pic = PICTURE_ID[id] ?? id;
  if (id.startsWith('chr_')) {
    if (!has(`operators/${pic}.webp`)) need(`operator ${id} has no portrait (operators/${pic}.webp)`, 'run `python scripts/portraits.py` (once the wiki has the operator; before that `python scripts/guide-art.py`)');
    if (!has(`operators/full/${pic}.webp`)) need(`operator ${id} has no full art (operators/full/${pic}.webp)`, `run \`python scripts/operator-full.py ${DUMP} ${id}\` locally — needs the game dump`);
    if (!wikiOps[id] && !wikiOps[pic]) need(`operator ${id} is missing from wiki/operators.json`, `run \`python scripts/operator-from-game.py ${DUMP} ${id}\` locally, then \`node scripts/update-wiki.mjs\``);
  } else if (id.startsWith('wpn_')) {
    if (!has(`arsenals/${id}.webp`)) need(`weapon ${id} has no portrait (arsenals/${id}.webp)`, 'run `python scripts/portraits.py` (once the wiki has the weapon; before that `python scripts/guide-art.py`)');
  }
}

for (const [list, label] of [[schedule.banners, 'banner'], [schedule.events ?? [], 'event']]) {
  for (const e of list) {
    if (e.needsReview) need(`schedule.json ${label} "${e.name}" is marked needsReview`, 'check it against the game dump (TimeRangeTable), fix it and delete its `needsReview`');
  }
}

let out = needs.length ? `## Banners and pictures\n\n${needs.join('\n')}\n` : '';
if (wikiReport && existsSync(wikiReport)) {
  // update-wiki.mjs ends with "<n> warnings:" and the warnings indented under it.
  const report = readFileSync(wikiReport, 'utf8').split(/\r?\n/);
  const from = report.findIndex((l) => /^\d+ warnings:$/.test(l.trim()));
  const warnings = [];
  if (from >= 0) for (const l of report.slice(from + 1)) { if (!/^\s+\S/.test(l)) break; warnings.push(`- ${l.trim()}`); }
  if (warnings.length) out += `${out ? '\n' : ''}## Wiki warnings (scripts/update-wiki.mjs)\n\n${warnings.join('\n')}\n`;
}
writeFileSync(at('needs.md'), out);
console.log(out ? `needs.md:\n${out}` : 'needs.md: nothing missing');
