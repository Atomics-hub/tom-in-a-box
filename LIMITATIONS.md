# Limitations

`tib` is pre-alpha research tooling. It can help with security review, but it should not be treated as an autonomous vulnerability finder or submission engine.

## Model Judgment

- Verifier agents can be wrong.
- `SUBMIT` means every configured verifier agreed, not that a maintainer will accept the report.
- `NEEDS_MANUAL_REVIEW` is a safe non-submit state, not a successful finding.
- Benchmark results depend on model behavior, prompt context, and corpus quality.

## Cost

- Live runs spend API credits.
- `--dry-run` estimates conservative maximum cost but is not an exact billing statement.
- `--cost-cap` stops before reserved estimated cost exceeds the cap; provider-side billing can still differ from local estimates.

## Scope

- The CLI does not execute target repository code by default.
- Generated PoCs are markdown plans, not automatically run exploit code.
- Dynamic analysis, fuzzing, browser automation, container execution, and environment setup are out of scope for the current release.

## Benchmark Privacy

- The public repo includes only a toy smoke/demo corpus.
- Private benchmark cases may contain undisclosed research, copied source snapshots, or disclosure-sensitive details.
- Publish aggregate benchmark results unless disclosure status and source licensing are clear.

## Security Boundaries

- Treat target repositories, claims, generated reports, and benchmark cases as untrusted input.
- Do not paste secrets into claims or prompts.
- Do not publish `audit-results/`, `benchmark-results/`, `private-benchmarks/`, or `~/.tib/config.toml`.
