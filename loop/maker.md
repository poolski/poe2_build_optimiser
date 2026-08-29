# Maker

**Task:** Generate or update something as part of a loop iteration.

This could be:
- Run an integration test suite and capture results
- Re-run the corpus benchmark
- Refresh a dataset or generated artifact
- Any repeatable, bounded task that produces an output

## Instructions

1. **Do the work** — whatever the task is, do it completely and reproducibly
2. **Capture the output** — save results to a file, stdout, or both (for the verifier to check)
3. **Report clearly** — include success/failure, key metrics, timestamps, and any anomalies
4. **Stop on error** — if something breaks, report the error and stop (don't patch over it)

## Example flows

### Integration test run
```bash
npm run test:integration 2>&1 | tee loop-results.txt
echo "=== Status: $?" >> loop-results.txt
```

### Benchmark corpus
```bash
npm run bench-tree-approaches --concurrency=8 > loop-bench.md 2>&1
```

### Generate fixture
```bash
npm run gut-build | tee loop-gutted.txt
```

## Template

Edit this to describe your specific task:

---

**Task summary:** [One sentence on what the maker does]

**Prerequisites:**
- [e.g. "Integration tests must be available"]
- [e.g. "The PoB submodule must be initialized"]

**Steps:**
1. [First step]
2. [Second step]
3. [Produce output file: `loop-results.txt`]

**Success looks like:** [What indicates success]

**Failure looks like:** [What indicates failure; stop and report]

---

(End of template — replace above with your task.)
