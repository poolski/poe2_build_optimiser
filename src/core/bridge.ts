// JSON-RPC client for the headless PoB bridge (pob-runtime/bridge.lua).
// Spawns LuaJIT once and keeps it warm for the lifetime of the app session.

import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import * as path from "node:path";
import * as readline from "node:readline";

export interface PobRpcRequest {
	id: number;
	method: string;
	params?: Record<string, unknown>;
}

export interface PobRpcResponse {
	id: number;
	result?: unknown;
	error?: string;
}

// What core/*.ts modules depend on -- an interface rather than the concrete PobBridge class so
// tests can pass a fake bridge (canned responses, no real LuaJIT process) without fighting
// PobBridge's private fields, which would otherwise make it structurally unsatisfiable by a
// plain object.
export interface PobBridgeClient {
	call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
}

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const POB_SRC_DIR = path.join(REPO_ROOT, "pob-runtime", "PathOfBuilding-PoE2", "src");
const BRIDGE_LUA = path.join(REPO_ROOT, "pob-runtime", "bridge.lua");
const LUAJIT_EXE = process.env.POB_LUAJIT_PATH ?? "C:\\msys64\\mingw64\\bin\\luajit.exe";

export class PobBridge implements PobBridgeClient {
	private proc: ChildProcessWithoutNullStreams;
	private rl: readline.Interface;
	private nextId = 1;
	private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

	constructor() {
		this.proc = spawn(LUAJIT_EXE, [BRIDGE_LUA], {
			cwd: POB_SRC_DIR,
			env: {
				...process.env,
				LUA_PATH: "../runtime/lua/?.lua;../runtime/lua/?/init.lua;?.lua;;",
				LUA_CPATH: "../runtime/?.dll;;",
			},
		});

		this.proc.stderr.on("data", (chunk: Buffer) => {
			// PoB's own boot/diagnostic log -- useful for debugging, not part of the protocol.
			process.stderr.write(`[pob] ${chunk}`);
		});
		this.proc.on("exit", (code) => {
			for (const { reject } of this.pending.values()) {
				reject(new Error(`bridge process exited (code ${code}) before responding`));
			}
			this.pending.clear();
		});

		this.rl = readline.createInterface({ input: this.proc.stdout });
		this.rl.on("line", (line) => {
			if (!line.trim()) return;
			let response: PobRpcResponse;
			try {
				response = JSON.parse(line);
			} catch {
				console.error("[pob] failed to parse response line:", line);
				return;
			}
			const waiter = this.pending.get(response.id);
			if (!waiter) return;
			this.pending.delete(response.id);
			if (response.error) {
				waiter.reject(new Error(response.error));
			} else {
				waiter.resolve(response.result);
			}
		});
	}

	call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
		const id = this.nextId++;
		const request: PobRpcRequest = { id, method, params };
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
			this.proc.stdin.write(JSON.stringify(request) + "\n");
		});
	}

	dispose(): void {
		this.rl.close();
		this.proc.stdin.end();
		this.proc.kill();
	}
}
