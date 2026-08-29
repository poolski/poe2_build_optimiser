# Loop

A **maker/verifier autonomous loop** for tasks that benefit from repeated cycles.

This folder scaffolds Claude agents to work deterministically on loop-safe tasks: validation runs, regression checks, corpus updates, and other repeatable work.

## How to use

### One-shot run

```bash
./run-loop.sh
```

Runs the maker once, verifies the result, and reports.

### Continuous loop

```bash
/loop [interval]
```

(From Claude Code terminal)

Runs maker → verifier cycles on a schedule. The interval can be:
- `5m` — every 5 minutes
- `1h` — every hour
- Omitted — let Claude self-pace based on task state

## Files

- **`maker.md`** — prompt for the agent that generates or updates something (a test run, a benchmark, a corpus refresh, etc.)
- **`verifier.md`** — prompt for the agent that checks the maker's output for correctness, regressions, or unexpected changes
- **`blocked.md`** (optional) — human-readable reasons a loop is halted (if the verifier rejects a run)
- **`lessons.md`** (optional) — non-obvious learnings from loop iterations (failures, edge cases, tuning changes)
- **`.gitignore`** — excludes local build artifacts and temporary state (loop history, credentials, volatile outputs)
- **`run-loop.sh`** — (Unix/macOS) quick-start script for a one-shot test
- **`run-loop.ps1`** — (Windows) PowerShell equivalent

## Design pattern

A typical loop:

1. **Maker** — "Run the integration tests and report any failures."
2. **Verifier** — "Did all tests pass? Report pass/fail and any new errors."
3. **Loop decides:** If verifier says "pass", schedule the next cycle. If "fail", halt and surface the blocker.

Verifier output (pass/fail, error summary) gates what happens next, keeping the loop from spinning on failures.

## When to use

- **Nightly corpus re-runs** — rebuild datasets, re-benchmark, detect regressions
- **Continuous validation** — run integration tests every N hours to catch environmental issues
- **Release preparation** — a multi-stage verification that everything is stable
- **Long-running experiments** — periodically check progress, bail out if diverging

## When NOT to use

- **One-off tasks** — don't loop what only happens once
- **User-interactive work** — loops are autonomous; they need clear accept/reject signals
- **Unbounded work** — if the maker can't finish in bounded time, the loop will block

---

**Getting started:** Edit `maker.md` and `verifier.md` to describe your task. Test locally with `./run-loop.sh` first, then schedule with `/loop` if it works.

**Last updated:** 2026-08-29
