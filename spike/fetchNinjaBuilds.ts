// One-off: pull PoB build XMLs off poe.ninja's PoE2 build ladder for the beam-search corpus
// (design step 8). poe.ninja exposes a per-character JSON endpoint whose `pathOfBuildingExport`
// field is a standard PoB import code (base64(zlib(xml))); we decode it and drop the XML into a
// dedicated subfolder so the corpus stays separate from hand-authored builds.
//
//   npm run fetch-ninja-builds
//
// After it runs: `npm run characterise-build -- "<xml>"` on each, then paste rows into
// docs/beam-search/corpus.md.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const LEAGUE_OVERVIEW = "runes-of-aldur";
const LEAGUE_URL = "runesofaldur";
const OUT_DIR = "D:/My Documents/Path of Building (PoE2)/Builds/ninja";

interface Target {
	account: string;
	name: string;
	tag: string; // output filename (without .xml)
	tier: "optimised" | "weak" | "mid";
	note: string;
}

// Picked by hand from poe.ninja/poe2/builds/runesofaldur (Runes of Aldur, latest snapshot,
// 2026-08-28) to span optimisation tiers and level brackets. Table stats at pick time in the note.
const TARGETS: Target[] = [
	// --- highly optimised, level 100 ---
	{ account: "Aengus-2685", name: "stillAengus", tag: "stillAengus-L100-46M",
		tier: "optimised", note: "L100 46M DPS 26k EHP 4427 ES -- extreme crit glass cannon" },
	{ account: "TLLSN-0342", name: "我们猎魔的女猎人也是猎魔人", tag: "HuntressTank-L100-5.8M",
		tier: "optimised", note: "L100 5.8M DPS 156k EHP 7263 ES -- tanky huntress, best all-round" },
	{ account: "BrandNew-9781", name: "Techno_IceShot", tag: "TechnoIceShot-L100-28M",
		tier: "optimised", note: "L100 28M DPS 66k EHP 4253 ES -- ice shot, evasion" },
	{ account: "Sticker45-4455", name: "Venereable", tag: "Venereable-L100-13M",
		tier: "optimised", note: "L100 13M DPS 33k EHP 0 ES -- life-based" },
	{ account: "Meisssen-4959", name: "Fimozix", tag: "Fimozix-L100-ES",
		tier: "optimised", note: "L100 2.5M DPS 103k EHP 11031 ES life=1 -- ES/CI stacker" },

	// --- weak / unoptimised, level 100 ---
	{ account: "Aeone1-0564", name: "SnusInMyBlood", tag: "SnusInMyBlood-L100-weak",
		tier: "weak", note: "L100 4.3k DPS 8.5k EHP -- barely functional" },
	{ account: "esahi_superdry-6393", name: "furufuru_RoA", tag: "furufuru-L100-weak",
		tier: "weak", note: "L100 5.0k DPS 22k EHP 0 ES" },
	{ account: "江湖夜雨十年灯-6403", name: "几度秋凉", tag: "JiduQiuliang-L100-glass",
		tier: "weak", note: "L100 77k DPS 5.2k EHP -- glassy and weak" },
	{ account: "AEgliid-0254", name: "QingCum", tag: "QingCum-L100-nodmg",
		tier: "weak", note: "L100 57k DPS 75k EHP 53 ES -- tanky, no damage" },

	// --- mid-ish, level 84 ---
	{ account: "Tzadi19-2313", name: "TheTradie", tag: "TheTradie-L84-400k",
		tier: "mid", note: "L84 400k DPS 28k EHP 4755 ES -- decent for level" },
	{ account: "Rolecks-5190", name: "dosesondoses", tag: "dosesondoses-L84-ES",
		tier: "mid", note: "L84 36k DPS 26k EHP 9940 ES -- ES bruiser, low dmg" },
	{ account: "RafaelLVPersonal-8487", name: "R_Thor", tag: "R_Thor-L84-weak",
		tier: "mid", note: "L84 5.5k DPS 20k EHP 0 ES -- weak melee" },

	// --- level 92 ---
	{ account: "Blandis-6578", name: "BlandisThree", tag: "BlandisThree-L92-tank",
		tier: "mid", note: "L92 70k DPS 185k EHP -- extreme tank, low dmg" },
	{ account: "Spraybleu-1512", name: "KinkyDommyMommy", tag: "KinkyDommyMommy-L92-glass",
		tier: "mid", note: "L92 1.2M DPS 11k EHP 4237 ES -- glass" },
];

async function getSnapshotVersion(): Promise<string> {
	const r = await fetch("https://poe.ninja/poe2/api/data/index-state");
	if (!r.ok) throw new Error(`index-state ${r.status}`);
	const j = (await r.json()) as { snapshotVersions: Array<{ url: string; version: string }> };
	const sv = j.snapshotVersions.find((s) => s.url === LEAGUE_URL);
	if (!sv) throw new Error(`no snapshot version for ${LEAGUE_URL}`);
	return sv.version;
}

function decodePobCode(code: string): string {
	const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
	const raw = Buffer.from(b64, "base64");
	return zlib.inflateSync(raw).toString("utf-8");
}

async function fetchCharacter(version: string, t: Target) {
	const u = new URL(`https://poe.ninja/poe2/api/builds/${version}/character`);
	u.searchParams.set("account", t.account);
	u.searchParams.set("name", t.name);
	u.searchParams.set("overview", LEAGUE_OVERVIEW);
	u.searchParams.set("timeMachine", "");
	const r = await fetch(u);
	if (!r.ok) throw new Error(`character ${t.name} -> ${r.status}`);
	return (await r.json()) as {
		class: string;
		level: number;
		pathOfBuildingExport: string;
		passiveCounts?: { passives: number; ascendancy: number; anoints: number; bonusPassives: number };
	};
}

async function main() {
	fs.mkdirSync(OUT_DIR, { recursive: true });
	const version = await getSnapshotVersion();
	console.log(`snapshot ${version}  ->  ${OUT_DIR}\n`);

	const manifest: string[] = [];
	for (const t of TARGETS) {
		try {
			const c = await fetchCharacter(version, t);
			const xml = decodePobCode(c.pathOfBuildingExport);
			const root = xml.match(/<\s*([A-Za-z0-9]+)/)?.[1] ?? "?";
			const outPath = path.join(OUT_DIR, `${t.tag}.xml`);
			fs.writeFileSync(outPath, xml, "utf-8");
			const pc = c.passiveCounts;
			const pcs = pc ? `passives=${pc.passives} asc=${pc.ascendancy} anoint=${pc.anoints}` : "";
			console.log(`ok   ${t.tag}`);
			console.log(`     ${c.class} L${c.level}  <${root}>  ${xml.length} chars  ${pcs}`);
			console.log(`     ${t.note}`);
			manifest.push(`${t.tier}\t${t.tag}\t${c.class}\tL${c.level}\t${pcs}`);
		} catch (err) {
			console.log(`FAIL ${t.tag}: ${err instanceof Error ? err.message : err}`);
			manifest.push(`${t.tier}\t${t.tag}\tFAILED`);
		}
	}
	console.log(`\n--- manifest ---\n${manifest.join("\n")}`);
}

main().catch((err) => {
	console.error("fetch-ninja-builds failed:", err instanceof Error ? err.message : err);
	process.exitCode = 1;
});
