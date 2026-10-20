# Automatic foreground sync acceptance

Status: pending real-device acceptance; all rollout flags stay disabled.
Baseline: PR #86 plus native connectivity recovery. Automated tests are evidence for code behavior, not a substitute for this matrix.

## Preconditions

- Use a test account and isolated browser profiles/devices with recoverable game data. Record client commit/binary version, API version/capabilities and effective pilot flags for every run.
- A new iPhone development/TestFlight binary must include `expo-network ~57.0.2` and existing SQLite dependencies. An iOS JavaScript export does not verify native linking. Do not send this code as a JS-only update to an older binary missing the module. No paid build is authorized by this checklist.
- Apply rollout flags only in an explicitly authorized test environment. Keep production disabled. Automatic sync requires the existing repository/screen/recovery/delivery/scoring/cold-write pilot chain; imports have their own review/admission flags and fresh import capability.
- Preserve the initial game IDs, player/entry IDs, complete history and operation IDs/receipts before failure injection. Compare the retained device projection and server history afterwards, including when a request outcome is unknown. Never clear storage to make a failed run pass.

## Matrix to execute on web and iPhone

| Scenario | Expected behavior | Evidence/status |
|---|---|---|
| Cold launch online and authenticated | Cached game immediately usable; automatic sync eventually confirms saved changes without blocking scoring | Pending |
| Cold launch offline after prior verified grant | Previously tracked game editable locally with original IDs; no auth/network wait in score save | Pending |
| Online recovery while continuously foregrounded | iPhone network event/browser online event resumes automatically; no manual tap needed; an exhausted budget may wait the remaining one-minute cooldown | Pending |
| Airplane mode during in-flight score, then restore | Owned automatic request cancels; original unknown-outcome request replays; score appears exactly once; dependent local scores retained | Pending |
| Background/foreground during sync and cooldown | No automatic work while inactive; foreground resumes bounded work; no duplicate worker or late UI overwrite | Pending |
| Repeated network flapping/captive portal/API outage | No unbounded loop; one flight, minimum gap and bounded retry budget; API/auth errors remain authoritative; local scoring stays usable | Pending |
| Typed score/rule/edit draft while another device syncs | Draft remains; observed deletion closes stale editors and suppresses game; rejected predecessors pause dependants with complete recovery copies | Pending |
| Auth expiry and manual Reconnect | No network-event bypass of sign-in/capability blocks; explicit reconnect available; successful reconnect permits later automatic work | Pending |
| Account switch/sign-out/deletion during held request | Old completion/events cannot publish into another account or send new work; durable local lifecycle guards revoke old writes | Pending |
| Two devices and two browser tabs score concurrently | Original request bytes/IDs preserved; conflicts retained for review, never silently rebased or duplicated; no lost local history | Pending |
| Old/new client, adopted device original and queued deletion | Old client behavior recorded; account authority and tombstones suppress duplicate playable originals; unresolved policy blocks activation | Pending |
| Restart after uncertain local/remote acknowledgement | Recovered queue and exact receipt retry yield one effect; full before-delete and recovery history survive | Pending |
| Quota/storage failure, privacy/erasure and rollback | Honest save error, no eviction/false sync; retention/erasure policy approved; rollback does not reactivate legacy writers over pending work | Pending |

Record timestamps, visible sync state, sanitized diagnostic stage/code and durations. Never record tokens or raw account/game payloads in production telemetry. Capture server effect counts and stable IDs in controlled test evidence. Save each result here with environment, expected/actual result and follow-up issue; leave unexecuted rows pending.

## Exit and rollout

All rows need recorded results and resolved blocking defects/policies before activation. First authorize an isolated browser/device pilot; then stage web and TestFlight cohorts with explicit stop criteria for lost/duplicate history, account leakage, unexpected deletion, save failures or sustained latency. Disabling new scheduling must preserve queued data and account-copy authority; do not fall back to legacy mutation writers. Reconcile/drain or retain local use with sync paused. API/schema readiness must be checked against actual deployed capabilities, not inferred from merges. OS background execution and scale work remain separate.
