# Offline-first device pilot: preflight and first test session

Status: prepared, not activated. PR #88 is merged; the next milestone is full-app browser/iPhone acceptance, not another delivery feature. No build or deployment is started by this document.

## 1. Choose the test target before spending an Expo build

The checked-in `mobile/eas.json` development, preview and production profiles all target the existing API. None declares the seven automatic-sync flags below. This is a repository-only inspection: remote Expo environment variables, local .env files, hosting build variables and actual Azure settings have not been inspected and can change the effective configuration. A normal production build must not be assumed to exercise the pilot.

Decide between a separate test API/database (preferred for failure/deletion testing) and an explicitly authorized pilot against the existing API using disposable test accounts/games. A dedicated account does not isolate server settings: enabling `ScorekeeperGameOperationsEnabled` on the existing Function App affects capability discovery for all accounts served there. Do not change that production setting merely to follow this document. Confirm the endpoint, accepted token audience/scope, web redirect/CORS and mobile registration with the chosen target before configuring clients.

All current iPhone profiles also use the same application bundle identifier. A differently named EAS profile alone does not create a separate app or storage sandbox. Use a spare test device or a deliberately configured separate app variant. Do not uninstall the current app or clear its data to make a test work. Preserve existing local-only games and queued/recovery data.

## 2. Verify backend readiness in the chosen test environment

- Confirm all API instances run the lifecycle/receipt implementation and migrations 004 then 005 have already been applied to that database. Migration 005 advances the schema marker to 2; do not rerun 004 after 005. See [lifecycle deployment requirements](GAME_LIFECYCLE_OPERATIONS.md).
- Only after test-target authorization, enable `ScorekeeperGameOperationsEnabled=true` there. Do not infer current Azure values from a merged PR or an earlier deployment.
- Sign in with a disposable test account and inspect its authenticated `GET /api/account` response. Require a matching profile, `deletionStatus: null`, and `gameOperations.version: 1`, `receipts: "retained"`, `atomicGameAndReceipt: true`, `kinds` containing `action` and `delete`, and advertised actions for the test (`score`, `select`, plus `finish/resume/undo/edit/rules` when exercising those actions). Import tests additionally require `import`.
- `gameOperations: null`, an auth error, wrong profile or missing capability is a stop condition before building/enabling a writer. Do not retry legacy mutations or replace unknown-outcome operation IDs.
- Record API commit/version, migration state and a capability summary. Never share bearer/refresh tokens, connection strings or raw personal/game payloads in logs or PRs. Capability observation is not a substitute for native/device acceptance.

## 3. Prepare explicit test-only client settings

Both apps use the same suffixes with different prefixes:

| Suffix | Web prefix | iPhone prefix | Automatic pilot test value |
|---|---|---|---|
| CONFIRMED_CACHE_PILOT | NEXT_PUBLIC_ | EXPO_PUBLIC_ | true |
| GAME_SCREEN_PILOT | NEXT_PUBLIC_ | EXPO_PUBLIC_ | true |
| GAME_RECOVERY_PILOT | NEXT_PUBLIC_ | EXPO_PUBLIC_ | true |
| GAME_DELIVERY_PILOT | NEXT_PUBLIC_ | EXPO_PUBLIC_ | true |
| GAME_SCORING_PILOT | NEXT_PUBLIC_ | EXPO_PUBLIC_ | true |
| GAME_COLD_WRITES_PILOT | NEXT_PUBLIC_ | EXPO_PUBLIC_ | true |
| GAME_AUTOMATIC_SYNC_PILOT | NEXT_PUBLIC_ | EXPO_PUBLIC_ | true |

These are build/bundle settings, not an in-app switch. Leave production settings unchanged. Use an isolated web preview/origin and an explicit mobile test profile. Keep legacy staging, adoption review/import and collision-resolution flags false for the initial existing-account-game session; they have separate acceptance gates. A newly created device-only game is not proof of account-queue synchronization.

The following is a **proposed profile fragment**, not an existing profile or applied configuration. Add it under `build` only after the target and test installation are agreed. Replace the endpoint and verify inherited public auth identifiers/scope for that target. The `preview` environment is selected explicitly; inspect project/account EAS variables as well. Inheriting `preview` produces an internal Release build without a Metro server, so the installed bundle uses the build settings. Keep development/production profiles unchanged.

```json
"offline-acceptance": {
  "extends": "preview",
  "environment": "preview",
  "env": {
    "EXPO_PUBLIC_API_URL": "https://REPLACE-WITH-APPROVED-TEST-API/api",
    "EXPO_PUBLIC_CONFIRMED_CACHE_PILOT": "true",
    "EXPO_PUBLIC_GAME_SCREEN_PILOT": "true",
    "EXPO_PUBLIC_GAME_RECOVERY_PILOT": "true",
    "EXPO_PUBLIC_GAME_DELIVERY_PILOT": "true",
    "EXPO_PUBLIC_GAME_SCORING_PILOT": "true",
    "EXPO_PUBLIC_GAME_COLD_WRITES_PILOT": "true",
    "EXPO_PUBLIC_GAME_AUTOMATIC_SYNC_PILOT": "true",
    "EXPO_PUBLIC_LEGACY_STAGING_PILOT": "false",
    "EXPO_PUBLIC_GAME_ADOPTION_REVIEW_PILOT": "false",
    "EXPO_PUBLIC_GAME_ADOPTION_IMPORT_PILOT": "false",
    "EXPO_PUBLIC_GAME_COLLISION_RESOLUTION_PILOT": "false"
  }
}
```

Public identifiers are not secrets. Do not put secrets in NEXT_PUBLIC_/EXPO_PUBLIC_ settings. For a development-client build instead, configure the same test values in the Metro environment too: EAS build-profile env does not automatically populate a later local `expo start` process.

## 4. Build once, after preflight and explicit build authorization

The new binary must include `expo-network` and `expo-sqlite`; an export is not proof of native linking. Never send the new module requirement to an old binary as a JavaScript-only update. Internal distribution is different from TestFlight; use the installation link for registered test devices. If choosing TestFlight instead, prepare its separate store-distribution profile deliberately rather than submitting this internal profile.

From the repository root in PowerShell, **after the proposed profile has actually been configured**:

```powershell
git pull --ff-only
Set-Location mobile
npm ci
npm run typecheck
npx eas-cli@latest build --platform ios --profile offline-acceptance
```

The final command starts an EAS build and may consume paid allowance. It has not been run or authorized here. Install only on the agreed test device/variant, and record the commit, build ID, API endpoint and effective flags. Use the same client commit/test API for the isolated web preview.

## 5. First session: existing account game only

1. Online, sign in to the disposable account on web and iPhone. Open an existing unfinished account game with known player IDs/history. If none exists, seed a disposable account game through a compatible existing client before the pilot; do not enable import as an implicit workaround.
2. While connected, open the game and choose **Enable score entry** if it is untracked. Preparing a cached game is explicit. Confirm a score is saved and then confirmed in the account on both clients; record starting game/version/entry counts.
3. Put iPhone in airplane mode, force-close/reopen it, then resume the prepared game. Enter two different scores. It must remain usable with local saves and a clear pending/offline state. Do not create replacement games or sign out to work around a failed save.
4. Restore networking while keeping the app foregrounded. No manual reconnect should be needed. An exhausted retry budget may wait the remaining one-minute cooldown. Confirm each score appears once on web with matching totals/history, and that no duplicate game tile appears.
5. Background/foreground during a later sync and repeat a manual Reconnect. Confirm drafts remain and history is not duplicated. Stop if an error cannot be explained; preserve data and record sanitized stage/code/duration.
6. With both clients caught up, disconnect one, score on both, then reconnect. Expect explicit conflict review rather than silent merging/rebasing. Inspect both retained histories before any account-copy choice. Verify choice retries retain the displaced device history.
7. Delete only a disposable game and verify pending deletion, eventual suppression and retained before-delete evidence. Account deletion, old-client mixing, quotas, privacy/erasure and rollout rollback require the later dedicated matrix rows; do not test these against personal data.

Record results in [the acceptance matrix](AUTOMATIC_SYNC_ACCEPTANCE.md). A successful session closes only its recorded rows, not all native/auth/performance/retention gates. Keep broader rollout disabled until those gates and policies are resolved.

## Stop and rollback

Stop the pilot for lost/duplicate entries, account leakage, unexpected deletion, false save confirmation or storage/native failures. Preserve queues, receipts, tombstones, archives and originals. Disabling automatic scheduling must not return pending account games to a legacy writer. Retain local use with sync paused or reconcile/drain through the verified protocol; do not clear storage, uninstall, erase receipts or blindly downgrade a pending store. Agree any server-setting rollback for the chosen environment explicitly.

References: [Expo build profiles](https://docs.expo.dev/build/eas-json/), [Expo public environment variables](https://docs.expo.dev/guides/environment-variables/), [the saved architecture plan](OFFLINE_FIRST_SYNC_PLAN.md).
