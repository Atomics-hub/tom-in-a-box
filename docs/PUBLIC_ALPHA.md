# Public Alpha Bar

The public alpha bar exists to keep `tib` honest. A release should not be judged by an impressive single finding; it should be judged by whether the verifier submits real bugs and refuses attractive wrong ones.

## Required Evidence

A public alpha candidate needs:

- at least 10 accepted, non-fixture positive cases
- at least 20 non-fixture negative cases
- zero `SUBMIT` verdicts on known negatives
- every accepted positive observed as `SUBMIT`
- every case passing its expected-status check
- two separate live model runs with the same pass result
- a dry-run cost estimate before live runs

Negative cases should cover a mix of:

- near misses
- duplicates
- silent patches
- design-intent behavior

`source-fixture` cases are useful for prompt tuning and regression testing, but they do not count toward this public bar.

## Interpreting Results

`SUBMIT` should mean all verification agents returned `AGREE`.

`REJECT`, `LIKELY_DUPLICATE`, and `NEEDS_MANUAL_REVIEW` are acceptable outcomes for known negatives when the case metadata allows them. A negative case producing `SUBMIT` is a serious failure.

`NEEDS_MANUAL_REVIEW` is a safe non-submit state, not a success claim. Too many manual-review outcomes can still make the product feel weak even when the strict bar passes.

## Commands

First pass:

```sh
bun run src/cli.ts bench <private-corpus> \
  --strict-public-bar \
  --cost-cap 60 \
  --out benchmark-results/public-bar-live-run-1
```

Second pass:

```sh
bun run src/cli.ts bench <private-corpus> \
  --strict-public-bar \
  --cost-cap 60 \
  --out benchmark-results/public-bar-live-run-2
```

Resume a billing-interrupted or transport-interrupted run without rerunning passing cases:

```sh
bun run src/cli.ts bench resume benchmark-results/public-bar-live-run-2 \
  --corpus <private-corpus> \
  --strict-public-bar \
  --cost-cap 60 \
  --out benchmark-results/public-bar-live-run-2-resumed
```

For the current 7-case interrupted resume path, the estimator should be rerun immediately before spending credits. With `claude-opus-4-7`, the local estimator uses Opus 4.7 pricing instead of older Opus pricing.

If case metadata changes after a run, replay can recompute pass/fail and public-bar status without making model calls:

```sh
bun run src/cli.ts bench replay benchmark-results/public-bar-live-run-1 \
  --corpus <private-corpus> \
  --strict-public-bar
```

Replay is valid for correcting benchmark metadata and auditing result interpretation. It is not a substitute for the second live stability pass.

## Product Proof

Before public release:

- `tib verify` reproduces accepted findings from the private corpus.
- known near misses do not become `SUBMIT`
- duplicate cases surface as `LIKELY_DUPLICATE` or at least `NEEDS_MANUAL_REVIEW`
- generated PoCs are minimal enough for a maintainer to reason about
- generated writeups avoid inflated severity and name assumptions

## Safety

- repository content remains quarantined in prompts as untrusted evidence
- target repo commands are not executed by default
- PoC execution requires a future explicit design, not implicit verifier behavior
- cost caps stop before model calls that would exceed the configured budget

## Public Story

Position this as a verification-first audit tool:

> A source-code security audit copilot that tries to disprove findings before you submit them.

Publish aggregate benchmark numbers. Keep private target names, raw source snapshots, raw model outputs, and undisclosed research out of the public repo unless disclosure permission and licensing are clear.
