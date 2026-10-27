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
