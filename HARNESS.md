# Comparator test harness

**One file: `comparator-tests.js`.** Node only — no install, no network, no
other files. 60 tests.

```bash
node comparator-tests.js                          # finds ./comparator_offline53.html
node comparator-tests.js path/to/build.html       # or point it anywhere
```

Re-run after any change to the build.

## Why one file

Comparator ships as a single self-contained HTML, and this follows suit so it
can live in a Project beside it. A split-file version was lost between sessions,
taking 72 tests with it — the whole point of this format is that it survives.

## How it works

The build's testable functions are lifted out of the HTML by marker, then run in
a per-suite sandbox that stubs the browser globals they touch (`document`,
`state`, `COL`, `XLSX`). Each suite gets its own sandbox because the modules
expect different `COL` shapes.

If a marker moves, extraction **fails loudly and names it** — the build was
refactored and the marker needs updating. That is deliberate: an empty module
would let every suite pass while testing nothing.

## Coverage

| Suite | Tests | Covers |
|---|---|---|
| Engine | 9 | **Core correctness.** Tagging a proc code actually changes `buildAbomMap` output; swap-as-add second pass; founding program unaffected; worker table in lockstep |
| Proc code panel | 16 | Job-number sampling, dedup, HTML escaping, Mapping 2 (where the old description column was always blank) |
| NCR untraced | 12 | Export grain is **one row per disposition**, not per file row; merged values joined not dropped |
| ECN completeness | 7 | CHP-listed items that never joined to an EBOM row |
| ECN aggregation | 6 | Many EBOM line items → one ECN; one bad item excludes the whole ECN |
| Stylesheet/chrome | 6 | Orphan keyframes, undefined CSS vars, export-menu consistency, brace balance |
| Version | 4 | Single-source version string; guards the header pill against drift |

## Two guards worth keeping

- **Brace balance** compares the stylesheet's delta against a baseline of **-2**
  — not zero, because the counter is not a real CSS parser. This caught a stray
  `}` left by a regex edit that would otherwise have silently broken a rule.
- **Version literal check** fails if a version string appears anywhere in the UI
  chrome. The header pill was stale for 33 releases before this existed.

## Not covered

- **CHP release-state badge** (~18 tests, lost). Straightforward to rewrite —
  `chpReleaseState` is already reachable.
- **Delta tool** (~22 tests, lost). Lives in `comparator_delta_v3_1.html`, a
  separate file this harness does not read.
- **Proc code table mechanics** (~23 tests, lost) — profile export/import
  round-trip, baseline-equality detection, lock behaviour.

Nothing in the UI layer is covered: no DOM rendering, no click paths, no Excel
file is opened and inspected. These suites test logic, not the interface.
