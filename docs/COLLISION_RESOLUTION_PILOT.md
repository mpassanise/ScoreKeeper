# Explicit collision resolution pilot

This increment follows merged PR #75. It adds a deliberately limited resolution policy on both web and iPhone. Production flags remain disabled.

## Policy and user flow

A same-version disagreement is never resolved by choosing one of its conflicting snapshots. The first pair remains retained. A subsequent GET, Reconnect or successful delivery cannot clear the pause.

For a game with **no queued, uncertain, applied-but-unreconciled or rejected operations**, and no deletion tombstone, a user may explicitly check for a newer account copy from Saved copies. The account is verified first and one captured token is pinned for the account/GET pass. The request is read-only and bounded by existing API timeouts. Checking does not lock the application or prevent closing the review; close, game/account switches and stale scopes discard late presentation. Background refresh can invalidate the preview instead of forcing a stale choice.

The complete candidate must have the same game ID and a server version strictly greater than the conflicting version and every retained authoritative base/candidate applicable to that game. A restored cold lease can inspect archived evidence but cannot check/confirm without fresh account verification. A missing game/404, same or older version, malformed snapshot, profile mismatch, pending changes or deletion evidence leaves the game paused.

The newer copy is shown first for comparison. A separate confirmation explains that it becomes the saved view on this device, both contradictory snapshots and any earlier device base remain in recovery, and nothing is uploaded or combined. The preview's exact object, opaque scope, verified lease, game ID, immutable decision ID, selected snapshot and queue/collision revisions are privately bound. Cloned, edited or stale presentation DTOs are not authority to choose another copy.

Confirmation atomically updates the queue base/projection and appends the original pair/earlier base/selected copy to the collision archive, then marks that collision inactive. Existing operations and receipts for all games remain unchanged. Old reserved entry IDs plus IDs from both conflicting snapshots, the previous base and the selected copy remain reserved. The generic confirmed cache is not rewritten or erased; the tracked queue takes precedence. The ordinary two-step terminal-rejection recovery path remains available separately.

## Storage and failures

`AtomicDocuments.writeMany` is optional at the interface for older/test adapters, implemented transactionally by current IndexedDB and SQLite adapters. Resolution requires it and never falls back to sequential writes. Each mutation has its own CAS, plus the durable lifecycle revision guard in the same transaction. IndexedDB waits for transaction completion; SQLite uses its exclusive transaction/durability path. A failed second CAS or lifecycle guard cannot install a new view without archiving the pair, or clear the collision without updating the queue. No SQL/schema migration or local database version bump is needed.

Collision schema v1 remains readable without rewriting. A resolved record uses schema v2 with an optional active pair and retained decision history. The same document holds the entire history: maximum 20 decisions and 8 MiB; capacity fails visibly and never prunes evidence. Queue validation uses the existing total capacity **including reserved receipt space for other pending games**. A new contradiction reactivates the marker while keeping previous decisions. Subsequent queue/delivery/recovery writes guard the exact marker revision instead of assuming a resolved document is absent.

A lost local commit acknowledgement may be retried with the same preview/decision ID: the retained decision is returned without a second archive or rollback of later state. Restart retains the chosen base and original evidence; a new process can inspect them normally. A new decision requires a new verified preview. A retry returning a later pending/confirmed deletion suppresses its stale home tile rather than resurrecting it. Corrupt history fails closed. Sign-out, account deletion, re-verification, scope switches and conflicting queue writes revoke or reject pending previews. No tokens/emails are stored in decision records.

## Flags and rollout

- Web: `NEXT_PUBLIC_GAME_COLLISION_RESOLUTION_PILOT=true`.
- iPhone: `EXPO_PUBLIC_GAME_COLLISION_RESOLUTION_PILOT=true`.

Both default false/absent and additionally require the existing effective cache + screen + recovery pilots. Manual operation delivery remains independently gated. Do not set any production backend/client rollout flag yet. Merge does not require API deployment, migration or a paid Expo build. Controlled native testing eventually requires the existing SQLite-capable binary; local CI iOS export is not a paid EAS build.

Rollback to old application code encountering v2 evidence fails closed rather than erasing or resolving it. Turning off the new flag in the current code hides new decisions while keeping v1/v2 archives readable. Activation requires a compatible-client rollout plan and privacy/retention/erasure policy that includes collision history and the home index.

## Validation and remaining work

`node scripts/test-collision-resolution.mjs` exercises production logic with IndexedDB and desktop SQLite. It covers transaction rollback, explicit-preview-only behavior, strict newer versions/IDs, pinned read-only shell requests, close/account races, immutable original pairs, retained entry reservations, generic-cache preservation, restart, ambiguous local commit retry, queue changes, private/cloned/mutated/stale previews, cold restore and account-deletion transaction races. Queued, uncertain, applied, rejected and deleted cases remain blocked with exact original requests/receipts retained. Actual web/native check functions are executed; no production network requests occur. Existing queue, delivery, recovery, home, lifecycle/storage regressions and both typechecks remain required; the new suite is in CI.

Browser/physical-iPhone layout, focus/VoiceOver, dark mode, real auth/profile switching, large-history memory/latency and privacy/erasure/retention acceptance are still open. Pending/uncertain collisions, authoritative deletion resolution, archive pruning/export and automatic merging are not implemented. They remain paused rather than permitting a reset/rebase/drop of original requests.

Next bounded increment: integrate a separately gated scoring writer for already-tracked account games with no review/deletion barriers, reusing immutable operations and the captured-account manual delivery path. Keep source adoption/import and unresolved collision/unknown-outcome policies separate; complete privacy, device and performance gates before any production activation.
