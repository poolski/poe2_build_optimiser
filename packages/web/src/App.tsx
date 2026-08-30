import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { BuildInput } from "@poe2/contract";
import { ApiError, httpClient, type OptimiserClient } from "./api";
import { makeMockClient } from "./mock/mockClient";
import { initialState, reducer, type Step } from "./state";
import BuildInputStep from "./steps/BuildInput";
import RunConfig from "./steps/RunConfig";
import RunProgress from "./steps/RunProgress";
import Results from "./steps/Results";

// Dev hits the real Hono server through the /api proxy by default -- run `npm run dev` (api + web).
// Set VITE_USE_MOCK=1 to fall back to the fixture-backed client and run the SPA with no API process
// (the canvas-decoupling workflow).
const useReal = import.meta.env?.VITE_USE_MOCK !== "1";

const STEP_LABELS: [Step, string][] = [
  ["input", "1 · Build"],
  ["config", "2 · Configure"],
  ["running", "3 · Run"],
  ["results", "4 · Result"],
];

export default function App({ client }: { client?: OptimiserClient }) {
  const api = useMemo(() => client ?? (useReal ? httpClient : makeMockClient()), [client]);
  const [state, dispatch] = useReducer(reducer, initialState);
  const [busy, setBusy] = useState(false);
  const unsubRef = useRef<null | (() => void)>(null);

  // "replace" on the very first render (don't leave a junk entry before any user action, and
  // on restart -- see `restart()` below); "push" for every ordinary forward step transition.
  const historyModeRef = useRef<"push" | "replace">("replace");
  // Set true just before dispatching a popstate-driven `syncStep`, so the state->URL effect
  // below skips writing back the entry the browser just navigated to (would otherwise loop).
  const skipNextHistorySyncRef = useRef(false);

  useEffect(() => {
    if (skipNextHistorySyncRef.current) {
      skipNextHistorySyncRef.current = false;
      return;
    }
    const mode = historyModeRef.current;
    historyModeRef.current = "push";
    if (mode === "replace") {
      history.replaceState({ step: state.step }, "", `#${state.step}`);
    } else {
      history.pushState({ step: state.step }, "", `#${state.step}`);
    }
  }, [state.step]);

  useEffect(() => {
    const onPopState = (e: PopStateEvent) => {
      const step = (e.state as { step?: Step } | null)?.step ?? "input";
      skipNextHistorySyncRef.current = true;
      dispatch({ type: "syncStep", step });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const loadBuild = useCallback(
    async (input: BuildInput) => {
      setBusy(true);
      try {
        const build = await api.createBuild(input);
        dispatch({ type: "buildLoaded", build });
      } catch (e) {
        dispatch({ type: "jobError", message: describe(e) });
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  const run = useCallback(async () => {
    setBusy(true);
    try {
      const ref = await api.submitJob(state.request);
      const startedAt = Date.now();
      dispatch({ type: "jobStarted", jobId: ref.jobId, startedAt });
      unsubRef.current = api.streamJob(ref.jobId, {
        onProgress: (event) => dispatch({ type: "progress", event }),
        onDone: (result) => dispatch({ type: "jobDone", result }),
        onError: (err) => dispatch({ type: "jobError", message: err.message }),
      });
    } catch (e) {
      dispatch({ type: "jobError", message: describe(e) });
    } finally {
      setBusy(false);
    }
  }, [api, state.request]);

  const cancel = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
    if (state.job) void api.cancelJob(state.job.jobId).catch(() => {});
    dispatch({ type: "back", to: "config" });
  }, [api, state.job]);

  const restart = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
    historyModeRef.current = "replace";
    dispatch({ type: "reset" });
  }, []);

  return (
    <div className="app">
      <h1>PoE2 passive-tree optimiser</h1>
      <p className="sub">
        Paste a build, pick a mode, and let Path of Building&rsquo;s own calc engine find the
        allocation. Local-first &mdash; nothing leaves your machine.
      </p>

      <nav className="steps-nav">
        {STEP_LABELS.map(([s, label]) => (
          <span
            key={s}
            className={`crumb ${s === state.step ? "active" : ""} ${
              doneBefore(state.step, s) ? "done" : ""
            }`}
          >
            {label}
          </span>
        ))}
      </nav>

      {state.step === "input" && (
        <BuildInputStep onSubmit={loadBuild} busy={busy} error={state.error} />
      )}

      {state.step === "config" && state.build && (
        <RunConfig
          build={state.build}
          request={state.request}
          onChange={(patch) => dispatch({ type: "editRequest", patch })}
          onRun={run}
          onBack={() => dispatch({ type: "back", to: "input" })}
          client={api}
          busy={busy}
        />
      )}

      {state.step === "running" && (
        <RunProgress
          progress={state.progress}
          baselineObjective={state.build?.baseline?.TotalDPS}
          error={state.error}
          onCancel={cancel}
          onBack={() => dispatch({ type: "back", to: "config" })}
        />
      )}

      {state.step === "results" && state.result && (
        <Results result={state.result} build={state.build} onRestart={restart} />
      )}
    </div>
  );
}

function doneBefore(current: Step, s: Step): boolean {
  const order: Step[] = ["input", "config", "running", "results"];
  return order.indexOf(s) < order.indexOf(current);
}

function describe(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
