#!/usr/bin/env node
/**
 * Weapon tuning and Potential skill bounds for ItJustLogs' loadouts and builds, from the game's tables (the
 * EndfieldData community dump), written to combat/weapon-tuning.json:
 *
 * - templates: WeaponBreakThroughTemplateTable. Per tuning stage (0 = untuned, then the tunings at levels 20, 40,
 *   60 and 80: `levels`, its breakthroughLv), each skill's [lowest, highest] level (skillLevelBounds). The lowest
 *   is the level with no essence; an essence's term level adds to it, up to the highest.
 * - potentials: WeaponTalentTemplateTable. Per Potential (P1–P5), what it adds to each skill's [lowest, highest]
 *   (skillLevelExtraBounds).
 * - weapons: each weapon's two templates (WeaponBasicTable) and its highest level (maxLv).
 *
 *   node scripts/weapon-tuning.mjs [--local <dump output folder>]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RAW = 'https://git.escartem.moe/Endfield/EndfieldData/raw/branch/master';
const at = process.argv.indexOf('--local');
const LOCAL = at > 0 ? process.argv[at + 1] : null;

const table = async (name) => {
  if (LOCAL) return JSON.parse(readFileSync(join(LOCAL, 'Data', 'TableCfg', `${name}.json`), 'utf8'));
  const res = await fetch(`${RAW}/TableCfg/${name}.json`);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.json();
};
const [WEAPONS, BREAKS, TALENTS] = await Promise.all(['WeaponBasicTable', 'WeaponBreakThroughTemplateTable', 'WeaponTalentTemplateTable'].map(table));

const pair = (b) => [b.lowerBound, b.upperBound];
const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

const templates = sorted(
  Object.fromEntries(
    Object.entries(BREAKS).map(([id, t]) => {
      const list = [...t.list].sort((a, b) => a.breakthroughShowLv - b.breakthroughShowLv);
      return [id, { levels: list.map((s) => s.breakthroughLv), bounds: list.map((s) => s.skillLevelBounds.map(pair)) }];
    }),
  ),
);
const potentials = sorted(
  Object.fromEntries(Object.entries(TALENTS).map(([id, t]) => [id, [...t.list].sort((a, b) => a.talentLv - b.talentLv).map((p) => p.skillLevelExtraBounds.map(pair))])),
);
const weapons = sorted(
  Object.fromEntries(Object.values(WEAPONS).map((w) => [w.weaponId, { tuning: w.breakthroughTemplateId, potential: w.talentTemplateId, maxLevel: w.maxLv }])),
);

const out = {
  source: 'https://git.escartem.moe/Endfield/EndfieldData',
  note: 'Game data © Gryphline / Hypergryph.',
  fetched: new Date().toISOString().slice(0, 10),
  templates,
  potentials,
  weapons,
};
// One template or Potential per line, so the file reads as the tables do.
const lines = (o) => Object.entries(o).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
writeFileSync(
  'combat/weapon-tuning.json',
  `{\n  "source": ${JSON.stringify(out.source)},\n  "note": ${JSON.stringify(out.note)},\n  "fetched": ${JSON.stringify(out.fetched)},\n` +
    `  "templates": {\n${lines(templates)}\n  },\n  "potentials": {\n${lines(potentials)}\n  },\n  "weapons": {\n${lines(weapons)}\n  }\n}\n`,
);
console.log(`${Object.keys(weapons).length} weapons, ${Object.keys(templates).length} tuning templates, ${Object.keys(potentials).length} Potential templates`);
