// Reads a PoB-PoE2 <PathOfBuilding2> build XML off disk and loads it into a warm bridge.

import * as fs from "node:fs";
import { PobBridgeClient } from "@poe2/pob-bridge";

export async function loadBuildFromFile(bridge: PobBridgeClient, buildXmlPath: string): Promise<void> {
	const xml = fs.readFileSync(buildXmlPath, "utf-8");
	await bridge.call("load_build_xml", { xml });
}
