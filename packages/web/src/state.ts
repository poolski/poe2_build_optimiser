// The whole app is a 4-step wizard on one page; no router. One useReducer, small shape.
// Form state is OptimiseRequestInput (z.input) -- defaulted contract fields stay optional while
// the user is filling them in (intake/web-ui/05-frontend.md "Typing against the contract").

import type {
  BuildSummary,
  JobStatus,
  OptimiseRequestInput,
  OptimiseResultDTO,
  ProgressEvent,
} from "@poe2/contract";

export type Step = "input" | "config" | "running" | "results";

export interface AppState {
  step: Step;
  build?: BuildSummary;
  /** Form model, seeded with contract-shaped defaults. `buildId` is filled from `build`. */
  request: OptimiseRequestInput;
  job?: { jobId: string; status: JobStatus };
  progress?: ProgressEvent;
  startedAt?: number;
  result?: OptimiseResultDTO;
  error?: string;
}

export function initialRequest(buildId = ""): OptimiseRequestInput {
  return {
    buildId,
    mode: "extend",
    objective: "TotalDPS",
    constraints: {},
    preserveMetrics: [],
    includeAllNodeTypes: false,
    freeze: [],
  };
}

export const initialState: AppState = {
  step: "input",
  request: initialRequest(),
};

/** Whether `step`'s data prerequisite is met -- mirrors the `&&`-guards App.tsx already renders
 * on (`state.build` for config, `state.result` for results). Used by the `syncStep` action so a
 * popstate event that targets a step whose data was never loaded (or was cleared by `reset`)
 * doesn't render a blank/broken screen. */
function stepReady(state: AppState, step: Step): boolean {
  if (step === "config") return !!state.build;
  if (step === "running") return !!state.job;
  if (step === "results") return !!state.result;
  return true;
}

/** The latest step whose data prerequisite currently holds, used as the `syncStep` fallback. */
function latestReadyStep(state: AppState): Step {
  if (state.result) return "results";
  if (state.build) return "config";
  return "input";
}

export type Action =
  | { type: "buildLoaded"; build: BuildSummary }
  | { type: "editRequest"; patch: Partial<OptimiseRequestInput> }
  | { type: "back"; to: Step }
  | { type: "syncStep"; step: Step }
  | { type: "jobStarted"; jobId: string; startedAt: number }
  | { type: "progress"; event: ProgressEvent }
  | { type: "jobDone"; result: OptimiseResultDTO }
  | { type: "jobError"; message: string }
  | { type: "reset" };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "buildLoaded":
      return {
        ...state,
        build: action.build,
        request: { ...state.request, buildId: action.build.buildId },
        error: undefined,
        step: "config",
      };
    case "editRequest":
      return { ...state, request: { ...state.request, ...action.patch } };
    case "back":
      return { ...state, step: action.to, error: undefined };
    case "syncStep": {
      const step = stepReady(state, action.step) ? action.step : latestReadyStep(state);
      return { ...state, step, error: undefined };
    }
    case "jobStarted":
      return {
        ...state,
        job: { jobId: action.jobId, status: "running" },
        startedAt: action.startedAt,
        progress: undefined,
        result: undefined,
        error: undefined,
        step: "running",
      };
    case "progress":
      return { ...state, progress: action.event };
    case "jobDone":
      return {
        ...state,
        result: action.result,
        job: state.job && { ...state.job, status: "done" },
        step: "results",
      };
    case "jobError":
      return {
        ...state,
        error: action.message,
        job: state.job && { ...state.job, status: "error" },
      };
    case "reset":
      return { ...initialState, request: initialRequest() };
    default:
      return state;
  }
}
