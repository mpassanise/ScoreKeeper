# Captured-account delivery and reconnect — Phase 3, increment 6

Status: inactive shared coordinator/HTTP adapter for web and iPhone, built on PR #69 reconciliation. No application call site, live scoring writer, automatic timer or public UI changes. The worker defaults to disabled; calling connect while disabled performs no queue, token or network work. All backend/client rollout flags remain off.

## Entry points and identity

The durable repository exposes `delivery(lease, transport, options)` and `httpDelivery(lease, baseUrl, getToken, options)`. The HTTP factory passes the captured selector/profile to the token provider, which must acquire credentials for that account rather than the current global selection. Each explicitly invoked connection pass obtains one token and verifies `/account` using it before sending any operation. All requests in that pass use that same token. A 401/403 pauses for sign-in; it never silently swaps credentials mid-queue. Tokens, email addresses and payloads are not persisted or published in status.

Overlapping connect calls on one worker share one pass. Cancel stops the pass; close permanently stops the worker. Verification start/re-verification, sign-out, deletion, connection invalidation and repository close synchronously close attached workers. Every stage checks its durable lease before/after work. A periodic guard detects independent-handle revocation during requests. Aborting cannot unsend an in-flight request, but late results cannot advance another account's state; the original uncertain request remains available for recovery. Different handles may replay the same request; SQL receipts and local CAS prevent duplicate effects, without cross-tab leader election.

## Delivery and retry behavior

`ScorekeeperApi.operation(wire)` sends the exact admitted JSON string to `/game-operations`, using existing authentication/abort/error handling and no internal write retries. The transport uses single-attempt reads, leaving retry policy to the coordinator. Existing legacy API methods keep their behavior; the coordinator never falls back to their write routes.

Before a POST, queue preparation commits uncertain state. Timeouts and lost responses retry the identical request/operation ID. A terminal receipt is committed before dependent work proceeds. Invalid acknowledgements, identity/capability/protocol errors, operation-ID reuse and storage/CAS failures pause delivery without inventing receipts or rebasing work. A lost response from a successful local receipt commit is recovered by reading the queue again; the next pass refreshes without posting that acknowledged operation again.

Default limits: three attempts per transient network stage, linear backoff with jitter around 500/1,000 ms (capped at five seconds), a 65-second stage budget, a two-minute total pass deadline and 50 operations per pass. Configurable values are clamped. The total deadline also bounds an abort-ignoring token provider. Budget/deadline exhaustion preserves pending data and requires another explicit connect; no endless background loop is installed. Network errors and HTTP 408/429/500/502/503/504 may retry, except OPERATIONS_UNAVAILABLE. Missing capability, token/identity errors and terminal rejected receipts do not spin.

Account deletion reported by the service stops delivery, revokes local write grants and attempts the durable deletion barrier. If persistence cannot be confirmed, account-blocked status reports ACCOUNT_BLOCK_NOT_PERSISTED for host recovery. No account data is erased by this coordinator.

## Reconciliation and scoped status

After draining acknowledged changes for a game, fetch its complete view and pass a captured-profile snapshot to reconciliation. A partial budget drain can refresh evidence without replacing pending projections. If refresh fails after save acknowledgement, only refresh is needed on the next pass. An applied delete settles from its receipt without reading a deleted game. Rejections preserve/block dependants and refresh review evidence unless GAME_DELETED already supplies proof. A generic 404 never creates a tombstone: preserve the state, report snapshot unavailability and continue independent games.

Worker status contains only phase, stage, attempt, pending count and sanitized code. Phases cover disabled/connecting/syncing/retrying/pending/synced/needs-review/unavailable/sign-in-required/account-blocked/cancelled. Callback failures cannot invalidate saves. Future UI must detach old worker subscriptions when switching accounts. The existing web/iPhone connection status UI is unchanged.

## Evidence and rollout

`node scripts/test-game-delivery.mjs` runs the production coordinator on fake IndexedDB and real desktop SQLite. Tests cover disabled inactivity, coalescing, immutable retries after response loss, post-ack refresh recovery, rejected dependants, capability/token/profile gates, timeouts/late results, same/independent-handle cancellation, 404 preservation, deletion receipts/blocking, operation/pass budgets and lost local receipt responses. Mock HTTP checks pin the captured token/profile, preserve raw bytes and verify no internal write retry. No production requests are made. Existing queue/reconciliation/lifecycle/API and real SQL/web/mobile checks remain required. This is not authenticated production or physical-iPhone acceptance.

If PR #69 is still open, this increment is stacked on its exact head; merge reconciliation first. No API/schema deployment or paid Expo build is needed. Keep ScorekeeperGameOperationsEnabled=false and all client pilot/write flags off. Merge does not activate the worker.

Next: application integration behind disabled web/iPhone flags, queue-aware reads, compact reconnect/status UX and explicit conflict/recovery UI. Complete authenticated HTTP, retained-session privacy, archive/local-erasure/performance and real-browser/physical-iPhone gates before writer cutover. Retained sessions still restore read-only until fresh verification. A native pilot needs a SQLite-capable binary, but do not spend an EAS build before the pilot is ready.
