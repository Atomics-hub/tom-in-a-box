# Current Proof State

This document is the honest public-readiness ledger.

## What Exists

- local CLI for `audit`, `verify`, `bench`, `bench replay`, and `bench resume`
- six independent verification agents
- local markdown and JSON artifacts
- benchmark corpus format
- dry-run cost estimates
- cost caps before model calls
- publication audit for private-data and packaging mistakes

## Benchmark Evidence

Current private-corpus public-bar shape:

- accepted positives: 10
- known negatives: 20
- required negative `SUBMIT` count: 0

Live pass 1:

- cases: 30
- passed: 30
- failed: 0
- accepted positives observed as `SUBMIT`: 10
- known negative `SUBMIT` verdicts: 0
- status: pass

Live pass 2:

- resumed from the API-credit-interrupted run with `bench resume`
- cases: 30
- passed: 30
- failed: 0
- accepted positives observed as `SUBMIT`: 10
- known negative `SUBMIT` verdicts: 0
- status: pass

## Public Alpha Status

The private benchmark corpus now has two live public-bar passes.

The low-waste resume command used for the second pass shape is:

```sh
bun run src/cli.ts bench resume benchmark-results/public-bar-live-10x20-run-2 \
  --corpus <private-corpus> \
  --cost-cap 20 \
  --strict-public-bar \
  --out benchmark-results/public-bar-live-10x20-run-2-resumed-failed-7
```

Run a dry-run estimate immediately before any future paid benchmark run.

## Claims We Can Make Now

- The verification workflow is implemented.
- Two live private benchmark passes satisfied the public-bar criteria.
- Packaging and publication guardrails are in place.
- The second pass used resume mode to rerun only API-credit-interrupted cases from the original second run.

## Claims We Should Not Make Yet

- "Production ready."
- "Finds vulnerabilities automatically with low false positives."
- "Better than Semgrep/Snyk/GitHub."
- "Guaranteed bounty ROI."
