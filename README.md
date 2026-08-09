# Comparator test harness — v153

Comparator ships as one self-contained HTML file, so these suites cannot
`require` it directly. `extract.js` lifts the functions under test into small
CommonJS modules; the runner does this for you.

## Run

```bash
./run-all.sh                              # defaults to ../comparator_offline53.html
./run-all.sh path/to/comparator_offline54.html
```

Node only — no install, no network, no Python. **60 tests.**

Re-run after any change to the build. If extraction fails, the error names the
marker that moved: the build was refactored and `extract.js` needs the new
marker. That failure is intentional — a silently-empty module would let the
suites pass while testing nothing.

## Coverage

| Suite | Tests | Covers |
|---|---|---|
| `t_engine.js` | 9 | **Core correctness.** Tagging a proc code actually changes `buildAbomMap` output; swap-as-add second pass; baseline program unaffected; worker table stays in lockstep |
| `t_jobs.js` | 16 | Proc Code Behavior panel: job-number sampling, dedup, escaping, Mapping 2 (where the old description column was always blank) |
| `t_ncr.js` | 12 | NCR Dispositions Without EBOM Trace export; **grain = one row per disposition**, not per file row |
| `t_cov.js` | 7 | ECN footprint completeness — CHP-listed items that never joined to an EBOM row |
| `t_many.js` | 6 | Many EBOM line items → one ECN; AND-aggregation across the whole footprint |
| `t_visual.js` | 6 | Orphan keyframes, CSS var integrity, export-menu consistency, stylesheet brace balance |
| `t_ver.js` | 4 | Single-source version string; guards the header pill against drift |
| `t_desc.js` | — | Not a test. Demonstrates the false positives that got the description-based proc code hint removed. Kept as rationale |

## Two guards worth keeping

- **`t_visual.js` brace balance** compares the stylesheet's brace delta against a
  baseline of **-2** — not zero, because the counter is not a real CSS parser.
  This caught a stray `}` left behind by a regex edit that would otherwise have
  silently broken a rule.
- **`t_ver.js`** fails if a version literal appears anywhere in the UI chrome.
  The header pill was stale for 33 releases before this existed.

## Not covered

Lost to a container reset and not rebuilt — worth restoring if you touch these:

- **CHP release-state badge** (~18 tests). `badge.js` is still extracted, so the
  suite is straightforward to rewrite against `chpReleaseState`.
- **Delta tool** (~22 tests) — proc-code awareness, cause attribution, guardrails.
  Lives in `comparator_delta_v3_1.html`, a separate file this runner does not read.
- **Proc code table mechanics** (~23 tests) — profile export/import round-trip,
  baseline-equality detection, lock behaviour. `pmod.js` exports everything needed.

Nothing in the UI layer is covered: no DOM rendering, no click paths, no Excel
output is opened and inspected. The suites test logic, not the interface.
