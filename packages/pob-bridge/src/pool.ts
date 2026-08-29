// A fixed-size pool of warm PobBridge children. One long-lived pool serves many optimise jobs
// without paying PoB's multi-second boot per job. Parallelism here is *across* jobs only -- a
// single job still runs serially on one acquired bridge (phase 1.5 changes that).

import { PobBridge, PobBridgeClient } from "./bridge";

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
	 *  `release()`. Acquires one at a time (reuses `acquire()`'s own FIFO queue), so a lease can
	 *  take a moment to fully assemble under contention -- acceptable, jobs run for minutes. If
	 *  any acquire in the sequence fails (e.g. the pool is disposed mid-lease), every slot already
	 *  acquired is released before rejecting, so a failed lease never strands busy slots. Throws
	 *  synchronously (no partial acquire) if `n` exceeds the pool size -- acquiring that many
	 *  would otherwise wait forever for slots that can never free up.
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
		const slots: PooledBridge[] = [];
		try {
			for (let i = 0; i < count; i++) {
				slots.push(await this.acquire());
			}
		} catch (err) {
			for (const s of slots) s.release();
			throw err;
		}
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
			// Hand the still-busy slot straight to the next waiter (FIFO); ensure a live child.
			if (!slot.bridge) this.spawnSlot(slot);
			next.deliver(slot);
			return;
		}
		slot.busy = false;
	}
}
