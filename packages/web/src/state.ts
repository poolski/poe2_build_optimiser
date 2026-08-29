// The whole app is a 4-step wizard on one page; no router. One useReducer, small shape.
// Form state is OptimiseRequestInput (z.input) -- defaulted contract fields stay optional while
// the user is filling them in (docs/web-ui/05-frontend.md "Typing against the contract").

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

export type Action =
  | { type: "buildLoaded"; build: BuildSummary }
  | { type: "editRequest"; patch: Partial<OptimiseRequestInput> }
  | { type: "back"; to: Step }
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
