// The single module that reaches into the repo-root `src/core`. Everything else in
// @poe2/api imports the optimiser through here, so the `../../../` hop is written once and
// the "API is core's third consumer after the two CLIs" boundary stays legible.
//
// There is no build step / project reference for this crossing -- the root `tsconfig.json`
// `include` globs both `src/**` and `packages/*/src/**` into one `tsc --noEmit` program, and
// ts-node resolves the relative path at runtime. `packages/api/tsconfig.json` is `noEmit`
// for the same reason (an emit would reject the out-of-rootDir import).

export { optimiseTree } from "../../../src/core/optimiseTree";
export type {
	OptimiseTreeOptions,
	OptimiseTreeResult,
	OptimiseProgress,
	OptimiseStep,
	RemovedNode,
} from "../../../src/core/optimiseTree";

export { recommendTree } from "../../../src/core/recommendTree";
export type {
	RecommendTreeOptions,
	RecommendedNode,
	RecommendProgress,
	TreeStatus,
	ConstraintViolation,
} from "../../../src/core/recommendTree";

export { parseObjective } from "../../../src/core/objective";
export type { StatSet } from "../../../src/core/stats";
