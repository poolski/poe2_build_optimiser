// Process bootstrap: build the pool, mount the app, bind 127.0.0.1. Not a background service --
// start it when you want the tool, Ctrl-C when done.
//
//   npm start            (from repo root; prod-ish, API only)
//   ts-node packages/api/src/server.ts

import { serve } from "@hono/node-server";
import { PobBridgePool } from "@poe2/pob-bridge";
import { createApp } from "./app";
import { config } from "./config";

const pool = new PobBridgePool({
	size: config.poolSize,
	luajitPath: config.luajitPath,
	onChildError: (slot, err) => console.error(`[pool] slot ${slot}: ${err.message}`),
});

const { app } = createApp({ pool });

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
	console.log(
		`build_optimiser API -> http://${config.host}:${info.port}  ` +
			`(local-first, single-user, no auth -- do not expose)`,
	);
});

let shuttingDown = false;
function shutdown(signal: string): void {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`\n${signal} -- shutting down`);
	server.close();
	void pool.dispose().finally(() => process.exit(0));
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
