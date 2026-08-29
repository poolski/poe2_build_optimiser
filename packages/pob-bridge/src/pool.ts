// A fixed-size pool of warm PobBridge children. One long-lived pool serves many optimise jobs
// without paying PoB's multi-second boot per job. `acquire()` gives one job exclusive use of one
// slot; `lease(n)` (phase 1.5) gives one job exclusive use of `n` slots at once, so a single job
// can fan work across several children instead of running serially on one.

import { PobBridge, PobBridgeClient } from "./bridge";
import { ParallelBridge } from "./parallel";

export interface PobBridgePoolOptions {
	/** Warm children to keep. Default: POOL_SIZE env, else 2. Min 1. */
	size?: number;
	/** Passed to every child (overrides POB_LUAJIT_PATH for this pool). */
	luajitPath?: string;
	/** Fired once per unexpected child death (not on dispose()). The slot re-spawns on its
	 *  next acquire(); any in-flight call() on that slot has already rejected. */
	onChildError?: (slot: number, err: Error) => void;
}

export interface PooledBridge extends PobBridgeClient {
	/** Return the bridge to the pool. Must be called (use try/finally). The handle throws on
	 *  any use after release(). Idempotent. */
	release(): void;
}

/** N exclusive slots leased together for one run (phase 1.5 -- parallel candidate evaluation
 *  within a single optimise/recommend job). `slots[0]` is the conventional "primary" a caller
 *  routes single-round-trip / stateful RPCs to (see ParallelBridge in ./parallel). */
export interface BridgeLeaseHandle {
	readonly slots: PooledBridge[];
	/** Release every leased slot. Must be called (use try/finally). Idempotent. */
	release(): void;
}

interface Slot {
	readonly index: number;
	bridge: PobBridge | null; // null = never spawned, or dead and awaiting re-spawn
	busy: boolean;
	disposing: boolean; // set right before an intentional dispose() so onExit is ignored
}

interface Waiter {
	deliver: (slot: Slot) => void;
	reject: (err: Error) => void;
}

export class PobBridgePool {
	private readonly size: number;
	private readonly luajitPath?: string;
	private readonly onChildError?: (slot: number, err: Error) => void;
	private readonly slots: Slot[];
	private readonly queue: Waiter[] = []; // FIFO waiters when every slot is busy
	/** Callbacks parked by lease() while waiting for `n` slots to be free together. Woken (all of
	 *  them -- each just re-checks and re-parks if still not enough) whenever a slot frees up or
	 *  the pool disposes. Not FIFO-ordered against `queue` -- see lease()'s doc comment. */
	private readonly leaseWaiters: Array<() => void> = [];
	private disposed = false;

	constructor(opts: PobBridgePoolOptions = {}) {
		const envSize = Number(process.env.POOL_SIZE);
		this.size = Math.max(1, opts.size ?? (Number.isFinite(envSize) && envSize > 0 ? envSize : 2));
		this.luajitPath = opts.luajitPath;
		this.onChildError = opts.onChildError;
		this.slots = Array.from({ length: this.size }, (_, index) => ({
			index,
			bridge: null,
			busy: false,
			disposing: false,
		}));
	}

	/** Resolve with an exclusive bridge. FIFO-queued when all slots are busy -- no timeout (jobs
	 *  are minutes; the caller owns any deadline). Rejects only if the pool is disposed.
	 *
	 *  Contract: the caller owns spec state. Do `load_build_xml` (+ `reset_metrics`) on the
	 *  acquired bridge before use; no cleanup is needed on release -- the next job reloads. */
	acquire(): Promise<PooledBridge> {
		if (this.disposed) return Promise.reject(new Error("pool is disposed"));
		const free = this.slots.find((s) => !s.busy);
		if (free) {
			free.busy = true;
			return Promise.resolve(this.handleFor(free));
		}
		return new Promise<PooledBridge>((resolve, reject) => {
			this.queue.push({ deliver: (slot) => resolve(this.handleFor(slot)), reject });
		});
	}

	/** Resolve with `n` exclusive bridges leased together, all belonging to this one caller until
	 *  `release()`. Throws synchronously (no partial acquire) if `n` exceeds the pool size --
	 *  acquiring that many would otherwise wait forever for slots that can never free up.
	 *
	 *  **All-or-nothing, by construction, not just on the happy path.** Unlike calling `acquire()`
	 *  `n` times, this never claims some slots and then blocks holding them while it waits for the
	 *  rest -- it waits until `n` slots are free, THEN claims all `n` in one synchronous burst (no
	 *  `await` between checking "are `n` free?" and marking them busy, so nothing else can
	 *  interleave and steal one out from under it in between). That matters because a caller that
	 *  is careless about ordering -- e.g. two concurrent `lease(2)` calls against a pool of size 3
	 *  -- would otherwise deadlock: each grabs 1 free slot immediately, then blocks forever waiting
	 *  for a 2nd that the other call is also holding. With the atomic-burst design, the second
	 *  `lease(2)` simply waits (holding *nothing*) until 2 slots are free together; if the first
	 *  lease is released before a third caller starves it out, the second proceeds normally --
	 *  no partial-hold, no deadlock, though a lease can still wait a while under heavy contention
	 *  (acceptable: jobs run for minutes, and the intended caller -- `packages/api`'s JobRegistry
	 *  -- has its own slot-accounting admission control that keeps a lease from blocking at all in
	 *  the normal case; this is the defence-in-depth layer for whatever calls `lease()` directly).
	 *  One fairness caveat: a `lease(n)` waiting on free slots does not queue ahead of single-slot
	 *  `acquire()` callers or other `lease()` callers in any guaranteed order -- under sustained
	 *  single-slot traffic a wide lease could in principle wait longer than a FIFO strict-order
	 *  queue would give it. Not a concern for this pool's actual caller (the registry never issues
	 *  more concurrent slot demand than `poolSize` in the first place), but worth knowing before
	 *  reusing `lease()` somewhere with a different admission story.
	 *
	 *  Same contract as a single `acquire()`: the caller owns spec state. Loading the build once
	 *  onto every slot (and any all-slots broadcast, e.g. reset_metrics) is the job of the
	 *  dispatcher built on top -- see ParallelBridge in ./parallel, which special-cases
	 *  load_build_xml / reset_metrics as a broadcast to every leased slot. */
	async lease(n: number): Promise<BridgeLeaseHandle> {
		if (this.disposed) throw new Error("pool is disposed");
		const count = Math.max(1, Math.trunc(n));
		if (count > this.size) {
			throw new Error(`lease(${count}) exceeds pool size ${this.size} -- would wait forever`);
		}
		for (;;) {
			if (this.disposed) throw new Error("pool is disposed");
			const free = this.slots.filter((s) => !s.busy);
			if (free.length >= count) {
				// Atomic burst: claim exactly `count` slots with no `await` in between claiming them,
				// so this loop iteration cannot be interleaved by another lease()/acquire() stealing one.
				const chosen = free.slice(0, count);
				for (const s of chosen) s.busy = true;
				const slots = chosen.map((s) => this.handleFor(s));
				let released = false;
				return {
					slots,
					release: () => {
						if (released) return;
						released = true;
						for (const s of slots) s.release();
					},
				};
			}
			await new Promise<void>((resolve) => this.leaseWaiters.push(resolve));
		}
	}

	/** `lease(n)` wrapped in a single `PooledBridge`-shaped handle that fans every call across the
	 *  leased slots via `ParallelBridge` -- release the returned handle exactly like a plain
	 *  `acquire()`'s. `n === 1` is a legal, if slightly roundabout, way to get a single slot (the
	 *  1-slot `ParallelBridge` just routes every call straight through); packages/api's job runner
	 *  uses this for any job whose decided parallelism is `> 1` and keeps plain `acquire()` for the
	 *  common `n === 1` case. */
	async acquireParallel(n: number): Promise<PooledBridge> {
		const lease = await this.lease(n);
		const bridge = new ParallelBridge(lease.slots);
		let released = false;
		return {
			call: <T>(method: string, params?: Record<string, unknown>): Promise<T> => {
				if (released) return Promise.reject(new Error("PooledBridge used after release()"));
				return bridge.call<T>(method, params);
			},
			release: () => {
				if (released) return;
				released = true;
				lease.release();
			},
		};
	}

	/** OS pids of each slot's live child (undefined where not spawned). Diagnostic / health. */
	pids(): (number | undefined)[] {
		return this.slots.map((s) => s.bridge?.pid);
	}

	/** Counts for /api/health. */
	stats(): { size: number; busy: number; queued: number } {
		return {
			size: this.size,
			busy: this.slots.filter((s) => s.busy).length,
			queued: this.queue.length,
		};
	}

	/** Pre-spawn every slot and wait for each child to answer a ping, so the first real jobs
	 *  don't eat the cold start. Optional -- lazy spawn on acquire() works without it. */
	async warm(): Promise<void> {
		if (this.disposed) throw new Error("pool is disposed");
		await Promise.all(
			this.slots.map((slot) => {
				const bridge = slot.bridge ?? this.spawnSlot(slot);
				return bridge.call("ping").then(
					() => undefined,
					() => undefined,
				);
			}),
		);
	}

	/** Kill every child, reject all queued acquire()s. Idempotent. */
	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		for (const w of this.queue.splice(0)) w.reject(new Error("pool is disposed"));
		for (const slot of this.slots) {
			slot.disposing = true;
			slot.bridge?.dispose();
			slot.bridge = null;
		}
		this.wakeLeaseWaiters(); // let every parked lease() re-check and see `disposed`
	}

	/** Wake every lease() parked waiting for slots to free up. Each just re-checks "are `n` free
	 *  now?" -- most will re-park immediately if not, which is cheap and correct, just not free of
	 *  a thundering-herd re-check under heavy contention (acceptable at this pool's scale). */
	private wakeLeaseWaiters(): void {
		for (const wake of this.leaseWaiters.splice(0)) wake();
	}

	private spawnSlot(slot: Slot): PobBridge {
		const bridge = new PobBridge({
			luajitPath: this.luajitPath,
			onExit: (code) => {
				if (slot.disposing || this.disposed || slot.bridge !== bridge) return;
				// Unexpected death. Drop the handle; the slot re-spawns on its next acquire().
				// If the slot is mid-job its in-flight call() has already rejected and the job
				// runner will fail that job; the slot stays busy until release() frees it.
				slot.bridge = null;
				this.onChildError?.(
					slot.index,
					new Error(`pool slot ${slot.index} bridge exited unexpectedly (code ${code})`),
				);
			},
		});
		slot.bridge = bridge;
		return bridge;
	}

	private handleFor(slot: Slot): PooledBridge {
		const bridge = slot.bridge ?? this.spawnSlot(slot);
		let released = false;
		return {
			call: <T>(method: string, params?: Record<string, unknown>): Promise<T> => {
				if (released) return Promise.reject(new Error("PooledBridge used after release()"));
				return bridge.call<T>(method, params);
			},
			release: () => {
				if (released) return;
				released = true;
				this.releaseSlot(slot);
			},
		};
	}

	private releaseSlot(slot: Slot): void {
		const next = this.queue.shift();
		if (next && !this.disposed) {
			// Hand the still-busy slot straight to the next single-slot waiter (FIFO); ensure a live
			// child. The slot never actually goes "free", so lease() waiters have nothing new to see
			// here -- no wake needed on this branch.
			if (!slot.bridge) this.spawnSlot(slot);
			next.deliver(slot);
			return;
		}
		slot.busy = false;
		this.wakeLeaseWaiters(); // a slot just became free -- let parked lease()s re-check
	}
}
