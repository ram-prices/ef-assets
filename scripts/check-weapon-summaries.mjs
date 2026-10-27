#!/usr/bin/env node
/**
 * Checks wiki/weapon-summaries.json against wiki/weapons.json: every weapon whose own (last) skill has an effect past
 * its leading stat has a summary, no summary is for an unknown weapon, every {k} is one of that skill's values, and
 * every branch compares two attributes with >= or >.
 *
 *   node scripts/check-weapon-summaries.mjs
 */
import { readFileSync } from 'node:fs';

const weapons = JSON.parse(readFileSync('wiki/weapons.json', 'utf8')).weapons;
const { summaries } = JSON.parse(readFileSync('wiki/weapon-summaries.json', 'utf8'));
const LEADING = /^[A-Za-z][A-Za-z &.'-]*?\s*⟦num\|\+\{0\}%?⟧[.,]?\s*/;
const ATTRS = new Set(['Strength', 'Agility', 'Intellect', 'Will']);
const problems = [];

for (const [id, w] of Object.entries(weapons)) {
  const s = w.skills.at(-1);
  if (w.skills.length < 2 || !s?.text) continue;
  if (s.text.replace(LEADING, '').trim() && !summaries[id]) problems.push(`${id} (${w.name}): no summary`);
}
for (const [id, sum] of Object.entries(summaries)) {
  const w = weapons[id];
  if (!w) {
    problems.push(`${id}: not in wiki/weapons.json`);
    continue;
  }
  const n = w.skills.at(-1).values.length;
  const lines = sum.lines ?? (sum.branches ?? []).flatMap((b) => b.lines);
  if (!lines.length) problems.push(`${id}: no lines`);
  for (const line of lines) for (const [, k] of line.matchAll(/\{(\d+)\}/g)) if (Number(k) >= n) problems.push(`${id}: {${k}} but the skill has ${n} values`);
  for (const b of sum.branches ?? [])
    if (!ATTRS.has(b.if?.[0]) || !ATTRS.has(b.if?.[2]) || !['>=', '>'].includes(b.if?.[1])) problems.push(`${id}: bad branch ${JSON.stringify(b.if)}`);
}
console.log(problems.length ? problems.join('\n') : `${Object.keys(summaries).length} summaries, all fine`);
process.exit(problems.length ? 1 : 0);
