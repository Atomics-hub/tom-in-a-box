# Cross-user note read authorization bypass

Severity: medium

Affected file: `src/server.ts`

`readNote()` fetches a note by caller-supplied id and returns it to any non-admin authenticated user. Unlike `updateNote()`, it never checks that `note.ownerId` matches `currentUser.id`.

An authenticated user who can guess or obtain another user's note id can read that user's note body.

Expected fix: mirror the ownership check from `updateNote()` before returning the note to non-admin users.
