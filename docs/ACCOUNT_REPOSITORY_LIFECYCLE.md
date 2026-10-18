# Account access for the web and native repositories

Date: 2026-10-18. Phase 2, iteration 3. Inactive foundation; no production migration or app cutover.
Related: [rollout tracker](OFFLINE_FIRST_SYNC_PLAN.md), [baseline ADRs](SYNC_BASELINE_AND_CONTRACTS.md), [confirmed storage](CONFIRMED_REPOSITORY.md), [SQLite spike](SQLITE_REPOSITORY.md).

## Implemented for both platforms

`account-access.ts` wraps the confirmed-game repository with account-session leases. `web-account-repository.ts` and `native-account-repository.ts` are the intended future integration entry points; they apply exactly the same guard to IndexedDB and SQLite. The live web/iPhone applications do not open these repositories yet. Existing authentication, games, players, storage keys, imports and writes remain unchanged.

A caller first creates a session using an opaque authentication selector and optional remembered profile hint. Neither an email, a selector nor a remembered profile grants local access. The caller must verify the lease using the profileId/status returned by the authenticated API. Status objects must come from that trusted API path; this in-process helper does not validate JWTs or authenticate an owner itself.

Once verified, calls accept a lease and game ID; callers cannot select another profile on each read/write. The guard supplies the verified profile to the underlying compound-key repository. A changed profile on the same lease is rejected. Only successful verification permits confirmed-snapshot saves. Connection failure disables saves while preserving same-session cached reads. This is not an offline scoring writer or authorization for replaying cloud operations.

## Lifecycle behavior

| Event | Guard behavior | Data behavior |
| --- | --- | --- |
| Initial session / remembered ID only | Reads and saves denied until verification | Stored records untouched |
| Successful API verification | Same-profile reads and confirmed saves allowed | No implicit import or adoption |
| Token/auth/network unavailable | Confirmed saves disabled; verified local reads retained | Existing data preserved |
| Same-account verified reconnect | Confirmed saves re-enabled | IDs and content unchanged |
| Unexpected profile / malformed verification | Reject; saves disabled | Previously verified local partition retained |
| Explicit sign-out | Revoke lease and hide account access immediately | No purge; future pending queues must be preserved by their own storage contract |
| Account switch | New lease; old verification/results rejected | Old account records stay in their original partition |
| Deletion begins / API reports deletion | Revoke lease; block that profile for this guard's lifetime | No upload or recreation method exists in this guard; retention/purge is separate |
| Repository close | Revoke all access and await adapter closure | No data removal |
| New process/controller | Start unverified | No trust inferred from stored games |

Reads check the lease again after asynchronous storage work, so a late result cannot enter the next account's UI. An accepted local storage write may already be committing when sign-out/switch occurs; it remains bound to its original profile. Its caller receives a stale-account error afterward rather than a success for the new session. This does not cancel a committed local transaction, acknowledge cloud sync or implement deletion purge.

The guard keeps no token/email in its diagnostics and has no delete-storage, guest adoption or network method. The underlying low-level adapters remain available for migration/adapter tests, but app cutover should use the guarded platform entry points.

## Privacy and durable-state decisions before activation

Within an already verified active session, token expiry alone does not hide downloaded games. Explicit sign-out must hide that account and preserve work for the same account's later recovery. Cached app access is not encryption or a defense against someone who can directly read the device/browser database.

This iteration intentionally does not persist trusted identity, sign-out state or deletion markers. Deletion blocking is in-memory, not a durable tombstone. A new guard starts closed until verified online. It must not be enabled as the final offline cold-start implementation in this state.

Before app cutover, add transactional lifecycle metadata: schema version, trusted authentication-selector/API-profile mapping, active local account selection, signed-out marker, and deletion/upload-block state. Restore only a previously verified retained session that was not explicitly signed out/deleted; never infer identity from email, summary caches or arbitrary game content. Missing, corrupt, ambiguous or partially migrated metadata must fail closed without deleting game records. Durable deletion blocking must survive restart and prevent automatic account recreation. Scope browser-tab notifications and queued transactions to lifecycle revisions; an in-memory lease alone does not coordinate separate tabs.

No new device encryption, biometric gate or offline-access privacy option is shipped here. Verify the intended retained-session behavior on a shared device and with existing sign-out/account-deletion UI before activation. Destructive local removal and account deletion need separate treatment of unsynced work; this module does not add such an action or claim such work exists yet.

## Verification

After normal root dependencies and the pinned test-only IndexedDB package are installed:

```sh
npm ci --prefix tests/offline --ignore-scripts --no-audit --no-fund
node scripts/test-account-access.mjs
```

The suite compiles the actual guard, platform factories and adapters. It repeats the lifecycle scenarios against IndexedDB emulation and temporary real SQLite files, then smoke-tests both guarded factories. It verifies rejection before account verification, explicit same-account reconnect, malformed/profile-mismatch failure, read retention during connection expiry, sign-out without purge, account switch and stale verification, deletion access blocking, new-instance fail-closed behavior, late reads after sign-out, and late writes staying in the original partition. Closing a factory revokes access.

These checks are not evidence of durable sign-out/deletion markers, queued-operation recovery, cross-tab lifecycle propagation or physical iPhone acceptance. CI runs this suite; web and native TypeScript checks pass. No API/web deployment, new native dependency or EAS build is needed for the inactive foundation.

## Next increment

Add lifecycle metadata and a recoverable migration journal to both transactional adapters. Copy, validate exact IDs/content/counts, and mark progress atomically where possible. Retain all legacy sources; require explicit adoption of unbound guest games and preserve divergent same-ID content. Test restart/interruption at every migration stage, persistent sign-out/deletion state and two-tab lifecycle changes. Only then wire confirmed-read caching behind a disabled rollout flag, with the native dependency/device acceptance gate intact. Offline account scoring and queue replay remain later phases.
