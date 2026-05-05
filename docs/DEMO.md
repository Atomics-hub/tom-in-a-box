# Public Demo

The public demo is intentionally small and safe. It exists to show the CLI flow without publishing private benchmark cases or spending money by default.

## No-Spend Smoke Test

```sh
bun run src/cli.ts bench benchmarks --offline
```

This checks the benchmark harness and output writer. Offline mode does not perform independent AI verification.

Stable sample artifacts are checked in under `examples/demo-output/`.

## No-Spend Cost Estimate

```sh
bun run src/cli.ts verify examples/vulnerable-notes-app \
  --claim examples/vulnerable-notes-app/claim.md \
  --focus authz \
  --dry-run
```

This maps the demo source, builds the verification prompt context, and estimates planned model calls and conservative maximum cost.

## Optional Live Demo

Run this only when you intentionally want to spend API credits:

```sh
bun run src/cli.ts verify examples/vulnerable-notes-app \
  --claim examples/vulnerable-notes-app/claim.md \
  --focus authz \
  --cost-cap 2 \
  --out audit-results/demo-notes
```

The demo is not part of the public alpha benchmark. It is a toy target for exercising the user experience.
