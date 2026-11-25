#!/usr/bin/env node
/**
 * Combat data for a team damage simulator, from the game's own skill files
 * (the EndfieldData community dump, git.escartem.moe/Endfield/EndfieldData:
 * Json/SkillData decoded, TableCfg/SkillPatchTable), written to
 * combat/skills.json for every operator in wiki/operators.json.
 *
 * Each skill (basic attack steps, battle, combo, ultimate, power/dash/plunge
 * attacks, talents) as a timeline at the game's 30 frames a second:
 * - duration (frames), exclusive (frames before anything else can be cast),
 *   next (the window to start the next action), cooldown and cost per rank;
 * - hits: frame, damage type, multiplier (a key into `values`, or a fixed
 *   value), `via` (projectile / entity: damage in a launched or spawned
 *   skill, at its launch frame; travel time isn't counted) and `cond` (the
 *   branch conditions it sits behind);
 * - stagger, inflictions, gains (SP: "Atb", Ultimate energy: "UltimateSp")
 *   and buffs applied, the same way;
 * - values: every rank's numbers by key (atk_scale, poise, usp...).
 *
 * Damage formulas aren't in the game's data: the simulator takes them from
 * endfield.wiki.gg's Damage calculation page. Combo triggers aren't either
 * (most are in the asset bundles).
 *
 *   node scripts/combat.mjs [--dry-run] [--local <dump output folder>]
 *
 * `--local` reads SkillPatchTable and the skill files from a local dump
 * (EndfieldDataDump's output/: Data/TableCfg and the decoded jsondata/);
 * `--local-tables` only the table, the skill files fetched a few at a time
 * and cached in the system temp folder between runs.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DUMP = 'https://git.escartem.moe/Endfield/EndfieldData';
const RAW = `${DUMP}/raw/branch/master`;
const UA = { 'User-Agent': 'ef-assets combat snapshot (github.com/ram-prices/ef-assets; ItJustLogs)' };
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE = join(tmpdir(), 'ef-assets-combat');
const DRY = process.argv.includes('--dry-run');
// --local <dir>: table and skill files from a local dump's output folder; --local-tables <dir>: only the table.
const LOCAL = process.argv.includes('--local') ? process.argv[process.argv.indexOf('--local') + 1] : process.argv.includes('--local-tables') ? process.argv[process.argv.indexOf('--local-tables') + 1] : null;
const LOCAL_JSON = process.argv.includes('--local');

/** The tables' text ids are 64-bit: kept as their digits, which JSON.parse would round. */
const parse = (text) => JSON.parse(text, (k, v, ctx) => (typeof v === 'number' && !Number.isSafeInteger(v) && ctx?.source ? ctx.source : v));
/** A local table's floats are the game's 32-bit ones (0.23 as 0.23000000417...): back to the shortest the remote dump writes. */
const f32 = (v) => (typeof v === 'number' && !Number.isInteger(v) && Math.fround(v) === v ? Number(v.toPrecision(7)) : v);
const parseLocal = (text) => JSON.parse(text, (k, v, ctx) => (typeof v === 'number' && !Number.isSafeInteger(v) && ctx?.source ? (Number.isInteger(v) ? ctx.source : String(f32(v))) : v));

/**
 * The local decoder writes what the game's classes hold; the remote dump's files are Unity's JSON: types as
 * "A.B+C+D, Gameplay.Beyond" (the decoder: "A.B/C/D"), a null string as "" and a null object left out, flags as
 * "Fire, Pulse" (the decoder: "Fire|Pulse"). Changed to the remote's shape so the output is the same either way.
 */
const STRINGY = /(Key|Id|Name|Fx|Path|Node|Sprite|Context|Event|ContextTarget|Blackboard)$|^(value|valueStr|stringValue)$|^(skillIdOn|toIdle|toFight)/;
function remoteShape(node) {
  if (Array.isArray(node)) return node.map((x) => (x === null ? '' : remoteShape(x)));
  if (node && typeof node === 'object') {
    // Curve keys (Unity's AnimationCurve, via the decoder: m_Time...): the remote's names, a weighted mode by name, infinity spelt out.
    if (Object.keys(node).length === 1 && 'm_Mask' in node) return { mask: node.m_Mask };
    if ('m_Time' in node) {
      const num = (x) => (x === 'inf' ? 'Infinity' : x === '-inf' ? '-Infinity' : remoteShape(x));
      return { time: num(node.m_Time), value: num(node.m_Value), inTangent: num(node.m_InTangent), outTangent: num(node.m_OutTangent), weightedMode: ['None', 'In', 'Out', 'Both'][node.m_WeightedMode] ?? node.m_WeightedMode, inWeight: num(node.m_InWeight), outWeight: num(node.m_OutWeight) };
    }
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === '$type' && typeof v === 'string') out[k] = `${v.replace(/\//g, '+')}, Gameplay.Beyond`;
      else if (v === null) {
        if (STRINGY.test(k)) out[k] = '';
      } else out[k] = remoteShape(v);
    }
    return out;
  }
  if (typeof node === 'string' && /^-?\d+(\.\d+)?e[-+]?\d+$/.test(node)) return node.toUpperCase();
  if (typeof node === 'string' && /^[A-Za-z]+(\|[A-Za-z]+)+$/.test(node)) return node.replace(/\|/g, ', ');
  return node;
}

/** The local dump's decoded files are wrapped as {$file,$root,$type,data}; the remote layout is the `data`. Persistent wins over StreamingAssets. */
function localFile(path) {
  for (const r of ['Persistent', 'StreamingAssets']) {
    const f = join(LOCAL, 'jsondata', r, ...path.replace(/^Json\//, '').split('/'));
    if (existsSync(f)) return remoteShape(parse(readFileSync(f, 'utf8')).data);
  }
  return null;
}

async function get(path) {
  if (LOCAL_JSON && path.startsWith('Json/')) return localFile(path);
  const file = join(CACHE, path.replace(/\//g, '__'));
  if (existsSync(file)) return parse(readFileSync(file, 'utf8'));
  for (let tries = 0; ; tries++) {
    const r = await fetch(`${RAW}/${path}`, { headers: UA });
    if (r.status === 404) return null;
    if (r.ok) {
      const text = await r.text();
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(file, text);
      return parse(text);
    }
    if (tries >= 2) throw new Error(`${path}: ${r.status}`);
    await new Promise((ok) => setTimeout(ok, 2000 * (tries + 1)));
  }
}
const skillFile = (id) => get(`Json/SkillData/${id}.json`);
const short = (t) => (t || '').split(',')[0].split('.').pop();

const PATCH = LOCAL ? parseLocal(readFileSync(join(LOCAL, 'Data', 'TableCfg', 'SkillPatchTable.json'), 'utf8')) : await get('TableCfg/SkillPatchTable.json');
const operators = JSON.parse(readFileSync(join(ROOT, 'wiki', 'operators.json'), 'utf8')).operators;

/** A blackboard-or-direct value: the key it reads (with its default), or the value. */
const val = (v) => (v == null ? null : v.useBlackboardKey ? { key: v.blackboardKey } : { value: v.value });

/** Walks a list of actions at `frame`, following projectiles and spawned entities into their own skill files. */
async function collect(list, ctx, out) {
  for (const a of list ?? []) {
    if (!a || a.isEnable === false) continue;
    const t = short(a['$type']);
    const at = { f: ctx.frame, ...(ctx.via.length ? { via: ctx.via.join('>') } : {}), ...(ctx.cond.length ? { cond: ctx.cond.join(' | ') } : {}) };
    if (t === 'DamageAction+DamageActionData')
      for (const u of a.damageUnits ?? []) {
        // HP damage: ATK × a multiplier (a calculation object when not simple); Poise: Stagger.
        if (u.damageAttributeType === 'Poise') out.stagger.push({ ...at, amount: val(u.poiseCalculation?.value ?? u.atkScale) });
        else out.hits.push({ ...at, type: u.damageType, scale: val(u.simpleCalculation === false && u.atkCalculation?.atkScale ? u.atkCalculation.atkScale : u.atkScale) });
      }
    else if (t === 'SpellInfliction+Data') out.inflictions.push({ ...at, type: a.inflictionType, ...(a.isExtra ? { extra: true } : {}) });
    else if (t === 'ObtainCostAction+Data') out.gains.push({ ...at, cost: a.costType, amount: val(a.costValue) });
    else if (t === 'CreateBuffAction+Data') out.buffs.push({ ...at, ids: a.buffs.map((b) => b.buffId) });
    else if (t === 'LaunchProjectile+Data' && a.castSkillOnHit && a.projectileSkillId) await follow(a.projectileSkillId, { ...ctx, via: [...ctx.via, 'projectile'] }, out);
    else if (t === 'SpawnAbilityEntity+Data' && a.abilityEntitySkillId) await follow(a.abilityEntitySkillId, { ...ctx, via: [...ctx.via, 'entity'] }, out);
    if (t === 'IfElseAction+IfElseActionData') {
      const cond = (a.conditionAction?.actionData ?? []).map((c) => short(c['$type']).replace(/\+Data$/, '')).join('&');
      await collect(a.succeedActions?.actionData, { ...ctx, cond: [...ctx.cond, cond] }, out);
      await collect(a.failActions?.actionData, { ...ctx, cond: [...ctx.cond, `!${cond}`] }, out);
      continue;
    }
    // Other containers of actions (sequences, loops...): same frame.
    for (const [k, v] of Object.entries(a))
      if (k !== 'conditionAction' && v && typeof v === 'object' && Array.isArray(v.actionData)) await collect(v.actionData, { ...ctx, cond: [...ctx.cond, `${t.replace(/\+Data$/, '')}.${k}`] }, out);
  }
}

async function follow(id, ctx, out) {
  if (ctx.seen.has(id) || ctx.via.length > 4) return;
  const j = await skillFile(id);
  if (!j) return void out.missing.push(id);
  await timeline(j, { ...ctx, seen: new Set([...ctx.seen, id]) }, out);
}

async function timeline(j, ctx, out) {
  for (const ta of j.actionGroupData?.timelineActions ?? []) await collect(ta._sequenceActionData?.actionData, { ...ctx, frame: ctx.frame + ta._startFrame }, out);
}

const windowOf = (j, type) => {
  const w = (j.actionGroupData?.timelineActions ?? []).find((ta) => (ta._sequenceActionData?.actionData ?? []).some((d) => short(d['$type']) === type));
  return w ? [w._startFrame, w._endFrame] : null;
};

async function skillTimeline(id) {
  const j = await skillFile(id);
  if (!j) return null;
  const out = { hits: [], stagger: [], inflictions: [], gains: [], buffs: [], missing: [] };
  await timeline(j, { frame: 0, via: [], cond: [], seen: new Set([id]) }, out);
  const levels = PATCH[id]?.SkillPatchDataBundle ?? [];
  const values = {};
  for (const l of levels) for (const b of l.blackboard) (values[b.key] ??= []).push(Number(Number(b.value).toFixed(4)));
  const { missing, ...rest } = out;
  return {
    kind: j.skillSpecification,
    duration: j.durationFrame,
    exclusive: j.exclusiveFrame,
    next: windowOf(j, 'AllowNextSkillAction+Data'),
    cooldown: levels.map((l) => l.coolDown),
    cost: { type: j.castData.costData.costType, value: levels.map((l) => l.costValue) },
    values,
    ...rest,
    ...(missing.length ? { missing } : {}),
  };
}

const out = {};
const report = [];
for (const [opId, op] of Object.entries(operators)) {
  const ids = Object.keys(PATCH).filter((k) => k.startsWith(`${opId}_`));
  if (!ids.length) {
    report.push(`${op.name}: no skills in the table`);
    continue;
  }
  const skills = {};
  for (let i = 0; i < ids.length; i += 4) {
    const batch = ids.slice(i, i + 4);
    const done = await Promise.all(batch.map(skillTimeline));
    batch.forEach((id, k) => done[k] && (skills[id.slice(opId.length + 1)] = done[k]));
  }
  out[opId] = { name: op.name, element: op.element, skills };
}
const count = Object.values(out).reduce((n, o) => n + Object.keys(o.skills).length, 0);
console.log(`Combat: ${Object.keys(out).length} operators, ${count} skills.`);
for (const l of report) console.log(`  ${l}`);
if (!DRY) {
  mkdirSync(join(ROOT, 'combat'), { recursive: true });
  writeFileSync(
    join(ROOT, 'combat', 'skills.json'),
    `${JSON.stringify({ source: LOCAL_JSON ? 'the game files (a local EndfieldDataDump)' : DUMP, note: 'Game data © Gryphline / Hypergryph.', fetched: new Date().toISOString().slice(0, 10), fps: 30, operators: out })}\n`,
  );
}
