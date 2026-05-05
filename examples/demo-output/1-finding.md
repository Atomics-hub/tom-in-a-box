# Cross-user note read authorization bypass

## Advisory Metadata

- Status: NEEDS_MANUAL_REVIEW
- Severity: medium
- Confidence: 0.50
- Focus: authz
- Repository commit: unknown

## Summary

`readNote()` fetches a note by caller-supplied id and returns it to any non-admin authenticated user. Unlike `updateNote()`, it never checks that `note.ownerId` matches `currentUser.id`.

An authenticated user who can guess or obtain another user's note id can read that user's note body.

Expected fix: mirror the ownership check from `updateNote()` before returning the note to non-admin users.

## Affected Code

- src/server.ts

## Attack Path

Provided by researcher claim; verification agents must independently validate it.

## Impact

Provided by researcher claim; verification agents must independently validate it.

## Verification Appendix

Final status: NEEDS_MANUAL_REVIEW
Score: 0.19

| Agent | Verdict | Confidence | Summary |
| --- | --- | ---: | --- |
| revalidate | NEEDS_REVIEW | 0.25 | Offline smoke mode skipped model-backed verification. |
| trybreak | NEEDS_REVIEW | 0.25 | Offline smoke mode skipped model-backed verification. |
| audit-writeup | NEEDS_REVIEW | 0.25 | Offline smoke mode skipped model-backed verification. |
| audit-poc | NEEDS_REVIEW | 0.25 | Offline smoke mode skipped model-backed verification. |
| novelty | NEEDS_REVIEW | 0.25 | Offline smoke mode skipped model-backed verification. |
| style-consistency | NEEDS_REVIEW | 0.25 | Offline smoke mode skipped model-backed verification. |

### Blocking Facts

- revalidate: No independent AI verification was performed.
- trybreak: No independent AI verification was performed.
- audit-writeup: No independent AI verification was performed.
- audit-poc: No independent AI verification was performed.
- novelty: No independent AI verification was performed.
- style-consistency: No independent AI verification was performed.
