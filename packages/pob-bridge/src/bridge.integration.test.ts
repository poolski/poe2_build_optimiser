// Cheapest real-bridge check: proves pob-runtime/ + the PathOfBuilding-PoE2 submodule still
// resolve from packages/pob-bridge/ (the REPO_ROOT -> PACKAGE_ROOT move) and that the JSON-RPC
// loop round-trips. ~3s. Needs luajit -- see vitest.integration.config.ts.

import { afterEach, describe, expect, it } from "vitest";
import { PobBridge } from "./bridge";

let bridge: PobBridge | undefined;
afterEach(() => {
	bridge?.dispose();
	bridge = undefined;
});

// A minimal but complete PoB-PoE2 build: enough for loadBuildFromXML to construct a spec.
const MINIMAL_BUILD = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="1" className="Ranger" ascendClassName="None" mainSocketGroup="1"/>
  <Skills/>
  <Tree activeSpec="1"><Spec treeVersion="0_2" classId="1" ascendClassId="0" nodes=""/></Tree>
  <Items/>
  <Config/>
</PathOfBuilding2>`;

describe("PobBridge (real luajit)", () => {
	it("boots, answers ping, and exposes its pid", async () => {
		bridge = new PobBridge();
		expect(await bridge.call("ping")).toBe("pong");
		expect(typeof bridge.pid).toBe("number");
	});

	it("returns a full StatSet from a bare boot", async () => {
		bridge = new PobBridge();
		const stats = await bridge.call<Record<string, unknown>>("get_stats");
		expect(Object.keys(stats).length).toBeGreaterThan(50);
		expect(typeof stats.TotalDPS).toBe("number");
	});

	it("loads a build XML and recomputes its stats", async () => {
		bridge = new PobBridge();
		const loaded = await bridge.call<{ ok: boolean; level: number }>("load_build_xml", { xml: MINIMAL_BUILD });
		expect(loaded).toMatchObject({ ok: true, level: 1 });
		const stats = await bridge.call<Record<string, unknown>>("get_stats");
		expect(Number.isFinite(stats.Life as number)).toBe(true);
	});

	it("dispose() terminates the child", async () => {
		const b = new PobBridge();
		await b.call("ping");
		const pid = b.pid as number;
		b.dispose();
		await new Promise((r) => setTimeout(r, 500));
		expect(() => process.kill(pid, 0)).toThrow(); // ESRCH: gone
	});
});
