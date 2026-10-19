# Replay-safe game lifecycle — Phase 3, increment 3

Status: backend and shared web/iPhone protocol implemented behind the existing disabled flag. No client queue, account data adoption, local migration, or offline account scoring is activated.

## Stable lifecycle requests

`POST /api/game-operations` now accepts four v1 kinds: `action`, `create`, `import`, and `delete`. The existing action serialization and fingerprint fixture remain unchanged. All kinds share the authenticated-owner/operation-ID receipt namespace; changing an operation's kind or payload under the same ID returns `OPERATION_ID_REUSED`.

Create/import envelopes contain `protocolVersion`, `kind`, `operationId`, `gameId`, `expectedVersion: 0`, and `game`. The game is the strict server Game wire shape, without client view/cache properties such as `totals` or `deviceOnly`. Creation requires version 1, no entries, an active game, no end metadata and the first player selected. Import accepts validated existing history. Both preserve all caller-allocated game/player/entry IDs. The stored server version starts at 1, Updated uses server time, and an absent StartedAt uses server time; existing history/start/end metadata remains intact. Keep the original request bytes/values for retries rather than rebuilding it from subsequently normalized server state.

An existing active game ID returns a terminal `GAME_ALREADY_EXISTS` receipt. A deleted ID returns `GAME_DELETED`. Neither case adopts, overwrites, merges, duplicates, or assigns a replacement ID. Import review and local-source retention remain separate future client work.

Delete contains `protocolVersion`, `kind: delete`, `operationId`, `gameId`, `expectedVersion`, and optionally `game: null`. Existing active games require the exact server version. Finished games return `GAME_FINISHED`; stale versions return `VERSION_CONFLICT`. A missing game with expected version zero creates a version-1 tombstone, reserving a never-confirmed ID against a delayed creation/import. Missing games with a positive expected version return `GAME_NOT_FOUND`. An existing tombstone returns `GAME_DELETED`.

Applied acknowledgements commit expectedVersion + 1. For a missing game, observedVersion is null; otherwise it is the prior server version. Rejected acknowledgements have no committedVersion and are terminal. Receipt lookup occurs before state/version checks. Replaying an earlier creation after deletion returns its original acknowledgement metadata, never a game snapshot or a resurrection. Resolve an uncertain creation/import outcome through its original receipt before constructing a dependent versioned action; never blindly rebase a queue or change an uncertain request.

## Imported entry reservations

Migration 005 adds `GameEntryReservations`, an owner-hash/game-ID/entry-ID ledger. It backfills current history and prior successful score receipts, including undone receipt-backed scores. SQL hashes existing owner IDs as UTF-8 to match the API. Imported multi-entry history is reserved in the same transaction as the game and receipt. Undo does not free IDs. Legacy writers preserve their old/new history in this ledger when installed, sharing the existing owner lock with operation writes. This does not recover historical legacy entries already removed before installation and not represented by a receipt; those IDs are unknowable. Future client queues must allocate fresh entry IDs.

The ledger contains no game/player names or scores. Account deletion purges it and all operation receipts with the game data; the permanent minimal account deletion block remains. No receipt or reservation expiration is introduced.

## Deployment after merge

1. Keep `ScorekeeperGameOperationsEnabled=false` and all web/iPhone cache/queue pilot flags disabled. The user confirmed migration 004 and the prior API deployment; that is reported deployment state, not independent production verification.
2. Apply `backend/migrations/005_game_lifecycle_operations.sql` as administrator to the intended database, with migration 004 already present. Use the actual managed-identity database user if it differs from `scorekeeper-api`. Take the normal database backup/restore precautions. This script does not move or delete existing games/receipts.
3. Deploy the new API from merged main. The disabled API can deploy before 005, but migration first is preferred. No client rebuild or EAS build is required for this backend step.
4. Verify existing signed-in create/score/import/delete/player-sync behavior and `gameOperations: null` while disabled. Preserve local data throughout; never clear storage to repair a connection.
5. Deliberate backend acceptance in a test environment can enable the flag only after every API instance runs the new version. Readiness requires schema version 2 (migration 005), the reservation ledger and receipt indexes. Capability stays protocol version 1 and adds `kinds: [action, create, import, delete]`; future lifecycle clients must require the relevant kind explicitly.
6. Run authenticated lost-response/replay, account isolation/deletion and mixed-version checks before a separately gated client queue pilot. Browser and physical-iPhone storage/identity acceptance remain open.

Migration 005 advances the schema marker from 1 to 2 and is repeatable. Do not rerun 004 afterward: it deliberately rejects unknown versions. An old action-only API rejects version 2 rather than silently advertising incompatible support. Rollback: keep the backend flag false and retain all schema tables, receipts, reservations and tombstones. Legacy routes remain available; never roll back permanent account deletion blocking or erase replay evidence.

## Verification and next work

Core fixtures cover creation/import/deletion response loss, receipt-write rollback, concurrent ID collisions, preserved IDs, imported-entry undo/reuse and delayed-creation barriers. SQL CI exercises the production storage source with the application database user, including migration 004/005 gates, UTF-8 backfill, imported history, legacy undo, deletion/import transaction failures, independent-connection concurrency, retained action receipts and account purge. The shared TypeScript contract is used by both clients; neither dispatches these lifecycle envelopes yet.

Next: implement the atomic local operation outbox and acknowledgement recovery against IndexedDB and native SQLite behind disabled flags, without switching live scoring writers. Store the immutable operation and local projection atomically, keep uncertain outcomes until their original receipt is recovered, and test restart/account-switch/conflict safety before controlled web/iPhone activation.
