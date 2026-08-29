// Thin typed wrappers around the Hono API (docs/web-ui/04-api-server.md). Every payload type
// comes from @poe2/contract; nothing is redeclared here. The real server is built in parallel
// against the same contract -- see ./mock/mockClient.ts for the fixture-backed stand-in used for
// local dev and tests.

import type {
  BuildInput,
  BuildSummary,
  JobError,
  JobRef,
  OptimiseRequestInput,
  OptimiseResultDTO,
  ProgressEvent,
  RecommendedNodeDTO,
} from "@poe2/contract";

/** `GET /api/jobs/:id` -- JobRef plus the settled payload. Not a named contract type; this is a
 * composition of contract types, not a redeclaration of their fields. */
export interface JobPoll extends JobRef {
  result?: OptimiseResultDTO | RecommendedNodeDTO[];
  error?: JobError;
}

export interface StreamHandlers {
  onProgress: (e: ProgressEvent) => void;
  onDone: (r: OptimiseResultDTO) => void;
  onError: (e: JobError) => void;
}

/** The surface both the real and the mock client implement. */
export interface OptimiserClient {
  createBuild(input: BuildInput): Promise<BuildSummary>;
  getBuild(id: string): Promise<BuildSummary>;
  submitJob(req: OptimiseRequestInput): Promise<JobRef>;
  getJob(id: string): Promise<JobPoll>;
  cancelJob(id: string): Promise<JobRef>;
  /** Opens the SSE stream. Returns an unsubscribe fn. */
  streamJob(id: string, h: StreamHandlers): () => void;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let kind = "internal";
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { kind?: string; message?: string };
      if (body.message) message = body.message;
      if (body.kind) kind = body.kind;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, kind, res.status);
  }
  return (await res.json()) as T;
}

export const httpClient: OptimiserClient = {
  createBuild: (input) =>
    req<BuildSummary>("/builds", { method: "POST", body: JSON.stringify(input) }),

  getBuild: (id) => req<BuildSummary>(`/builds/${encodeURIComponent(id)}`),

  // POST /jobs takes OptimiseRequest | RecommendRequest discriminated by `kind` (04). v1 only
  // wires the optimise job.
  submitJob: (r) =>
    req<JobRef>("/jobs", { method: "POST", body: JSON.stringify({ kind: "optimise", ...r }) }),

  getJob: (id) => req<JobPoll>(`/jobs/${encodeURIComponent(id)}`),

  cancelJob: (id) =>
    req<JobRef>(`/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),

  streamJob(id, h) {
    const url = `${BASE}/jobs/${encodeURIComponent(id)}/events`;
    let es: EventSource | null = new EventSource(url);
    let closed = false;
    const close = () => {
      closed = true;
      es?.close();
      es = null;
    };
    es.addEventListener("progress", (ev) => {
      h.onProgress(JSON.parse((ev as MessageEvent).data) as ProgressEvent);
    });
    es.addEventListener("done", (ev) => {
      h.onDone(JSON.parse((ev as MessageEvent).data) as OptimiseResultDTO);
      close();
    });
    es.addEventListener("error", (ev) => {
      // A named "error" event carries a JobError payload; a bare connection error has no data.
      const data = (ev as MessageEvent).data;
      if (typeof data === "string" && data.length) {
        h.onError(JSON.parse(data) as JobError);
        close();
        return;
      }
      if (closed) return;
      // Connection dropped: fall back to a poll (04 "Reconnect"). If settled, resolve; else the
      // browser's own EventSource retry will re-open.
      void this.getJob(id).then((poll) => {
        if (poll.status === "done" && poll.result && !Array.isArray(poll.result)) {
          h.onDone(poll.result);
          close();
        } else if (poll.status === "error" && poll.error) {
          h.onError(poll.error);
          close();
        }
      });
    });
    return close;
  },
};
