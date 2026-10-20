# Captured-account manual delivery — Phase 3, increment 10

This continues merged PR #73. It connects the existing coordinator to explicit web/iPhone connection actions without activating live account scoring, guest adoption or automatic replay.

## Activation boundary

| Client | New flag | Required flags |
| --- | --- | --- |
| Web | `NEXT_PUBLIC_GAME_DELIVERY_PILOT=true` | `NEXT_PUBLIC_CONFIRMED_CACHE_PILOT`, `NEXT_PUBLIC_GAME_SCREEN_PILOT`, `NEXT_PUBLIC_GAME_RECOVERY_PILOT` all `true` |
| iPhone | `EXPO_PUBLIC_GAME_DELIVERY_PILOT=true` | `EXPO_PUBLIC_CONFIRMED_CACHE_PILOT`, `EXPO_PUBLIC_GAME_SCREEN_PILOT`, `EXPO_PUBLIC_GAME_RECOVERY_PILOT` all `true` |

All settings default false/absent; only the exact string `true` enables them. No hosting/EAS/API/database settings are changed. Keep all client flags and `ScorekeeperGameOperationsEnabled` disabled in production. No API/schema deployment or paid Expo build is required to merge. End-to-end testing needs an operations-capable API advertising the v1 atomic game/receipt contract, a verified original account, and an existing SQLite-capable native binary. Enabling those environments is a separate action.

## User actions and status

Only explicit Reconnect/Sync now, Account sync and iPhone pull-to-refresh request manual delivery. Startup, foreground and ordinary automatic refreshes remain read-only. A manual request waits for a running read-only refresh and coalesces overlapping gestures into one intent. If the account changes while waiting, the intent is discarded. A later explicit pass can continue after a pass/time/operation budget is exhausted.

The existing account-sync popover/drawer shows progress, queued changes confirmed, changes still waiting, or saved changes needing review. Connection success is not itself evidence that pending scores were acknowledged. The app remains usable with local/device games throughout; opening the status panel does not disable the screen. Technical diagnostics allow only bounded known codes/stages and no credentials, game IDs, names or operation payloads. The queue status is the most recent manual pass result, not a live cross-device subscription.

## Account and request safety

Fresh `/account` verification establishes the pilot lease before creating a pass. The short pilot lock only acquires a worker; network work runs outside the lock so reads, sign-out and deletion are not queued behind HTTP. Repeated calls for the same captured scope/base share one promise. Caller cancellation, selector/scope changes, prepare/reverification, sign-out, deletion and closure cancel owned workers; stale cleanup cannot close a newer worker.

The web callback passes the captured MSAL account object to silent acquisition and checks its auth selector before and after acquisition. Native checks the captured identity revision and verified profile around acquisition. The transport pins that token for the pass and verifies its profile before any operation. A 401/profile mismatch pauses delivery; it cannot switch credentials or fall back to legacy writes mid-pass. Only existing immutable queue envelopes are POSTed. New games still save on this device and existing account scoring remains view-only.

A default application pass uses at most two attempts per transient failure, 30 seconds per stage, 60 seconds per pass and 25 operations. The existing overall connection watchdog and request budgets remain active. Account status, capability and snapshot requests are safe reads; uncertain operations retry their exact original bytes. Receipts commit before dependent work, and authoritative snapshots reconcile through the queue. A valid post-commit receipt remains valuable even if a collision appears during the request.

## Same-version collision boundary

A validated same-version contradiction is durably retained even when discovered through the direct coordinator snapshot path. Its account/game-scoped marker blocks new queue writes, seeding, delivery preparation, send attempts/retries, compaction and new recovery choices. Queue transactions guard absence of that marker as well as lifecycle revision. Another handle inserting a marker after validation rolls back the queue transition. Received receipts are still retained; this does not select a version or clear evidence.

There is an unavoidable boundary once an HTTP request has left the device: a new collision cannot recall it. Its original operation ID remains uncertain until an authenticated receipt arrives, and any received receipt is retained while further delivery/compaction pauses. Nothing is reissued under a new identity. Known per-game review failures do not starve independent games; storage corruption, identity/protocol and transaction failures stop the pass.

Known pending/confirmed deletions are checked after verification and before selected-game GETs so a successful queued delete does not cause an avoidable stale-game 404 or resurrection. Selected views and matching account rows suppress those results while local copies remain intact. A missing cache row is not treated as confirmed deletion. Full home/recovery overlays and hidden-game recovery navigation remain follow-up work.

## Validation and remaining gates

`node scripts/test-manual-delivery.mjs` uses real IndexedDB/desktop SQLite repository logic and intercepted HTTP with no production requests. It checks disabled inactivity, pinned profile/token, exact retry bytes, coalescing, queued manual intents, cached reads/sign-out during a hanging token request, abort-ignoring late results, receipt recovery without duplicate effects, profile/capability/cold-restore gates, collision CAS rollback, independent-game progress and in-flight receipt preservation. The actual web/native connection functions are also exercised with automatic/manual intents and tombstone GET suppression. Existing delivery, queue, reconciliation, recovery, read-model, lifecycle, pilot, connection and account-refresh suites remain required.

Browser/physical-iPhone rendering, VoiceOver/focus, real authentication/provider behavior, large retained histories/memory and privacy/erasure/retention acceptance remain open. Next add queue-aware home/recovery summaries, explicit collision-resolution/archive policy and controlled scoring-writer/adoption integration, then finish those gates before any production rollout. No flag is permission to discard originals, clear queues or rebase uncertain changes.
