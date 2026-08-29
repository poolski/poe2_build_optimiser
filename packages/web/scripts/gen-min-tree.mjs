// Generate packages/web/public/tree-0_5.min.json from PoB's vendored tree.json.
//
// COMMITTED artifact, NOT a build step. Rationale (intake/web-ui/08-fork-prep.md task 6): a
// build step would re-couple the canvas track (06) to the pob-runtime submodule, which is
// exactly what fork-prep removes. Re-run only when the tree version bumps:
//
//   node packages/web/scripts/gen-min-tree.mjs
//
// Output shape (see `meta` in the file too):
//   meta        - provenance + the node-tuple field order + the orbit-angle formula
//   bounds      - { minX,minY,maxX,maxY } world-space tree extent
//   constants   - { orbitRadii, skillsPerOrbit, PSSCentreInnerRadius }
//                 node angle = 2*PI * orbitIndex / skillsPerOrbit[orbit]  (all orbits uniform;
//                 PoB's orbitAnglesByOrbit table is dropped as fully derivable -- verified)
//   strings[]   - interned node names + stat lines (the tree repeats stat lines heavily)
//   groups      - { "<gid>": [x, y] }
//   nodes       - { "<id>": [gid, orbit, orbitIndex, nameIdx, kind, conns[], statIdx[]?, ascNameIdx?] }
//                 kind: 0 normal | 1 notable | 2 keystone | 3 jewel | 4 attribute
//   nodeFlags   - { "<id>": { ascStart?, classesStart? } }  (a few dozen nodes only)
//
// Dropped from source: sprite sheets, imageZoomLevels, nodeOverlay frame names, per-node
// icon paths, flavour text, ddsCoords/assets/connectionArt (all GGG art), orbitAnglesByOrbit.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(
  here,
  "../../pob-bridge/pob-runtime/PathOfBuilding-PoE2/src/TreeData/0_5/tree.json",
);
const OUT = resolve(here, "../public/tree-0_5.min.json");
const TREE_VERSION = "0_5";

const src = JSON.parse(readFileSync(SRC, "utf-8"));

const strings = [];
const strIndex = new Map();
const intern = (s) => {
  let i = strIndex.get(s);
  if (i === undefined) {
    i = strings.length;
    strings.push(s);
    strIndex.set(s, i);
  }
  return i;
};

const KIND = { normal: 0, notable: 1, keystone: 2, jewel: 3, attribute: 4 };
function kindOf(n) {
  if (n.isKeystone) return KIND.keystone;
  if (n.isNotable) return KIND.notable;
  if (n.isJewelSocket) return KIND.jewel;
  if (n.isAttribute) return KIND.attribute;
  return KIND.normal;
}
const round2 = (v) => Math.round(v * 100) / 100;

// `src.groups` is a 0-based JSON array, but `node.group` is a 1-based PoB/Lua group id
// (Lua tables are 1-indexed; the serialiser shifted them by one). So the group that holds a
// node lives at array index `node.group - 1`. Key our map by the 1-based id (index + 1) so a
// straight `groups[node.group]` lookup lands on the right group -- without this every node reads
// its neighbour group's coordinates and the whole tree scatters (09-rollback-tree-preview.md).
const groups = {};
src.groups.forEach((g, i) => {
  if (!g || typeof g.x !== "number" || typeof g.y !== "number") return;
  groups[String(i + 1)] = [round2(g.x), round2(g.y)];
});

const nodes = {};
const nodeFlags = {};
let orphanGroup = 0;
for (const [nid, n] of Object.entries(src.nodes ?? {})) {
  if (n.group === undefined || n.orbit === undefined) continue; // root sentinel / proxies
  if (!(String(n.group) in groups)) orphanGroup++;
  const tuple = [
    n.group,
    n.orbit ?? 0,
    n.orbitIndex ?? 0,
    intern(n.name ?? ""),
    kindOf(n),
    (n.connections ?? []).map((c) => c.id),
  ];
  const statIdx = (n.stats ?? []).map(intern);
  const ascIdx = n.ascendancyName ? intern(n.ascendancyName) : undefined;
  if (statIdx.length || ascIdx !== undefined) tuple.push(statIdx);
  if (ascIdx !== undefined) tuple.push(ascIdx);
  nodes[nid] = tuple;

  const flags = {};
  if (n.isAscendancyStart) flags.ascStart = true;
  if (n.classesStart) flags.classesStart = n.classesStart;
  if (Object.keys(flags).length) nodeFlags[nid] = flags;
}

const min = {
  meta: {
    treeVersion: TREE_VERSION,
    source: "packages/pob-bridge/pob-runtime/PathOfBuilding-PoE2/src/TreeData/0_5/tree.json",
    generatedBy: "packages/web/scripts/gen-min-tree.mjs (intake/web-ui/08-fork-prep.md task 6)",
    nodeFields: ["group", "orbit", "orbitIndex", "nameIdx", "kind", "conns", "statIdx?", "ascNameIdx?"],
    kinds: ["normal", "notable", "keystone", "jewel", "attribute"],
    angleFormula: "2*PI * orbitIndex / skillsPerOrbit[orbit]",
    groupFields: ["x", "y"],
    note: "Stylised-canvas geometry + node kind/name/stats. Committed artifact, not a build step.",
  },
  bounds: { minX: src.min_x, minY: src.min_y, maxX: src.max_x, maxY: src.max_y },
  constants: {
    orbitRadii: src.constants.orbitRadii,
    skillsPerOrbit: src.constants.skillsPerOrbit,
    PSSCentreInnerRadius: src.constants.PSSCentreInnerRadius,
  },
  strings,
  groups,
  nodes,
  nodeFlags,
};

writeFileSync(OUT, JSON.stringify(min));
const kb = (n) => (n / 1024).toFixed(0) + " KB";
console.log(
  `wrote ${OUT}\n  groups: ${Object.keys(groups).length}  nodes: ${Object.keys(nodes).length}` +
    `  strings: ${strings.length}  flagged: ${Object.keys(nodeFlags).length}  (orphan-group refs: ${orphanGroup})` +
    `\n  size: ${kb(readFileSync(OUT).length)} (source ${kb(readFileSync(SRC).length)})`,
);
