// Approach benchmark for the tree planner (design step 9). For each (build × approach) it records
// the objective lift vs the loaded tree, the cost (BuildOutput recomputes -- the machine-independent
// currency), wall-clock, and whether the plan kept the build feasible, then writes a markdown table
// + summary to docs/beam-bench-<objective>.md (and stdout).
//
//   npm run bench-tree-approaches -- [objective] [extraPoints] [--no-constraints] [--only=substr]
//                                    [--concurrency=N] [--fresh-bridge]
//
//   objective       objective spec for parseObjective -- "TotalDPS" (default), "TotalEHP",
//                   "dps-ehp:0.5", "blend:A,B,W", or any bare mainOutput key.
//   extraPoints      headroom above each build's pointsUsed for the extend row (default 8).
//                    Gutted builds override this with the number of points that were gutted, so
//                    "extend" is a like-for-like "spend the spare points back" test.
//   --no-constraints drop the default "preserve the 3 elemental resists" floor.
//   --only=substr    restrict the corpus to builds whose label contains `substr` (debug aid).
//   --concurrency=N  run N builds in parallel (default 4, or $BENCH_CONCURRENCY). Each parallel
//                    slot owns one LuaJIT bridge process, and the three approaches of a build share
//                    it -- so peak process count is N, and load_build_xml runs once per build, not
//                    once per (build x approach). Builds are independent and the calc engine is
//                    byte-deterministic, so results do not depend on N. Tune to core count / RAM.
//   --fresh-bridge   spawn a throwaway bridge per (build x approach), matching the pre-parallel
//                    behaviour. Use only to rule out cross-approach state bleed on a shared bridge
//                    (every _from RPC restores to the loaded baseline, so this should not matter).
//
// NOTE: all runs write the one committed fixture docs/beam-bench-<objective>.md -- do not run two
// bench processes with the same objective concurrently (different objectives are fine).
//
// Approaches compared:
//   extend      optimiseTree extend mode -- the multi-step greedy walk, +headroom fresh points,
//               no respec. This is the "greedy seed" baseline from the design doc.
//   repair-rN   optimiseTree repair mode -- free up to N of the lowest-value allocated leaves and
//               re-spend them, net ~0 points, costs N respec. better-of(loaded, repaired) internally.
//
// extend spends passive points; repair spends respec currency. Both report lift vs the same loaded
// baseline, and the cost columns show the price -- that's the apples-to-apples the design asks for.
//
// Gutted builds (a `.json` sidecar sibling from `npm run gut-build`) additionally get a
// "fraction of lost objective recovered" score: (final - guttedBaseline) / (original - guttedBaseline).
// 1.0 == the approach fully clawed back what gutting removed; >1.0 == it beat the original tree.
// Only computed when the bench objective matches the sidecar's `objectiveSpec`.
//
// The full step-8 corpus: 6 local + 12 usable poe.ninja (2 are 0-DPS headless) + 5 gutted.
// Held-out builds (never used while tuning K/W/D) are marked in the output; the definitive run
// uses them.

import * as fs from "node:fs";
import * as path from "node:path";
import { PobBridge } from "../src/core/bridge";
import { parseObjective } from "../src/core/objective";
import { optimiseTree, OptimiseTreeResult } from "../src/core/optimiseTree";
import { asNumber, StatSet } from "../src/core/stats";

const BUILDS_DIR = "D:/My Documents/Path of Building (PoE2)/Builds";
const PRESERVE_RESISTS = ["FireResist", "ColdResist", "LightningResist"];

/** docs/beam-bench-<objective>.md -- one committed fixture per objective. */
function outFileFor(objectiveSpec: string): string {
	const slug = objectiveSpec.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
	return path.join(__dirname, "..", "docs", `beam-bench-${slug}.md`);
}

interface CorpusBuild {
	rel: string;
	label: string;
	/** strong / mid / weak / naive / tuned -- printed next to the label. */
	tier: string;
	note?: string;
	heldOut?: boolean;
}

const CORPUS: CorpusBuild[] = [
	// --- local (6) ---
	{ rel: "Ranger.xml", label: "Ranger-L37", tier: "naive", note: "deliberately gutted, L37 so budget = pointsUsed+extra" },
	{ rel: "RampantlyBisexual.xml", label: "RampantlyBisexual", tier: "mid", note: "23 spare" },
	{ rel: "Blood Mage.xml", label: "Blood Mage", tier: "n/a", note: "TotalDPS=0 headless -- skips under a DPS/blend objective" },
	{ rel: "Monk/Flicker Strike Invoker.xml", label: "Flicker-Invoker", tier: "mid", note: "10 spare" },
	{ rel: "Monk/MA-FlickerStrike.xml", label: "MA-FlickerStrike", tier: "naive", note: "25 spare -- validation 'repair improves'" },
	{
		rel: "Monk/Martial Artist - Shattering Palm + Flicker Strike.xml",
		label: "MA-Shattering",
		tier: "tuned",
		note: "hand-tuned, 10 spare -- validation 'repair ~= no change'",
	},
	// --- poe.ninja (14; BlandisThree + (Blood Mage above) are 0-DPS headless) ---
	{ rel: "ninja/stillAengus-L100-46M.xml", label: "stillAengus", tier: "strong", note: "evasion/ES thin; -2 spare (over-alloc residual)" },
	{ rel: "ninja/TechnoIceShot-L100-28M.xml", label: "TechnoIceShot", tier: "strong", heldOut: true, note: "evasion; -1 spare" },
	{ rel: "ninja/Venereable-L100-13M.xml", label: "Venereable", tier: "strong", note: "life only, thin; -1 spare" },
	{ rel: "ninja/HuntressTank-L100-5.8M.xml", label: "HuntressTank", tier: "strong", heldOut: true, note: "evasion, huge EHP; -2 spare" },
	{ rel: "ninja/Fimozix-L100-ES.xml", label: "Fimozix", tier: "strong", note: "ES/evasion (CI); -1 spare" },
	{ rel: "ninja/KinkyDommyMommy-L92-glass.xml", label: "KinkyDommyMommy", tier: "mid", note: "ES, thin; 7 spare" },
	{ rel: "ninja/TheTradie-L84-400k.xml", label: "TheTradie", tier: "mid", note: "evasion; 15 spare (decent for lvl)" },
	{ rel: "ninja/JiduQiuliang-L100-glass.xml", label: "JiduQiuliang", tier: "weak", note: "pure glass; -1 spare" },
	{ rel: "ninja/QingCum-L100-nodmg.xml", label: "QingCum", tier: "weak", note: "armour tank, no dmg; -1 spare" },
	{ rel: "ninja/dosesondoses-L84-ES.xml", label: "dosesondoses", tier: "mid", heldOut: true, note: "ES; 16 spare" },
	{ rel: "ninja/furufuru-L100-weak.xml", label: "furufuru", tier: "weak", note: "armour; 7 spare" },
	{ rel: "ninja/R_Thor-L84-weak.xml", label: "R_Thor", tier: "weak", note: "armour; 16 spare" },
	{ rel: "ninja/SnusInMyBlood-L100-weak.xml", label: "SnusInMyBlood", tier: "weak", heldOut: true, note: "evasion, bad res; -1 spare" },
	{ rel: "ninja/BlandisThree-L92-tank.xml", label: "BlandisThree", tier: "n/a", note: "0-DPS headless -- skips under a DPS/blend objective" },
	// --- synthetic gutting (5; sidecar .json drives the recovery-fraction score) ---
	{ rel: "ninja/gutted/TheTradie-L84-400k-gut8-low.xml", label: "TheTradie-gut8-low", tier: "gutted", note: "policy low -- 'relocate wasted points' case, gap ~0" },
	{ rel: "ninja/gutted/TheTradie-L84-400k-gut25-random.xml", label: "TheTradie-gut25-rand", tier: "gutted", note: "policy random s1" },
	{ rel: "ninja/gutted/TheTradie-L84-400k-gut25-high.xml", label: "TheTradie-gut25-high", tier: "gutted", note: "policy high -- honest ceiling" },
	{ rel: "ninja/gutted/Venereable-L100-13M-gut25-random.xml", label: "Venereable-gut25-rand", tier: "gutted", note: "policy random s1" },
	{ rel: "ninja/gutted/Venereable-L100-13M-gut25-high.xml", label: "Venereable-gut25-high", tier: "gutted", note: "policy high -- honest ceiling" },
];

/** Parsed `.json` sidecar written next to a gutted XML by spike/gutBuild.ts. */
interface GuttedSidecar {
	objectiveSpec: string;
	pointsRemoved: number;
	original: { score: number };
	gutted: { score: number };
	gapToRecover: number;
}

function readSidecar(buildXmlPath: string): GuttedSidecar | undefined {
	const jsonPath = buildXmlPath.replace(/\.xml$/i, ".json");
	if (!fs.existsSync(jsonPath)) return undefined;
	try {
		const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
		if (raw && raw.original && raw.gutted && typeof raw.gapToRecover === "number") return raw as GuttedSidecar;
	} catch {
		/* fall through */
	}
	return undefined;
}

interface Approach {
	name: string;
	proximity: number;
	respecBudget: number;
	kind: "extend" | "repair";
}

const APPROACHES: Approach[] = [
	{ name: "extend", proximity: 3, respecBudget: 0, kind: "extend" },
	{ name: "repair-r3", proximity: 3, respecBudget: 3, kind: "repair" },
	{ name: "repair-r6", proximity: 3, respecBudget: 6, kind: "repair" },
];

interface Row {
	/** corpus index + approach index -- for deterministic row ordering when builds finish out of
	 * order under `--concurrency`. Not rendered. */
	ci: number;
	ai: number;
	build: string;
	tier: string;
	heldOut: boolean;
	approach: string;
	/** Points of headroom the extend walk was given (0 for repair rows). */
	extendHeadroom: number;
	baselineObjective: number;
	finalObjective: number;
	liftPct: number;
	/** (final - base) -- absolute objective units. For gutted builds this is what was clawed back. */
	liftAbs: number;
	/** original - gutted baseline, from the sidecar. undefined for non-gutted or objective mismatch. */
	gapToRecover?: number;
	/** liftAbs / gapToRecover. 1.0 == fully recovered; >1 == beat the original tree. */
	recoveredFrac?: number;
	netPoints: number;
	respecUsed: number;
	resOk: boolean;
	buildOutputs: number;
	/** Cumulative bridge-side seconds inside recomputeBuild() for this run (get_metrics
	 * buildOutputSeconds). NaN against an older bridge. `simSeconds / buildOutputs * 1000` = ms per
	 * recompute, the machine-dependent latency the parallelism is meant to hide. */
	simSeconds: number;
	cacheHitPct: number;
	wallSeconds: number;
	stopped: string;
}

interface RunOutput {
	result: OptimiseTreeResult;
	baseStats: StatSet;
	wallSeconds: number;
}

/** Spawn a bridge and load `buildXmlPath` into it. Caller owns disposal. */
async function openBridgeWithBuild(buildXmlPath: string): Promise<PobBridge> {
	const bridge = new PobBridge();
	try {
		const xml = fs.readFileSync(buildXmlPath, "utf-8");
		await bridge.call("load_build_xml", { xml });
		return bridge;
	} catch (err) {
		bridge.dispose();
		throw err;
	}
}

/** Run one approach against a bridge that already has the build loaded. Metrics are reset per call,
 * so the counts are per-approach even when the bridge is shared across a build's three approaches.
 * Every _from RPC optimiseTree uses restores the spec to the loaded baseline, so the next approach
 * on the same bridge still starts from the loaded tree. */
async function runApproachOn(
	bridge: PobBridge,
	approach: Approach,
	extendHeadroom: number,
	objectiveSpec: string,
	constraintsOn: boolean,
): Promise<RunOutput> {
	await bridge.call("reset_metrics");
	const status = await bridge.call<{ pointsUsed: number }>("get_tree_status");
	const baseStats = await bridge.call<StatSet>("get_stats");

	const t0 = Date.now();
	const result = await optimiseTree(bridge, {
		pointBudget: status.pointsUsed + (approach.kind === "extend" ? extendHeadroom : 0),
		proximity: approach.proximity,
		respecBudget: approach.respecBudget,
		objectiveFn: parseObjective(objectiveSpec),
		preserveMetrics: constraintsOn ? PRESERVE_RESISTS : undefined,
	});
	return { result, baseStats, wallSeconds: (Date.now() - t0) / 1000 };
}

/** Fixed-size worker pool: at most `limit` `worker` calls in flight at once, walking `items` in
 * order. `onDone` fires on the main task as each result lands (JS is single-threaded, so it needs
 * no locking around shared accumulators). `worker` must not throw -- a rejection aborts the pool. */
async function runWithConcurrency<T, R>(
	items: T[],
	limit: number,
	worker: (item: T, index: number) => Promise<R>,
	onDone: (result: R, index: number) => void,
): Promise<void> {
	let cursor = 0;
	const runNext = async (): Promise<void> => {
		const i = cursor++;
		if (i >= items.length) return;
		onDone(await worker(items[i], i), i);
		return runNext();
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runNext()));
}

/** Every preserved resist in the final plan is >= its loaded-baseline value (small tolerance for
 * float dust). optimiseTree enforces this internally; a false here is a bug worth surfacing. */
function resistsHeld(baseStats: StatSet, finalStats: StatSet): boolean {
	return PRESERVE_RESISTS.every((m) => asNumber(finalStats[m]) >= asNumber(baseStats[m]) - 0.01);
}

function median(xs: number[]): number {
	if (xs.length === 0) return Number.NaN;
	const s = [...xs].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const f2 = (n: number | undefined) => (n !== undefined && Number.isFinite(n) ? n.toFixed(2) : "n/a");
const pct = (n: number | undefined) => (n !== undefined && Number.isFinite(n) ? `${(100 * n).toFixed(0)}%` : "-");
/** ms per recompute -- the machine-dependent per-eval latency. */
const msPerBoNum = (r: { simSeconds: number; buildOutputs: number }) =>
	r.buildOutputs > 0 && Number.isFinite(r.simSeconds) ? (r.simSeconds * 1000) / r.buildOutputs : Number.NaN;
const msPerBo = (r: { simSeconds: number; buildOutputs: number }) => {
	const v = msPerBoNum(r);
	return Number.isFinite(v) ? v.toFixed(0) : "n/a";
};
const clock = (sec: number) => {
	const s = Math.round(sec);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = s % 60;
	return (h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(ss).padStart(2, "0")}`;
};

/** normalise for objective-spec comparison against the sidecar. */
const normObj = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");

function render(
	rows: Row[],
	objectiveSpec: string,
	defaultExtra: number,
	constraintsOn: boolean,
	skipped: string[],
	progress: { done: number; total: number } | null,
): string {
	const lines: string[] = [];
	lines.push(`<!-- generated by \`npm run bench-tree-approaches\` -- do not edit by hand -->`);
	lines.push(`# Tree planner approach benchmark`);
	lines.push(``);
	if (progress) {
		lines.push(`> **IN PROGRESS — ${progress.done}/${progress.total} builds complete.** Table grows as runs finish.`);
		lines.push(``);
	}
	lines.push(
		`objective \`${objectiveSpec}\`, extend headroom +${defaultExtra} pts (gutted builds: +pointsRemoved), ` +
			`constraints: ${constraintsOn ? "preserve Fire/Cold/Lightning resist" : "none"}. ` +
			`Generated ${new Date().toISOString()}.`,
	);
	lines.push(``);
	lines.push(
		`Corpus: full step-8 set — 6 local + 12 usable poe.ninja + 5 synthetic-gutted. ` +
			`Held-out builds (marked \`*\`) are included: this is the definitive run, not a tuning pass.`,
	);
	lines.push(``);
	lines.push(
		`| build | tier | approach | base | final | lift % | Δabs | gap | recov | net pts | respec | res ok | BuildOutputs | sim s | ms/BO | cache hit % | wall s | stopped |`,
	);
	lines.push(`|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|:-:|--:|--:|--:|--:|--:|---|`);
	for (const r of rows) {
		lines.push(
			`| ${r.build}${r.heldOut ? " \\*" : ""} | ${r.tier} | ${r.approach} | ${f2(r.baselineObjective)} | ${f2(r.finalObjective)} | ` +
				`${f2(r.liftPct)} | ${f2(r.liftAbs)} | ${r.gapToRecover !== undefined ? f2(r.gapToRecover) : "-"} | ` +
				`${pct(r.recoveredFrac)} | ${r.netPoints} | ${r.respecUsed} | ${r.resOk ? "y" : "**N**"} | ${r.buildOutputs} | ` +
				`${f2(r.simSeconds)} | ${msPerBo(r)} | ${f2(r.cacheHitPct)} | ${f2(r.wallSeconds)} | ${r.stopped} |`,
		);
	}
	lines.push(``);

	// Per-build summary. extend and repair are different-budget operations, so this is not a
	// head-to-head "which wins", it is "what each path buys from the same baseline".
	const builds = [...new Map(rows.map((r) => [r.build, r])).values()];
	lines.push(`## Per-build summary (lift %, same loaded baseline)`);
	lines.push(``);
	lines.push(`| build | tier | extend | repair-r3 | repair-r6 | repair monotonic? |`);
	lines.push(`|---|---|--:|--:|--:|:-:|`);
	let nonMonotonic = 0;
	for (const b of builds) {
		const ext = rows.find((r) => r.build === b.build && r.approach === "extend");
		const r3 = rows.find((r) => r.build === b.build && r.approach === "repair-r3");
		const r6 = rows.find((r) => r.build === b.build && r.approach === "repair-r6");
		if (!ext && !r3 && !r6) continue;
		const mono = r3 && r6 ? (r6.liftPct >= r3.liftPct - 0.5 ? "y" : "**N**") : "-";
		if (mono === "**N**") nonMonotonic++;
		lines.push(
			`| ${b.build}${b.heldOut ? " \\*" : ""} | ${b.tier} | ${ext ? f2(ext.liftPct) : "-"} | ${r3 ? f2(r3.liftPct) : "-"} | ` +
				`${r6 ? f2(r6.liftPct) : "-"} | ${mono} |`,
		);
	}
	lines.push(``);
	if (nonMonotonic > 0) {
		lines.push(
			`> **${nonMonotonic} build(s): repair-r6 < repair-r3.** optimiseTree sweeps k=1..N and keeps ` +
				`the best swept plan, so this should be rare; a persistent flag means the sweep is not ` +
				`covering a case (design doc step 7).`,
		);
		lines.push(``);
	}

	// Recovery-fraction view (gutted builds only).
	const guttedRows = rows.filter((r) => r.gapToRecover !== undefined);
	if (guttedRows.length > 0) {
		lines.push(`## Recovery on gutted builds (fraction of the gutted objective clawed back)`);
		lines.push(``);
		lines.push(
			`\`recov\` = (final − guttedBaseline) / (original − guttedBaseline). 100% == the approach ` +
				`fully restored what gutting removed; >100% == it found a better tree than the original.`,
		);
		lines.push(``);
		lines.push(`| build | approach | gap | Δabs recovered | recov % | net pts | respec |`);
		lines.push(`|---|---|--:|--:|--:|--:|--:|`);
		for (const r of guttedRows) {
			lines.push(
				`| ${r.build} | ${r.approach} | ${f2(r.gapToRecover)} | ${f2(r.liftAbs)} | ${pct(r.recoveredFrac)} | ${r.netPoints} | ${r.respecUsed} |`,
			);
		}
		lines.push(``);
	}

	lines.push(`## Cost by approach (median)`);
	lines.push(``);
	lines.push(
		`\`sim s\` is bridge-side recompute time (get_metrics); \`wall s\` includes search + transport ` +
			`overhead and is what \`--concurrency\` overlaps across builds. \`ms/BO\` = sim s / BuildOutputs.`,
	);
	lines.push(``);
	lines.push(`| approach | runs | median BuildOutputs | median sim s | median ms/BO | median wall s |`);
	lines.push(`|---|--:|--:|--:|--:|--:|`);
	for (const approach of APPROACHES) {
		const sub = rows.filter((r) => r.approach === approach.name);
		if (sub.length === 0) continue;
		lines.push(
			`| ${approach.name} | ${sub.length} | ${median(sub.map((r) => r.buildOutputs))} | ` +
				`${f2(median(sub.map((r) => r.simSeconds)))} | ${f2(median(sub.map(msPerBoNum).filter(Number.isFinite)))} | ` +
				`${f2(median(sub.map((r) => r.wallSeconds)))} |`,
		);
	}
	lines.push(``);

	if (skipped.length > 0) {
		lines.push(`## Skipped`);
		lines.push(``);
		for (const s of skipped) lines.push(`- ${s}`);
		lines.push(``);
	}
	return lines.join("\n") + "\n";
}

/** Everything one build contributes to the report: its rows (0..APPROACHES.length) and, if it
 * bailed, a one-line skip reason. Returned rather than mutating shared state so the pool's `onDone`
 * is the single writer. */
interface BuildRunResult {
	ci: number;
	label: string;
	rows: Row[];
	skipped?: string;
}

/** Run all APPROACHES for one corpus build. Sequential within the build (so the pre-parallel skip
 * semantics hold: a throw or unusable baseline on one approach skips the rest), sharing a single
 * bridge unless `freshBridge`. Never throws -- unexpected failures become a skip reason. */
async function runBuild(
	cb: CorpusBuild,
	ci: number,
	total: number,
	objectiveSpec: string,
	defaultExtra: number,
	constraintsOn: boolean,
	freshBridge: boolean,
	log: (s: string) => void,
	bumpRuns: () => void,
): Promise<BuildRunResult> {
	const buildXmlPath = path.join(BUILDS_DIR, cb.rel);
	const tag = `[${ci + 1}/${total}] ${cb.label} (${cb.tier}${cb.heldOut ? ", held-out" : ""})`;

	if (!fs.existsSync(buildXmlPath)) {
		log(`${tag}  -- FILE NOT FOUND (${cb.rel}), skipping`);
		for (let i = 0; i < APPROACHES.length; i++) bumpRuns();
		return { ci, label: cb.label, rows: [], skipped: `${cb.label} (file not found: ${cb.rel})` };
	}

	const sidecar = readSidecar(buildXmlPath);
	const extendHeadroom = sidecar ? sidecar.pointsRemoved : defaultExtra;
	const objectivesMatch = sidecar ? normObj(sidecar.objectiveSpec) === normObj(objectiveSpec) : false;
	log(
		`${tag}  headroom +${extendHeadroom}${sidecar ? ` (gutted: ${sidecar.pointsRemoved} removed, gap ${sidecar.gapToRecover.toFixed(2)}${objectivesMatch ? "" : `, obj '${sidecar.objectiveSpec}' != bench -> no recov %`})` : ""}  -- start`,
	);

	const rows: Row[] = [];
	let buildSkipReason: string | undefined;
	let sharedBridge: PobBridge | undefined;

	try {
		if (!freshBridge) {
			try {
				sharedBridge = await openBridgeWithBuild(buildXmlPath);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				log(`${tag}  -- load_build_xml threw: ${msg}`);
				for (let i = 0; i < APPROACHES.length; i++) bumpRuns();
				return { ci, label: cb.label, rows: [], skipped: `${cb.label} (load_build_xml threw: ${msg})` };
			}
		}

		for (let ai = 0; ai < APPROACHES.length; ai++) {
			const approach = APPROACHES[ai];
			if (buildSkipReason) {
				bumpRuns();
				continue;
			}
			const headroom = approach.kind === "extend" ? extendHeadroom : 0;
			const t0 = Date.now();
			let out: RunOutput;
			try {
				if (freshBridge) {
					const b = await openBridgeWithBuild(buildXmlPath);
					try {
						out = await runApproachOn(b, approach, extendHeadroom, objectiveSpec, constraintsOn);
					} finally {
						b.dispose();
					}
				} else {
					out = await runApproachOn(sharedBridge!, approach, extendHeadroom, objectiveSpec, constraintsOn);
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				log(`${tag} / ${approach.name}  THREW after ${((Date.now() - t0) / 1000).toFixed(1)}s -- ${msg}`);
				buildSkipReason = `optimiseTree threw (${msg})`;
				bumpRuns();
				continue;
			}
			bumpRuns();

			const base = out.result.baseline.objective;
			if (!Number.isFinite(base) || base === 0) {
				log(`${tag} / ${approach.name}  -- unusable baseline objective ${base}, skipping remaining approaches`);
				buildSkipReason = `baseline objective ${base} not usable for lift %`;
				continue;
			}
			const final = out.result.final;
			const liftAbs = final.objective - base;
			const gapToRecover = sidecar && objectivesMatch ? sidecar.gapToRecover : undefined;
			const recoveredFrac = gapToRecover && gapToRecover !== 0 ? liftAbs / gapToRecover : undefined;
			rows.push({
				ci,
				ai,
				build: cb.label,
				tier: cb.tier,
				heldOut: !!cb.heldOut,
				approach: approach.name,
				extendHeadroom: headroom,
				baselineObjective: base,
				finalObjective: final.objective,
				liftPct: (100 * liftAbs) / Math.abs(base),
				liftAbs,
				gapToRecover,
				recoveredFrac,
				netPoints: final.pointsSpent,
				respecUsed: out.result.pointsFreed,
				resOk: resistsHeld(out.baseStats, final.stats),
				buildOutputs: out.result.buildOutputCount ?? -1,
				simSeconds: out.result.buildOutputSeconds ?? Number.NaN,
				cacheHitPct: 100 * out.result.cacheHitRate,
				wallSeconds: out.wallSeconds,
				stopped: out.result.stoppedBecause,
			});

			const r = rows[rows.length - 1];
			log(
				`${tag} / ${approach.name}${approach.kind === "extend" ? `+${headroom}` : ""}  ` +
					`done ${out.wallSeconds.toFixed(1)}s  lift ${r.liftPct >= 0 ? "+" : ""}${r.liftPct.toFixed(2)}%  ` +
					`(${f2(base)}->${f2(final.objective)})  ${r.buildOutputs} BO @ ${msPerBo(r)}ms  ${r.resOk ? "res-ok" : "RES-FAIL"}  ` +
					`[stop: ${r.stopped}]${recoveredFrac !== undefined ? `  recov ${pct(recoveredFrac)}` : ""}`,
			);
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		log(`${tag}  -- UNEXPECTED ${msg}`);
		buildSkipReason = buildSkipReason ?? `unexpected error (${msg})`;
	} finally {
		sharedBridge?.dispose();
	}

	return { ci, label: cb.label, rows, skipped: buildSkipReason ? `${cb.label} (${buildSkipReason})` : undefined };
}

async function main() {
	const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
	const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
	const objectiveSpec = positional[0] ?? "TotalDPS";
	const defaultExtra = positional[1] ? Number(positional[1]) : 8;
	const constraintsOn = !flags.includes("--no-constraints");
	const freshBridge = flags.includes("--fresh-bridge");
	const onlyFlag = flags.find((f) => f.startsWith("--only="))?.slice("--only=".length);
	const concFlag = flags.find((f) => f.startsWith("--concurrency="))?.slice("--concurrency=".length);
	const concurrency = Math.max(1, Math.trunc(Number(concFlag ?? process.env.BENCH_CONCURRENCY ?? 4)) || 4);

	const corpus = onlyFlag ? CORPUS.filter((c) => c.label.toLowerCase().includes(onlyFlag.toLowerCase())) : CORPUS;
	const outFile = outFileFor(objectiveSpec);
	const rows: Row[] = [];
	const skipped: string[] = [];

	// Total run count for the ETA -- rough (skips reduce it) but good enough to watch.
	const totalRuns = corpus.length * APPROACHES.length;
	let runsDone = 0;
	let buildsDone = 0;
	const startedAt = Date.now();
	const elapsed = () => (Date.now() - startedAt) / 1000;

	const log = (s: string) => process.stderr.write(s + "\n");
	log(
		`\n=== bench-tree-approaches: objective '${objectiveSpec}', +${defaultExtra} extend headroom, ` +
			`constraints ${constraintsOn ? "on" : "off"}, concurrency ${concurrency}${freshBridge ? ", fresh-bridge" : ""} ===`,
	);
	log(`corpus: ${corpus.length} builds x ${APPROACHES.length} approaches = ${totalRuns} runs\n`);

	const writeOut = (inProgress: boolean) => {
		const sorted = [...rows].sort((a, b) => a.ci - b.ci || a.ai - b.ai);
		fs.writeFileSync(
			outFile,
			render(
				sorted,
				objectiveSpec,
				defaultExtra,
				constraintsOn,
				skipped,
				inProgress ? { done: buildsDone, total: corpus.length } : null,
			),
		);
	};

	await runWithConcurrency(
		corpus,
		concurrency,
		(cb, ci) =>
			runBuild(cb, ci, corpus.length, objectiveSpec, defaultExtra, constraintsOn, freshBridge, log, () => {
				runsDone++;
			}),
		(res) => {
			// Single writer: JS is single-threaded, so appending here needs no lock.
			rows.push(...res.rows);
			if (res.skipped) skipped.push(res.skipped);
			buildsDone++;
			writeOut(buildsDone < corpus.length);
			const eta = runsDone > 0 ? (elapsed() / runsDone) * (totalRuns - runsDone) : 0;
			log(
				`  -> [${res.ci + 1}/${corpus.length}] ${res.label} complete (${res.rows.length} rows)  ` +
					`elapsed ${clock(elapsed())}, ~${clock(eta)} left  (${buildsDone}/${corpus.length} builds, ${runsDone}/${totalRuns} runs)  ` +
					`-> wrote ${path.relative(path.join(__dirname, ".."), outFile)}\n`,
			);
		},
	);

	writeOut(false);
	const finalSorted = [...rows].sort((a, b) => a.ci - b.ci || a.ai - b.ai);
	console.log(render(finalSorted, objectiveSpec, defaultExtra, constraintsOn, skipped, null));
	log(`\n=== complete in ${clock(elapsed())} -- ${rows.length} rows, ${skipped.length} skipped ===`);
	log(`wrote ${path.relative(path.join(__dirname, ".."), outFile)}`);
}

main().catch((err) => {
	console.error("bench-tree-approaches failed:", err instanceof Error ? err.message : err);
	process.exitCode = 1;
});
