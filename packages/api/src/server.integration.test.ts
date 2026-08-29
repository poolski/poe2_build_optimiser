// Real-LuaJIT end-to-end for the API: a genuine PobBridgePool behind the Hono app, a corpus
// build ingested over POST /api/builds, and a small `respecBudget: 2` repair job driven through
// POST /api/jobs -> poll GET /api/jobs/:id. Needs luajit + the pob-runtime submodule; runs via
// `npm run test:integration` only. Self-skips when the reference build XML is absent.
//
// The reference build lives outside the repo (a PoB Builds dir) -- same one the core
// optimiseTree.integration.test.ts uses, via the committed canvas fixture's recorded path.

import * as fs from "node:fs";
import * as zlib from "node:zlib";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PobBridgePool } from "@poe2/pob-bridge";
import { createApp } from "./app";

const FIXTURE = JSON.parse(
	fs.readFileSync(
		path.resolve(__dirname, "../../web/fixtures/canvas-diff.R_Thor-L84-weak.json"),
		"utf-8",
	),
) as { meta: { buildPath: string } };

const buildXmlPath = FIXTURE.meta.buildPath;
const haveBuild = fs.existsSync(buildXmlPath);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = <T = any>(res: Response): Promise<T> => res.json() as Promise<T>;
const JSON_HEADERS = { "content-type": "application/json" };

function decode(code: string): string {
	return zlib.inflateSync(Buffer.from(code.replace(/-/g, "+").replace(/_/g, "/"), "base64")).toString("utf-8");
}

describe.skipIf(!haveBuild)("API over a real PobBridgePool (R_Thor L84)", () => {
	let pool: PobBridgePool;
	let app: ReturnType<typeof createApp>["app"];

	beforeAll(() => {
		pool = new PobBridgePool({ size: 1 });
		app = createApp({ pool, maxActiveJobs: 1 }).app;
	});
	afterAll(async () => {
		await pool.dispose();
	});

	it(
		"ingests a build via POST /api/builds",
		async () => {
			const xml = fs.readFileSync(buildXmlPath, "utf-8");
			const res = await app.request("/api/builds", {
				method: "POST",
				headers: JSON_HEADERS,
				body: JSON.stringify({ kind: "xml", xml }),
			});
			expect(res.status).toBe(201);
			const summary = await json(res);
			expect(summary.className).toBe("Warrior");
			expect(summary.level).toBe(84);
			expect(summary.ascendancy).toBe("Smith of Kitava");
			expect(summary.pointsUsed).toBeGreaterThan(90);
			expect(typeof summary.baseline.TotalDPS).toBe("number");
			expect(Number.isFinite(summary.baseline.TotalDPS)).toBe(true);

			expect((await app.request(`/api/builds/${summary.buildId}`)).status).toBe(200);
		},
		120_000,
	);

	it(
		"runs a respecBudget:2 optimise job end to end and returns a valid result DTO",
		async () => {
			const xml = fs.readFileSync(buildXmlPath, "utf-8");
			const buildId = (
				await json(
					await app.request("/api/builds", {
						method: "POST",
						headers: JSON_HEADERS,
						body: JSON.stringify({ kind: "xml", xml }),
					}),
				)
			).buildId as string;

			const created = await app.request("/api/jobs", {
				method: "POST",
				headers: JSON_HEADERS,
				body: JSON.stringify({ kind: "optimise", buildId, mode: "repair", respecBudget: 2 }),
			});
			expect(created.status).toBe(201);
			const { jobId } = await json(created);

			let status = "queued";
			let result: Record<string, unknown> | undefined;
			for (let i = 0; i < 600; i++) {
				const got = await json(await app.request(`/api/jobs/${jobId}`));
				status = got.status;
				if (status === "done") {
					result = got.result;
					break;
				}
				if (status === "error") throw new Error(`job errored: ${JSON.stringify(got.error)}`);
				await new Promise((r) => setTimeout(r, 500));
			}
			expect(status).toBe("done");
			expect(result).toBeDefined();
			expect(result!.mode).toBe("repair");
			expect(Array.isArray(result!.allocatedNodeIds && (result!.allocatedNodeIds as { after: number[] }).after)).toBe(
				true,
			);

			// updatedPobCode must decode and carry the CONNECTED after-set into <Spec nodes>.
			const updatedXml = decode(result!.updatedPobCode as string);
			const after = (result!.allocatedNodeIds as { after: number[] }).after;
			const specNodes = updatedXml.match(/<Spec\b[^>]*\bnodes="([^"]*)"/)?.[1] ?? "";
			expect(specNodes).toBe(after.join(","));

			// buildOutputCount should be a real, positive recompute tally.
			expect(typeof result!.buildOutputCount).toBe("number");
			expect(result!.buildOutputCount as number).toBeGreaterThan(0);
		},
		600_000,
	);
});
