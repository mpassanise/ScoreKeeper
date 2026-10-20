# Local-first account scoring writer pilot

This increment follows merged PR #76. It enables **score entry, No Points and player selection only**, on web and iPhone, for already-tracked account games. It does not activate production rollout.

## Admission and permissions

A new scoring intent requires the active opaque pilot scope and a currently valid durable account lease. This process must have verified the account and an operations capability advertising retained receipts, atomic game/receipt commits and both score/select actions. That permission is held in memory, not inferred from a cached DTO or persisted token. A network failure alone does not revoke an already verified offline writer; sign-out, deletion, profile mismatch, stale durable revisions or re-verification revoke the old lease/grant.

Cold restored leases remain read-only until a successful verification in the current process. This is an intentional bound of this increment, not a promise of offline writes immediately after a cold offline launch. New device games remain playable independently. Server capability removal leaves account scoring unavailable even when the client flag is enabled.

The game must already exist in the validated account queue, have a live unfinished projection, no collision/content mismatch/deletion barrier, and only unsent queued operations. More offline scores may be appended to those queued operations. Uncertain saves, applied receipts awaiting reconciliation and terminal rejections pause new admissions. A known original immutable request can still be recognized without resubmission. Generic confirmed-cache snapshots are never implicitly seeded, imported or adopted by this writer.

The rendered `canScore`/access explanation is presentation only. The service checks the verified grant and the outbox validates current state/version and lifecycle/collision/queue transaction guards again before committing. Stale UI, another tab, delivery preparation and account changes cannot bypass those checks. The normal outbox capacity and reserved receipt budget still apply.

## Local save and retry behavior

Each gesture captures its target player, expected version, immutable operation ID and (for a score) entry ID once. The projection, queued wire and reserved entry identity commit together before the shell shows updated scores. Input clears only after a confirmed local admission and only when the captured input still matches the selected game. Local admission makes no HTTP/token request and never falls back to the legacy API writer.

No Points is a score operation: zero in additive mode, the existing player's total in total mode. Both play styles use explicit player identity on the wire. Existing scoring validation and automatic target/round endings apply; terminal projections return to view-only. Manual finish/resume, undo, entry correction, rules, account deletion/import and first-time queue preparation are not added here. Their existing account-screen restrictions remain in place; guest/device-only behavior stays unchanged.

A failed local acknowledgement is not proof of rollback. The service looks for the exact request in the validated queue/archive. If it is retained, it returns the current authoritative read instead of generating another operation. If a successful read proves it absent, the input stays and the failed intent can be corrected. If storage cannot establish either outcome, the shared UI writer retains the original request and input in memory, hides new score admission and exposes **Retry save**. Edited input cannot silently replace that intent. Identical in-flight gestures coalesce; a second intentional score after local confirmation gets fresh IDs.

Retry is explicit and reuses original bytes/IDs. The pending intent survives a pilot reconnect generation for the same selector/game, is pinned to its original verified profile and cannot be applied to a different profile. An account switch cannot adopt a late result. After process restart, durable operations remain authoritative; existing version-bound draft restoration must not restore already-consumed input over a newer game. The pending UI intent itself is not a new durable journal, and device/restart draft acceptance remains an activation gate.

New admissions and retry results update minimal home summaries, not copies of score history. Pending/confirmed deletions suppress stale selected/home rows. Failed admissions that encounter changed state pause score entry while keeping the input and last view, or suppress it when durable deletion proof requires that. Scope-revocation errors remain account/lifecycle errors rather than being hidden as ordinary save uncertainty.

## Delivery and rollout

Only the existing explicit manual delivery controls send queued operations: Reconnect/Sync now, Account sync and native pull-to-refresh. Startup/foreground reads remain non-mutating. Delivery pins one freshly verified account/token and retries original wires; receipt acknowledgement is distinct from full authoritative snapshot confirmation. No background scoring replay or legacy write fallback is introduced.

- Web: `NEXT_PUBLIC_GAME_SCORING_PILOT=true`.
- iPhone: `EXPO_PUBLIC_GAME_SCORING_PILOT=true`.

Both default false/absent and additionally require the existing effective cache, screen, recovery and manual-delivery pilot flags. The collision-resolution flag remains separate. Keep every production backend/client pilot disabled. No API/schema deployment, migration or paid Expo build is needed to merge. Controlled end-to-end testing additionally requires a compatible operations-capable API advertising the capability and the existing SQLite-capable native binary; neither is enabled/deployed here.

## Validation and remaining gates

`node scripts/test-scoring-writer.mjs` uses production IndexedDB and desktop SQLite logic. It covers queued local scores/selection, No Points in both modes/styles, totals/limits/automatic endings, untracked denial, capability/cold restore, uncertainty/applied/rejected/collision/deletion barriers, original wires, rollback, lost local acknowledgements, unreadable confirmation, exact retry across reconnect, in-flight coalescing, profile binding, restart and revocation at the transaction boundary. A real captured-token HTTP adapter with intercepted test responses loses the first server reply and proves one server effect, identical retry bytes, retained receipt and authoritative snapshot reconciliation. No production requests are made.

Actual web/iPhone action, No Points and save-adoption functions are executed for routing, input matching, late account/activity/game results and deletion suppression. The new suite is in CI beside existing lifecycle, queue, recovery, delivery, home, API and client checks. Passing automated tests does not establish browser/physical-iPhone layout, focus/VoiceOver, actual auth, cold-launch draft behavior or large-history/memory performance. The write path still validates bounded queue/history data; sustained physical-device write latency remains unverified.

Next: explicit preparation of existing cached account games for queue-backed scoring, then remaining targeted queued actions and source adoption/import. Durable offline-write permission across cold starts, unresolved collisions/deletion proofs, privacy/erasure/retention and physical-device/browser/performance acceptance remain separate activation gates. Do not enable rollout flags based only on this increment.
