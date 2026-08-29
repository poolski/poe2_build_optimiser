// Shared 400 shape. Per docs/web-ui/04-api-server.md a Zod / input failure is
// `{ kind: "bad-request", message }` -- note this is NOT a `JobError` (which carries a jobId);
// it is a pre-job rejection.

import type { Context } from "hono";
import type { ZodError } from "zod";

export function formatZodIssues(err: ZodError): string {
	return err.issues
		.map((i) => {
			const path = i.path.join(".");
			return path ? `${path}: ${i.message}` : i.message;
		})
		.join("; ");
}

export function badRequest(c: Context, message: string) {
	return c.json({ kind: "bad-request", message }, 400);
}
