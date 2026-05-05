# Contributing

`tom-in-a-box` is early. Contributions are most useful when they make the verifier more trustworthy, cheaper to run, or easier to evaluate.

## Good First Contributions

- improve docs and examples
- add tests for verdict merging, pricing estimates, or benchmark replay/resume behavior
- add safe public benchmark fixtures that do not expose private research
- improve cost estimation and reporting
- improve output formatting for maintainers and researchers

## Benchmark Contributions

Public benchmark cases must be safe to publish:

- source licensing is clear
- disclosure status is clear
- no private target code or private model output
- no secrets, tokens, or private user data
- case metadata explains why the expected status is correct

Private corpora should stay outside public commits.

## Development Checks

```sh
bun test
bun run typecheck
bun run src/cli.ts bench benchmarks --offline
bun run public:audit
```

Run `bun run public:audit` before sharing a branch or release candidate.
