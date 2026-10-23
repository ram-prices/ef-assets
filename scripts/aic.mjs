#!/usr/bin/env node
/**
 * AIC planner data from the game's own tables (the EndfieldData community
 * dump, git.escartem.moe/Endfield/EndfieldData), written to aic/planner.json
 * for ItJustLogs' AIC planner:
 *
 * - recipes: every production facility recipe (seconds per craft, what goes
 *   in and out; `mode`, the facility mode it needs, which a region must
 *   allow: Valley IV only "normal"; `carrier` when it empties a filled
 *   bottle or canister), plus mining rigs, pumps and the gas extractor as recipes
 *   with nothing in (`source`: they need an ore node or water). Event-only
 *   items (`item_activity_*`) are left out.
 * - machines: power use, Protocol Capacity ("bandwidth") and footprint;
 *   `perRegion` where a region allows only so many (Forge of the Sky).
 * - items: English name, phase (solid, liquid, gas) and which regions'
 *   depots hold it (`depot`); a filled bottle is named after its bottle and
 *   what's in it.
 * - depot: a belt's items a minute, the Depot Loader and Unloader, and a
 *   core's free ports into and out of the depot.
 * - fuels: what a Thermal Bank makes from each fuel and how long it burns.
 * - regions: each region's PAC power, its areas' Protocol Capacity at every
 *   Regional Development level and ore and gas nodes (item, x, z), and Regional Transfer (items an hour by
 *   level, which items can go, the level where it stops losing items).
 *
 *   node scripts/aic.mjs [--dry-run] [--local <dump output folder>]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DUMP = 'https://git.escartem.moe/Endfield/EndfieldData';
const RAW = `${DUMP}/raw/branch/master`;
const UA = { 'User-Agent': 'ef-assets AIC snapshot (github.com/ram-prices/ef-assets; ItJustLogs)' };
const OUT = fileURLToPath(new URL('../aic/', import.meta.url));
const DRY = process.argv.includes('--dry-run');
const LOCAL = process.argv.includes('--local') ? process.argv[process.argv.indexOf('--local') + 1] : null;

/** The tables' text ids are 64-bit: kept as their digits, which JSON.parse would round. */
const parse = (text) => JSON.parse(text, (k, v, ctx) => (typeof v === 'number' && !Number.isSafeInteger(v) && ctx?.source ? ctx.source : v));
async function get(url) {
  for (let tries = 0; ; tries++) {
    const r = await fetch(url, { headers: UA });
    if (r.ok) return parse(await r.text());
    if (tries >= 2 || r.status < 500) throw new Error(`${url}: ${r.status}`);
    await new Promise((ok) => setTimeout(ok, 2000 * (tries + 1)));
  }
}
const json = (path) => (LOCAL ? parse(readFileSync(join(LOCAL, 'raw', 'StreamingAssets', 'JsonData', 'Data', 'Json', path), 'utf8')) : get(`${RAW}/Json/${path}`));
const table = (name) => (LOCAL ? parse(readFileSync(join(LOCAL, 'Data', 'TableCfg', `${name}.json`), 'utf8')) : get(`${RAW}/TableCfg/${name}.json`));

const [en, itemTable, facItems, buildings, crafts, crafters, miners, gasMiners, pumps, fuels, hubs, domains, transfer, levels, belts] = await Promise.all(
  [
    'I18nTextTable_EN',
    'ItemTable',
    'FactoryItemTable',
    'FactoryBuildingTable',
    'FactoryMachineCraftTable',
    'FactoryMachineCrafterTable',
    'FactoryMinerTable',
    'FactoryGasMinerTable',
    'FactoryFluidPumpInTable',
    'FactoryFuelItemTable',
    'FactoryHubTable',
    'DomainDataTable',
    'FactoryDomainItemTransmissionTable',
    'LevelDescTable',
    'FactoryGridBeltTable',
  ].map(table),
);
// Every ore and gas node in each area, where it is (world x, z: one unit is one AIC grid cell).
const factoryRegions = (await json('LevelGenForRuntime/TotalFactoryRegions.json')).regions;
const nodesOf = (level) =>
  factoryRegions
    .filter((r) => r.sceneId === level)
    .flatMap((r) => r.mines.map((m) => [m.itemId, m.trans.voxelPosition.x, m.trans.voxelPosition.z]));

const T = (ref) => (ref && ref.id && ref.id !== '0' && ref.id !== 0 ? (en[String(ref.id)]?.trim() ?? null) : null);
const PHASE = { 1: 'solid', 2: 'liquid', 4: 'gas' };
const skip = (id) => /activity/.test(id);

const recipes = [];
const used = new Set();
const machinesUsed = new Set();
const pair = (list) => list.map((x) => [x.id, x.count]);
for (const r of Object.values(crafts)) {
  const ins = r.ingredients.flatMap((g) => g.group);
  const outs = r.outcomes.flatMap((g) => g.group);
  if ([...ins, ...outs].some((x) => skip(x.id)) || !buildings[r.machineId] || /_nop/.test(r.machineId)) continue;
  const mode = crafters[r.machineId]?.modeMap?.find((m) => m.groupName === r.formulaGroupId)?.modeName ?? 'normal';
  recipes.push({ id: r.id, machine: r.machineId, seconds: r.progressRound, mode, in: pair(ins), out: pair(outs) });
  for (const x of [...ins, ...outs]) used.add(x.id);
  machinesUsed.add(r.machineId);
}
// Rigs, pumps and the gas extractor: one item a round from a node or water.
for (const [id, m] of [...Object.entries(miners), ...Object.entries(gasMiners)])
  for (const x of m.mineable) {
    const ins = x.consumeItem?.id ? [[x.consumeItem.id, x.consumeItem.count]] : [];
    const mode = PHASE[facItems[x.miningItemId]?.phaseType] === 'gas' ? 'gas' : ins.length ? 'liquid' : 'normal';
    recipes.push({ id: `${id}:${x.miningItemId}`, machine: id, seconds: m.msPerRound / 1000, mode, in: ins, out: [[x.miningItemId, x.produceRate]], source: 'node' });
    used.add(x.miningItemId);
    for (const [i] of ins) used.add(i);
    machinesUsed.add(id);
  }
for (const [id, p] of Object.entries(pumps)) {
  if (!buildings[id]) continue;
  recipes.push({ id: `${id}:item_liquid_water`, machine: id, seconds: p.msPerRound / 1000, mode: 'liquid', in: [], out: [['item_liquid_water', 1]], source: 'water' });
  used.add('item_liquid_water');
  machinesUsed.add(id);
}
// Thermal Bank: listed with the fuels. Depot Loader and Unloader: moving items between a site and its region's depot.
machinesUsed.add('power_station_1');
machinesUsed.add('loader_1');
machinesUsed.add('unloader_1');
for (const f of Object.keys(fuels)) used.add(f);

// Item names; a filled bottle is "<bottle> (<what's in it>)", from the recipes that fill it.
const items = {};
const nameOf = (id) => T(itemTable[id]?.name) ?? id;
for (const id of used) {
  const f = facItems[id];
  items[id] = { name: nameOf(id), phase: PHASE[f?.phaseType] ?? 'solid', depot: (f?.showInHubDomainIds ?? []).filter((d) => domains[d]) };
  const transfer = (f?.transferDomainIds ?? []).filter((d) => domains[d]);
  if (transfer.length) items[id].transfer = transfer;
}
const filled = new Set();
for (const r of recipes) {
  const m = r.machine === 'filling_powder_mc_1' && r.in.length === 2 && r.out.length === 1 && r.out[0][0].startsWith('item_fbottle');
  const jar = r.machine === 'filling_powder_mc_1' && r.out.length === 1 && r.out[0][0].startsWith('item_gasjar');
  if (!m && !jar) continue;
  items[r.out[0][0]].name = `${nameOf(r.in[0][0])} (${nameOf(r.in[1][0])})`;
  filled.add(r.out[0][0]);
}
// Emptying a filled bottle or canister: a way to carry fluids, marked so the planner prefers making the fluid.
for (const r of recipes) if (r.in.some(([id]) => filled.has(id))) r.carrier = true;
// Names still shared by different items: the id says which.
const byName = new Map();
for (const [id, x] of Object.entries(items)) byName.set(x.name, [...(byName.get(x.name) ?? []), id]);
const clash = [...byName.entries()].filter(([, ids]) => ids.length > 1);

const machines = {};
for (const id of machinesUsed) {
  const b = buildings[id];
  machines[id] = { name: T(b.name) ?? id, power: b.powerConsume, capacity: b.bandwidth, size: [b.range.width, b.range.depth] };
  if (b.placeDomainLimitCnt?.length) machines[id].perRegion = b.placeDomainLimitCnt[0];
  if (b.placeDomains?.length) machines[id].regions = b.placeDomains;
}

const fuelsOut = Object.fromEntries(Object.entries(fuels).map(([id, f]) => [id, { power: f.powerProvide, seconds: f.progressRound }]));

const regions = Object.values(domains).map((d) => {
  const lv = d.domainDevelopmentLevel;
  const areas = d.levelGroup.map((lid) => ({
    id: lid,
    name: T(levels[lid]?.showName) ?? lid,
    capacity: lv.map((l) => l.domainDevelopmentLevelEffect[lid]?.bandwidth ?? 0),
    nodes: nodesOf(lid),
  }));
  const t = transfer[d.domainId];
  return {
    id: d.domainId,
    name: T(d.domainName) ?? d.domainId,
    power: hubs.sp_hub_1.powerGenerate,
    modes: d.machineModeTypeGroup,
    levels: lv.length,
    areas,
    ...(t && t.unlockLevel <= lv.length
      ? { transfer: { perHour: lv.map((_, i) => t.levelToCapacity[String(i + 1)] ?? 0), routes: t.routeNum, lossless: t.unlockLosslessLevel } }
      : {}),
  };
});

const out = {
  source: DUMP,
  note: 'From the game’s own tables (EndfieldData dump). Game data © Gryphline / Hypergryph.',
  fetched: new Date().toISOString().slice(0, 10),
  thermalBank: 'power_station_1',
  // A belt's items a minute; a core's (PAC or Sub-PAC) free ports into and out of the depot.
  depot: {
    loader: 'loader_1',
    unloader: 'unloader_1',
    beltPerMin: 60000 / belts.grid_belt_01.beltData.msPerRound,
    coreIn: buildings.sp_sub_hub_1.inputPorts.length,
    coreOut: buildings.sp_sub_hub_1.outputPorts.length,
  },
  items,
  machines,
  recipes,
  fuels: fuelsOut,
  regions,
};
console.log(`AIC: ${recipes.length} recipes, ${Object.keys(machines).length} facilities, ${Object.keys(items).length} items, ${regions.length} regions.`);
for (const [name, ids] of clash) console.log(`  Shared name "${name}": ${ids.join(', ')}`);
if (!DRY) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'planner.json'), `${JSON.stringify(out)}\n`);
}
