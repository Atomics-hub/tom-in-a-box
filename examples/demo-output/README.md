# Demo Output

This directory contains stable, no-spend sample artifacts from:

```sh
bun run src/cli.ts verify examples/vulnerable-notes-app \
  --claim examples/vulnerable-notes-app/claim.md \
  --focus authz \
  --offline
```

Offline mode does not perform model-backed verification, so the expected result is `NEEDS_MANUAL_REVIEW`. The sample exists to show artifact shape without requiring API credits.
