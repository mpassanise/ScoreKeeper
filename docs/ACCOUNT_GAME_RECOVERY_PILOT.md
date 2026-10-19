# Explicit account-game recovery — Phase 3, increment 9

Status: inactive client-only continuation of merged PR #72. Web and iPhone share the same recovery model, permissions and decision boundary.

## Flags

| Client | New setting | Required existing settings |
| --- | --- | --- |
| Web | `NEXT_PUBLIC_GAME_RECOVERY_PILOT=true` | `NEXT_PUBLIC_CONFIRMED_CACHE_PILOT=true` and `NEXT_PUBLIC_GAME_SCREEN_PILOT=true` |
| iPhone | `EXPO_PUBLIC_GAME_RECOVERY_PILOT=true` | `EXPO_PUBLIC_CONFIRMED_CACHE_PILOT=true` and `EXPO_PUBLIC_GAME_SCREEN_PILOT=true` |

Only the exact string `true` enables a setting. Keep all settings and `ScorekeeperGameOperationsEnabled` disabled in production. No hosting, EAS, API or database migration settings are changed. Merge requires no API/schema deployment or paid Expo build. Physical native testing still requires an existing SQLite-capable development binary.

## Review experience

The saved-game panel offers **Review saved copies**, alongside the existing connection controls. The web dialog and iPhone safe-area drawer use existing theme tokens and button styles. Each copy shows its game/rules, player totals, version, score-entry count and completion state. History expands on demand in 20-entry increments. Older recovery copies appear five at a time. Cold-start read-only restore permits inspection without a network request or write grant; users reconnect and reopen the review before making a decision.

Copies are explicitly saved evidence, not a claim of current server connectivity. Same-version collisions show both retained account responses. Unknown request outcomes explain why reconnect must come before choosing. Account deletions and receipt/content disagreement without a resolvable terminal rejection stay review-only. Navigation to hidden/deleted-game recovery remains a follow-up; this increment places the review on selected live account views.

## Explicit choice and preservation

Only a terminal rejected operation with a valid complete account candidate at/above the existing receipt/base version floor is eligible. The interface requires **Use account copy…**, followed by **Confirm account copy**. It explains that previous device scores and dependent queued changes are retained for recovery and are neither combined nor uploaded.

The pilot issues a private ticket bound to the exact returned review object, captured account scope, verified durable lease, game, queue revision and immutable decision ID. A rendered DTO, a cloned review or caller-edited game/revision cannot authorize a different choice. Fresh account verification is required for the decision. Reverification/account switching invalidates prior tickets; reload the review instead of carrying a choice across sessions.

One queue-document CAS atomically retains the exact original base/projection/entry reservations, immutable request wires, receipts and dependants in the existing `account-selected` archive before installing the reviewed account snapshot. It guards the durable lifecycle revision and absence of same-version collision evidence. A collision arriving during confirmation rolls back the entire choice. Any intervening queue revision rejects the preview. Quota/capacity/corruption/transaction failures remain errors and preserve existing copies.

A retry uses the same private decision ID. A commit whose response was lost is recognized from its archive and is not applied or archived again. Reopening after the commit displays the selected view plus the retained device copy; the original queue wires are never changed into a new retry. No new game is created, no server request is made, and no legacy source is reclassified or removed by a recovery decision.

## Validation and remaining gates

`node scripts/test-game-recovery.mjs` runs against fake IndexedDB and file-backed desktop SQLite with real repository logic. It covers preview without writes, retained projection/base/reservation/receipt/dependant preservation, archive inspection after restart, stale/forged previews, failed and ambiguous commits, repeat choice, collision and lifecycle transaction races, uncertain outcomes, cold restore permissions, disabled inactivity and account isolation. Existing queue/reconciliation/delivery/read/pilot tests and web/native typechecks remain required. CI also builds web and exports iOS; these do not certify physical iPhone or browser accessibility/visual behavior.

Manual acceptance remains open: keyboard/focus restoration and screen-reader reading order in web; VoiceOver, safe area, text scaling and long names on iPhone; both themes; offline cold preview followed by reconnect; account switching/sign-out/deletion during review/confirmation; large histories and many retained copies. No live request delivery or scoring writer is activated.

Next integrate same-version review with writer/delivery gates and the captured-account manual coordinator, then home/recovery summaries, explicit collision-resolution/archive policy and remaining local privacy/erasure/retention/adoption/performance acceptance before any production activation.
