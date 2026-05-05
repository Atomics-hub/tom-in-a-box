# Security Policy

`tom-in-a-box` is a security research tool, so reports about unsafe behavior in the tool itself are very welcome.

## Supported Version

The project is pre-1.0. Security fixes target the current `main` branch until stable release branches exist.

## Reporting

Please report security issues privately to the maintainer before opening a public issue. Include:

- affected command or workflow
- expected behavior
- observed behavior
- minimal reproduction steps
- whether a token, private repo, benchmark corpus, or generated report can be exposed

## Design Boundaries

- The CLI reads source code and claim files as untrusted evidence.
- It does not execute repository code or PoCs by default.
- Model calls are gated by an Anthropic API key and cost caps.
- Benchmark corpora may contain sensitive historical research and should be kept private unless disclosure and licensing are clear.
