# One device scores a game

## User experience

The device that starts an account game scores it. Other connected devices can view it and see:

**Scoring on another device**

This game is being scored on another device.

**Score here**

Confirm: **Score on this device?** / “The other device will stop scoring this game.”

Buttons: **Cancel**, **Score here**.

After confirmation this device scores normally. The previous connected device shows the same read-only prompt. No merging, copy comparisons, revision numbers or sync terminology appears in this flow. All devices use the same wording and behavior. Timer, viewing history and Home stay available.

## Agreed offline scope

Offline scoring remains supported. Mike explicitly deferred offline handoff behavior to a later iteration. An offline device cannot immediately learn that control moved. Do not claim immediate offline locking. Do not discard its saved operations or reinterpret them automatically. Handling those outstanding changes when reconnecting is a separate follow-up before calling the entire offline handoff experience complete.

## Safe rollout

1. **Server foundation (this iteration):** additive migration 006; account-scoped control separate from game snapshots; authenticated read/take-control endpoints; owner-serialized conditional handoffs; enforcement inside scoring transactions, including legacy mutation routes. No existing client sends device IDs or claims games, so existing behavior remains unchanged. Existing receipts can still be read after control moves, without repeating their effects. No game or operation fingerprint changes.
2. **Web and iPhone together:** persistent per-install device identity, creator ownership, shared controller state, Score here confirmation, read-only scoring state, foreground refresh and pre-write checks. Adapt ownership responses to simple device-control language rather than conflict/review UI. Roll out both clients after API/migration verification. Disable auto-claim on simple reads. Preserve unsubmitted drafts across handoff messages. Existing unclaimed games can be explicitly claimed.
3. **Offline handoff follow-up (deferred by Mike):** define and test outstanding offline scores when control changes; retain exact requests and recovery evidence. No automatic destructive merge or silent loss.

## Invariants

- API derives the account from authentication; body/header device IDs never select an account.
- Claim and score writes share the authenticated-owner SQL transaction lock.
- A new request from another device, including missing device identity on legacy writes, cannot mutate a claimed game.
- A previously committed request still returns its original receipt after takeover.
- Claim requests use a compare-and-swap epoch internally; stale and concurrent claims cannot silently steal control. Epochs are not game versions and never appear in user-facing copy.
- Ownership is separate from scoring snapshots, preventing false same-version content conflicts.
- Missing, deleted and foreign-account games cannot be created or resurrected by a claim.
- Account deletion removes device-control rows.

## Validation

Existing scoring/receipt suites remain required. Added SQL integration coverage exercises creator control, takeover, old-device denial without terminal rejected receipts, legacy-route denial, idempotent acknowledgement and takeover retries, concurrent takeovers, account isolation, missing-game safety and old-client compatibility. Apply migration twice to check repeatability. Real SQL acceptance is required through CI; do not infer it from compilation.

## Deployment order

Merge this foundation, apply migration 006 and deploy API. This alone does not change the interface. Then deliver the paired web/iPhone iteration and verify two-device takeover online. Do not turn on any client claims before both device paths are ready. No existing game data needs rewriting or re-importing.

## Paired client implementation (next iteration)

Web and iPhone now use a durable installation UUID as a request header, including the freshly constructed replay transport clients. No game, operation envelope, entry ID or receipt fingerprint changes. Browser creation uses the Web Locks API where available so tabs share an installation identity. Account/game-scoped remembered permissions preserve offline scoring and read-only state across reopening.

Both game screens show the same compact **Scoring on another device → Score here** flow. Taking control requires confirmation, an account/game-fenced request and a fresh repository-backed game read before enabling entry. Legacy unclaimed games use the same explicit button. History, timer and navigation remain available. Pending local work blocks a handoff instead of replaying old offline scores after a takeover; the requests remain untouched for the deferred offline-handoff iteration. Unsubmitted points for a different selected player are held separately in memory and restored only to their original account/game/player; they are not applied to the new player.

Scoring-control refusals park the exact original request without a terminal rejection receipt, while unrelated games continue delivery. The normal read-only prompt replaces the generic recovery notice for this case. Existing queues, retry handling, duplicate prevention, conflict evidence, archives, recovery views and advanced reconciliation remain implemented. No reconciliation logic has been removed. Existing unsupported/undeployed APIs retain their prior behavior through capability detection.

Permissions refresh in the foreground and every 30 seconds while a game is open. Server authorization is authoritative on every delivered mutation. A previously connected device can briefly retain its entry UI before learning about a handoff; an offline device cannot learn about it until it reconnects. This iteration does not promise instantaneous locking of offline devices or settle their outstanding scores. Other tabs in the same browser installation share one device identity.

Deployment remains: migration 006 + API first; merge this paired client change; publish web and update iPhone together. Existing old clients cannot score a game claimed by updated clients, so update both clients for takeover testing. No new migration or paid native build was run during implementation.

Validation: shared controller/transport and actual web/native handoff handler tests; both IndexedDB and SQLite delivery isolation; existing immutable retry, automatic sync, scoring writer, pinned scorer, timer and countdown suites; web/native TypeScript; web production build; iOS JavaScript export. Architect review covers lifecycle fencing, old read/takeover races, unknown outcomes, retained originals, deletion authority and platform parity. Authenticated two-device/browser and physical iPhone acceptance remain to be performed after deployment.

Final architect review fixes: preserve unsubmitted entries by player, reject handoff with either durable queued work or an ambiguous local writer intent, fence token acquisition and callbacks against account/game/activity changes, and persist an activation marker before sending the takeover request. Lost replies or failed fresh reads therefore remain read-only across restart until the same takeover is safely retried. Connected admissions check device control before enqueueing, with a bounded network budget and offline fallback; delivery still enforces control authoritatively. No unresolved review findings in this scoped connected-device flow. Offline concurrent handoff remains deferred.
