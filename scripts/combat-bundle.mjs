#!/usr/bin/env node
/**
 * Each operator's combat logic for ItJustLogs' damage simulator, from the
 * game's own files (the EndfieldData community dump: Json/SkillData,
 * Json/BuffData, TableCfg/SkillPatchTable), written to combat/ops/<id>.json:
 *
 * - skills: every skill the operator has, and every skill those reach
 *   (projectiles, spawned entities, cast or swapped-in skills), as the game
 *   stores them, minus what only shows or sounds (effects, camera,
 *   animation, voice...): the simulator runs the rest.
 * - buffs: every buff those skills or buffs create, check or end, the same way.
 * - patch: the skill table's numbers per rank (blackboard values, cooldown, cost).
 *
 * Anything a file names that looks like a skill or buff id is followed, so a
 * new kind of action doesn't hide what it uses.
 *
 *   node scripts/combat-bundle.mjs [operator id ...] [--local <dump output folder>]
 *
 * Skill and buff files are fetched a few at a time and cached in the system
 * temp folder between runs (`--local` reads only SkillPatchTable locally:
 * the local dump has the others in binary form).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DUMP = 'https://git.escartem.moe/Endfield/EndfieldData';
const RAW = `${DUMP}/raw/branch/master`;
const API = 'https://git.escartem.moe/api/v1/repos/Endfield/EndfieldData/contents';
const UA = { 'User-Agent': 'ef-assets combat snapshot (github.com/ram-prices/ef-assets; ItJustLogs)' };
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE = join(tmpdir(), 'ef-assets-combat');
const args = process.argv.slice(2);
const LOCAL = args.includes('--local') ? args[args.indexOf('--local') + 1] : null;
const only = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--local');

/** The tables' text ids are 64-bit: kept as their digits, which JSON.parse would round. */
const parse = (text) => JSON.parse(text, (k, v, ctx) => (typeof v === 'number' && !Number.isSafeInteger(v) && ctx?.source ? ctx.source : v));

async function get(path) {
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
async function listing(dir) {
  const file = join(CACHE, `list__${dir.replace(/\//g, '__')}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const r = await fetch(`${API}/${dir}?ref=master`, { headers: UA });
  if (!r.ok) throw new Error(`${dir}: ${r.status}`);
  const names = (await r.json()).map((f) => f.name.replace(/\.json$/, ''));
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, JSON.stringify(names));
  return names;
}

const short = (t) => (t || '').split(',')[0].split('.').pop().replace(/\+Data$|Data$/, '');

/** Actions that only show, sound or move the camera: left out. */
const PRESENTATION = new Set(
  [
    'EffectAction+EffectAction', 'CharWeaponVisibleAction+CharWeaponVisibleAction', 'PlaySoundAction+PlaySoundAction', 'CameraImpulseAction+CameraImpulseAction',
    'EnemyHurtAnimAction+', 'HitStopAction+', 'VoiceTriggerAction+VoiceTriggerAction', 'ShowHideActorAction+ShowHideActor', 'CustomRootMotionAction+',
    'AddDynamicCcsAction+AddDynamicCcsAction', 'OverrideCameraFollowAction+OverrideCameraFollowAction', 'RayCastEffectAction+RayCastEffectAction',
    'CharWeaponAnimationAction+CharWeaponAnimationAction', 'LockCameraAimAction+LockCameraAimAction', 'AnimatedCameraAction+AnimatedCameraAction',
    'HideUIAction+', 'UltimateShowAction+', 'CameraRotateAction+CameraRotationAction', 'SaveTwoDirectionAngle+', 'CheckComboSkillCameraAlphaSetting+',
    'SetAnimatorParamAction+', 'DebugPrintAction+', 'NotifyCharPassiveUIAction+', 'DisableMoveColliderAction+', 'DisableRootMotionAction+',
    'SetIgnoreGlobalTimeScaleAction+', 'AddCameraControlStateAction+AddCameraControlStateAction', 'InheritCCSAction+', 'IgnoreModelIntervalCheck+',
    'RaiseTrainLevelEvent+', 'TeleportAction+', 'TeleportPosSelectAction+', 'SelfRotateAction+', 'MoveToAction+', 'SnapToTargetWithRangeAction+',
    'JumpToAction+', 'BlowOffAction+', 'PushBackAction+', 'PullAction+',
  ].map((t) => t.replace(/\+$/, '')),
);
/** Fields that only describe presentation. */
const DROP_KEYS = new Set(['effectData', 'hitSoundData', 'playHitSound', 'iconConfig', 'iconId', 'skillName', 'uiRangeHints', 'comboSkillUIBigSpriteName', 'comboSkillUISpriteName']);

/** A copy without presentation, and every id it names. */
function trim(node, ids) {
  if (Array.isArray(node)) return node.filter((x) => !(x && typeof x === 'object' && PRESENTATION.has(short(x['$type'])))).map((x) => trim(x, ids));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (DROP_KEYS.has(k)) continue;
      out[k] = trim(v, ids);
    }
    return out;
  }
  if (typeof node === 'string' && /^(buff_|chr_|abilityentity_|projectile_|wpn_|equip_)/.test(node)) ids.add(node);
  return node;
}

const [skillNames, buffNames] = await Promise.all([listing('Json/SkillData'), listing('Json/BuffData')]);
const SKILLS = new Set(skillNames);
const BUFFS = new Set(buffNames);
const PATCH = LOCAL ? parse(readFileSync(join(LOCAL, 'Data', 'TableCfg', 'SkillPatchTable.json'), 'utf8')) : await get('TableCfg/SkillPatchTable.json');
const operators = JSON.parse(readFileSync(join(ROOT, 'wiki', 'operators.json'), 'utf8')).operators;

async function bundle(opId) {
  const skills = {};
  const buffs = {};
  const queue = skillNames.filter((n) => n.startsWith(`${opId}_`));
  const seen = new Set(queue);
  while (queue.length) {
    const batch = queue.splice(0, 6);
    const files = await Promise.all(batch.map((id) => get(`Json/${SKILLS.has(id) ? 'SkillData' : 'BuffData'}/${id}.json`)));
    batch.forEach((id, i) => {
      if (!files[i]) return;
      const ids = new Set();
      (SKILLS.has(id) ? skills : buffs)[id] = trim(files[i], ids);
      for (const x of ids)
        if (!seen.has(x) && (SKILLS.has(x) || BUFFS.has(x))) {
          seen.add(x);
          queue.push(x);
        }
    });
  }
  const patch = {};
  for (const id of Object.keys(skills))
    if (PATCH[id])
      patch[id] = PATCH[id].SkillPatchDataBundle.map((l) => ({
        level: l.level,
        values: Object.fromEntries(l.blackboard.map((b) => [b.key, b.valueStr || Number(b.value)])),
        cooldown: l.coolDown,
        cost: l.costValue,
      }));
  return { skills, buffs, patch };
}

const ids = only.length ? only : Object.keys(operators);
mkdirSync(join(ROOT, 'combat', 'ops'), { recursive: true });
for (const id of ids) {
  const b = await bundle(id);
  const text = `${JSON.stringify({ source: DUMP, note: 'Game data © Gryphline / Hypergryph.', fetched: new Date().toISOString().slice(0, 10), operator: id, ...b })}\n`;
  writeFileSync(join(ROOT, 'combat', 'ops', `${id}.json`), text);
  console.log(`${operators[id]?.name ?? id}: ${Object.keys(b.skills).length} skills, ${Object.keys(b.buffs).length} buffs, ${(text.length / 1024).toFixed(0)} KB`);
}
