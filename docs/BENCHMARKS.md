# Benchmark Method

The benchmark corpus is the evidence engine for `tib`. Every prompt change, model change, retrieval change, or verdict-policy change should run against the same cases.

## Case Classes

- `accepted`: a real accepted vulnerability that should end as `SUBMIT`.
- `near-miss`: a plausible but wrong report that should end as `REJECT` or `NEEDS_MANUAL_REVIEW`.
- `duplicate`: a known duplicate or already-disclosed issue that should end as `LIKELY_DUPLICATE`.
- `silent-patch`: a claim against behavior that current source has already fixed.
- `design-intent`: surprising behavior that is intentionally allowed by maintainers.
- `source-fixture`: a small distilled source excerpt for prompt/retrieval tuning. These do not count toward the public-alpha bar.

## Historical Novelty

Accepted bugs that are public today can still be useful benchmarks when run against a pre-fix source snapshot. Add a `[novelty]` block to make the novelty agent judge duplicate risk from the historical date instead of today's public state:

```toml
[novelty]
as_of = "2026-03-09"
state = "pre-fix"
```

With `as_of` set, the novelty agent should not reject a case solely because an advisory, bug ID, or fix became public after that date. It should still return `LIKELY_DUPLICATE` when the issue was already disclosed or patched on or before the `as_of` date.

## Minimum Public Bar

- At least 10 accepted real bugs.
- At least 20 negatives across near-miss, duplicate, silent-patch, and design-intent cases.
- Zero `SUBMIT` verdicts on known negatives.
- Stable pass rate across two model runs.
- Every failure has an agent-level explanation in `benchmark-summary.md`.

## Running

```sh
bun run src/cli.ts bench benchmarks --offline
bun run src/cli.ts bench /path/to/private-corpus --case v8-example --cost-cap 4
bun run src/cli.ts bench /path/to/private-corpus --cost-cap 25
bun run src/cli.ts bench /path/to/private-corpus --strict-public-bar
```

Dry run estimates model calls and conservative maximum cost:

```sh
bun run src/cli.ts bench /path/to/private-corpus --dry-run
```

Resume a partially failed run without rerunning cases that already passed:

```sh
bun run src/cli.ts bench resume benchmark-results/public-bar-live-run-2 \
  --corpus /path/to/private-corpus \
  --cost-cap 60 \
  --strict-public-bar
```

By default, resume reruns only failed cases from the source run. Add repeatable `--case <id>` flags when you want to rerun a specific subset.

## Scaffolding Cases

Use `bench scaffold` to turn a local checkout or remote repo into a focused benchmark case without hand-copying source snapshots:

```sh
bun run src/cli.ts bench scaffold <private-corpus> \
  --id plane-authz-bypass-accepted \
  --repo /path/to/repo \
  --claim /path/to/claim.md \
  --focus authz \
  --accepted SUBMIT \
  --accepted NEEDS_MANUAL_REVIEW \
  --tag accepted \
  --source-commit <vulnerable-sha> \
  --fixed-commit <fixed-sha> \
  --source-path path/to/file.ts \
  --novelty-as-of 2026-01-01
```

The command creates `<corpus>/<id>/case.toml`, copies the claim to `claim.md`, copies selected source files from `--source-commit` into `repo/`, and writes `repo/fix.diff` from the commit pair. If `--source-path` is omitted, it infers changed paths from the diff and caps the snapshot to a focused set.

`--strict-public-bar` fails unless the run has at least 10 accepted non-fixture cases, at least 20 negative non-fixture cases, zero `SUBMIT` verdicts on known negatives, all expected-status checks passing, and a live model run. Stability still requires manually comparing two separate summaries.
