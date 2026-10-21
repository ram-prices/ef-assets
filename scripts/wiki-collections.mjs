#!/usr/bin/env node
/**
 * Snapshots the game's medals (Path of Glory) and Intel Archives (Findings,
 * Audio Records, Nexus Files, Intel Gathering) from endfield.wiki.gg into
 * wiki/medals.json and wiki/findings.json, for ItJustLogs' Achievements and
 * Archives pages (moved here from ItJustLogs). Their pictures are linked as
 * the wiki's URLs; scripts/collection-pictures.py saves a copy of each into
 * collections/ so the site needn't load them from the wiki.
 * The wiki's text is CC BY-SA 4.0: the pages credit it.
 *
 *   node scripts/wiki-collections.mjs
 */
import { writeFileSync } from 'node:fs';

const API = 'https://endfield.wiki.gg/api.php';
const UA = 'ef-assets wiki snapshot (github.com/ram-prices/ef-assets; ItJustLogs)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params) {
  const url = `${API}?${new URLSearchParams({ ...params, format: 'json', formatversion: '2' })}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      const d = await r.json();
      if (!d.error) return d;
      console.warn('wiki error', d.error.code);
    } catch (e) {
      console.warn('retry', e.message);
    }
    await sleep(3000 * (attempt + 1));
  }
  throw new Error(`gave up on ${url}`);
}

/** Page wikitext for up to 50 titles at once: Map title → text (redirects followed). */
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
      if (text != null) out.set(back.get(p.title) ?? p.title, text);
    }
    await sleep(1200);
  }
  return out;
}

/** File URLs for up to 50 files at once: Map file name (no "File:") → URL; missing files are left out. */
async function fileUrls(names) {
  const out = new Map();
  const uniq = [...new Set(names)];
  for (let i = 0; i < uniq.length; i += 50) {
    const batch = uniq.slice(i, i + 50);
    const d = await api({ action: 'query', prop: 'imageinfo', iiprop: 'url', titles: batch.map((n) => `File:${n}`).join('|') });
    const back = new Map();
    for (const n of d.query.normalized ?? []) back.set(n.to, n.from);
    for (const p of d.query.pages) {
      const url = p.imageinfo?.[0]?.url;
      if (url) out.set((back.get(p.title) ?? p.title).replace(/^File:/, ''), url.replace(/\?.*$/, ''));
    }
    await sleep(1200);
  }
  return out;
}

// --- Wikitext ---------------------------------------------------------------

/** The templates named `name` in `text`, each as its raw parameter string. */
function templates(text, name) {
  const out = [];
  const re = new RegExp(`\\{\\{\\s*${name}\\s*(?=[|}])`, 'gi');
  for (let m; (m = re.exec(text)); ) {
    let depth = 0;
    let i = m.index;
    for (; i < text.length; i++) {
      if (text.startsWith('{{', i)) {
        depth++;
        i++;
      } else if (text.startsWith('}}', i)) {
        depth--;
        i++;
        if (!depth) break;
      }
    }
    out.push({ at: m.index, body: text.slice(m.index + m[0].length, i - 1) });
  }
  return out;
}

/** A template's named parameters (split on top-level "|"). */
function params(body) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === '{{' || two === '[[') {
      depth++;
      cur += two;
      i++;
    } else if (two === '}}' || two === ']]') {
      depth--;
      cur += two;
      i++;
    } else if (body[i] === '|' && !depth) {
      parts.push(cur);
      cur = '';
    } else cur += body[i];
  }
  parts.push(cur);
  const out = {};
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq > 0) out[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
  }
  return out;
}

/** Wikitext to plain text: links to their label, line breaks kept, markup and pictures dropped. */
function plain(s = '') {
  let t = s;
  t = t.replace(/<!--[\s\S]*?-->/g, '');
  t = t.replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  t = t.replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '');
  t = t.replace(/\{\{(?:Spoiler|Color|Tooltip|Nowrap)\s*\|([^|}]*)[^}]*\}\}/gi, '$1');
  for (let i = 0; i < 4; i++) t = t.replace(/\{\{[^{}]*\}\}/g, '');
  t = t.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1');
  t = t.replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, '$1');
  t = t.replace(/<\/?br\s*\/?>/gi, '\n');
  t = t.replace(/<[^>]+>/g, '');
  t = t.replace(/'''''|'''|''/g, '');
  t = t.replace(/&#32;/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  return t
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const slug = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// --- Medals -----------------------------------------------------------------

const CATEGORIES = ['Chapter', 'Technical', 'Regional', 'Progression', 'Construction', 'Social', 'Event', 'Wondrous'];

async function medals() {
  const texts = await pages(CATEGORIES.map((c) => `Path of Glory/${c}`));
  const list = [];
  for (const category of CATEGORIES) {
    const text = texts.get(`Path of Glory/${category}`) ?? '';
    // "==Main Mission==" headings split a category into the game's sub-lists.
    const heads = [...text.matchAll(/^==\s*([^=].*?)\s*==\s*$/gm)].map((m) => ({ at: m.index, name: plain(m[1]) }));
    for (const { at, body } of templates(text, 'Medal cell')) {
      const p = params(body);
      if (!p.name) continue;
      const group = heads.filter((h) => h.at < at).at(-1)?.name ?? null;
      const name = plain(p.title || p.name);
      const file = p.medal || p.name;
      list.push({
        id: slug(name),
        name,
        category,
        group,
        desc: plain(p.desc || p.based || ''),
        cond: plain(p.cond || ''),
        secret: p.secret ? plain(p.secret) : undefined,
        reforge: [p.ref2 && { desc: plain(p.ref2d || ''), cond: plain(p.ref2) }, p.ref3 && { desc: plain(p.ref3d || ''), cond: plain(p.ref3) }].filter(Boolean),
        trim: p.trim ? plain(p.trim) : undefined,
        end: p.end ? plain(p.end) : undefined,
        files: {
          base: `Medal-${file}.png`,
          ...(p.ref2 ? { r2: `Medal-${p.name}_Reforged_II.png` } : {}),
          ...(p.ref3 ? { r3: `Medal-${p.name}_Reforged_III.png` } : {}),
          ...(p.trim ? { trim: `Medal-${p.name}_Trimmed.png` } : {}),
        },
      });
    }
  }
  const urls = await fileUrls(list.flatMap((m) => Object.values(m.files).map((f) => f.replace(/ /g, '_'))));
  for (const m of list) {
    m.images = Object.fromEntries(Object.entries(m.files).flatMap(([k, f]) => (urls.get(f.replace(/ /g, '_')) ? [[k, urls.get(f.replace(/ /g, '_'))]] : [])));
    delete m.files;
    for (const k of ['secret', 'trim', 'end']) if (m[k] === undefined) delete m[k];
  }
  // A name used twice gets its category on the id.
  const seen = new Map();
  for (const m of list) seen.set(m.id, (seen.get(m.id) ?? 0) + 1);
  for (const m of list) if (seen.get(m.id) > 1) m.id = `${slug(m.category)}-${m.id}`;
  return list;
}

// --- Findings ---------------------------------------------------------------

async function findings() {
  const index = (await pages(['Findings'])).get('Findings') ?? '';
  const entries = [];
  let category = null;
  for (const line of index.split('\n')) {
    const h = line.match(/^===\s*(.+?)\s*===\s*$/);
    if (h) {
      category = plain(h[1]);
      continue;
    }
    const l = line.match(/^\*\s*\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/);
    if (l && category) entries.push({ page: l[1].trim(), name: plain(l[2] ?? l[1]).replace(/^"(.*)"$/, '$1'), category });
  }
  const texts = await pages(entries.map((e) => e.page));
  const out = [];
  for (const [order, e] of entries.entries()) {
    const text = texts.get(e.page) ?? '';
    const box = params(templates(text, 'Finding')[0]?.body ?? '');
    const section = (text.split(/^==\s*Content\s*==\s*$/m)[1]?.split(/^==[^=]/m)[0] ?? '').replace(/\[\[Category:[^\]]*\]\]/gi, '');
    // The text usually sits in a {{Quote|...}}: take what's inside it.
    const quote = templates(section, 'Quote')[0];
    const content = quote ? quote.body.replace(/^\s*\|/, '') : section;
    const big = content.match(/\[\[File:\s*([^|\]]+)/)?.[1]?.trim();
    out.push({
      id: slug(`${e.category}-${e.name}`),
      name: e.name,
      category: e.category,
      order,
      type: plain(box.type || '') || undefined,
      region: plain(box.region || '') || undefined,
      area: plain(box.area || '') || undefined,
      parts: box.parts ? Number(plain(box.parts)) || undefined : undefined,
      text: plain(content) || undefined,
      file: box.image ? box.image.trim() : box.type ? `Finding ${plain(box.type)}.png` : undefined,
      picture: big,
      missing: !text || undefined,
    });
  }
  const urls = await fileUrls(out.flatMap((f) => [f.file, f.picture].filter(Boolean).map((n) => n.replace(/ /g, '_'))));
  for (const f of out) {
    f.icon = f.file ? urls.get(f.file.replace(/ /g, '_')) : undefined;
    f.image = f.picture ? urls.get(f.picture.replace(/ /g, '_')) : undefined;
    delete f.file;
    delete f.picture;
    for (const k of Object.keys(f)) if (f[k] === undefined) delete f[k];
  }
  return out;
}

// --- The rest of Intel Archives: Audio Records, Nexus Files, Intel Gathering ---

/** Links listed under a page's "== List of ... ==" section (or its table), in order. */
function listed(text) {
  const out = [];
  for (const m of text.matchAll(/\[\[([^|\]#]+)(?:\|([^\]]+))?\]\]/g)) {
    const page = m[1].trim();
    if (/^(Category|File):/i.test(page) || out.some((x) => x.page === page)) continue;
    out.push({ page, name: plain(m[2] ?? m[1]).replace(/^Nexus Files:\s*/, '') });
  }
  return out;
}

async function moreArchives(start) {
  const index = await pages(['Audio Records', 'Nexus Files', 'Intel Gathering']);
  const lists = [
    ['Audio Records', listed(index.get('Audio Records')?.split(/^==\s*List of Audio Records\s*==/m)[1] ?? '')],
    ['Nexus Files', listed((index.get('Nexus Files') ?? '').match(/\{\|[\s\S]*?\n\|\}/)?.[0] ?? '')],
    ['Intel Gathering', listed(index.get('Intel Gathering')?.split(/^==\s*List of Intel Gathering\s*==/m)[1] ?? '')],
  ];
  const texts = await pages(lists.flatMap(([, l]) => l.map((e) => e.page)));
  const out = [];
  let order = start;
  for (const [category, list] of lists) {
    for (const e of list) {
      const text = texts.get(e.page) ?? '';
      const nexus = params(templates(text, 'Nexus Files')[0]?.body ?? '');
      // Audio Records: each {{Audio Record cell|speaker|line}}, as "Speaker: line".
      const audio = templates(text, 'Audio Record cell')
        .map((t) => t.body.replace(/^\s*\|/, '').split('|'))
        .map(([who, ...said]) => `${plain(who)}: ${plain(said.join('|'))}`);
      const reports = (text.split(/^==\s*Needed Files\s*==/m)[1]?.split(/^==[^=]/m)[0].match(/^!\s*[^!\n]+?\s*!!/gm) ?? []).length;
      out.push({
        id: slug(`${category}-${e.name}`),
        name: e.name,
        category,
        order: order++,
        type: category === 'Intel Gathering' ? 'Investigation' : undefined,
        parts: reports || undefined,
        text: (audio.length ? audio.join('\n\n') : plain(nexus.desc ?? '')) || undefined,
        unlock: plain(nexus.obtain ?? '') || undefined,
        missing: !text || undefined,
      });
    }
  }
  for (const f of out) for (const k of Object.keys(f)) if (f[k] === undefined) delete f[k];
  return out;
}

const fetched = new Date().toISOString().slice(0, 10);
const attribution = { source: 'endfield.wiki.gg', url: 'https://endfield.wiki.gg', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', fetched };
const m = await medals();
writeFileSync('wiki/medals.json', JSON.stringify({ attribution, medals: m }, null, 1) + '\n');
console.log(`medals: ${m.length} (${m.filter((x) => !x.images.base).length} without a picture)`);
const found = await findings();
const f = [...found, ...(await moreArchives(found.length))];
writeFileSync('wiki/findings.json', JSON.stringify({ attribution, findings: f }, null, 1) + '\n');
console.log(`archive: ${f.length} (${['Audio Records', 'Nexus Files', 'Intel Gathering'].map((c) => `${c} ${f.filter((x) => x.category === c).length}`).join(', ')})`);
console.log(`findings: ${f.length} (${f.filter((x) => x.missing).length} without a page, ${f.filter((x) => !x.icon).length} without an icon)`);
