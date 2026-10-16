# Native confirmed repository: Phase 2, iteration 2

Date: 2026-10-16. Status: inactive adapter spike; physical-device gate open.
Related: [rollout plan](OFFLINE_FIRST_SYNC_PLAN.md), [confirmed repository](CONFIRMED_REPOSITORY.md).

## Implemented

`shared/repository/sqlite-confirmed-games.ts` implements the shared confirmed-game contract using a structural subset of Expo SQLite. Both apps still use their existing storage and writers. No runtime imports/open calls, dependency changes, device migration or offline account writes are enabled.

A future native caller opens a dedicated `scorekeeper-repository-v1.db` with Expo SQLite, then supplies that connection to `openSQLiteConfirmedGames`. The connection must be exclusively owned by this repository and must not be the legacy source. Callers must establish verified account identity first; the adapter does not authenticate an owner. There is no guest adoption, outbox, projection or network operation here.

The adapter reuses full snapshot validation and canonical comparison from the web contract. Compound SQL primary keys partition the stable API profile ID and game ID. User values use bound parameters, including snapshot JSON. Batches compare versions and write in one exclusive transaction. All statements in that transaction use its supplied `tx` handle, not the outer connection. Older versions are ignored; equal-version divergence rolls the batch back for review. List absence never deletes a record. Corrupt snapshots/schemas and unknown versions are retained and reported.

Calls through one repository are serialized; asynchronous close waits behind accepted calls and rejects later calls. SQLite locks provide the database-level boundary between independent handles. Lock contention rejects visibly without claiming the batch saved; the caller retains the input and can retry. The in-memory queue is not presented as the cross-connection correctness guarantee.

A dedicated new database creates its table and `user_version = 1` together. Initialization interruption rolls back both. A nonempty, unversioned database is rejected rather than treated as a new schema. A future version is rejected without downgrade, deletion or recreation. Version 1 column and compound-key definitions are validated before use.

The database uses WAL. Full SQLite synchronous durability (value 2 or greater) is checked on each transaction connection, including initialization. Expo exclusive transactions create a separate connection; setting a connection-local PRAGMA only on the original handle is insufficient. If the transaction connection is configured for weaker durability, the adapter fails instead of accepting a write. No platform can guarantee preservation after uninstall, device loss or storage eviction; physical device behavior still needs verification.

## SDK and build evidence

The installed Expo 57.0.27 bundledNativeModules.json recommends `expo-sqlite ~57.0.4`. The published 57.0.4 package was downloaded into a temporary inspection directory without installing it into either app. Its SQLiteDatabase type was assigned to the adapter's SQLiteConnection interface under strict TypeScript checking. Assignment passed. The package implementation confirms that withExclusiveTransactionAsync opens a new transaction connection and commits/rolls back around its callback.

Sources checked:

- https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/
- expo-sqlite 57.0.4: `src/SQLiteDatabase.ts`, `build/SQLiteDatabase.d.ts`.
- Installed expo 57.0.27: `bundledNativeModules.json`.

No mobile package.json/lockfile, app configuration or production dependency changed. No EAS cloud build was used. Before actual app wiring, add the SDK-compatible expo-sqlite dependency and produce a new development/TestFlight binary that includes it; an existing binary without that native module cannot gain it from a JavaScript-only update. Batch that binary with the milestone/device acceptance work, not this inactive spike.

## Executable evidence

From the repository root on Node 22.13 or newer with the normal TypeScript dependency installed:

```sh
node scripts/test-sqlite-repository.mjs
node scripts/test-confirmed-repository.mjs
```

CI runs both. The SQLite suite uses Node's real SQLite engine with temporary on-disk databases and a small Expo-shaped test port. Exclusive callbacks use separate database handles. It compiles and calls the actual adapter; it does not replace repository SQL with a map or touch production/device data.

Covered: complete reads after reopen, account/game isolation, input mutation while a write is queued, invalid/partial/duplicate input, stale responses, equal-version collisions, atomic rollback after an injected second-write failure, database lock rejection/retry, bound SQL containing hostile identity text, total-score snapshots, per-transaction durability rejection, orderly close behind an active write, corrupt data retention, future schema preservation, nonempty legacy rejection and interrupted initialization/retry.

Child-process tests terminate without normal database close before commit and after commit. Reopening keeps the previous snapshot in the first case and the committed snapshot in the second. Repeating the same confirmed version/content remains a no-op. These tests do not implement or prove idempotent server score mutations.

Web and native TypeScript checks pass. The IndexedDB suite still passes after extending the shared close contract to allow asynchronous native closure. No app runtime changed, so this iteration requires no web/API deployment or native build.

## Open gates and next step

Desktop SQLite process tests are not physical iOS acceptance. Before activation, validate the Expo bridge with actual native handles, installed iOS SQLite durability defaults, app force-quit/relaunch, disk-full behavior, background/foreground lifecycle and supported schema upgrades. Real power-loss durability cannot be inferred from process termination alone.

Next, document and test verified profile binding, offline account selection, explicit sign-out, account deletion and local device privacy. Then add recoverable copy/validate/mark migration with exact source IDs/content, account adoption decisions and representative legacy fixtures. Retain all legacy AsyncStorage/localStorage originals. Only after these gates should confirmed caching be wired behind a disabled-by-default flag; offline account scoring remains blocked on transactional operations/projections and replay-safe API capability.
