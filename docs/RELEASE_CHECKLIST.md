# Release Checklist

Use this checklist before making a public commit, tag, package, or binary release.

## Evidence

- `bun test`
- `bun run typecheck`
- `bun run src/cli.ts doctor`
- `bun run src/cli.ts bench benchmarks --offline`
- `bun run src/cli.ts verify examples/vulnerable-notes-app --claim examples/vulnerable-notes-app/claim.md --focus authz --dry-run`
- `bun run src/cli.ts bench <private-corpus> --dry-run`
- two live public-bar benchmark summaries satisfy `docs/PUBLIC_ALPHA.md`

The second live pass can resume a billing-interrupted run:

```sh
bun run src/cli.ts bench resume <prior-run-dir> \
  --corpus <private-corpus> \
  --cost-cap 60 \
  --strict-public-bar \
  --out benchmark-results/public-bar-live-run-2-resumed
```

## Publication Audit

```sh
bun run public:audit
```

The audit checks the intended package surface, ignore rules, and obvious secret/local-path leaks.

## Private Material

Do not publish:

- `private-benchmarks/`
- `benchmark-results/`
- `audit-results/`
- `~/.tib/config.toml`
- raw model outputs from private targets
- source snapshots whose license or disclosure status is unclear

## Packaging

- Build binary with `bun run build`.
- Run `./dist/tib --help`.
- Run `./dist/tib bench benchmarks --offline`.
- Run `npm pack --dry-run --json` and confirm private/result directories are absent.
- Attach binaries as release artifacts only after confirming the target OS and architecture.

## Public Claims

Public language should say:

- verification-first audit CLI
- tries to disprove findings before submission
- benchmarked against accepted findings and known negatives
- not a replacement for expert review

Avoid claiming autonomous bug bounty submission, guaranteed vulnerabilities, or complete coverage.
