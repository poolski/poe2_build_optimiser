import { Hono } from "hono";
import { BuildInput } from "@poe2/contract";
import type { BuildStore } from "../builds/store";
import { badRequest, formatZodIssues } from "./errors";

export function buildRoutes(deps: { builds: BuildStore }): Hono {
	const app = new Hono();

	// POST /api/builds  { kind: "pobCode" | "xml", ... }  -> BuildSummary
	app.post("/", async (c) => {
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return badRequest(c, "request body is not valid JSON");
		}
		const parsed = BuildInput.safeParse(body);
		if (!parsed.success) return badRequest(c, formatZodIssues(parsed.error));

		try {
			const summary = await deps.builds.ingest(parsed.data);
			return c.json(summary, 201);
		} catch (err) {
			// decode failure / unparseable XML / bridge rejecting the build -- all "your input".
			return badRequest(c, err instanceof Error ? err.message : "could not load build");
		}
	});

	// GET /api/builds/:id -> BuildSummary
	app.get("/:id", (c) => {
		const stored = deps.builds.get(c.req.param("id"));
		if (!stored) return c.json({ kind: "not-found", message: "no such build" }, 404);
		return c.json(stored.summary);
	});

	return app;
}
