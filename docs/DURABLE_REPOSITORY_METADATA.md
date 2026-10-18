# Durable account metadata and legacy staging

Date: 2026-10-18. Phase 2, iteration 4. Inactive foundation for both web and iPhone.
Related: [rollout plan](OFFLINE_FIRST_SYNC_PLAN.md), [prior account lifecycle contract](ACCOUNT_REPOSITORY_LIFECYCLE.md).

## Schema and transaction boundary

IndexedDB now opens database version 2 and adds `repositoryMetadata` without replacing `confirmedGames`. SQLite adds `repository_metadata` and advances user_version to 2 in the same transaction. The database/file names stay unchanged; full snapshot records retain their schemaVersion 1 format and IDs. Unknown future/corrupt schemas still fail closed, never delete/recreate. IndexedDB verifies compound key paths; SQLite verifies table/primary-key definitions.

Both adapters expose AtomicDocuments: read a revisioned document, or compare-and-swap an expected revision (0 means absent). The read/compare/write is one storage transaction. Success resolves after commit, not after a request is accepted. Concurrent stale revisions reject with STORAGE_CONFLICT. Quota, connection/lock and transaction errors reject without pretending to save; callers retain their source/intent. SQLite lock contention may reject with STORAGE_UNAVAILABLE and require an explicit later retry; there is no blind disk-full retry.

Lifecycle and staging documents use separate keys. They do not make game snapshots and metadata one multi-store write transaction. Accepted snapshot writes remain bound to their original profile, and access is checked again afterward. This is sufficient for the current confirmed-read foundation, not for a future operation/projection/outbox transaction. No queued game writer is implemented or enabled.

## Durable lifecycle protocol shared by both entry points

The canonical web/native repository factories now return createDurableAccountRepository. The earlier in-memory guard remains a tested low-level prototype; app cutover must use the durable factories. Neither live app opens these factories yet.

The `account-lifecycle` document records schema version, one retained verified selector/profile binding, an optional pending verification and permanently blocked deletion profile IDs. It contains no access/refresh tokens, email identity or game contents.

1. beginVerification(selector, expectedProfileId?) writes an unverified barrier and returns a revision ticket. Selectors and remembered IDs grant no access. A new selection revokes prior leases across database handles on their next access check.
2. verify(ticket, authenticatedApiStatus) compares the same durable revision and checks the expected/server profile and deletion state. Success durably binds the selector/profile and issues an account lease. A late response from before sign-out cannot restore an account because its revision is stale. Trusted API status is the caller's responsibility; the storage layer does not authenticate JWTs itself.
3. restore(selector) returns a read-only lease only for the matching retained verified account. It needs no online token. Another selector, signed-out/pending account, corrupt metadata or a deletion block cannot restore access.
4. connectionUnavailable(lease) disables confirmed saves for that lease while retaining verified reads. A lease restored after process restart is already read-only. Fresh successful verification is required before confirmed snapshot saves; this is not an offline scoring save path.
5. signOut(lease or verification ticket) commits a null active/pending binding without purging stored games or source copies. After reopen, restore remains denied. A successful sign-out must not be reported before this transaction commits.
6. beginDeletion(lease) commits the profile block and clears the active binding before a future caller sends the server deletion request. Even a later API status saying active cannot silently recreate that blocked profile. Server-reported deletion during verification also writes a durable block. No unblock, account recreation, guest import or purge method is provided.
7. Read/save methods validate revision and account before and after asynchronous snapshot work. Old handles cannot read after another handle signs out or switches the active binding. Closing invalidates that instance's handles and closes its adapter.

A failed durable sign-out/deletion write is not a completed action: the stored binding may remain active, and the caller must hide local UI access, retain the intent and report/recover the storage failure before claiming completion or sending deletion. That app-level failure UX is part of the cutover gate. Local records are not encrypted by this feature; account gating controls application access, not raw database access by a device owner.

Separate handles observe revision changes when they next use the repository. This is not a BroadcastChannel/event subscription that immediately clears already-rendered content in another browser tab. Such lifecycle notifications and application state clearing remain mandatory before live web activation. The global lifecycle revision deliberately allows one selected account per database; a pending verification is fail-closed until verification or explicit sign-out completes. Token refresh for an already verified account uses verify(existing lease, status), preserving reads while the request is pending; it must not start a new selection barrier merely because a token expires.

## Recoverable legacy copy/validate/mark staging

stageLegacyGames(documents, sourceId, raw) accepts immutable source bytes; it has no source writer/remover or network dependency. A single atomic document stores exact raw bytes and their validation manifest together. Each source has numbered versions, original game IDs/count, and validated/review status.

- Repeating identical bytes reuses the existing version, including after a response was lost locally. It does not allocate game/player/entry IDs.
- Different bytes for the same source retain both versions and mark review. The staging runner never overwrites an earlier source copy.
- Malformed JSON, invalid games and duplicate IDs retain the complete original bytes for review. Duplicate IDs remain in the manifest; nothing is silently deduplicated or discarded.
- Valid games are inspected through real legacy reading and game/rule validation. Device-only flags are ignored only in the temporary validation view. The stored raw source is unchanged.
- Reopening validates the journal against its retained source bytes. Invalid/corrupt journals reject rather than resetting to empty.
- Compare-and-swap conflicts retry against the latest journal up to five times. Other storage failures leave the source intact and require recovery/retry. Nothing clears the legacy source.

Validated means the staged copy passed inspection. It does not mean owned, adopted, imported, synced, server-confirmed or ready for offline writes. Raw legacy games remain unbound. They are not inserted into confirmedGames; a user must explicitly adopt eligible content later, and divergent server/local copies need review. Frequent-player adoption is not migrated by this runner. Whole-source copies may be large; quota/scale and privacy acceptance are required before real-device staging is enabled.

## Evidence and verification

After normal root dependencies and the test-only IndexedDB package are installed:

```sh
node scripts/test-durable-repository.mjs
node scripts/test-account-access.mjs
node scripts/test-confirmed-repository.mjs
node scripts/test-sqlite-repository.mjs
```

The durable suite runs the same scenarios against IndexedDB emulation and file-backed real SQLite. It creates authentic schema-1 fixtures with a full game, interrupts the actual v1-to-v2 upgrade after metadata DDL, verifies rollback to v1 and retained content, then upgrades successfully. It verifies metadata CAS, independent-handle revocation, offline restore, sign-out/deletion after reopen, stale verification rejection, read-only restore, account separation, concurrent staging/retry, exact raw/ID preservation, changed/malformed/duplicate-ID review, quota rollback, lost local acknowledgement and corrupt metadata/journal rejection.

The prior adapter/lease suites remain enabled, including SQLite process-exit recovery. Future-schema fixtures advance to version 3 so their downgrade guards continue to test a genuinely unsupported version. Both platform factory tests now use the durable verification protocol. Web and native TypeScript checks pass. CI includes the new durable suite.

These tests do not prove real browser disk persistence/eviction, immediate cross-tab UI clearing, Expo native bridge behavior, iPhone disk-full/power-loss handling, production migrations or exactly-once cloud scoring. No EAS cloud build, production storage migration, website/API deployment or live app cutover is part of this increment.

## Continuation and rollback

Next, wire the durable protocol to both applications' identity, sign-out and deletion handlers behind a disabled rollout flag; add browser lifecycle notifications and native dependency/device acceptance. Design explicit legacy-source selection/adoption and review UI, and measure source size/quota behavior. Cache only full authenticated confirmed reads initially, keeping legacy sources. Do not mark Phase 2 complete until those gates pass. Replay-safe API receipts and atomic local operation/projection transactions still precede offline account scoring.

The v1-to-v2 upgrade is additive and tested but one-way for these adapters: v1-only code must fail rather than downgrade a v2 database. This iteration is inactive, so there is no user data upgrade to roll back. Once activated, disable new enrollment and retain a schema-2-compatible recovery reader; never delete metadata to force old code to open.
