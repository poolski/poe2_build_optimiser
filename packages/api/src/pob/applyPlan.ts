// Write an optimiser plan back into a build XML by replacing the base passive spec's
// `nodes="..."` id list.
//
// The id list to write is `OptimiseTreeResult.allocatedNodeIds.after` -- the CONNECTED
// post-plan set the bridge read back (every path node AllocNode dragged in included). It is
// NOT rebuilt here from `removed` + `addedNodeIds`: those are picks-only and would emit a
// disconnected tree (docs/gotchas.md, mapper obligation #3 in docs/web-ui/04-api-server.md).
//
// Only the first <Spec> element's `nodes` attribute is touched. PoB keeps weapon-set-specific
// deviations in separate <WeaponSet1 nodes> / <WeaponSet2 nodes> elements; the optimiser never
// changes those, so they are left exactly as-is.

const SPEC_OPEN_TAG = /<Spec\b[^>]*>/;
const NODES_ATTR = /(\bnodes=")[^"]*(")/;

/** Return `xml` with the base <Spec> `nodes` list replaced by `afterIds` (ascending ids). */
export function applyPlan(xml: string, afterIds: readonly number[]): string {
	const tagMatch = xml.match(SPEC_OPEN_TAG);
	if (!tagMatch) throw new Error("applyPlan: build XML has no <Spec> element");

	const oldTag = tagMatch[0];
	const nodeList = afterIds.join(",");

	let newTag: string;
	if (NODES_ATTR.test(oldTag)) {
		newTag = oldTag.replace(NODES_ATTR, (_m, pre: string, post: string) => `${pre}${nodeList}${post}`);
	} else {
		// No nodes attribute yet (an empty tree) -- insert one just before the tag close.
		newTag = oldTag.replace(/\s*\/?>$/, (close) => ` nodes="${nodeList}"${close}`);
	}

	// Function replacer so `$` in the surrounding attributes (unlikely, but cheap to be safe)
	// is never treated as a capture-group reference.
	return xml.replace(SPEC_OPEN_TAG, () => newTag);
}
