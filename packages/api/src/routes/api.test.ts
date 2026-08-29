import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { encodePobCode } from "../pob/code";
import { fakeOptimiseResult, fakePool, SAMPLE_XML, stubCore, type StubCoreImpl } from "../testkit";
import type { OptimiseTreeOptions, TreeStatus } from "../core";

/** `Response.json()` is `Promise<unknown>` under @types/node -- cast at the test boundary. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = <T = any>(res: Response): Promise<T> => res.json() as Promise<T>;

const JSON_HEADERS = { "content-type": "application/json" };

const STATUS: TreeStatus = {
	pointsUsed: 100,
	pointsMax: 123,
	ascendancyPointsUsed: 6,
	ascendancyPointsMax: 8,
	secondaryAscendancyPointsUsed: 0,
	secondaryAscendancyPointsMax: 8,
	weaponSet1PointsUsed: 0,
	weaponSet2PointsUsed: 0,
	weaponSetPointsMax: 24,
	treeNodesAllocated: 100,
};

const bridgeHandlers = {
	load_build_xml: { ok: true, className: "Warrior", level: 84 },
	reset_metrics: { ok: true },
	get_stats: { TotalDPS: 5513.53, TotalEHP: 45000 },
	get_tree_status: STATUS,
	get_item_slots: { "Weapon 1": "Axe" },
	list_allocated_nodes: (_m: string, params?: Record<string, unknown>) => {
		const remove = (params?.removeIds as number[] | undefined) ?? [];
		const all = [10, 20, 30, 31, 40]; // 31 depends on 30
		const dropped = new Set<number>();
		for (const id of remove) {
			dropped.add(id);
			dropped.add(id + 1);
		}
		return { nodes: all.filter((id) => !dropped.has(id)).map((id) => ({ id })) };
	},
};

function makeApp(coreImpl: StubCoreImpl = {}) {
	const pool = fakePool(bridgeHandlers, { size: 2, busy: 0, queued: 0 });
	const { app } = createApp({ pool, maxActiveJobs: 2, core: stubCore(coreImpl) });
	return app;
}
type App = ReturnType<typeof makeApp>;

async function ingestBuild(app: App): Promise<string> {
	const res = await app.request("/api/builds", {
		method: "POST",
		headers: JSON_HEADERS,
		body: JSON.stringify({ kind: "xml", xml: SAMPLE_XML }),
	});
	expect(res.status).toBe(201);
	return (await json(res)).buildId;
}

async function postJob(app: App, payload: unknown): Promise<Response> {
	return app.request("/api/jobs", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) });
}

/** Drain an SSE response body into `{ event, data }` frames. */
async function readSSE(res: Response): Promise<Array<{ event: string; data: string }>> {
	const reader = res.body!.getReader();
	const dec = new TextDecoder();
	let buf = "";
	const frames: Array<{ event: string; data: string }> = [];
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buf += dec.decode(value, { stream: true });
		const chunks = buf.split("\n\n");
		buf = chunks.pop() ?? "";
		for (const chunk of chunks) {
			if (!chunk.trim() || chunk.startsWith(":")) continue;
			let event = "message";
			let data = "";
			for (const line of chunk.split("\n")) {
				if (line.startsWith("event:")) event = line.slice(6).trim();
				else if (line.startsWith("data:")) data += line.slice(5).trim();
			}
			frames.push({ event, data });
		}
	}
	return frames;
}

async function waitForTerminal(app: App, jobId: string): Promise<string> {
	for (let i = 0; i < 200; i++) {
		const s = (await json(await app.request(`/api/jobs/${jobId}`))).status;
		if (s === "done" || s === "error" || s === "cancelled") return s;
		await new Promise((r) => setTimeout(r, 5));
	}
	throw new Error("job did not settle");
}

describe("GET /api/health", () => {
	it("reports contract version + pool + job counts", async () => {
		const res = await makeApp().request("/api/health");
		expect(res.status).toBe(200);
		const h = await json(res);
		expect(h).toMatchObject({ ok: true, pool: { size: 2 }, jobs: { active: 0, total: 0 } });
		expect(typeof h.contractVersion).toBe("string");
	});
});

describe("POST /api/builds", () => {
	it("accepts an xml body and returns a BuildSummary", async () => {
		const res = await makeApp().request("/api/builds", {
			method: "POST",
			headers: JSON_HEADERS,
			body: JSON.stringify({ kind: "xml", xml: SAMPLE_XML }),
		});
		expect(res.status).toBe(201);
		expect(await json(res)).toMatchObject({ className: "Warrior", level: 84, ascendancy: "Smith of Kitava" });
	});

	it("accepts a pobCode body", async () => {
		const res = await makeApp().request("/api/builds", {
			method: "POST",
			headers: JSON_HEADERS,
			body: JSON.stringify({ kind: "pobCode", code: encodePobCode(SAMPLE_XML) }),
		});
		expect(res.status).toBe(201);
	});

	it("400s a malformed body with the bad-request shape", async () => {
		const res = await makeApp().request("/api/builds", {
			method: "POST",
			headers: JSON_HEADERS,
			body: JSON.stringify({ kind: "url", url: "http://x" }),
		});
		expect(res.status).toBe(400);
		expect((await json(res)).kind).toBe("bad-request");
	});

	it("400s an undecodable pob code", async () => {
		const res = await makeApp().request("/api/builds", {
			method: "POST",
			headers: JSON_HEADERS,
			body: JSON.stringify({ kind: "pobCode", code: "@@not-base64@@" }),
		});
		expect(res.status).toBe(400);
	});

	it("GET /api/builds/:id round-trips; 404 for unknown", async () => {
		const app = makeApp();
		const id = await ingestBuild(app);
		expect((await app.request(`/api/builds/${id}`)).status).toBe(200);
		expect((await app.request("/api/builds/nope")).status).toBe(404);
	});

	it("returns the summary's allocatedNodeIds", async () => {
		const app = makeApp();
		const id = await ingestBuild(app);
		expect((await json(await app.request(`/api/builds/${id}`))).allocatedNodeIds).toEqual([
			10, 20, 30, 31, 40,
		]);
	});

	async function postCascade(app: App, id: string, body: unknown): Promise<Response> {
		return app.request(`/api/builds/${id}/cascade`, {
			method: "POST",
			headers: JSON_HEADERS,
			body: JSON.stringify(body),
		});
	}

	it("POST /api/builds/:id/cascade returns the freed subtree", async () => {
		const app = makeApp();
		const id = await ingestBuild(app);
		const res = await postCascade(app, id, { anchorNodeId: 30 });
		expect(res.status).toBe(200);
		expect(await json(res)).toEqual({ anchorNodeId: 30, freedNodeIds: [30, 31] });
	});

	it("cascade 404s an unknown build", async () => {
		const res = await postCascade(makeApp(), "nope", { anchorNodeId: 30 });
		expect(res.status).toBe(404);
	});

	it("cascade 400s a non-allocated anchor", async () => {
		const app = makeApp();
		const id = await ingestBuild(app);
		const res = await postCascade(app, id, { anchorNodeId: 999 });
		expect(res.status).toBe(400);
		expect((await json(res)).kind).toBe("bad-request");
	});

	it("cascade 400s a malformed body", async () => {
		const app = makeApp();
		const id = await ingestBuild(app);
		const res = await postCascade(app, id, { anchor: "x" });
		expect(res.status).toBe(400);
	});
});

describe("POST /api/jobs validation", () => {
	it("400s an unknown kind", async () => {
		const app = makeApp();
		const buildId = await ingestBuild(app);
		expect((await postJob(app, { kind: "frobnicate", buildId })).status).toBe(400);
	});

	it("400s a shape-valid but out-of-range objective weight (parseObjective gate)", async () => {
		const app = makeApp();
		const buildId = await ingestBuild(app);
		const res = await postJob(app, { kind: "optimise", buildId, mode: "extend", objective: "dps-ehp:5" });
		expect(res.status).toBe(400);
		expect((await json(res)).message).toMatch(/weight/i);
	});

	it("400s repair mode without respecBudget", async () => {
		const app = makeApp();
		const buildId = await ingestBuild(app);
		expect((await postJob(app, { kind: "optimise", buildId, mode: "repair" })).status).toBe(400);
	});

	it("400s an unknown buildId", async () => {
		expect((await postJob(makeApp(), { kind: "optimise", buildId: "b_missing", mode: "extend" })).status).toBe(400);
	});
});

describe("job run over HTTP", () => {
	const coreImpl: StubCoreImpl = {
		optimiseTree: async (_b, opts: OptimiseTreeOptions) => {
			for (let i = 1; i <= 3; i++) {
				opts.onProgress?.({ phase: "add-loop", buildOutputs: i * 10, bestObjective: 1000 + i, depth: i } as never);
			}
			return fakeOptimiseResult({
				final: { objective: 1003, pointsSpent: 3, stats: { TotalDPS: 1003 } },
				allocatedNodeIds: { before: [10, 20, 30, 40], after: [10, 20, 30, 40, 55] },
			}) as never;
		},
	};

	it("POST /jobs -> SSE yields progress then done; GET /jobs/:id has the result", async () => {
		const app = makeApp(coreImpl);
		const buildId = await ingestBuild(app);

		const created = await postJob(app, { kind: "optimise", buildId, mode: "extend", extraPoints: 3 });
		expect(created.status).toBe(201);
		const ref = await json(created);
		expect(ref.status).toBe("queued");

		const frames = await readSSE(await app.request(`/api/jobs/${ref.jobId}/events`));
		expect(frames.filter((f) => f.event === "progress").length).toBeGreaterThanOrEqual(1);
		const terminal = frames.filter((f) => f.event === "done" || f.event === "error");
		expect(terminal).toHaveLength(1);
		expect(terminal[0].event).toBe("done");

		const got = await json(await app.request(`/api/jobs/${ref.jobId}`));
		expect(got.status).toBe("done");
		expect(got.result.final.objective).toBe(1003);
		expect(typeof got.result.updatedPobCode).toBe("string");
	});

	it("late SSE subscriber still gets a terminal frame", async () => {
		const app = makeApp(coreImpl);
		const buildId = await ingestBuild(app);
		const { jobId } = await json(await postJob(app, { kind: "optimise", buildId, mode: "extend", extraPoints: 3 }));

		expect(await waitForTerminal(app, jobId)).toBe("done");
		const frames = await readSSE(await app.request(`/api/jobs/${jobId}/events`));
		expect(frames.some((f) => f.event === "done")).toBe(true);
	});

	it("runs a recommend job: result is a RecommendedNodeDTO[]", async () => {
		const app = makeApp({
			recommendTree: async (_b, opts) => {
				opts.onProgress?.({
					phase: "scoring",
					buildOutputs: 12,
					candidatesScored: 12,
					candidatesTotal: 40,
				} as never);
				return [
					{
						id: 101,
						name: "Some Notable",
						type: "Notable",
						statLines: ["+10 to something"],
						pointsSpent: 1,
						ascendancyPointsSpent: 0,
						delta: 500,
						deltaPerPoint: 500,
					},
				] as never;
			},
		});
		const buildId = await ingestBuild(app);
		const { jobId } = await json(await postJob(app, { kind: "recommend", buildId, objective: "TotalDPS", top: 5 }));

		expect(await waitForTerminal(app, jobId)).toBe("done");
		const got = await json(await app.request(`/api/jobs/${jobId}`));
		expect(Array.isArray(got.result)).toBe(true);
		expect(got.result[0]).toMatchObject({ id: 101, deltaPerPoint: 500 });
	});

	it("POST /jobs/:id/cancel returns a JobRef; unknown job 404s", async () => {
		const app = makeApp({
			optimiseTree: async (_b, opts: OptimiseTreeOptions) => {
				while (opts.shouldContinue?.() ?? true) await new Promise((r) => setTimeout(r, 5));
				return fakeOptimiseResult({ stoppedBecause: "cancelled" }) as never;
			},
		});
		const buildId = await ingestBuild(app);
		const { jobId } = await json(await postJob(app, { kind: "optimise", buildId, mode: "extend", extraPoints: 3 }));

		await new Promise((r) => setTimeout(r, 20));
		const res = await app.request(`/api/jobs/${jobId}/cancel`, { method: "POST" });
		expect(res.status).toBe(200);
		expect(await json(res)).toMatchObject({ jobId, status: "cancelled" });
		await waitForTerminal(app, jobId);

		expect((await app.request("/api/jobs/nope/cancel", { method: "POST" })).status).toBe(404);
	});
});
