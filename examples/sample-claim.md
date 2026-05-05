# Authorization bypass in sample route

Severity: unknown

The claim document path is intentionally small and generic. It is useful for exercising `tib verify` in `--offline` mode without spending model tokens.

Affected file: `src/index.ts`

An unauthenticated or under-privileged user may be able to reach a privileged action if the route handler trusts caller-supplied role state without checking the server-side authorization policy.
