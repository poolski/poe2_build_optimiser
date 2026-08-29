# Verifier

**Task:** Check the maker's output and decide if the loop should continue.

The verifier reads whatever the maker produced (a test log, a benchmark report, a dataset, etc.) and answers:
- **Pass** — the output looks good; schedule the next cycle
- **Fail** — something is wrong; halt and surface the blocker

## Instructions

1. **Read the maker's output** — whatever file(s) it left behind
2. **Run checks** — validate correctness, check for regressions, confirm metrics are in expected range
3. **Decide** — report pass or fail with specific reasoning
4. **If fail:** Include what went wrong so a human can unblock (or so the maker can fix it next time)

## Example flows

### Test suite verification
- Read `loop-results.txt`
- Check for "all tests passed" or count failures
- If any failures, report which tests + error messages
- Pass if 0 failures; fail otherwise

### Benchmark verification
- Read `loop-bench.md`
- Check that wall time is within expected range (e.g., < 2 hours)
- Compare lift % to baseline (alert if > 5% regression)
- Pass if no regressions; fail if anomalies

### Dataset verification
- Read the generated dataset
- Run a quick sanity check (e.g., row count, field presence, type validation)
- Compare to previous version (alert if structure changed unexpectedly)
- Pass if valid; fail if corrupted

## Template

Edit this to describe your verification logic:

---

**What to verify:** [One sentence on what the verifier checks]

**Inputs:**
- Reads: `[file produced by maker]`
- Baseline (if applicable): `[reference file or metric]`

**Checks:**
1. [First check: e.g., "Does the output file exist and parse?"]
2. [Second check: e.g., "Are test counts > 0?"]
3. [Third check: e.g., "Did any tests fail?"]
4. [Performance check: e.g., "Was wall time < 2 hours?"]

**Pass criteria:** [All checks above pass]

**Fail criteria & reporting:**
- If check 1 fails → Report: "Maker output missing or invalid"
- If check 3 fails → Report: "N tests failed: [list + error summaries]"
- [etc.]

---

(End of template — replace above with your task.)
