# Read-only account game screens — Phase 3, increment 8

Status: separately disabled web/iPhone screen pilot following merged PR #71. It exposes queue-aware saved views without activating a writer, replay scheduler, automatic adoption or conflict decision. Existing production behavior remains unchanged with flags absent/false.

## Activation boundary

| Setting | Default | Requirement |
| --- | --- | --- |
| `NEXT_PUBLIC_GAME_SCREEN_PILOT` | false | Also requires `NEXT_PUBLIC_CONFIRMED_CACHE_PILOT=true` |
| `EXPO_PUBLIC_GAME_SCREEN_PILOT` | false | Also requires `EXPO_PUBLIC_CONFIRMED_CACHE_PILOT=true` and an installed SQLite-capable native binary |

Only the exact string `true` enables either setting. No EAS or hosting configuration is changed. Keep both new settings, existing client pilots and `ScorekeeperGameOperationsEnabled` disabled in production. No API/schema deployment or paid Expo build is required for merge. Physical testing needs a development binary with SQLite before any native flag is enabled; an OTA update cannot install a missing native module.

## Opening and refreshing a game

Both clients use the same `openGameScreen` and `observeGameScreen` boundary. A retained account game opens from its queue/cache result without a game GET. `RepositoryPilot.readGame` may restore an existing durable active lease for this purpose, without fresh verification, metadata mutation or write grants. Missing/unverified bindings fail closed. A cache miss can fetch a complete game only through the caller's captured request; observing it still requires fresh API account verification. A cold-start cache miss may therefore require Reconnect first. Returned game IDs must match the requested ID.

Manual/background refreshes and conflict-refresh reads resolve through the queue-aware model rather than displaying a raw GET over pending changes. Receipt/content mismatch preserves the device projection and shows a review state. Pending and confirmed deletion results suppress the selected game rather than falling back to a stale live cache. Storage/authentication/lifecycle failures cannot silently substitute a raw remote game. Account/selection/activity checks still guard asynchronous screen adoption, including native recovery drafts. The existing summary cache is not yet a full queue-aware home-list index: selected deletion rows are suppressed, but complete home-list overlay remains an acceptance/follow-up requirement.

The themed saved-game status is visible on web and iPhone. It distinguishes view-only saved copies, pending account confirmation and review-required changes, and offers Reconnect plus access to a new device game. No connectivity guarantee is inferred from a saved snapshot. Account refresh success copy avoids claiming all pending scores have synced. Reconnect refreshes account evidence in this increment; it does not send uncertain operations or choose a conflict outcome.

## Excluding unsafe writes

When the screen pilot is enabled, **all account game writes are disabled**, including fresh/untracked games. This avoids a tracking-versus-legacy-write race before a unified writer exists. `ScorekeeperApi` enforces `readOnlyGames` before token/capability acquisition for create, action, edit/rules, delete and import, with a defensive POST-route guard including replay operations. The separate inactive replay transport remains unchanged because it constructs its own client; neither app activates it here. Account reads, frequent-player sync and explicit account deletion retain their existing behavior and lifecycle barriers.

Scoring/edit/finish/resume/history controls are hidden or disabled on account views. Web delete and native swipe/long-press/accessibility delete affordances are removed for account rows. Stale callbacks are still rejected by the transport policy. Account imports are blocked before source reconciliation can reclassify or remove local copies, and automatic pending-import scans are skipped. New games bypass cloud creation and persist the device-only marker in the initial game write so scoring routes to LocalGames while signed in. Existing device-only and guest games keep their current scoring/edit/delete behavior. No original local source is migrated, adopted or erased.

## Validation and remaining gates

The shared IndexedDB/desktop-SQLite regression suite covers retained opens without GETs, missing-cache GETs, wrong-game responses, mismatches that retain the projection, confirmed deletion suppression, cold-start read-only restore, stale scopes and absence of write grants. Existing cache corruption, revision invalidation, account races and pending projection tests remain required. API tests reject every game write before token or capability work while permitting reads/player sync. Both application typechecks, web build and local iOS export remain required; export is not a paid EAS build.

Manual browser/physical-iPhone acceptance remains open: test offline cold start, opening during first-connect verification, sign-out/account-switch/deletion during reads, response loss, dark/light text and controls, VoiceOver deletion actions, recovery drafts, and a large retained history. Summary overlay, explicit conflict/recovery choices (including access to retained recovery copies), captured-token manual delivery integration, adoption/privacy/erasure/retention and performance gates must be completed before writer cutover. Do not enable a production pilot simply because CI passes.

Next: explicit conflict/recovery UI and a captured-account manual delivery bridge, followed by queue-aware home summaries and controlled writer/adoption integration. Never rebase uncertain requests or discard original local data to recover connectivity.

## PR #72 architecture review corrections

Device-only creation uses one local write on web and iPhone, including the existing account-unavailable fallback. A rejected write cannot leave an unmarked hidden game; there is no separate classification write to fail. Guest creation retains its previous classification.

The shared durable account observation boundary retains a validated pair of contradictory same-version account snapshots under an account/game-scoped metadata key. A lifecycle-guarded CAS preserves the first pair and leaves both the generic cache and queued projection untouched. Account game reads overlay `needs-review` from this evidence across screen reopen, process restart and read-only restore. Matching or newer GETs cannot silently resolve it; explicit recovery is a later increment. Corrupt evidence fails closed; capacity/quota/transaction failures surface as errors instead of claiming successful review persistence. Each pair is capped at 8 MiB. No schema migration is required.

This evidence currently protects the read-only screen/observation boundary. Before enabling any queued writer or delivery worker, integrate collision review with its write/delivery gates and explicit resolution/archive policy; neither worker nor writer is activated here. Existing queue receipt/content review remains unchanged. Regression checks cover cached and tracked collisions, preserved source bytes, reopen/restart, newer refreshes, account isolation, corrupted evidence, failed commits and lifecycle revocation on IndexedDB and desktop SQLite. Physical iPhone/browser acceptance remains open.

Recovery continuation: [explicit saved-copy recovery pilot](ACCOUNT_GAME_RECOVERY_PILOT.md) adds a separately disabled inspection/confirmation boundary on both clients. The screen pilot alone still grants no recovery-decision capability.


Continuation: [captured-account manual delivery pilot](MANUAL_GAME_DELIVERY_PILOT.md) adds a separate default-false application delivery flag. Ordinary account clients remain read-only; only explicit manual actions with every prerequisite pilot enabled can invoke the dedicated immutable-operation transport. Startup/foreground refreshes do not replay queues. Production settings remain disabled.
