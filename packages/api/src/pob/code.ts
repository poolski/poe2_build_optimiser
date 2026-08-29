// PoB export-code <-> XML. The decode is exactly spike/fetchNinjaBuilds.ts:76 (+ a .trim() so a
// pasted code with trailing newline still works): url-safe base64 of a zlib stream of the
// <PathOfBuilding2> XML. Encode is the mirror -- used to hand back `updatedPobCode`.

import * as zlib from "node:zlib";

/** Decode a PoB import code to its XML. Throws on malformed base64 / a bad zlib stream. */
export function decodePobCode(code: string): string {
	const b64 = code.trim().replace(/-/g, "+").replace(/_/g, "/");
	if (b64 === "") throw new Error("empty PoB code");
	return zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf-8");
}

/** Encode XML back to a PoB import code (url-safe base64 of the zlib stream). */
export function encodePobCode(xml: string): string {
	return zlib
		.deflateSync(Buffer.from(xml, "utf-8"))
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_");
}
