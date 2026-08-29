// These run the REAL LuaJIT bridge (there is no fake for a full boot). They need luajit on
// PATH at the usual location or POB_LUAJIT_PATH set -- same as the CLIs.

import { afterEach, describe, expect, it, vi } from "vitest";
import { PobBridge } from "./bridge";
import { PobBridgePool } from "./pool";

// PoB's cold boot is a few seconds; give every case room.
const BOOT_MS = 30_000;

// Track everything spawned so a failing assertion never leaks a luajit child.
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
	for (const fn of cleanups.splice(0)) {
		try {
			await fn();
		} catch {
			/* best effort */
		}
	}
});

function makePool(...args: ConstructorParameters<typeof PobBridgePool>): PobBridgePool {
	const pool = new PobBridgePool(...args);
	cleanups.push(() => pool.dispose());
	return pool;
}

describe("PobBridgePool", () => {
	it(
		"serialises acquire() when every slot is busy (size 1)",
		async () => {
			const pool = makePool({ size: 1 });
			const first = await pool.acquire();

			let secondResolved = false;
			const secondP = pool.acquire().then((h) => {
				secondResolved = true;
				return h;
			});

			await new Promise((r) => setTimeout(r, 50));
			expect(secondResolved).toBe(false);
			expect(pool.stats()).toEqual({ size: 1, busy: 1, queued: 1 });

			first.release();
			const second = await secondP;
			expect(secondResolved).toBe(true);
			expect(pool.stats()).toEqual({ size: 1, busy: 1, queued: 0 });

			second.release();
			expect(pool.stats()).toEqual({ size: 1, busy: 0, queued: 0 });
		},
		BOOT_MS,
	);

	it(
		"a pooled bridge returns the same StatSet as a standalone PobBridge",
		async () => {
			const standalone = new PobBridge();
			cleanups.push(() => standalone.dispose());
			const solo = await standalone.call("get_stats");

			const pool = makePool({ size: 1 });
			const h = await pool.acquire();
			const pooled = await h.call("get_stats");
			h.release();

			expect(pooled).toEqual(solo);
		},
		BOOT_MS,
	);

	it(
		"warm() pre-spawns every slot",
		async () => {
			const pool = makePool({ size: 2 });
			expect(pool.pids()).toEqual([undefined, undefined]);
			await pool.warm();
			const pids = pool.pids();
			expect(pids.every((p) => typeof p === "number")).toBe(true);
			expect(pids[0]).not.toBe(pids[1]);
		},
		BOOT_MS,
	);

	it(
		"dispose() kills children and rejects queued + later acquire()s",
		async () => {
			const pool = makePool({ size: 1 });
			const held = await pool.acquire();
			const pidBefore = pool.pids()[0];
			expect(typeof pidBefore).toBe("number");

			const queued = pool.acquire(); // parks behind `held`

			await pool.dispose();

			await expect(queued).rejects.toThrow(/disposed/);
			await expect(pool.acquire()).rejects.toThrow(/disposed/);

			// child actually gone (signal 0 just probes existence)
			await vi.waitFor(() => {
				expect(() => process.kill(pidBefore as number, 0)).toThrow();
			});
			void held; // release() after dispose is a harmless no-op
		},
		BOOT_MS,
	);

	it(
		"re-spawns a slot whose child died, firing onChildError exactly once",
		async () => {
			const errors: Array<{ slot: number; message: string }> = [];
			const pool = makePool({
				size: 1,
				onChildError: (slot, err) => errors.push({ slot, message: err.message }),
			});

			const h1 = await pool.acquire();
			expect(await h1.call("ping")).toBe("pong");
			const deadPid = pool.pids()[0] as number;

			process.kill(deadPid); // hard-kill out from under the pool

			await vi.waitFor(() => {
				expect(errors).toHaveLength(1);
				expect(pool.pids()[0]).toBeUndefined();
			});
			expect(errors[0].slot).toBe(0);

			h1.release();

			const h2 = await pool.acquire();
			const freshPid = pool.pids()[0];
			expect(typeof freshPid).toBe("number");
			expect(freshPid).not.toBe(deadPid);
			expect(await h2.call("ping")).toBe("pong");
			h2.release();

			expect(errors).toHaveLength(1); // still just the one
		},
		BOOT_MS,
	);

	// A minimal but complete PoB-PoE2 build (same fixture as bridge.integration.test.ts): enough
	// for loadBuildFromXML to construct a spec and for get_stats to return a real StatSet.
	const MINIMAL_BUILD = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="1" className="Ranger" ascendClassName="None" mainSocketGroup="1"/>
  <Skills/>
  <Tree activeSpec="1"><Spec treeVersion="0_2" classId="1" ascendClassId="0" nodes=""/></Tree>
  <Items/>
  <Config/>
</PathOfBuilding2>`;

	it(
		"lease(n) hands out n distinct slots, all loadable with the same build",
		async () => {
			const pool = makePool({ size: 3 });
			const lease = await pool.lease(3);
			cleanups.push(() => lease.release());
			expect(lease.slots).toHaveLength(3);
			expect(pool.stats()).toEqual({ size: 3, busy: 3, queued: 0 });

			await Promise.all(lease.slots.map((s) => s.call("load_build_xml", { xml: MINIMAL_BUILD, name: "lease-test" })));
			const stats = await Promise.all(lease.slots.map((s) => s.call("get_stats")));
			expect(stats[1]).toEqual(stats[0]);
			expect(stats[2]).toEqual(stats[0]);

			lease.release();
			expect(pool.stats()).toEqual({ size: 3, busy: 0, queued: 0 });
		},
		BOOT_MS,
	);

	it(
		"lease(n) throws synchronously when n exceeds the pool size",
		async () => {
			const pool = makePool({ size: 2 });
			await expect(pool.lease(3)).rejects.toThrow(/exceeds pool size/);
			expect(pool.stats()).toEqual({ size: 2, busy: 0, queued: 0 }); // no partial acquire leaked
		},
		BOOT_MS,
	);

	it(
		"a lease() waiting for slots to free up holds NONE of them meanwhile (all-or-nothing)",
		async () => {
			const pool = makePool({ size: 3 });
			const h1 = await pool.acquire();
			const h2 = await pool.acquire();
			expect(pool.stats()).toEqual({ size: 3, busy: 2, queued: 0 }); // 1 slot free

			let resolved = false;
			const leaseP = pool.lease(2).then((l) => {
				resolved = true;
				return l;
			});
			await new Promise((r) => setTimeout(r, 50));
			expect(resolved).toBe(false);
			// The critical assertion: busy is still 2, not 3 -- lease(2) did NOT grab the 1 free slot
			// and hold it while waiting for a 2nd. A "grab-then-wait" implementation would show 3 here.
			expect(pool.stats().busy).toBe(2);

			h1.release(); // now 2 free -> lease(2) can proceed
			const lease = await leaseP;
			expect(resolved).toBe(true);
			expect(lease.slots).toHaveLength(2);
			expect(pool.stats()).toEqual({ size: 3, busy: 3, queued: 0 }); // h2 (1) + the lease (2)

			lease.release();
			h2.release();
			expect(pool.stats()).toEqual({ size: 3, busy: 0, queued: 0 });
		},
		BOOT_MS,
	);

	it(
		"two concurrent lease(2) calls against a 3-slot pool do not deadlock",
		async () => {
			const pool = makePool({ size: 3 });
			const leaseA = await pool.lease(2); // grabs 2 of 3; 1 free
			expect(pool.stats().busy).toBe(2);

			let bResolved = false;
			const leaseBP = pool.lease(2).then((l) => {
				bResolved = true;
				return l;
			});
			await new Promise((r) => setTimeout(r, 50));
			expect(bResolved).toBe(false); // only 1 free -- B waits, holding nothing
			expect(pool.stats().busy).toBe(2); // NOT 3 -- B never partially grabbed the free slot

			leaseA.release(); // frees 2 -> exactly what B needs
			const leaseB = await leaseBP;
			expect(bResolved).toBe(true);
			expect(leaseB.slots).toHaveLength(2);

			leaseB.release();
			expect(pool.stats()).toEqual({ size: 3, busy: 0, queued: 0 });
		},
		BOOT_MS,
	);

	it(
		"lease() rejects and holds nothing if the pool is disposed while waiting",
		async () => {
			const pool = makePool({ size: 2 });
			const held = await pool.acquire(); // both slots eventually busy: 1 here, lease(2) needs 2
			const leaseP = pool.lease(2);
			await new Promise((r) => setTimeout(r, 50)); // let lease(2) start waiting (only 1 free)
			await pool.dispose();
			await expect(leaseP).rejects.toThrow(/disposed/);
			void held;
		},
		BOOT_MS,
	);

	it(
		"acquireParallel(n) returns a single handle that fans calls across n slots, same build on each",
		async () => {
			const pool = makePool({ size: 3 });
			const bridge = await pool.acquireParallel(3);
			expect(pool.stats()).toEqual({ size: 3, busy: 3, queued: 0 });

			await bridge.call("load_build_xml", { xml: MINIMAL_BUILD, name: "acquire-parallel-test" });
			await bridge.call("reset_metrics");
			expect(await bridge.call("get_stats")).toBeTruthy();

			bridge.release();
			expect(pool.stats()).toEqual({ size: 3, busy: 0, queued: 0 });
		},
		BOOT_MS,
	);

	it("honours an explicit size over the POOL_SIZE env", () => {
		const prev = process.env.POOL_SIZE;
		process.env.POOL_SIZE = "7";
		try {
			expect(makePool({ size: 3 }).stats().size).toBe(3);
			expect(makePool().stats().size).toBe(7);
		} finally {
			if (prev === undefined) delete process.env.POOL_SIZE;
			else process.env.POOL_SIZE = prev;
		}
	});
});
