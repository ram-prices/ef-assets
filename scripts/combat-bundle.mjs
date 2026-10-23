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
 * - talents: PotentialTalentEffectTable's entries for the operator (talent
 *   levels and Potentials), `conditions` they depend on (SkillConditionTable),
 *   and `attributes`: attribute numbers as the names the data uses.
 * - base: the operator's attributes at each level (CharacterTable, at the
 *   level's highest promotion), which attributes are its main and secondary,
 *   and `nodes`: the attribute talents (CharGrowthTable attribute nodes, such
 *   as "Forged": Strength +10/+15/+15/+20), each with the promotion it needs.
 *
 * And for builds, combat/weapons/<id>.json (each weapon's skills the same way,
 * its base ATK by level, its skills' level caps) and combat/gear.json (every
 * gear piece's stats at each artifice level, the sets' skills).
 *
 * Anything a file names that looks like a skill or buff id is followed, so a
 * new kind of action doesn't hide what it uses.
 *
 *   node scripts/combat-bundle.mjs [operator id ...] [--builds] [--local <dump output folder>]
 *
 * With operator ids, only those are written (and weapons and gear with --builds).
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
    'BlowOffAction+', 'PushBackAction+', 'PullAction+',
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
const table = (name) => (LOCAL ? parse(readFileSync(join(LOCAL, 'Data', 'TableCfg', `${name}.json`), 'utf8')) : get(`TableCfg/${name}.json`));
const [PATCH, TALENTS, CONDITIONS, ATTR_META, CHARACTERS, WEAPONS, WEAPON_LEVELS, WEAPON_BREAKS, WEAPON_TALENTS, EQUIP, SUITS, COMPOSITES, GROWTH] = await Promise.all(
  [
    'SkillPatchTable', 'PotentialTalentEffectTable', 'SkillConditionTable', 'AttributeMetaTable', 'CharacterTable', 'WeaponBasicTable', 'WeaponUpgradeTemplateTable',
    'WeaponBreakThroughTemplateTable', 'WeaponTalentTemplateTable', 'EquipTable', 'EquipSuitTable', 'CompositeAttributeTable', 'CharGrowthTable',
  ].map(table),
);
/**
 * Attribute numbers as the data's names: the names gear stats give them
 * (EquipTable packAttrType: 87 → PhysicalAndSpellInflictionEnhance, Arts
 * Intensity), else their icon's (icon_attribute_wisd → Wisd).
 */
const ATTRIBUTES = Object.fromEntries(
  Object.values(ATTR_META)
    .filter((a) => a.iconName)
    .map((a) => [a.attributeType, a.iconName.replace(/^icon_(attribute_)?/, '').replace(/(^|_)(\w)/g, (_, __, c) => c.toUpperCase())]),
);
for (const e of Object.values(EQUIP)) for (const d of e.displayAttrModifiers ?? []) if (d.attrType && d.packAttrType && !d.compositeAttr) ATTRIBUTES[d.attrType] = d.packAttrType;
ATTRIBUTES[0] = 'Level';
// Two numbers share the Ether icon: 55 sits with the DMG bonuses (50-54).
ATTRIBUTES[55] = 'EtherDamageIncrease';
/** Names that stand for several attributes (AllSkillDamageIncrease → the battle skill's, combo's and ultimate's). */
const COMPOSITE = Object.fromEntries(Object.entries(COMPOSITES).map(([k, v]) => [k, v.list]));
const operators = JSON.parse(readFileSync(join(ROOT, 'wiki', 'operators.json'), 'utf8')).operators;

/** Skills and buffs from `roots`, and every one they reach, without presentation; and their skill table rows. */
async function follow(roots) {
  const skills = {};
  const buffs = {};
  const queue = roots.filter((id, i) => roots.indexOf(id) === i && (SKILLS.has(id) || BUFFS.has(id)));
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

/** An attribute list ([{attrType, attrValue}]) by name. */
const named = (attrs) => Object.fromEntries(attrs.filter((a) => ATTRIBUTES[a.attrType]).map((a) => [ATTRIBUTES[a.attrType], Number(a.attrValue)]));

async function bundle(opId) {
  // Talents and Potentials: what each level does (attach a skill or buff, set skill values, change attributes).
  const talents = Object.fromEntries(Object.entries(TALENTS).filter(([k]) => k.startsWith(`${opId}_`)).map(([k, v]) => [k, v.dataList]));
  const conditions = {};
  for (const list of Object.values(talents)) for (const d of list) for (const c of d.activeCondition ?? []) if (CONDITIONS[c]) conditions[c] = CONDITIONS[c];
  const roots = skillNames.filter((n) => n.startsWith(`${opId}_`));
  for (const list of Object.values(talents)) for (const d of list) roots.push(...[d.attachBuff?.buffId, d.attachSkill?.skillId].filter(Boolean));
  const c = CHARACTERS[opId];
  // Each level at its highest promotion.
  const levels = {};
  for (const row of c?.attributes ?? []) {
    const attrs = named(row.Attribute.attrs);
    levels[attrs.Level] = attrs;
  }
  // Attribute talents: each node's additions and the promotion (break stage) it needs.
  const nodes = Object.values(GROWTH?.[opId]?.talentNodeMap ?? {})
    .map((n) => n.attributeNodeInfo)
    .filter((n) => n?.attributeModifiers?.length)
    .map((n) => ({ stage: n.breakStage, attrs: n.attributeModifiers.filter((m) => ATTRIBUTES[m.attrType]).map((m) => ({ attr: ATTRIBUTES[m.attrType], value: Number(m.attrValue), how: m.modifierType })) }))
    .sort((a, b) => a.stage - b.stage);
  const base = c ? { main: ATTRIBUTES[c.mainAttrType], sub: ATTRIBUTES[c.subAttrType], levels, nodes } : undefined;
  // dontInterruptCombo: casting a skill keeps the basic attack chain where it was.
  return { element: c?.charTypeId, dontInterruptCombo: !!c?.dontInterruptCombo, ...(await follow(roots)), talents, conditions, attributes: ATTRIBUTES, composites: COMPOSITE, base };
}

async function weapon(id) {
  const w = WEAPONS[id];
  const breaks = WEAPON_BREAKS[w.breakthroughTemplateId]?.list ?? [];
  return {
    weapon: id,
    rarity: w.rarity,
    type: w.weaponType,
    // Its three skills: two attribute skills and its own; their level caps at full promotion, and what each Potential adds.
    skillList: w.weaponSkillList,
    maxSkillLevels: (breaks.at(-1)?.skillLevelBounds ?? []).map((b) => b.upperBound),
    potentialLevels: (WEAPON_TALENTS[w.talentTemplateId]?.list ?? []).map((t) => t.skillLevelExtraBounds.map((b) => b.upperBound)),
    baseAtk: Object.fromEntries((WEAPON_LEVELS[w.levelTemplateId]?.list ?? []).map((l) => [l.weaponLv, l.baseAtk])),
    ...(await follow(w.weaponSkillList)),
  };
}

/** Gear stats: BaseAddition (5) or BaseMultiplier (6), of an attribute or of the wearer's main (1) or secondary (2) one, at artifice 0–3. */
const HOW = { 5: 'BaseAddition', 6: 'BaseMultiplier', 7: 'Addition', 8: 'FinalMultiplier' };
async function gear() {
  const items = {};
  for (const [id, e] of Object.entries(EQUIP))
    items[id] = {
      suit: e.suitID || null,
      part: e.partType,
      level: e.minWearLv,
      stats: (e.equipAttrModifiers ?? []).map((m) => ({
        attr: m.modifyAttributeType === 1 ? 'Main' : m.modifyAttributeType === 2 ? 'Sub' : ATTRIBUTES[m.attrType] ?? String(m.attrType),
        how: HOW[m.modifierType] ?? String(m.modifierType),
        values: m.attrValues.map(Number),
      })),
    };
  // Each set's effects by pieces worn.
  const sets = Object.fromEntries(Object.entries(SUITS).map(([k, v]) => [k, (v.list ?? []).map((x) => ({ pieces: x.equipCnt, skill: x.skillID, level: x.skillLv }))]));
  return { items, sets, ...(await follow(Object.values(sets).flatMap((l) => l.map((s) => s.skill)))) };
}

const stamp = () => ({ source: DUMP, note: 'Game data © Gryphline / Hypergryph.', fetched: new Date().toISOString().slice(0, 10) });
const ids = only.length ? only : Object.keys(operators);
mkdirSync(join(ROOT, 'combat', 'ops'), { recursive: true });
for (const id of ids) {
  const b = await bundle(id);
  const text = `${JSON.stringify({ ...stamp(), operator: id, ...b })}\n`;
  writeFileSync(join(ROOT, 'combat', 'ops', `${id}.json`), text);
  console.log(`${operators[id]?.name ?? id}: ${Object.keys(b.skills).length} skills, ${Object.keys(b.buffs).length} buffs, ${(text.length / 1024).toFixed(0)} KB`);
}
if (!only.length || args.includes('--builds')) {
  mkdirSync(join(ROOT, 'combat', 'weapons'), { recursive: true });
  for (const id of Object.keys(WEAPONS)) writeFileSync(join(ROOT, 'combat', 'weapons', `${id}.json`), `${JSON.stringify({ ...stamp(), ...(await weapon(id)) })}\n`);
  console.log(`${Object.keys(WEAPONS).length} weapons`);
  const g = await gear();
  writeFileSync(join(ROOT, 'combat', 'gear.json'), `${JSON.stringify({ ...stamp(), ...g })}\n`);
  console.log(`gear: ${Object.keys(g.items).length} pieces, ${Object.keys(g.sets).length} sets`);
}
