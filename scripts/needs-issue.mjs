// Keeps ONE GitHub issue, "ef-assets: needs attention", up to date: what
// site-art.mjs's needs.md lists, the wiki warnings, and a failed workflow run.
// The last step of update-schedule.yml and update-wiki.yml runs it, even when
// an earlier step failed.
//
//   node scripts/needs-issue.mjs <schedule|wiki>
//
// Env: GH_TOKEN (gh), JOB_STATUS (job.status), RUN_URL, WORKFLOW_NAME,
// GITHUB_REPOSITORY and GITHUB_RUN_ID (set by Actions).
//
// The issue's body has one section per kind of trouble. Each run replaces its
// own: both workflows write "Banners and pictures" (from needs.md, so the
// latest run wins), only update-wiki writes "Wiki warnings", and each writes
// its own "failed" line. Opens (or reopens) the issue when anything is listed,
// closes it with a comment when nothing is. Bot-opened issues notify nobody,
// so the issue is assigned to ram-prices and every line that wasn't there
// before goes into a comment starting with @ram-prices; a run that adds
// nothing new doesn't comment.
//
// Node built-ins and the gh CLI only.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TITLE = 'ef-assets: needs attention';
const OWNER = 'ram-prices';
const source = process.argv[2];
if (!['schedule', 'wiki'].includes(source)) throw new Error('usage: node scripts/needs-issue.mjs <schedule|wiki>');
const { JOB_STATUS = 'success', RUN_URL = '', WORKFLOW_NAME = source, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;

// GH_FAKE=<script.mjs> runs that instead of gh, to test this without GitHub.
const gh = (...args) => process.env.GH_FAKE
  ? execFileSync(process.execPath, [process.env.GH_FAKE, ...args], { encoding: 'utf8' })
  : execFileSync('gh', args, { encoding: 'utf8' });
const bodyFile = (text) => {
  const f = join(tmpdir(), `needs-issue-${process.pid}-${Math.random().toString(36).slice(2)}.md`);
  writeFileSync(f, text);
  return f;
};

const SECTIONS = [
  ['failed-schedule', 'Failed run: update-schedule'],
  ['failed-wiki', 'Failed run: update-wiki'],
  ['banners', 'Banners and pictures'],
  ['wiki', 'Wiki warnings (scripts/update-wiki.mjs)'],
];
const NEEDS_HEADING = { 'Banners and pictures': 'banners', 'Wiki warnings (scripts/update-wiki.mjs)': 'wiki' };

/** Bullet lines per section, from text with `<!-- section:name -->` markers. */
function parseBody(text) {
  const out = {};
  let cur = null;
  for (const line of (text ?? '').split(/\r?\n/)) {
    const m = /^<!-- section:([\w-]+) -->$/.exec(line.trim());
    if (m) { cur = m[1]; out[cur] = []; continue; }
    if (cur && line.startsWith('- ')) out[cur].push(line);
  }
  return out;
}

/** needs.md's bullet lines per section (its `## ` headings), or null when the run didn't write it. */
function parseNeeds() {
  if (!existsSync('needs.md')) return null;
  const out = {};
  let cur = null;
  for (const line of readFileSync('needs.md', 'utf8').split(/\r?\n/)) {
    if (line.startsWith('## ')) { cur = NEEDS_HEADING[line.slice(3).trim()] ?? 'banners'; out[cur] ??= []; continue; }
    if (line.startsWith('- ')) (out[cur ?? 'banners'] ??= []).push(line);
  }
  return out;
}

function failedStep() {
  try {
    const jobs = JSON.parse(gh('api', `repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/jobs`)).jobs ?? [];
    const step = jobs.flatMap((j) => j.steps ?? []).find((s) => s.conclusion === 'failure');
    return step?.name ?? null;
  } catch {
    return null;
  }
}

// The existing issue, open or closed (the newest with exactly this title).
const issues = JSON.parse(gh('issue', 'list', '--state', 'all', '--limit', '500', '--json', 'number,title,state,body'));
const issue = issues.filter((i) => i.title === TITLE).sort((a, b) => b.number - a.number)[0] ?? null;
const old = parseBody(issue?.body);

const needs = parseNeeds();
const sections = { ...old };
if (needs) {
  sections.banners = needs.banners ?? [];
  if (source === 'wiki') sections.wiki = needs.wiki ?? [];
}
if (JOB_STATUS !== 'success') {
  const step = failedStep();
  sections[`failed-${source}`] = [`- The ${WORKFLOW_NAME} run ${JOB_STATUS === 'cancelled' ? 'was cancelled' : 'failed'}${step ? ` at step "${step}"` : ''}: ${RUN_URL}`];
} else sections[`failed-${source}`] = [];

const all = SECTIONS.flatMap(([key]) => sections[key] ?? []);
const body = [
  'Kept up to date by the update-schedule and update-wiki workflows (scripts/needs-issue.mjs); it closes itself once nothing is listed.',
  'Each line says what is missing and the command that fixes it.',
  ...SECTIONS.filter(([key]) => sections[key]?.length).flatMap(([key, heading]) => ['', `<!-- section:${key} -->`, `### ${heading}`, '', ...sections[key]]),
  '',
  `Last run: ${RUN_URL || '(by hand)'}`,
].join('\n');

if (!all.length) {
  if (issue?.state === 'OPEN') {
    gh('issue', 'edit', String(issue.number), '--body-file', bodyFile(body));
    gh('issue', 'close', String(issue.number), '--comment', `All clear: nothing missing and no failed run (${WORKFLOW_NAME}, ${RUN_URL || 'by hand'}).`);
    console.log(`closed #${issue.number}`);
  } else console.log('nothing to report');
  process.exit(0);
}

// A run link differs every run: the same failure again isn't new.
const key = (line) => line.replace(/https?:\/\/\S+/g, '').trim();
const before = new Set(issue?.state === 'OPEN' ? Object.values(old).flat().map(key) : []);
const fresh = all.filter((l) => !before.has(key(l)));

let number = issue?.number;
if (!issue) {
  const url = gh('issue', 'create', '--title', TITLE, '--body-file', bodyFile(body), '--assignee', OWNER).trim();
  number = Number(url.split('/').pop());
  console.log(`opened #${number}`);
} else {
  if (issue.state !== 'OPEN') { gh('issue', 'reopen', String(number)); console.log(`reopened #${number}`); }
  gh('issue', 'edit', String(number), '--body-file', bodyFile(body), '--add-assignee', OWNER);
  console.log(`updated #${number}`);
}
if (fresh.length) {
  gh('issue', 'comment', String(number), '--body-file', bodyFile(`@${OWNER} new since the last run:\n\n${fresh.join('\n')}\n`));
  console.log(`commented ${fresh.length} new line(s)`);
}
