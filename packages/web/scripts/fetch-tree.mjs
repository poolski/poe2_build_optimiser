// packages/web/scripts/fetch-tree.mjs
//
// Replaces gen-min-tree.mjs. Fetches the passive tree + stat text from RePoE-fork instead of
// PoB's vendored tree.json (intake/web-ui/10-repoe-asset-source.md, phase 1). Output shape is
// unchanged from gen-min-tree.mjs's tree-0_5.min.json EXCEPT the node tuple gains a trailing
// iconIdx (see meta.nodeFields), and every node tuple is now fixed-length (9) with statIdx=[]/
// ascNameIdx=null placeholders instead of gen-min-tree.mjs's variable-length tuples -- so a
// tuple's iconIdx is always at a fixed position regardless of whether the node has stats or an
// ascendancy name.
//
//   node packages/web/scripts/fetch-tree.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { translateStat } from "./statTranslate.mjs";

const TREE_VERSION = "0_5";
const BASE = "https://repoe-fork.github.io/poe2";
const TREE_URL = `${BASE}/passive_skill_trees/Default.min.json`;
const STAT_URLS = [
  `${BASE}/stat_translations/passive_skill_stat_descriptions.min.json`, // checked first: overrides
  `${BASE}/stat_translations/stat_descriptions.min.json`, // general fallback
];

const KIND = { normal: 0, notable: 1, keystone: 2, jewel: 3, attribute: 4 };
function kindOf(p) {
  if (p.is_keystone) return KIND.keystone;
  if (p.is_notable) return KIND.notable;
  if (p.is_jewel_socket) return KIND.jewel;
  return KIND.normal;
}
const round2 = (v) => Math.round(v * 100) / 100;

function makeInterner() {
  const strings = [];
  const index = new Map();
  return {
    strings,
    intern(s) {
      let i = index.get(s);
      if (i === undefined) {
        i = strings.length;
        strings.push(s);
        index.set(s, i);
      }
      return i;
    },
  };
}

/**
 * @param {{orbit_radii: number[], skills_per_orbit: number[], groups: object}} repoeTree
 * @param {Array<{ids: string[], English: object[]}>} translations - passive-specific entries
 *   first, general entries second (first-match-wins in translateStat)
 */
export function transformTree(repoeTree, translations) {
  const { intern, strings } = makeInterner();
  const groups = {};
  const nodes = {};

  const groupEntries = Array.isArray(repoeTree.groups)
    ? repoeTree.groups.map((g, i) => [String(i), g]).filter(([, g]) => g)
    : Object.entries(repoeTree.groups);

  for (const [gid, g] of groupEntries) {
    if (typeof g.x !== "number" || typeof g.y !== "number") continue;
    groups[gid] = [round2(g.x), round2(g.y)];
    for (const p of g.passives ?? []) {
      const statLines = translateStat(p.stats ?? {}, translations);
      const statIdx = statLines.map(intern);
      const ascNameIdx = p.ascendancy ? intern(p.ascendancy) : null;
      const iconIdx = intern(p.icon ?? "");
      nodes[String(p.hash)] = [
        Number(gid),
        p.radius ?? 0,
        p.position_clockwise ?? 0,
        intern(p.name ?? ""),
        kindOf(p),
        p.connections ?? [],
        statIdx,
        ascNameIdx,
        iconIdx,
      ];
    }
  }

  return {
    meta: {
      treeVersion: TREE_VERSION,
      source: TREE_URL,
      generatedBy: "packages/web/scripts/fetch-tree.mjs (intake/web-ui/10-repoe-asset-source.md phase 1)",
      nodeFields: ["group", "orbit", "orbitIndex", "nameIdx", "kind", "conns", "statIdx", "ascNameIdx?", "iconIdx"],
      kinds: ["normal", "notable", "keystone", "jewel", "attribute"],
      angleFormula: "2*PI * orbitIndex / skillsPerOrbit[orbit]",
      groupFields: ["x", "y"],
      note: "RePoE-fork sourced (geometry, kind/name/stats, icon path). Committed artifact, not a build step.",
    },
    constants: {
      orbitRadii: repoeTree.orbit_radii,
      skillsPerOrbit: repoeTree.skills_per_orbit,
    },
    strings,
    groups,
    nodes,
  };
}

export async function fetchTree(destRoot, fetchImpl) {
  const [tree, passiveStx, generalStx] = await Promise.all([
    fetchImpl(TREE_URL).then((r) => r.json()),
    fetchImpl(STAT_URLS[0]).then((r) => r.json()),
    fetchImpl(STAT_URLS[1]).then((r) => r.json()),
  ]);
  const out = transformTree(tree, [...passiveStx, ...generalStx]);
  const dest = resolve(destRoot, "tree-0_5.min.json");
  writeFileSync(dest, JSON.stringify(out));
  const kb = (n) => (n / 1024).toFixed(0) + " KB";
  console.log(
    `wrote ${dest}\n  groups: ${Object.keys(out.groups).length}  nodes: ${Object.keys(out.nodes).length}` +
      `  strings: ${out.strings.length}\n  size: ${kb(JSON.stringify(out).length)}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const here = dirname(fileURLToPath(import.meta.url));
  await fetchTree(resolve(here, "../public"), fetch);
}
