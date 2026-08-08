# Comparator test suites — v153

Node-based regression tests written alongside the v150–v153 changes.
They run against functions **extracted from the build HTML**, so each
suite has a short extraction step at the top of its harness.

## Running

The suites need their module extracted from the build first. Each test
file documents which functions it needs. General pattern:

```bash
# extract the module under test from comparator_offline53.html into a .js file,
# then:
node t_jobs.js
```

## Coverage

| Suite | Tests | Covers |
|---|---|---|
| `t_jobs.js` | 16 | Proc Code Behavior panel: job-number sampling, dedup, escaping, Mapping 2 |
| `t_ncr.js` | 12 | NCR Dispositions Without EBOM Trace export; **grain = one row per disposition** |
| `t_cov.js` | 7 | ECN footprint completeness (CHP-listed items that never joined) |
| `t_many.js` | 6 | Many EBOM line items → one ECN; AND-aggregation across the footprint |
| `t_visual.js` | 6 | Orphan keyframes, CSS var integrity, export-menu consistency, brace balance |
| `t_ver.js` | 4 | Single-source version string; guards the header pill against drift |
| `t_desc.js` | — | Demonstrates the removed description-hint false positives (kept as rationale) |

## Two guards worth keeping

- **`t_visual.js` brace-balance test** compares the stylesheet's brace delta
  against a baseline of **-2** (not zero — the counter is not a real CSS
  parser). This caught a stray `}` left by a regex edit that would otherwise
  have silently broken a rule.
- **`t_ver.js`** fails if any version literal appears in the UI chrome. The
  header pill had been stale for 33 releases before this existed.
