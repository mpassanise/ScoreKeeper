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


## Read performance follow-up

Entry-ID reservation validation now builds a set once per game instead of repeatedly searching a growing array. The account read path keeps one bounded validated read-model cache per open repository, keyed by profile, durable lifecycle guard, outbox revision and exact serialized document content. Every read still reads durable storage and rechecks account authorization. Same-revision content changes force full revalidation, so corruption cannot be concealed by a revision-only cache. Missing documents, authorization/validation failures and lifecycle invalidation evict cached models. Sign-out, verification changes, deletion and close clear the applicable cache.

Cache entries retain only one document's serialized bytes and detached per-game read models, not a second mutable outbox/archive graph. Results are copied before returning. Mutable queue reads and every write continue full independent validation and guarded CAS; cached models cannot authorize writes, manufacture receipts or bypass settlement. A different handle's revision update invalidates the cached validation on the next storage read. No database/schema or rollout changes are needed.

The unavoidable document read/serialization remains linear in profile history. This is a bounded optimization of the current single-document design, not indexed per-game persistence. Browser/physical-iPhone performance and memory acceptance remain open before activation. Future indexing should remove whole-document I/O without weakening account guards or atomic queue/projection transitions.

`node scripts/benchmark-game-reads.mjs` creates a valid 7.7 MB profile containing 9,000 retained operations in 18 compaction batches and reports cold/warm tracked reads plus an untracked read on fake IndexedDB and desktop SQLite. It performs no network requests and asserts no machine-dependent timing thresholds. Regression tests instead verify unchanged histories are not replay-validated, changed revisions are revalidated (including independent handles), returned models stay detached, and same-revision corrupt content fails closed.

For the original fake-IndexedDB fixture on this development host, baseline tracked reads took 407–477 ms and an untracked read 792 ms. A follow-up run after optimization took 270 ms cold, 82–91 ms warm and 161 ms untracked. These measurements are illustrative desktop observations, not an iPhone guarantee; use the committed benchmark for reproducible current measurements.
