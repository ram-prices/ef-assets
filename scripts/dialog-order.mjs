#!/usr/bin/env node
/**
 * The order of each dialogue's lines and replies, from the game's dialogue
 * trees (Beyond.Gameplay.DialogTree, the dlg_<mission>_<scene>.txt assets
 * in the game's bundles), written to dialog/order.json for scripts/story.mjs.
 *
 * Each tree is lines (trunk nodes) and reply nodes joined by connections.
 * Walked from its start: a line is its number, a reply node is where the
 * player picks, with the lines each reply leads to until the replies meet
 * again; a reply that leads back to a choice already on the way ends "back";
 * a line that goes on two ways (by conditions the trees don't name) is a split.
 *
 *   node scripts/dialog-order.mjs <folder with the exported bundles>
 *
 * The trees aren't in the online dump: run it on an export of the bundles.
 *
 * Output: { "<tree>": Flow } where Flow = Step[], Step =
 *   number            a line of the tree's own scene (dlg_<tree>_<number>)
 *   string            a line of another scene (its full id)
 *   { r: [[id, Flow], ...] }   replies (option id without "option_dlg_<tree>_"), each with its own lines
 *   "back"            back to the last choice on the way
 *   { v: [Flow, ...] }  the dialogue goes one of these ways
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2];
if (!root) throw new Error('usage: node scripts/dialog-order.mjs <export folder>');
const OUT = fileURLToPath(new URL('../dialog/', import.meta.url));

const kind = (x) => x.$type.split('.').pop().replace('DialogTree', '').replace('Dialog', '');
const CONTENT = new Set(['TrunkNode', 'OptionNode', 'FinishNode']);

function files(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/^dlg_[a-z]+\d[a-z0-9_]*\.txt$/.test(f) && !f.includes('extra_config')) out.push(p);
  }
  return out;
}

function flowOf(tree, name) {
  const nodes = new Map(tree.nodes.filter((x) => x.$id != null).map((x) => [x.$id, x]));
  const ref = (r) => r.$ref ?? r.$id;
  const out = new Map();
  for (const c of tree.connections) {
    const s = ref(c._sourceNode);
    if (!out.has(s)) out.set(s, []);
    out.get(s).push(ref(c._targetNode));
  }
  const edges = (i) => (out.get(i) ?? []).filter((t) => nodes.has(t));
  const content = (i) => CONTENT.has(kind(nodes.get(i)));
  // The first line, reply or end along an edge (actor and camera side nodes lead nowhere).
  const first = (j) => {
    const seen = new Set();
    while (j != null && !content(j) && !seen.has(j)) {
      seen.add(j);
      const next = edges(j);
      j = next.find(content) ?? next[0];
    }
    return j != null && content(j) ? j : null;
  };
  const nexts = (i) => [...new Set(edges(i).map(first).filter((x) => x != null))];
  const reachCache = new Map();
  const reach = (i) => {
    if (reachCache.has(i)) return reachCache.get(i);
    const dist = new Map([[i, 0]]);
    let frontier = [i];
    while (frontier.length) {
      const next = [];
      for (const j of frontier) for (const k of nexts(j)) if (!dist.has(k)) (dist.set(k, dist.get(j) + 1), next.push(k));
      frontier = next;
    }
    reachCache.set(i, dist);
    return dist;
  };
  // Where branches meet again: the nearest node all of them reach (not a choice still on the way).
  const meet = (targets, active) => {
    const rs = targets.filter((t) => t != null).map(reach);
    if (!rs.length) return null;
    let best = null;
    let bestD = Infinity;
    for (const c of rs[0].keys()) {
      if (active.has(c) || !rs.every((r) => r.has(c))) continue;
      const d = Math.max(...rs.map((r) => r.get(c)));
      if (d < bestD || (d === bestD && c < best)) (best = c), (bestD = d);
    }
    return best;
  };
  const lineOf = (i) => {
    const id = nodes.get(i)._actorNodeData?.mfTrunkActionData?._trunkId;
    if (!id) return null;
    const own = id.startsWith(`${name}_`) && /^\d+$/.test(id.slice(name.length + 1));
    return own ? Number(id.slice(name.length + 1)) : id;
  };
  const optionOf = (id) => id.replace(`option_${name}_`, '');
  const memo = new Map();
  const seq = (i, stop, active) => {
    const key = `${i}|${stop}|${[...active].sort().join(',')}`;
    if (memo.has(key)) return memo.get(key);
    const items = [];
    const seen = new Set();
    while (i != null && i !== stop) {
      if (active.has(i)) {
        items.push('back');
        break;
      }
      if (seen.has(i)) break;
      seen.add(i);
      const k = kind(nodes.get(i));
      if (k === 'OptionNode') {
        const opts = (nodes.get(i)._normalOptions ?? []).map((o) => optionOf(o._optionId));
        const targets = edges(i).map(first);
        const inner = new Set([...active, i]);
        const m = meet(targets, inner);
        items.push({ r: opts.map((o, j) => [o, targets[j] != null && targets[j] !== m ? seq(targets[j], m, inner) : []]) });
        i = m;
        continue;
      }
      if (k === 'TrunkNode') {
        const l = lineOf(i);
        if (l != null) items.push(l);
      }
      const nx = nexts(i);
      if (nx.length > 1) {
        const m = meet(nx, active);
        items.push({ v: nx.map((t) => (t !== m ? seq(t, m, active) : [])) });
        i = m;
        continue;
      }
      i = nx[0] ?? null;
    }
    memo.set(key, items);
    return items;
  };
  const incoming = new Set([...out.values()].flat());
  const start = [...nodes.keys()].find((i) => !incoming.has(i));
  return start == null ? [] : seq(start, null, new Set());
}

const order = {};
let replies = 0;
// The patch folder (Persistent) is newer than the install (StreamingAssets): its copy wins.
const newest = (p) => (/[\\/]Persistent[\\/]/.test(p) ? 1 : 0);
for (const p of files(root).sort((a, b) => newest(a) - newest(b) || a.localeCompare(b))) {
  const name = p.split(/[\\/]/).pop().replace(/\.txt$/, '');
  // Unity writes curve tangents as Infinity / NaN, which JSON doesn't allow.
  const tree = JSON.parse(readFileSync(p, 'utf8').replace(/:\s*-?(?:Infinity|NaN)(?=\s*[,}\]])/g, ': null'));
  if (tree.type !== 'Beyond.Gameplay.DialogTree') continue;
  const flow = flowOf(tree, name);
  if (!flow.length) continue;
  order[name] = flow;
  replies += JSON.stringify(flow).split('"r":').length - 1;
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'order.json'), `${JSON.stringify({ note: "Dialogue order from the game's dialogue trees. Game data © Gryphline / Hypergryph.", trees: order })}\n`);
console.log(`dialog order: ${Object.keys(order).length} trees, ${replies} reply groups`);
