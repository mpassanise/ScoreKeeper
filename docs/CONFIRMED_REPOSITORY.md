# Confirmed game repository: Phase 2, iteration 1

Date: 2026-10-16. Status: foundation only; not activated in either app.
Related: [rollout tracker](OFFLINE_FIRST_SYNC_PLAN.md), [baseline and proposed ADRs](SYNC_BASELINE_AND_CONTRACTS.md).

## Implemented boundary

`shared/repository/confirmed-games.ts` defines a platform-neutral confirmed-read contract. `indexeddb-confirmed-games.ts` implements it for web. No application imports, opens or writes this repository yet. The work does not change login, scoring, existing games, localStorage/AsyncStorage, imports, deletion, frequent players or sync behavior. No API deployment or EAS build is needed for this iteration.

The only write method accepts complete, confirmed GameViews. It is not a local scoring method. A future caller must first bind the active authentication generation to the stable profileId returned by the authenticated API; passing an arbitrary ID to this storage API does not authenticate an owner. No remembered mapping, email or game summary can establish ownership.

The v1 database has a `confirmedGames` store keyed by the IndexedDB compound key `[profileId, gameId]`. Each record includes schema version, account/game identity, confirmed server version and complete GameView: players, entry IDs/history, rules, totals, next player, winner and lifecycle metadata. Writes clone and validate the input before queuing it; reads validate records rather than treating corrupt storage as an empty account.

## Transaction and replacement rules

- A batch is one read/write transaction. Resolve only after transaction completion, never after an individual put succeeds. Request errors/aborts reject; no silent in-memory fallback.
- Overlapping IndexedDB read/write transactions serialize the compare-and-write across independent connections. The code does not rely on an in-memory mutex.
- Older confirmed server versions cannot replace newer ones. Equal version and equal content is a no-op; equal version with different content rejects the entire batch for review. The existing stored copy stays intact, and the caller still owns its incoming snapshot. This is not a durable conflict inbox.
- Missing games in a batch are never deleted. A capped account list cannot establish deletion. No server tombstones are consumed in this iteration.
- Account partitions are explicit; there is no guest partition or adoption route here. Device-only games and partial summaries are rejected.
- An incompatible/corrupt/future database is retained and reported. No automatic delete/recreate, downgrade, purge, migration or fallback occurs.
- Blocked opens/timeouts reject visibly. Late open results close; an already-rejected upgrade is aborted. Connections close on versionchange so later schema upgrades can proceed.
- Write transactions request `durability: strict`. This is a browser durability hint, not a guarantee against device loss, browser eviction or physical power failure. Unsupported storage must surface an error before activation, not silently fall back to nontransactional writes.

Specification checked: [Indexed Database API 3.0](https://www.w3.org/TR/IndexedDB/), transaction scheduling, abort, completion and durability semantics.

No outbox, local revision, projection, acknowledgement, replay, network side effect or pending-operation state exists in this adapter. Do not attach it to an offline writer. A future schema and transaction contract must protect confirmed snapshots and local projections before queued writes are enabled.

## Reproducible checks

From the repository root, after installing the normal root dependencies:

```sh
npm ci --prefix tests/offline --ignore-scripts --no-audit --no-fund
node scripts/test-confirmed-repository.mjs
```

The pinned fake-indexeddb dependency is isolated in a test-only package; neither app gains a runtime package. CI runs the suite. The script compiles the actual repository and shared game implementation, then exercises IndexedDB behavior in an emulator. It never opens a production database or reads a user's saved games.

Covered: detached input, complete snapshots after connection reopen, account separation, missing owner, partial/device-only snapshots, duplicate game/entry IDs, total-score mode, completed games, two independent connections racing with out-of-order versions, replayed reads, same-version content mismatch, atomic batch rollback, injected quota exception after an earlier put was accepted, subsequent recovery, corrupt records, closed connections, interrupted initial upgrade/retry, incompatible v1 schema, security-denied opening and retention of future schemas. Existing local-game/import/frequent-player/cache safety suites and web/native typechecks also pass locally.

The emulator verifies transaction behavior, not physical filesystem durability, Safari quota behavior, actual multi-tab browser lifecycles, OS termination or eviction. Browser/device acceptance remains required. The test adapter does not establish production performance targets.

## Next activation gates and continuation

1. Validate the native SQLite adapter against the installed Expo SDK in a local spike; record dependency/build impact and crash recovery. AsyncStorage remains untouched as a migration source.
2. Settle verified profile binding, offline account selection, explicit sign-out/account deletion, local device privacy and storage error UX for both platforms.
3. Add a recoverable copy/validate/mark migration journal with representative legacy fixtures, exact IDs/content verification and explicit adoption. Keep originals; no automatic guest transfer or inferred acknowledgement.
4. Wire confirmed-read caching behind an independent rollout flag, initially disabled. Distinguish cached read-only views from writable local games; avoid stale resurrection after deletion and late writes after account switch/deletion. Validate browser quota, upgrade blocking and two-tab behavior.
5. Implement additive replay-safe API and local operation/projection transactions before enabling offline account scoring. Never retry legacy scoring POSTs or claim queued changes are synced without durable receipts.

Rollback for this iteration: remove the unused modules/tests without changing live behavior. There is no activated data migration to reverse. Once any future queued writer is enabled, rollback needs the queue-aware recovery procedure in the rollout plan.
