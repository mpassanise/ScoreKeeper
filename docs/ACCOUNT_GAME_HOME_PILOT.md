# Queue-aware account home and saved-copy navigation

This client-only increment follows PR #74. It uses each client's existing effective cache + screen + recovery pilot flags; no new flag is needed. All production pilots remain false/absent. Manual delivery still requires its separate flag. No deployment, API migration, paid Expo build, new scoring writer or automatic source adoption is activated by merging.

## Home behavior on web and iPhone

The account home list is projected through one validated account queue snapshot before showing account tiles. Queued creations and scoring/rule/finish projections take precedence over server summaries. Pending deletions and confirmed tombstones stay outside In Progress and Completed Games, even when an old list includes them. Device-only games retain their separate writer and presentation. Pending and review-required tiles get one short status line; confirmation is stored provenance, not a claim of live connectivity.

A compact Saved copies disclosure links to review-required games, earlier explicitly archived device copies, and hidden pending/confirmed deletions. Opening review uses the existing scope-bound recovery reader; it does not restore, upload, merge, acknowledge or erase a game. Pending deletions show the retained pre-deletion base when available. Confirmed deletion shows deletion evidence and any available recovery copies, without promising a complete historical snapshot that storage does not contain. The existing two-step eligible account-copy choice remains unchanged. Unknown outcomes and same-version collisions cannot be chosen here.

Home summaries are retained in `game-home:<profileId>`, a versioned display-only AtomicDocuments record. Only minimal summary fields are stored; no history, requests, receipts, credentials or device-only rows are copied into it. Incoming lists merge by game ID and increasing version. Omission, an empty offline cache and a list error do not erase older rows or constitute deletion proof. Queue state remains authoritative for visibility and content; the index cannot authorize writes or manufacture complete snapshots. Existing confirmed caches remain unchanged.

The index is bounded at 1,000 rows / 1 MB. Capacity, corruption and CAS failures surface rather than pruning retained rows or falling back to a potentially resurrected raw account list. Account rows wait for a successful repository read; device games and New Game remain usable. Reconnect retries the read through the existing connection control. Indexed rows never observed in this pilot cannot be discovered from historical generic caches alone; no broad cache scan or historical-source adoption is implied.

## Isolation and performance

Cold restored durable leases can read summaries and update this display-only index; they still have no sync/write authority over games. Index writes use both index CAS and the current durable lifecycle revision in the same transaction. Account/profile changes, sign-out and deletion revoke access without dropping retained records. The pilot checks opaque scope ownership and the shell checks captured account plus source-list identity before displaying a result. Home review navigation also rejects late account/activity results.

Queue validation happens once per home projection, not once per tile. A final revision check rejects a queue update racing the read. Collision documents are validated in batches of at most 16 and only summaries leave the reader. The shell refreshes on source-list and connection status/completion changes, not every delivery progress event. This remains a refresh-based view, not a new cross-tab/live subscription contract. Explicit collision resolution, summary retention/erasure policy, physical-device memory/latency and broader live invalidation remain rollout gates.

## Validation and rollout

`node scripts/test-game-home.mjs` runs production repository logic against IndexedDB and desktop SQLite. It covers projected scores, omitted lists, pending/confirmed deletions, untracked collisions, retained archives, restart, detached minimal results, one queue read plus revision check, concurrent queue changes, corrupt-index preservation, account isolation and lifecycle-guarded index rollback. Actual web/iPhone review-navigation functions are executed for successful and late account/activity results. The suite is included in CI alongside existing recovery/manual delivery/queue tests, production web build, API/SQL checks and mobile typecheck/iOS export.

Browser/physical-iPhone layout, focus/VoiceOver, dark mode, real authenticated network and large-history/memory acceptance remain unverified. Do not enable rollout flags based on these automated tests alone. Next: explicit same-version collision-resolution/archive policy and its guarded implementation before controlled scoring-writer/source-adoption integration, then remaining privacy/retention/device/performance gates.
