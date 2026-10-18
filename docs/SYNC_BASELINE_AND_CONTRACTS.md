# Sync baseline and implementation contracts

Date: 2026-10-16. Phase 0, iteration 1.
Related tracker: [offline-first rollout](OFFLINE_FIRST_SYNC_PLAN.md).

This is a source audit and executable safety baseline. No production data migration, runtime write-path change, new storage dependency or offline account scoring is enabled.

## Data-path inventory

| Path | Current source of truth / entry point | Safety requirement for replacement |
| --- | --- | --- |
| Guest and device-only games, web | localStorage via LocalGames in app/cloud/CloudHome.tsx | Preserve scorekeeper-v1 source; transactional replacement must retain complete games and stable IDs. |
| Guest and device-only games, iPhone | AsyncStorage via LocalGames in mobile/App.tsx | Same shared rules; process termination cannot leave half a score/outbox write. |
| Account startup/list | CloudHome.loadCloudGames; mobile startup/backgroundRefresh; shared/api.ts list | Display locally available data independently of auth/list/import checks. |
| Account summary cache | shared/game-list-cache.ts, used by iPhone | Per-profile display data only; no entries/rules/next, so never promote to a writable full snapshot. |
| Account game opening | Both clients' openGame call cloud get unless device-only/guest | Need a verified full account snapshot for offline opening. |
| Account score/edit/undo/select/finish/resume/rules | Both clients choose cloudApi for account games, localApi for device-only/guest | One repository writer per game; persist intent and projected state atomically. |
| New game | shared/game-start.ts checks account capabilities, attempts cloud create, then separate-ID local fallback | Replace only when server stable-ID create and receipts support safe recovery of uncertain outcomes. |
| Guest/device-only import | shared/game-import.ts plus explicit client importLocal | Preserve originals on unconfirmed responses; scope adoption to an authenticated owner and compare full content. |
| Game deletion | Client deleteGame; LocalGames.deleteGame; API/GameStore tombstone | Version check, durable delete intent and server tombstone; no recreation by a stale offline client. |
| Frequent players | shared/frequent-player-sync.ts; client useFrequentPlayers adapters | Preserve current durable operations, deduplication and account-switch generation checks; make adoption recoverable. |
| Web sign-out | setFrequentPlayersAccount(null,null), then MSAL signOut | Future pending game data remains account-scoped; no silent purge or exposure as guest. |
| iPhone sign-out | logout deactivates player account, clears summary cache, clears SecureStore session, shows local games | Revisit display of legacy unbound/imported copies; future full account snapshots stay separate from guest history. |
| Account deletion | Client Account UI, shared/api.ts deleteAccount, API deletion guard and GameStore | Terminal/pending deletion blocks queue uploads; handle queued data separately from ordinary sign-out. |
| Layout preference | Client player-order storage | Preserve existing preference without treating it as a scoring turn-order command. |
| Backend writes | backend/Scorekeeper.Api/GameStore.cs; expected version and owner transaction lock | Add receipts in the same transaction; keep authenticated ownership and deletion guards. |

The above covers current path families. A follow-up must enumerate exact handlers/storage keys from both client Account components and backend routing, and verify lifecycle behavior on a real device before closing Phase 0.

## Known gaps: explicit blockers, not passing guarantees

- Legacy LocalGames read/modify/write can race between tabs or concurrent calls. Its version check is not an atomic compare-and-swap.
- A failed response after a cloud create may leave an extra empty account game. Do not remove the separate-ID fallback in isolation: that can introduce a worse overwrite/import conflict.
- Full account snapshots and account game outboxes do not exist yet.
- Local revision and server version are currently represented by the same Game.version field in separate stores. The new repository must distinguish them.
- A legacy local copy has no authenticated owner binding. An imported copy must not automatically be adopted into whichever account next signs in.
- Frequent-player guest adoption writes the account document and clears the guest document separately. A crash needs a migration journal, not reliance on both writes finishing.
- List results are capped at 200; list absence is not deletion.
- Game actions have no replay receipt. Never add automatic POST retries before Phase 3.
- Import reconciliation is not proof of idempotent scoring commands. The new tests below characterize current import behavior only.
- No measured production startup p95, physical-device crash evidence, or MSAL callback diagnosis is supplied by this iteration.

## ADR-001: transactional local repository

Status: proposed contract; storage adapter selection requires a spike.

Use a shared repository API with platform adapters. Web candidate: IndexedDB. Native preferred candidate: SQLite, subject to Expo SDK compatibility and physical-device transaction/recovery verification. Keep existing AsyncStorage as a read-only migration source during cutover. Do not add a native dependency or require an EAS build in Phase 0.

Minimum logical records:

| Record | Required identity and contents |
| --- | --- |
| Account partition | Stable API profile identity, schema version; guest is a separate partition. |
| Game base | Account + game ID, last confirmed server version, complete confirmed snapshot. |
| Local projection | Account + game ID, local revision and full state after ordered pending operations. |
| Outbox operation | Account + operation ID, game ID, command schema/payload, local sequence, dependency, status. |
| Migration journal | Source identity/fingerprint, destination partition, stage, validated counts/IDs/content, adoption decision. |
| Sync metadata | Account, last successful acknowledgement time/cursor and typed failure state. |

A local transaction writes operation plus projection together. A separate acknowledgement transaction updates the confirmed base, removes/marks only acknowledged operations, and projects remaining operations. Older acknowledgements cannot replace newer confirmed state. Never mutate an operation payload after it may have been sent.

Serialize writes transactionally across tabs/process lifecycle events. On database open/upgrade failure, retain legacy data and show a recovery error. No fallback to an empty database and no silent downgrade.

Migration needs a recoverable copy/validate/mark sequence. Do not delete the source automatically. Repeating the migration reuses destination IDs and recorded adoption decisions. Malformed records are retained for review. A source containing duplicate IDs or different versions of the same ID is a conflict, not an invitation to discard records.

Validation gate: adapter tests prove atomic rollback, read-after-reopen, interrupted schema upgrade and contention behavior. Browser quota and native disk-full testing are required; the in-memory baseline does not prove filesystem guarantees.

## ADR-002: operation receipts and conflicts

Status: proposed protocol; not an API currently available to clients.

Proposed envelope: protocolVersion, operationId, gameId, expectedServerVersion, command, immutable payload and relevant entry/player IDs. Server derives owner from the authenticated identity. Replays use the original envelope.

Server sequence within one transaction:

1. Enforce account-deletion guard; check owner-scoped operation receipt.
2. If receipt exists, validate matching request fingerprint and return the original result. Do this before the ordinary stale-version check.
3. For a new operation, validate deletion marker, expected version and command semantics.
4. Commit game mutation and receipt together. Return operation ID and committed version.

Define canonical payload fingerprinting, receipt retention and expired-operation rejection before implementation. Receipt expiry cannot allow old operations to become new mutations.

Policy for the first rollout: any concurrent server change pauses dependent pending operations for explicit review. Do not automatically merge even additive scores until shared semantics for turn advancement and automatic endings are proven. Undo must refer to a specific entry. Current-total commands cannot be replayed as additive commands. New games/entries reuse IDs after restarts and network failures.

On acknowledgement failure locally, retain the operation and replay the same ID. Recover from its receipt; do not fabricate success from a subsequent network-online event. Capability discovery must precede queued cloud writes. Keep legacy endpoints working, but expect version conflicts from old clients.

## ADR-003: identity, sign-out and recovery

Status: shared session guard implemented for inactive web/native repositories; durable binding and app/account-screen integration remain open. See [account lifecycle contract](ACCOUNT_REPOSITORY_LIFECYCLE.md).

- Use the server's stable profile identity to partition account data. MSAL account IDs may select a remembered mapping, but email never establishes ownership.
- An expired token does not sign the local account out or reclassify its data as guest.
- An explicit sign-out hides that account's snapshots and queue; retain them for that same account unless the user explicitly confirms a destructive local removal.
- Sign-in to a different account must not send, display or adopt the previous account's operations.
- Legacy unbound games need explicit adoption. Compare complete server/local content when IDs overlap, retaining differences for review.
- Account deletion pauses uploads immediately and remains blocked during server deletion. Never silently recreate the account or migrate its queued changes to guest.
- Preserve pending input, view and queue through interactive authentication. Ignore late responses from a previous account generation.
- Local device access controls/encryption and how cached identity is selected offline must be settled before full account snapshots are enabled.

Reconnect is one user-triggered attempt at a time. It may renew tokens, check the authenticated API and resume existing pending work. It must not create a second queue or start an unconditional import. Phase 1 messaging must not claim account scores are saved locally until that capability exists.

## Executable safety baseline

Run from repository root:

```sh
node scripts/test-sync-safety.mjs
node scripts/test-local-games.mjs
node scripts/test-api-client.mjs
node scripts/test-frequent-player-sync.mjs
node scripts/test-game-list-cache.mjs
```

The new safety script compiles the real LocalGames/import implementations into an isolated temporary directory and injects failures into disposable storage/cloud fixtures. It does not touch a user's local data or a production endpoint.

| Failure | Assertion |
| --- | --- |
| Write fails before commit | Previous complete game remains identical after reopening; failed delete retains the game. |
| Write commits but caller sees failure | Reopening finds the score; resubmitting the old version is rejected without another entry. This is characterization, not general replay protection. |
| Corrupt legacy data | New game creation fails and source bytes remain unchanged. |
| Import commits but response is lost | Device copy remains; retry confirms same-ID content without another import. |
| Same-ID account copy differs | Conflict is reported and original device bytes stay unchanged. |
| Local import-confirmation marker fails | Reopen/retry reconciles without reposting the game. |

Existing suites cover scoring rules/bounds, total-mode behavior, cached summary account isolation, API mutation non-retry, frequent-player lost acknowledgements and late account-switch responses. Those checks remain required.

## Iteration evidence and next steps

2026-10-16, iteration 1: source inventory and proposed ADR contracts recorded; new safety script and four existing baseline suites run locally (see PR validation). No API/web/native deployment required.

Phase 0 remains in progress. Remaining gates:

- Capture sanitized auth/network/database timings after idle on web and iPhone; no tokens, emails or game contents in logs.
- Finish handler/key inventory and test actual sign-out/account-deletion behavior with pending frequent-player changes.
- Add representative migration fixture files for legacy, imported, conflicting, capped-list and large-history games; test recovery journal when implemented.
- Build transactional adapter spike and scoring parity fixtures shared with server tests.
- Verify MSAL installed-version callback behavior and deployed redirect registration before Phase 1 activation.
- Record physical-device/offline acceptance results; do not mark architecture gates complete from unit checks alone.

The next runtime iteration is Phase 1 connection status/Reconnect and auth recovery. It must not enable offline account mutations or introduce automatic score retries.
