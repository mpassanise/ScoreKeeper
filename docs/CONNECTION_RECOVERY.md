# Phase 1, iteration 1: account connection recovery

Date: 2026-10-16. Status: implemented in a review branch; not deployed.
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

## MSAL callback finding and next increment

The installed MSAL browser version is 5.24.0. The app currently handles redirects at the root and has no dedicated v5 bridge. Microsoft documents that iframe fallback after refresh-token expiry needs the bridge; redirect sign-in can still work when the root processes handleRedirectPromise.

Before activating a new callback:

1. Implement a same-origin bundled bridge route with the installed MSAL package; no external script/CDN.
2. Serve the callback without COOP and with Cache-Control: no-store.
3. Verify/register its exact URI in the existing web Entra app registration.
4. Activate the matching configuration only after the route and registration are available.
5. Exercise normal redirect, long-idle iframe fallback, blocked cookies and return-to-game on the deployed origin.

The registration has not been inspected or altered by this iteration. The existing root redirect remains active. This finding is not proof that every timeout comes from the callback.

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

Physical-device and browser interaction QA have not been performed in this environment. Existing controls still wait for foreground cloud scoring requests. Full offline account scoring requires phases 2–4. Automatic retry backoff/jitter and the dedicated MSAL bridge remain future Phase 1 increments; Phase 0 device/timing gates remain open.

## Deployment and rollback

Review/merge the PR first. Web publication and an iPhone build/distribution are separate release steps. No API deployment or data migration is required. No native dependency is added and no Expo cloud build is consumed by this development iteration.

Rollback restores prior client code; existing storage formats and API requests are compatible. The new web summary cache/draft can be left unused safely. Never clear legacy game/player storage to roll back.
