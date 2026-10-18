# Phase 1, iteration 1: account connection recovery

Date: 2026-10-16. Status: iteration 1 published as web version 52; iteration 2 callback repair and diagnostics in review.
Tracker: [offline-first rollout](OFFLINE_FIRST_SYNC_PLAN.md).
Baseline: [data paths and contracts](SYNC_BASELINE_AND_CONTRACTS.md).

## Behavior

Web and iPhone show a compact connection row on Home and the scoring page. It distinguishes connecting, connected, unavailable and sign-in-required states; web also uses the browser's offline signal. Text includes the last confirmed connection time. Reconnect is visible when the connection needs attention and hidden after success.

Reconnect does not acquire the foreground scoring/navigation lock. A shared controller permits one logical attempt at a time, gives it 15 seconds, and invalidates/aborts its scoped reads on timeout, offline transition, sign-out or account replacement. A timeout produces a retry action rather than waiting through the legacy read backoff. The existing general API budgets/retries remain the defaults for other callers.

Only an authenticated refresh completing its required work marks the account connected. The row does not claim all games are synced, that live updates exist, or that account scores have been saved on the device.

The web now reads an account-specific summary cache before network refresh. Native continues to use its existing summary cache. Lists can display before frequent-player syncing finishes. Background results cannot replace the active scoring view while points are entered, a score/rules edit is open, tiles are being reordered, or foreground activity/view selection changed.

Explicit import remains separate. Reconnect may confirm existing identical imported copies and discover pending imports using the existing helper, but does not create/import games or replay scoring commands. All existing mutation POST requests still have one attempt.

## Authentication recovery

- Typed interaction-required/invalid-grant/401 failures show Sign in to sync. Generic timeouts do not automatically trigger an interactive prompt.
- Web uses the existing redirect sign-in flow. Before redirecting, it saves the setup draft, selected game ID, score input, turn/version and MSAL account mapping in sessionStorage. It restores only for that same account. If the game changed, it retains the unsent number and asks the user to review rather than attaching it to another player's turn. It never auto-submits the draft.
- iPhone interactive recovery preserves the existing route/form/input and checks the newly authenticated API profile against the original profile before replacing the session. If an old session has no established profile ID, interactive recovery stops with an explanation; it cannot safely infer the account owner. Local play remains available.
- Native SecureStore writes are serialized and guarded by identity revision. A token refresh begun before sign-out cannot restore the previous session afterward. Old refresh cleanup cannot clear a newer refresh's promise.

No refresh-token lifetime, identity provider, client ID or registered redirect URI is changed.

## Phase 1 iteration 2: root callback repair and diagnostics

The registered redirect URI stays at the existing root. The root page now detects an OAuth response in a hidden frame and mounts only the callback component. That component calls the installed SDK's broadcastResponseToMainFrame before CloudHome/MSAL initialization can consume or block the response. Top-level redirects still mount CloudHome and use the existing handleRedirectPromise flow. Ordinary embedded app views without an OAuth response are unaffected.

This supersedes the proposed dedicated callback route from iteration 1. No new URI or app-registration change is required for this root callback repair. The root response is configured Cache-Control: no-store and Referrer-Policy: no-referrer; production must continue to omit COOP. The SDK remains responsible for state validation, response delivery and URL cleanup. No auth response is decoded, logged or persisted by application callback code.

Reconnect tracks authentication, account settings, game list, active game, frequent players, import checks and device reads separately. A timeout records the pending step (prioritizing token acquisition when it is still pending). Failed steps produce a sanitized diagnostic containing only attempt reference, step, elapsed milliseconds, an allowlisted error code, numeric HTTP status, and an optional GUID request reference from the API.

Both clients expose expandable Connection details and emit the same diagnostic under the console prefix [Scorekeeper connection]. Raw errors/messages, stacks, tokens, callback URLs, names, emails, game IDs, scores and operation payloads are excluded. Success/reset removes stale details. A stale/cancelled attempt cannot emit another account's diagnostic.

Authentication timeouts remain classified as unavailable rather than proof that sign-in is required. They offer a separate, user-triggered Sign in again action. Typed interaction-required/invalid-grant/401 failures retain the primary Sign in to sync action. No automatic interactive redirect or new score retry is added.

Production evidence received on 2026-10-16: a browser trace shows silent authorization returning to the root with an OAuth response, followed by CloudHome/silent-iframe authorization running again. This supports the callback-loop diagnosis; the generic sandbox warning is not itself the failure. No authorization codes, state values or account identifiers from that trace are retained here. API/database availability still needs confirmation after token handoff succeeds.

Tests exercise the actual installed MSAL 5.24.0 bridge with synthetic hash/query responses, URL cleanup and invalid-state rejection; they also verify that top-level redirects and ordinary embedded views do not select the bridge. Connection tests cover step selection and privacy redaction. These checks do not prove real third-party-cookie behavior or that every production timeout shares this cause.

Reference: [Microsoft redirect bridge setup](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-browser/docs/redirect-bridge.md).

## Validation and release gates

Automated checks:

- New connection controller/API checks: single-flight, account-switch cancellation, offline/retry, typed auth errors, bounded timeout, fetch abortion, late-result suppression and cancellation while token acquisition is pending.
- Existing API, local-game, sync-safety, frequent-player-sync and summary-cache checks.
- Existing mobile button/drag checks and web/native TypeScript checks.
- Production web build and local Expo iOS export. A bundle export is not a physical-device or App Store build.

Before release, manually verify on a browser and physical iPhone:

1. Open after idle with a slow/unavailable API: cached list and local game navigation remain usable.
2. Enter a score without submitting; reconnect and switch screens; confirm input/view are not replaced.
3. Repeatedly tap Reconnect; verify one active scoped read attempt and an available retry after 15 seconds.
4. Restore network; confirm authenticated reads and frequent players work, with no new game/score posted.
5. Expire/revoke authentication; complete same-account reauthentication. Cancel it or choose a different account; original native session/input remain intact.
6. Web redirect: recover setup/score input; a changed turn/version requires review. Verify sessionStorage failure prevents redirect with an error instead of losing input.
7. Sign out during renewal; confirm the old session is not restored.
8. Check dark/light mode, VoiceOver and narrow screens.

Physical-device and browser interaction QA have not been performed in this environment. Existing controls still wait for foreground cloud scoring requests. Full offline account scoring requires phases 2–4. Automatic retry backoff/jitter and real-session acceptance remain future Phase 1 work; Phase 0 device/timing gates remain open.

## Reproduction details to collect

On the updated web release: refresh, open F12 Console, click Reconnect once, and copy the object prefixed [Scorekeeper connection] or expand Connection details. Include whether the website was opened directly or embedded in ChatGPT. If needed, report just failing API request route (for example /api/account), status and duration from Network. Do not send a HAR export, request Authorization headers, access/refresh tokens, or a callback URL containing code/state.

If the step is authentication, test the user-triggered Sign in again path. If it is games/account with HTTP 503, correlate the GUID request reference using the existing API diagnostics. Player-only failures should be investigated as player sync, even when the game list already loaded.

## Deployment and rollback

Review/merge the PR first. Web publication and an iPhone build/distribution are separate release steps. No API deployment or data migration is required. No native dependency is added and no Expo cloud build is consumed by this development iteration.

Rollback restores prior client code; existing storage formats and API requests are compatible. The new web summary cache/draft can be left unused safely. Never clear legacy game/player storage to roll back.

## iPhone recovery and header UX follow-up (October 16)

A device capture showed games / REQUEST_TIMEOUT / HTTP 408 at 30,003 ms, followed by a successful manual reconnect in about two seconds. This is consistent with an initially slow service but does not establish SQL resume or any other root cause. It is the API I/O budget, not the prior 15-second outer watchdog.

The native refresh API now allows two safe read attempts (one bounded retry after REQUEST_TIMEOUT or DATABASE_WAKING, with the existing one-second delay). Authentication/401 failures do not retry this way, and mutations retain their no-retry behavior. A first timeout stays in nonblocking connecting state while the read retries; a persistent error still exposes Reconnect. This can recover a transient first-load failure without a second tap; it does not remove the first request's latency or guarantee connection. The whole-refresh watchdog still applies. Do not extend retries indefinitely or label cached account games writable offline.

The iPhone sync control moves to a 44-point-wide header button beside the app menu. A small amber dot marks attention; a white native spinner shows work. Opening it displays the existing safe-area-aware Account sync drawer, themed status, last-connected time, Sync now/Reconnect/Sign in to sync, and technical details collapsed by default. The drawer remains dismissible during sync. Main scoring content no longer contains the large status/diagnostic block. No new native dependency is added.

Local verification: API regression tests exercise timeout-then-success, two-attempt exhaustion, non-retry of 401, and cancellation during retry delay. Shared recovery tests, native typecheck and local iOS Expo export run without an EAS build. Physical iPhone light/dark, VoiceOver, Dynamic Type, first launch after idle, offline failure and same-account recovery remain acceptance checks for the next installed build. Existing data and offline-first repository activation are unchanged. This PR is native-only at runtime; no web/API deployment is needed.

## iPhone cold-start orchestration (October 18)

Review of current main confirms startup and manual Reconnect both call the same native refresh function. Their surrounding work differs. Native session restore previously attached a cloud-backed frequent-player store and immediately launched its sync before main refresh; a separate 30-second timer also performed account/players work when profileId was missing. Web restore does neither. Both main refresh functions originally launched account/list/open-game reads together. Native uses Expo AuthSession refresh and two safe GET attempts; web uses MSAL and one reconnect read attempt. There is no evidence that changing token lifetime or adding another blanket retry resolves this symptom.

Native restore now activates cached players with no remote and automatic sync disabled. The independent missing-profile account timer is removed. Main native refresh uses readAccountSnapshot: await account verification, stop on deletion/profile mismatch or stale identity, then load list/open-game reads. Only after verified reads and local/session checks does it attach the players remote without implicit sync, followed by one explicitly awaited player sync. Startup, manual Reconnect and foreground refresh still share this route and the existing single-flight connection controller. Scoring/game writes, API retry budgets, legacy storage and web runtime remain unchanged.

This removes identifiable startup request overlap; it does not prove that overlap caused the production 30-second timeout or eliminate backend cold latency. The existing two-attempt safe-read policy and overall watchdog remain bounded. A persistent error is still shown truthfully. Do not promise every first connection succeeds. If the next installed build still fails after idle, collect its sanitized failure stage/code/time and corresponding server request/dependency timings; account-first sequencing makes that stage easier to isolate.

New tests run real coordinator/API/controller/player-store implementations with disposable fixtures. They verify account-first read order, no game reads before account verification, profile/deletion rejection, late-result isolation, local-only player activation, one explicit player sync, first-read timeout/retry recovery within the original connection attempt, and no automatic 401 retry. Native typecheck and local iOS export pass; physical-device after-idle acceptance remains open. No EAS build used. Requires a future installed iPhone build; no web/API deployment is required.
