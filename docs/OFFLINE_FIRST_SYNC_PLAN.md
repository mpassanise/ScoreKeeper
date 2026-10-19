# Offline-first scoring and resilient account sync

Updated: 2026-10-19
Status: Phase 2 shadow repository pilot is merged but disabled; device/activation gates remain open. Phase 3 increment 3 adds gated replay-safe creation/import/deletion and imported-entry reservations; all client queues remain disabled.
Scope: web and iPhone, including games and frequent players.
Owner: Scorekeeper project. Keep this document as the durable implementation tracker.

## Outcome

Opening, resuming and scoring a previously downloaded game must not wait for authentication, the API or SQL. Save changes durably on the device, then sync in the background. Clearly distinguish saved-on-device from confirmed-in-account state. Provide a visible Reconnect action when sync cannot proceed.

Continue using Microsoft Entra External ID and Azure SQL initially. This work separates local interaction from authentication/network availability. It does not extend token lifetimes or guarantee uninterrupted cloud access.

## Current baseline and risks

Verified against the repository on 2026-10-16:

- `shared/local-games.ts` stores full guest/device-only games in the global `scorekeeper-v1` JSON array. Read/modify/write operations do not provide cross-tab transactions.
- `shared/game-list-cache.ts` stores up to 200 account summaries per profile, not complete games. It cannot supply offline scoring state.
- Account games still use cloud GET/action requests. Startup/resume and foreground mutations can therefore wait on token acquisition and network retries.
- `shared/api.ts` gives token acquisition a separate 30-second budget; GET requests can retry. Mutation requests deliberately do not retry because there is no game-operation receipt contract.
- `shared/game-start.ts` can fall back to a new device-only ID after a failed/timed-out cloud create. A late successful cloud create can leave a second, empty game.
- `shared/game-import.ts` preserves local originals and handles existing IDs, but import is not a durable, account-scoped operation outbox.
- Frequent players already have persistent operations and server deduplication. Review migration and account-switch behavior; the guest-to-account transfer uses separate writes.
- The API uses game versions for optimistic concurrency, a capped list, and deletion tombstones. Absence from a list does not prove deletion.
- Web MSAL v5 redirect/iframe integration needs verification against the installed version and deployed Entra redirect registrations. A generic timeout alone does not prove its cause.

The existing timeout diagnostics remain useful; see [connection diagnostics](ACCOUNT_CONNECTION_DIAGNOSTICS.md). Do not just increase timers again.

## Non-negotiable data rules

1. **Durable before success:** commit the local operation and resulting local state atomically before showing a saved score. On storage failure, retain input, show a clear error, and do not claim success.
2. **Stable identity:** allocate each game, player, score entry and queued operation ID once. Retries and restarts reuse those IDs. Never create a second fallback game to recover from an uncertain response.
3. **Safe replay:** deliver operations at least once; apply their effects once. The server transaction must commit the game mutation and its operation receipt together, keyed by authenticated owner plus operation ID. Reusing an ID with a different payload is an error.
4. **Explicit ownership:** partition snapshots, queues and frequent players by the API's stable account identity, not email. Guest data remains separate. Authentication failure never changes account data into guest data or another account's data.
5. **Preserve pending work:** pulls cannot replace a game that has pending changes. Keep a last-confirmed server snapshot, ordered local operations and their projected local view. Separate local revisions from server versions.
6. **Conflicts are visible:** use expected server versions and semantic operation targets. Preserve conflicting work until reviewed; never silently choose last-write-wins for scores, total-score entries, undo, edits, turn selection, rules or completion.
7. **Deletion wins:** retain server deletion markers long enough to reject all supported offline replays (or retain minimal markers indefinitely). An offline update must not resurrect a deleted game.
8. **No inferred acknowledgement:** online indicators, token success and request dispatch do not mean synced. Only a server acknowledgement, durably recorded locally, clears a pending operation.
9. **One writer per game:** serialize mutations and sync across requests, app resume and browser tabs. Coordinate tabs through transactional storage/locks; an in-memory queue alone is insufficient.
10. **No destructive migration:** retain the legacy source until its contents, identities, counts and migration results have been verified. Clearing storage is never an authentication repair step.

These safeguards cover app-controlled failures and retries. Device loss, uninstall and browser data eviction can remove changes that have never reached the account; do not promise otherwise.

## Phased delivery

Each phase gets its own small PR(s), verification evidence and release decision. No next phase is activated merely because the code is merged.

| Phase | Deliverable | Release gate and rollback |
| --- | --- | --- |
| 0. Baseline and safety harness | Inventory every read/write/import/delete/sign-out path; capture sanitized stage timings; build failure-injection fixtures and migration samples. Define shared scoring parity and account identity contracts. | Existing web/iPhone behavior passes characterization checks. No production data or write-path changes. |
| 1. Connection UX and auth recovery | Add shared connection states, Reconnect, bounded background attempts and cancellation of stale account work. Verify/fix MSAL v5 redirect bridge and callback handling. Separate cached-content display from background work. | Test after long idle, expired tokens, blocked silent auth, offline startup and account switching. Register/verify any new redirect URI before activating it. Keep cloud scoring online-only at this stage and label unavailable actions accurately. UI/auth changes can roll back independently. |
| 2. Durable local repository and migration | Add a shared repository contract with full account snapshots and durable operations. Use IndexedDB transactions on web; select/validate transactional native storage in an ADR, with SQLite the preferred candidate. Add schema versions, account partitioning, migration journal and recovery. Initially cache confirmed reads; keep new offline account writes disabled. | Repeat/crash migration without loss or duplicate records. Validate complete snapshots, storage-full handling, multi-tab access and guest isolation. Retain legacy source; feature flag can return to legacy reads while no new pending writes exist. |
| 3. Replay-safe API | Add operation IDs, payload fingerprints, atomic receipts, stable entry IDs, expected versions, typed conflict/deleted responses and capability discovery. Keep legacy routes compatible. Specify acknowledgement, receipt retention, delete markers and account-deletion behavior. | Deploy additive API/schema first. Test lost acknowledgements and repeated submissions: exactly one score/game effect. Old clients still work. Clients must not queue cloud writes until the API advertises this capability. Never roll the API back below a capability already required by queued clients. |
| 4. Local-first scoring pilot | Enable atomic local game creation/scoring plus outbox for a small web cohort, then an iPhone test build. Open cached games immediately; reconcile acknowledgements and pending operations in the background. Preserve scoring input and current view through reconnect. | Pass the full failure matrix below, scoring parity checks and physical iPhone restart/resume testing. Unknown outcomes survive restart and replay safely. Disable new enrollment on failure; keep the compatible local writer/recovery path for devices with pending work. |
| 5. Cross-device recovery and gradual rollout | Add conflict review, deletion reconciliation, safe legacy import/adoption, frequent-player migration recovery and account-switch/sign-out flows. Roll out web gradually, then TestFlight and App Store. | Two-device and old/new-client tests show no lost or duplicated changes. Resolve all pilot migration/conflict incidents. Never send pending devices back to the legacy cloud writer; reconcile/drain first or retain local use with sync paused. |
| 6. Performance and scale | Add paginated/delta sync with delete records, per-game fetching, deduplicated requests, backoff with jitter, and sanitized metrics. Measure SQL contention before changing owner-wide locks. Evaluate a same-origin BFF separately if web auth friction persists. | Compare measured startup, local-save and sync latency plus conflict/error rates against baseline. Keep correctness gates. A BFF is optional and must preserve existing account identity; it does not replace the local queue. |

### Phase 0 decisions to record before implementation

- Storage ADR: atomicity, crash recovery, quota/eviction behavior, native dependencies, multi-tab locking and migration format.
- Operation contract ADR: supported commands, payload version, IDs, dependencies, receipts, concurrency and conflict policy.
- Identity/sign-out ADR: how an existing cached account is selected offline, device-local access policy, explicit sign-out with pending work, and account deletion.
- Rollout configuration: separate flags for repository reads, queue writes and background sync. Only one mutation path may own a game.
- Test representative existing games: guest, device-only, imported, account-only, large history, completed, deleted, legacy rules and frequent players.

Guest/unbound legacy games require explicit account adoption. Do not infer ownership from deviceOnly, an email or a summary-cache match. If a legacy copy and account copy differ, preserve both for review; do not mint another ID or silently merge. Make the adoption/migration repeatable using a journal and source identity/fingerprint. Handle overlapping records by comparing complete content, not names alone.

### Phase 3 operation protocol

- Authenticate the owner server-side; never trust an owner supplied in a mutation body.
- One durable operation ID per intent with a schema version, game ID, command, payload, base server version and relevant stable entity IDs.
- Deduplication must be checked before rejecting a replay for a now-stale version. Return the original durable receipt without applying again.
- A receipt identifies the operation and committed server version/result. An old receipt must never overwrite a newer local confirmed snapshot.
- Apply a new operation and its receipt in the same database transaction. Serialize per game; retain existing account deletion safeguards.
- A response lost after commit remains pending locally. Retry the same operation; do not regenerate IDs or clear the queue on timeout.
- Undo targets a specific entry, not whichever entry is latest at retry time. Total-score changes and rule/turn/completion changes require explicit conflict policies.
- On conflict, pause dependent operations for that game, preserve their order and show review. Other games may continue syncing.
- Pulls must include a reliable deletion signal; a missing game in a capped/paginated list is not one.
- Define a receipt retention horizon and reject operations outside it safely. Expiring receipts must never make an old score replayable.
- Account deletion blocks queued uploads and removes appropriate account data/receipts under the documented deletion policy. It must not trigger guest import or account recreation.
- Legacy clients can still cause version conflicts; the new client must surface these without discarding local work.

## Connection and save UX

On web, use the compact sync control in the application header beside Settings/Account, with connection details and recovery actions in its popover. On iPhone, keep the current nonblocking connection status until native UX acceptance. Use existing theme colors, readable dark mode contrast and accessible text/icons. No page-wide dimming or blocking spinner for background sync. Keep per-game pending/review state available where it differs from the account state.

| Condition | Suggested text | Action and behavior |
| --- | --- | --- |
| Confirmed up to date | Synced · last successful time | Quiet status; no constant animation. Only claim a live connection if one actually exists. |
| Local transaction running | Saving on device… | Brief local state; protect against accidental duplicate submits. |
| Durable pending operations | Saved on this device · 3 changes waiting | Continue scoring. Show Reconnect if sync is unavailable. |
| Network unavailable | Offline · changes saved on this device | Reconnect; one attempt at a time. With no changes, show Offline and last sync time. |
| Network/API error or timeout | Sync unavailable · changes saved on this device | Reconnect; retain queue and show expandable sanitized details. |
| User interaction required | Sign in to sync · changes saved on this device | Sign in to sync; preserve input, route, account partition and pending changes. |
| User requested recovery | Reconnecting… | Nonblocking progress; prevent duplicate attempts and allow local use. |
| Conflict | Changes need review | Review opens a focused comparison; never silently overwrite. |
| Local storage failure | Couldn't save on this device | Retain input; do not count this as a saved score. Retry local save or recover storage explicitly. |

Reconnect first checks/renews authentication, then verifies the authenticated API and resumes the existing queue. Silent auth failure that requires interaction changes the action to Sign in to sync; do not loop automatic redirects or popups. A network-online event alone never marks the account synced. Backoff automatic retries with jitter and avoid repeated auth prompts. Cancel/ignore stale results after account switches and app lifecycle changes.

For the first release of the UX (phase 1), use truthful existing behavior: unmodified account games are still online-only. Show offline scoring promises only after phase 4 enables durable local writes. A game never downloaded onto this device needs connectivity to open; state that clearly.

Sign-out must disclose pending changes before any purge. Default to preserving the account-scoped queue for the same account to recover, subject to the documented device privacy policy. Never show that queue to a different account or clear it silently. Explicit account deletion needs a separate confirmation covering unsynced data and must not reconnect afterward.

## Verification matrix

Run automated failure-injection checks plus browser and physical iPhone acceptance testing. At minimum:

- Offline cold start and foreground resume; score repeatedly, terminate/reopen, then reconnect.
- Expire access/refresh credentials mid-game; fail silent auth; reconnect interactively without losing input or pending changes.
- Crash before local commit, after local commit/before send, after server commit/before response, and after response/before local acknowledgement.
- Submit one operation many times and reuse its ID with a different payload. First case applies once; second is rejected.
- Time out game creation after server commit; reconcile one stable game ID with no fallback duplicate.
- Quota/storage failure: no success message, partial write or lost prior state.
- Repeat/interruption of every migration stage, including guest frequent-player transfer. Compare source IDs, counts and content; verify no repeated adoption.
- Two devices and two browser tabs edit the same game; include legacy clients. Test additive scores, current totals, edits, undo, turn selection, reorder, rule changes, finish and resume.
- Delete on one device while another has pending scores; verify no resurrection. Delete the account with queued writes.
- Switch accounts during auth, pull and push; late responses cannot modify the new account. Sign out with pending work and recover on the original account.
- Test negative scores, ties, 100,000 limits, round/target endings and completed-game undo against shared/server scoring rules.
- More than 200 games, paginated pulls, tombstones and a game absent from a list; no false deletion or duplicate import.
- Light/dark modes, VoiceOver labels, narrow screens and long player names. Reconnect remains visible and local navigation remains usable.

Proposed performance targets to validate on representative devices: cached usable screen within 1 second and durable local score commit/feedback under 250 ms at p95. These are targets, not measured results. Record device, data size and browser in evidence. Track local commit latency, startup latency, oldest pending age, sync duration, auth stage errors, conflicts and replay hits without tokens, emails or score contents.

## Release procedure and continuation log

1. Implement only the next approved phase; reference this document in its PR.
2. Record checks, remaining limitations, migration version, API capabilities and rollback path.
3. Deploy additive API changes before dependent clients. Publish web separately from API and native distribution.
4. Test web locally/preview first. Use local Expo development testing where possible; reserve paid cloud builds for verified native dependency changes and milestone acceptance.
5. Pilot with known devices/accounts, compare records across device/account, and verify recovery before expanding.
6. Advance the phase status here only after evidence is linked. Keep legacy data until the retention/migration decision is explicitly documented.

| Phase | Status | PR / deployment / evidence |
| --- | --- | --- |
| Plan | Merged | PR #50; no runtime changes. |
| 0 | In progress | Iteration 1: [source inventory, safety baseline and proposed ADR contracts](SYNC_BASELINE_AND_CONTRACTS.md). Remaining gates are tracked there. |
| 1 | In progress | [Connection recovery](CONNECTION_RECOVERY.md): iteration 1 published on web; iteration 2 adds the existing-root MSAL bridge and redacted failure details. Real-session/device acceptance remains open. |
| 2 | In progress | Iterations 1–5 merged: durable storage, lifecycle metadata, staging and disabled shadow-cache wiring. Browser/physical-iPhone acceptance and controlled cutover remain open; see [pilot gates](CONFIRMED_CACHE_PILOT.md). |
| 3 | In progress | Increments 1–2: action contract plus [gated SQL receipts and endpoint](SQL_GAME_OPERATION_DEPLOYMENT.md). Lifecycle protocols are implemented in increment 3; authenticated deployment acceptance and client queue activation remain open. |
| 4 | Not started | Local-first pilot. |
| 5 | Not started | Cross-device recovery and rollout. |
| 6 | Not started | Performance and scale. |

## References

- [Google: building an offline-first app](https://developer.android.com/topic/architecture/data-layer/offline-first)
- [Microsoft Azure API guidelines: idempotency and concurrency](https://github.com/microsoft/api-guidelines/blob/vNext/azure/Guidelines.md)
- [MSAL browser redirect bridge](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-browser/docs/redirect-bridge.md)
- [MSAL browser token lifetimes](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/token-lifetimes)

Recheck documentation against installed versions during implementation. This plan is an incremental architecture change, not a claim that offline account scoring or the new Reconnect flow is already shipped.

### Phase 2 continuation, iteration 1

The confirmed-read repository now has a shared contract and a web IndexedDB adapter. It is not imported or opened by either application. Existing storage keys and write paths remain unchanged. Tests cover complete snapshots, account separation, concurrent connection ordering, transaction rollback, version collisions and invalid/corrupt storage. These emulated tests do not close physical-device, browser quota, eviction, privacy or migration gates. Next: native SQLite adapter spike and identity/privacy decisions, then copy/validate migration and controlled confirmed-read caching. Offline account writes stay disabled until replay-safe API capability and local operation transactions are verified.

### Phase 2 continuation, iteration 2

Added an inactive SQLite confirmed-snapshot adapter implementing the same account/game contract as IndexedDB, plus file-backed SQLite failure tests. The port was typechecked against expo-sqlite 57.0.4, recommended by the installed Expo 57.0.27 SDK; the native package is not added to mobile dependencies or loaded by the app. The desktop SQLite harness covers pre-commit process termination and committed content after abrupt process exit; it does not establish iOS native bridge/OS durability. CI runs the adapter tests. No storage migration, account cache activation, local scoring queue or API replay capability is enabled. Next: identity/privacy and account lifecycle contract, then recoverable copy/validate migration fixtures and native on-device acceptance before enabling confirmed-read caching. See [native adapter evidence and build impact](SQLITE_REPOSITORY.md).

### Phase 2 continuation, iteration 3

Added a shared account-access guard and guarded web/native repository entry points. The same tests run against IndexedDB and real file-backed SQLite: unverified account rejection, token-expiry read retention, same-profile reconnect, sign-out without purge, account switching, deletion blocking, stale verification and late read/write isolation. The guard is not wired to either live app and makes no migration or queue changes. Session/deletion blocking is currently in-memory; new instances fail closed until server verification. Durable verified binding, signed-out/deletion markers, multi-tab lifecycle propagation and migration journal remain required before activation. See [account lifecycle contract](ACCOUNT_REPOSITORY_LIFECYCLE.md). Next: add transactional lifecycle metadata and recoverable copy/validate/mark migration, then integrate controlled read caching on both platforms with device acceptance.

### Phase 2 continuation, iteration 4

Added schema 2 transactional metadata to IndexedDB and SQLite, retaining v1 confirmed snapshots. Canonical platform repository entry points now use durable verified-session leases, persistent sign-out/deletion blocks, revision checks across independent handles, and read-only offline restore. Source staging atomically retains exact legacy bytes plus an inspected manifest; repeat/lost-ack retries do not duplicate copies, changed/malformed/duplicate-ID sources remain for review. Staging is not account adoption, confirmed sync or live migration. Both apps remain on their existing writers/storage until controlled cutover. Tests cover aborted upgrade/retry, preservation, reopen, CAS races, durable lifecycle, quota failure, lost local acknowledgements and corruption against both adapters. See [durable metadata and migration staging](DURABLE_REPOSITORY_METADATA.md). Next: bind the durable protocol to app auth/lifecycle, browser-tab invalidation and an explicit migration/adoption flow behind a disabled rollout flag; finish native dependency/device acceptance before enabling caching. Replay-safe API and offline account writes remain later gates.

### Phase 2 continuation, iteration 5

PR #63 merged. Both application shells now import a shared shadow confirmed-read pilot, gated by separate build-time flags that default to false. The web hook opens IndexedDB only when enabled; iPhone dynamically loads expo-sqlite only inside the enabled opener. Only full authenticated GET results are copied after API profile verification; guest sources, summaries and mutation requests are not redirected into this repository. Cached records are not yet opened by the scoring UI. Existing score writers, legacy source keys and summary rendering continue unchanged.

The pilot binds a lifecycle revision before dispatching refresh reads. Opaque generation-scoped read captures reject late account responses after switching/sign-out. Browser BroadcastChannel/storage notifications carry no identity or game data; focus and native resume recheck the durable binding. Sign-out/deletion hide account views and must persist the local access block before completing sign-out or sending deletion. Deletion retries check the durable profile block without restoring access. Explicit device-save review, gated separately, stages exact bytes and reports validation/review only; it does not adopt, upload or remove anything.

See [pilot rollout and acceptance checklist](CONFIRMED_CACHE_PILOT.md). Local automated evidence includes both transactional adapters, disabled-opener behavior, detached GET inputs, account switching, external sign-out, late verification rejection, deletion retry after restart and staged-copy deduplication. Web/mobile typechecks and local iOS bundle export are required, with CI running the new regression suite. No EAS cloud build is requested. Native dependency expo-sqlite is now declared for the next binary; never enable its flag in an existing binary that lacks that module.

Next: run the disabled/enabled pilot on real browsers and a new iPhone development binary; finish full application mutation/account-change acceptance, deletion/tombstone reconciliation, retained-session privacy and legacy frequent-player migration gates before exposing cached account views. Implement an explicit adoption review separately. Then deliver the additive replay-safe API contract (Phase 3) before any account operation queue or offline scoring activation. Flags remain disabled until those gates are deliberately cleared; merge/deployment alone does not enable a pilot.

### Phase 3 continuation, increment 1

PR #64 and Copilot follow-ups are merged. Reviewed the account-action barriers, lifecycle-denial invalidation, failed pending-ticket sign-out retry, profile/game-bound iPhone input recovery, and same-account reconnect barrier recovery. Relevant repository, account-refresh and legacy game tests remain required. Publish the merged web fixes with pilot flags disabled; no API deployment or EAS build is needed merely for this merge.

Started Phase 3 development without advancing Phase 2 acceptance gates or activating any offline account writes. Added a strict v1 action-operation envelope shared by web/iPhone and C#, a stable-entry/commit-time scoring seam, and an inactive transactional receipt coordinator. It fingerprints requests before async work, checks owner/deletion scope, looks up receipts before version checks, reserves historical entry IDs, and returns terminal acknowledgements without game snapshots. The transaction fixture covers concurrent replay, receipt-write rollback and lost acknowledgements; it is not SQL integration evidence. See [protocol, safety boundaries and deployment order](REPLAY_SAFE_GAME_OPERATIONS.md).

Next: real SQL transaction/receipt adapter, additive schema and action endpoint with capability gating; resolve permanent minimal account deletion barriers and receipt retention before activation. Extend stable protocols to creation/import/deletion, then deploy compatible API/schema before enabling any dependent web/iPhone queue. Physical-device and browser pilot acceptance remain open. No routes/capabilities/queues or pilot flags are enabled in this increment.

### Phase 3 continuation, increment 2

PR #65 merged, including stricter numeric parsing and related regression checks. Added migration 004, the owner-locked SQL receipt adapter and authenticated `POST /game-operations`. Account capability discovery requires the exact backend flag plus a ready schema; no client dispatch, queue or offline account scoring is enabled. The SQL transaction commits game state and its applied/rejected receipt together. New/legacy writers share the owner lock and expected-version checks. Completed account deletion markers no longer expire; account completion removes receipts while retaining the minimal hashed block. Privacy/retention wording is updated to match.

A dedicated CI job uses disposable real SQL Server and the application database user for repeated/concurrent requests, lost acknowledgements, injected receipt failures, legacy writer contention, migration/schema gates, deletion and retained entry IDs. API/core checks and existing web/mobile CI remain required. Real SQL tests do not close production Azure/Entra, browser or physical-iPhone acceptance gates.

After merge, install migration 004 and deploy the API with `ScorekeeperGameOperationsEnabled=false`. No EAS build is required for this backend increment. Keep the capability off in production pending authenticated smoke/pilot acceptance, and do not enable queues. See [deployment sequence, rollback constraints and remaining work](SQL_GAME_OPERATION_DEPLOYMENT.md). Next: stable creation/import/deletion protocols, then a separately gated atomic local outbox and acknowledgement recovery for both clients.

### Phase 3 continuation, increment 3

PR #66 is merged. The user confirmed that migration 004 was applied and the API deployed with `ScorekeeperGameOperationsEnabled=false`. Added [replay-safe creation, import and deletion](GAME_LIFECYCLE_OPERATIONS.md), preserving client IDs and terminal receipts without automatic adoption or duplicate-ID fallback. Migration 005 backfills an entry-ID ledger for imported multi-entry history and advances readiness to schema version 2. Legacy saves/undo preserve reservations when the ledger is installed, and account deletion purges reservations with receipts and game data. The existing action fingerprint remains unchanged. Missing-ID deletion reserves a tombstone against delayed imports.

After merge: deploy the API with the backend flag false, confirm all instances use the new deletion cleanup, then apply migration 005. Retain every client pilot/queue flag disabled. No EAS build is required. Follow the lifecycle deployment/rollback guide and authenticated acceptance gates. Next: a separately gated atomic local outbox and acknowledgement recovery for both IndexedDB and iPhone SQLite, with restart/uncertain-commit/account-switch/conflict tests before live writer cutover.
