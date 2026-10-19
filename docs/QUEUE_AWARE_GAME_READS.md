# Queue-aware account reads — Phase 3, increment 7

Status: shared account read boundary and gated observation routing for web IndexedDB and iPhone SQLite. PR #70 is merged. All rollout flags remain disabled. No live scoring writer, automatic delivery, cached projection rendering, account adoption or new public UI is enabled.

## One read boundary

`durableRepository.readGame(lease, gameId)` checks the durable account binding before and after asynchronous work. Its result is detached from persisted documents. Tracked game state always takes precedence over the generic confirmed cache, even if the cache contains an older live game. After awaiting an untracked cache read, check the queue again so a concurrently admitted operation takes precedence.

| Result | Meaning |
| --- | --- |
| `kind: missing` | No tracked state or generic complete confirmed snapshot exists for this captured profile/game. No remote deletion is inferred. |
| `kind: game`, `sync: confirmed` | Complete authoritative cache or reconciled queue base, with no unsettled operations/candidate. This describes provenance, not current connectivity or freshness. |
| `kind: game`, `sync: pending` | Preserved queue projection, uncertain/applied-but-unreconciled work, or a retained candidate awaiting settlement. |
| `kind: game`, `sync: needs-review` | Rejected operation or known receipt/content mismatch. Preserve the device projection and authoritative evidence. |
| `kind: pending-delete` | A local deletion has no live projection, but is not settled. Suppress the generic live cache; do not claim server-confirmed deletion. |
| `kind: deleted` | Settled receipt-backed local tombstone. Never resurrect it from the generic cache or a late GET. |

Game results include source (`queue` or `cache`), the last confirmed base version and the number of active unsettled operations. That count includes applied receipts awaiting reconciliation. The optimistic projection version is not a confirmed server version. Raw game data belongs only in the captured account's game UI, never connection telemetry.

Reads never write, settle a candidate, acknowledge a request, prepare delivery, seed a queue, erase data or migrate/adopt guest sources. Corrupt/unknown queue documents fail closed without falling back to a seemingly usable older cache. Pending and reviewed work remain available after restart under an authorized retained lease; restored leases still cannot enqueue or reconcile until freshly verified. Sign-out/deletion/stale revisions deny reads, while preserving physical data for the existing recovery/erasure policy.

## Authenticated observations

`observeGame(lease, completeView)` detaches and validates input before awaiting work and requires fresh verification. Tracked games pass through `outbox.observeSnapshot`: pending projections remain intact, matching content cannot acknowledge uncertainty, exact-version mismatches retain review evidence, and settled deletions cannot be resurrected. The generic cache is not rewritten for tracked games. Untracked games retain the existing complete confirmed-cache save behavior; no automatic queue seeding occurs. If tracking begins while the cache save is in flight, the returned read still gives queue state precedence.

The existing shared `RepositoryPilot.record` now uses this observation boundary. Both application shells already call that shared method for authenticated full-game GETs. `RepositoryPilot.readGame` accepts an opaque captured read scope and exposes the same result to future rendering. Its identity checks bracket I/O; an independently revoked lease invalidates the current pilot without invalidating a newer selector. A disabled pilot opens no repository and performs no queue/cache work. Web/native pilot hooks and their flags remain unchanged.

This increment deliberately does not render these results in the existing scoring screens. Existing screens and legacy writers remain paired. Before rendering queued projections, integrate pending/review/deletion states and exclude legacy mutation/import/delete routes for tracked game IDs; otherwise a legacy write could bypass unsettled operation identities. Do not enable the cache pilot merely because this PR is merged.

## Evidence and next increment

`node scripts/test-game-read-model.mjs` exercises both production storage adapters with fake IndexedDB and real desktop SQLite. Cases cover detached cache/queue precedence, reads with no writes, uncertain matching snapshots, retained read-only restart, receipt/snapshot separation, repeated reconciliation without duplicates, pending/confirmed deletion suppression, content mismatches/rejections, corrupt queue denial, concurrent tracking during cache I/O, and the shared application's captured-scope observation/read path. Existing queue, delivery, reconciliation, durable lifecycle and pilot regressions remain required. This is not real-browser, production-authentication or physical-iPhone acceptance.

No API/schema deployment or paid Expo build is required. Keep `ScorekeeperGameOperationsEnabled=false` and both client pilot flags false. Next integrate queue-aware rendering with reconnect/conflict recovery and legacy-write exclusion on both clients, then complete authenticated transport, browser/device, local erasure, archive retention and performance acceptance before writer cutover.
