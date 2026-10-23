#!/usr/bin/env node
/**
 * The game's status and reaction settings (what ReadSkillSettingData reads in
 * skill and buff files: Arts Burst and reaction multipliers, Conductive,
 * Corrosion and freeze durations, Breach and Crush damage...), written to
 * combat/settings.json as { "<name>": { values: [level I, II, III, IV], kind } }.
 *
 * The table is in an asset bundle, not in the dumped tables: this reads it
 * from a bundle decrypted on this computer (the owner's EndfieldDataDump
 * output), so it's run by hand, not in the weekly job.
 *
 *   node scripts/combat-settings.mjs <decrypted CAB file>
 *
 * Each entry, as Unity serializes it: name (int32 length, UTF-8, padded to 4),
 * an int32, values (int32 count, that many float32), kind (string, padded).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = process.argv[2];
if (!file) throw new Error('Pass the decrypted CAB file that holds the settings (search the bundles for "导电持续时间").');
const buf = readFileSync(file);
const pad = (n) => (n + 3) & ~3;

/** An entry at offset p, if one starts there. */
function entry(p) {
  if (p + 4 > buf.length) return null;
  const len = buf.readInt32LE(p);
  if (len < 3 || len > 96 || p + 4 + len > buf.length) return null;
  const name = buf.toString('utf8', p + 4, p + 4 + len);
  if (!/[一-鿿]/.test(name) || name.includes('�')) return null;
  let q = p + 4 + pad(len);
  if (q + 8 > buf.length) return null;
  q += 4;
  const count = buf.readInt32LE(q);
  if (count < 1 || count > 8) return null;
  q += 4;
  const values = [];
  for (let i = 0; i < count; i++, q += 4) values.push(Number(buf.readFloatLE(q).toPrecision(7)));
  const klen = buf.readInt32LE(q);
  if (klen < 0 || klen > 32) return null;
  const kind = buf.toString('utf8', q + 4, q + 4 + klen);
  if (!/^[A-Za-z]*$/.test(kind)) return null;
  return { name, values, kind, end: q + 4 + pad(klen) };
}

const out = {};
for (let p = 0; p < buf.length - 4; p++) {
  const e = entry(p);
  if (!e) continue;
  out[e.name] = { values: e.values, kind: e.kind || undefined };
  p = e.end - 1;
}
const path = fileURLToPath(new URL('../combat/settings.json', import.meta.url));
writeFileSync(path, `${JSON.stringify({ note: 'Game data © Gryphline / Hypergryph. Read from the game’s asset bundle (status and reaction settings).', settings: out }, null, 1)}\n`);
console.log(`Settings: ${Object.keys(out).length} entries.`);
for (const [k, v] of Object.entries(out)) console.log(`  ${k}: ${v.values.join(' / ')} ${v.kind ?? ''}`);
