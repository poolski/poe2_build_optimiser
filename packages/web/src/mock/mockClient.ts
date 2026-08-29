// Fixture-backed stand-in for the Hono API. The real server is built in parallel against the
// same @poe2/contract; this lets `packages/web` run (and be demoed) with no API process, no
// LuaJIT and no pob-runtime submodule -- the same decoupling intake/web-ui/08-fork-prep.md set up
// for the canvas.
//
// Opt-in via VITE_USE_MOCK=1; dev otherwise hits the real API. Never used in tests (they inject
// their own fake).

import type {
  BuildInput,
  BuildSummary,
  JobRef,
  OptimiseRequestInput,
  OptimiseResultDTO,
  ProgressEvent,
} from "@poe2/contract";
import type { JobPoll, OptimiserClient, StreamHandlers } from "../api";
import fixture from "../../fixtures/canvas-diff.R_Thor-L84-weak.json";

interface RawFixture {
  baseline: { pointsUsed: number; pointsMax: number; objective: number };
  before: number[];
  afterConnected: number[];
  addedPickIds: number[];
  removed: {
    id: number;
    name: string;
    type: string;
    pointsFreed: number;
    valueLost: number;
    anchorCascade: boolean;
  }[];
  steps: {
    id: number;
    name: string;
    type: string;
    pointsSpent: number;
    pathLength: number;
    objectiveBefore: number;
    objectiveAfter: number;
    statLines: string[];
  }[];
  result: {
    mode: "repair";
    respecBudget: number;
    stoppedBecause: string;
    pointsFreed: number;
    pointsRespent: number;
    finalObjective: number;
    netPointsSpent: number;
    buildOutputCount: number;
    cacheHitRate: number;
  };
}

const fx = fixture as unknown as RawFixture;

const MOCK_BUILD: BuildSummary = {
  buildId: "mock-R_Thor-L84",
  className: "Warrior",
  ascendancy: "Titan",
  // matches the shipped tree-0_5.min.json so mock mode exercises the canvas, not the fallback
  treeVersion: "0_5",
  level: 84,
  pointsUsed: fx.baseline.pointsUsed,
  pointsMax: fx.baseline.pointsMax,
  weaponSet1PointsUsed: 0,
  weaponSet2PointsUsed: 0,
  allocatedNodeIds: [...fx.before].sort((a, b) => a - b),
  baseline: { TotalDPS: fx.baseline.objective, Life: 3200, TotalEHP: 45000 },
  notes: ["mock data -- fixture-backed client (unset VITE_USE_MOCK to hit the real server)"],
};

/** Reconstitute a full OptimiseResultDTO from the trimmed canvas fixture (same approach as the
 * contract's optimise.test.ts round-trip). */
export function mockResult(): OptimiseResultDTO {
  return {
    mode: fx.result.mode,
    baseline: {
      objective: fx.baseline.objective,
      pointsUsed: fx.baseline.pointsUsed,
      pointsMax: fx.baseline.pointsMax,
    },
    pointBudget: fx.baseline.pointsUsed,
    respecBudget: fx.result.respecBudget,
    beamWidth: 1,
    removed: fx.removed.map((rm) => ({
      id: rm.id,
      name: rm.name,
      type: rm.type,
      statLines: [],
      pointsFreed: rm.pointsFreed,
      anchorCascade: rm.anchorCascade,
      objectiveAfterRemoval: fx.baseline.objective - rm.valueLost,
      valueLost: rm.valueLost,
    })),
    steps: fx.steps.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      statLines: s.statLines,
      pointsSpent: s.pointsSpent,
      pathLength: s.pathLength,
      objectiveBefore: s.objectiveBefore,
      objectiveAfter: s.objectiveAfter,
      delta: s.objectiveAfter - s.objectiveBefore,
      deltaPerPoint: (s.objectiveAfter - s.objectiveBefore) / s.pointsSpent,
    })),
    addedNodeIds: fx.addedPickIds,
    allocatedNodeIds: { before: fx.before, after: fx.afterConnected },
    pointsFreed: fx.result.pointsFreed,
    pointsRespent: fx.result.pointsRespent,
    final: {
      objective: fx.result.finalObjective,
      pointsSpent: fx.result.netPointsSpent,
      stats: { TotalDPS: fx.result.finalObjective, Life: 3200, TotalEHP: 45200 },
    },
    stoppedBecause: fx.result.stoppedBecause as OptimiseResultDTO["stoppedBecause"],
    buildOutputCount: fx.result.buildOutputCount,
    buildOutputSeconds: 108.3,
    cacheHitRate: fx.result.cacheHitRate,
    updatedPobCode: "eJwMOCK_updated_pob_code_placeholder__real_server_produces_this",
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function makeMockClient(): OptimiserClient {
  let lastProgress: ProgressEvent | undefined;
  let settled: { result: OptimiseResultDTO } | undefined;

  return {
    async createBuild(_input: BuildInput) {
      await sleep(150);
      return MOCK_BUILD;
    },
    async getBuild(_id: string) {
      return MOCK_BUILD;
    },
    async getCascade(_id: string, anchorNodeId: number) {
      await sleep(120);
      // No tree topology in the mock: fake a small deterministic cascade -- the anchor plus the
      // next few allocated ids after it -- so the freed-subtree highlight has something to show.
      const before = [...fx.before].sort((a, b) => a - b);
      const idx = before.indexOf(anchorNodeId);
      const freed = idx >= 0 ? before.slice(idx, idx + 5) : [anchorNodeId];
      return { anchorNodeId, freedNodeIds: [...freed].sort((a, b) => a - b) };
    },
    async submitJob(_req: OptimiseRequestInput): Promise<JobRef> {
      settled = undefined;
      lastProgress = undefined;
      return { jobId: "mock-job-1", status: "queued" };
    },
    async getJob(_id: string): Promise<JobPoll> {
      if (settled) return { jobId: "mock-job-1", status: "done", result: settled.result };
      return { jobId: "mock-job-1", status: "running" };
    },
    async cancelJob(_id: string): Promise<JobRef> {
      return { jobId: "mock-job-1", status: "cancelled" };
    },
    streamJob(_id: string, h: StreamHandlers) {
      let cancelled = false;
      const phases: ProgressEvent["phase"][] = [
        "baseline",
        "regret-probe",
        "add-loop",
        "add-loop",
        "k-sweep",
        "finalising",
      ];
      const started = Date.now();
      void (async () => {
        for (let i = 0; i < phases.length; i++) {
          if (cancelled) return;
          await sleep(500);
          if (cancelled) return;
          lastProgress = {
            jobId: "mock-job-1",
            phase: phases[i],
            buildOutputs: Math.round((i + 1) * 70),
            estimatedTotal: 432,
            bestObjective:
              fx.baseline.objective +
              ((fx.result.finalObjective - fx.baseline.objective) * (i + 1)) / phases.length,
            depth: phases[i] === "add-loop" ? i : undefined,
            k: phases[i] === "k-sweep" ? 3 : undefined,
            kTotal: phases[i] === "k-sweep" ? 3 : undefined,
            elapsedMs: Date.now() - started,
          };
          h.onProgress(lastProgress);
        }
        if (cancelled) return;
        settled = { result: mockResult() };
        h.onDone(settled.result);
      })();
      return () => {
        cancelled = true;
      };
    },
  };
}
