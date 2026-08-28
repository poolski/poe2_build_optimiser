// Prints a one-line corpus-manifest row for a build XML (design step 8). Run it on each build
// you want in the beam-search benchmark corpus and paste the rows into docs/beam-search/corpus.md.
//   npm run characterise-build -- "<build.xml>"

import * as fs from "node:fs";
import { PobBridge } from "@poe2/pob-bridge";

const METRICS = [
	"TotalDPS",
	"TotalEHP",
	"Life",
	"EnergyShield",
	"Armour",
	"Evasion",
	"FireResist",
	"ColdResist",
	"LightningResist",
	"ChaosResist",
];

async function main() {
	const buildXmlPath = process.argv[2];
	if (!buildXmlPath) throw new Error("usage: characteriseBuild.ts <build.xml>");

	const bridge = new PobBridge();
	try {
		const xml = fs.readFileSync(buildXmlPath, "utf-8");
		const loaded = await bridge.call<{ className: string; level: number }>("load_build_xml", { xml });
		const status = await bridge.call<{
			pointsUsed: number;
			pointsMax: number;
			ascendancyPointsUsed: number;
			weaponSet1PointsUsed: number;
			weaponSet2PointsUsed: number;
			weaponSetPointsMax: number;
			treeNodesAllocated: number;
		}>("get_tree_status");
		const stats = await bridge.call<Record<string, unknown>>("get_stats");

		const name = buildXmlPath.split(/[\\/]/).pop()?.replace(/\.xml$/i, "") ?? buildXmlPath;
		const num = (k: string) => {
			const v = stats[k];
			return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : "-";
		};

		console.log(
			`\n| ${name} | ${loaded.className} | ${loaded.level} | ${status.pointsUsed}/${status.pointsMax} (${
				status.pointsMax - status.pointsUsed
			} spare) | ${status.ascendancyPointsUsed} asc | ${METRICS.map(num).join(" | ")} | ? | ? | ? |`,
		);
		console.log(`  (trailing "? ? ?" columns = defence-layer, hand-tuned|naive, held-out -- fill in by hand)`);
		console.log(`  raw: ${METRICS.map((k) => `${k}=${num(k)}`).join("  ")}`);
		console.log(
			`  weapon-set: ws1=${status.weaponSet1PointsUsed} ws2=${status.weaponSet2PointsUsed} / ${status.weaponSetPointsMax}` +
				`  (raw tree nodes ${status.treeNodesAllocated}, weapon-set-corrected pointsUsed ${status.pointsUsed})`,
		);
	} finally {
		bridge.dispose();
	}
}

main().catch((err) => {
	console.error("characterise-build failed:", err instanceof Error ? err.message : err);
	process.exitCode = 1;
});
