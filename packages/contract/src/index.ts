// @poe2/contract -- Zod request/response/event schemas + the TS types inferred from them,
// shared by the API (packages/api) and the web UI (packages/web). One definition, no drift:
// the API validates every untrusted request body against these, the UI builds its forms and
// result views against `z.infer` of the same schemas.
//
// Spec: docs/web-ui/03-shared-contract.md. Everything the UI consumes is inferable -- no
// hand-written interface that could drift from a schema.

/** Bumped whenever any schema in this package changes. Echoed on the API's `/api/health` so a
 * stale browser tab against a newer server can show a "reload" banner instead of silently
 * mis-parsing. Single repo, both halves ship together -- no wire-compat burden. */
export const CONTRACT_VERSION = "1.0.0";

export * from "./build";
export * from "./optimise";
export * from "./recommend";
export * from "./progress";
export * from "./job";
