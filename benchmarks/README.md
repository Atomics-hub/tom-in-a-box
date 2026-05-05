# Benchmark Corpus

Each benchmark case lives in its own directory with a `case.toml`, claim markdown, and either a local repo fixture or a remote repo URL.

```text
benchmarks/
└── accepted-ghsa-example/
    ├── case.toml
    ├── claim.md
    └── repo/
```

`case.toml`:

```toml
id = "accepted-ghsa-example"
name = "Accepted GHSA example"
repo = "repo"
claim = "claim.md"
focus = "authz"
expected_status = "SUBMIT"
tags = ["accepted", "authz"]
```

Use `accepted_statuses = ["REJECT", "LIKELY_DUPLICATE"]` when more than one verdict is acceptable for a known negative case.

Create a focused source-snapshot case from an existing git repo:

```sh
bun run src/cli.ts bench scaffold <private-corpus> \
  --id v8-maglev-uninit-speculation-source-vulnerable \
  --repo /path/to/v8 \
  --claim /path/to/claim.md \
  --focus memory \
  --accepted SUBMIT \
  --accepted NEEDS_MANUAL_REVIEW \
  --tag accepted \
  --tag historical \
  --source-commit <vulnerable-sha> \
  --fixed-commit <fixed-sha> \
  --source-path src/maglev/maglev-graph-builder.cc \
  --source-path src/maglev/maglev-graph-builder.h \
  --novelty-as-of 2026-03-09
```

The scaffolder writes `case.toml`, copies the selected source files from `--source-commit` into `repo/`, copies the claim to `claim.md`, and writes `repo/fix.diff` from the commit pair. Omit `--source-path` to infer changed paths from the diff, capped to a focused set.

The included `smoke-offline` case is not a real security benchmark. It exists so the harness can be tested without model calls:

```sh
bun run src/cli.ts bench benchmarks --offline
```
