# Offline-first upgrade in place

Mike confirmed on 2026-10-20 that the current app is pre-production and authorized upgrading the current app/API in place. Use the existing account registration, API, database, bundle identifier and device stores. A separate test API, app variant or disposable account is not a prerequisite. PR #89 is merged; the earlier separate-target proposal is superseded by this decision.

## 1. Deploy and enable the existing API first

After merging the in-place configuration PR, open GitHub Actions → **Deploy Azure API** → **Run workflow**, select `main`, and check **Enable replay-safe offline game operations on the existing API after deployment**. The workflow builds/tests/deploys the current API, then sets and verifies only `ScorekeeperGameOperationsEnabled=true` on the existing target. Leaving the checkbox unchecked preserves the existing setting; it does not turn an already enabled API off.

Migrations 004 and 005 were previously reported applied. Confirm that this remains the target database and current API schema is ready; do not reset it or rerun 004 after 005. Schema marker 2 and protocol capability version 1 are different values. See [lifecycle deployment requirements](GAME_LIFECYCLE_OPERATIONS.md). Deployment and the unauthenticated HTTP 401 smoke test do not prove authenticated database/capability acceptance.

Sign in to the current account and inspect its authenticated `GET /api/account` response. Require a matching profile, `deletionStatus: null`, and `gameOperations.version: 1`, `receipts: "retained"`, `atomicGameAndReceipt: true`, `kinds` containing `action`, `delete`, and `import`, and the advertised actions used (`score`, `select`, `finish`, `resume`, `undo`, `edit`, `rules`). If capability is null or incompatible, stop cloud activation and inspect the deployed API/schema before building the client. Never work around uncertainty by changing operation/entry IDs or sending pending actions through legacy endpoints.

This conversation cannot invoke the Azure deployment workflow through the available connector. The workflow must actually run; a merged PR is not evidence of deployment or a live Azure setting change.

## 2. Activate the current website

Use the current Sites project/origin and existing API. Set the web settings below in Sites and build/publish the latest merged source with those same public values available at bundle time. NEXT_PUBLIC flags are consumed by client code; a runtime configuration change alone is not proof they were compiled into the browser bundle. Do not publish an old saved version as though it contained the latest architecture.

| Suffix | NEXT_PUBLIC_ on web / EXPO_PUBLIC_ on iPhone |
|---|---|
| CONFIRMED_CACHE_PILOT | true |
| GAME_SCREEN_PILOT | true |
| GAME_RECOVERY_PILOT | true |
| GAME_DELIVERY_PILOT | true |
| GAME_SCORING_PILOT | true |
| GAME_COLD_WRITES_PILOT | true |
| GAME_AUTOMATIC_SYNC_PILOT | true |
| GAME_ADOPTION_REVIEW_PILOT | true |
| GAME_ADOPTION_IMPORT_PILOT | true |
| LEGACY_STAGING_PILOT | false |
| GAME_COLLISION_RESOLUTION_PILOT | false |

The first seven enable the core offline/automatic path. Review/import flags expose explicit account-copy admission of existing/new device-only games. Enabling them does not automatically import a game or replace an original. Legacy staging and advanced same-version collision resolution remain off; unresolved conflicts stay retained for review. A separate permanent production rollout decision is not needed for this authorized pre-production upgrade, but unverified acceptance results must still be recorded honestly.

Record the actual deployment/version and effective compiled flags. Do not clear browser data. Public identifiers/flags are not secrets; never put bearer/refresh tokens, connection strings or private keys in public variables.

## 3. Update the installed iPhone app without uninstalling

All existing EAS development, preview and production profiles now declare the table above and retain their API, public auth identifiers and application identity. The existing `production` profile remains the TestFlight/App Store build profile; using this profile name does not change the user's classification of the current app as pre-production. No new profile or bundle identifier is needed.

Use a new binary including `expo-network` and `expo-sqlite`, with a cleared build/bundler cache so newly enabled public flags are not inherited from a stale transformed bundle. An iOS JavaScript export is not native linking acceptance, and these new module requirements must not be sent to an older binary as a JavaScript-only update. Upgrade the installed app through the existing distribution path; do not uninstall it first or erase AsyncStorage/SQLite to make testing pass.

After API readiness and website upgrade, from the repository root in PowerShell:

```powershell
git pull --ff-only
Set-Location mobile
npm ci
npm run typecheck
npx eas-cli@latest build --platform ios --profile production --clear-cache
npx eas-cli@latest submit --platform ios --profile production --latest
```

The final two commands start a potentially paid build and upload to App Store Connect. They have not been run here. Submit the just-completed build; use its explicit build ID instead of `--latest` if another build can finish concurrently. Install it from TestFlight after processing. Alternatively, manually run the existing **Build iPhone for TestFlight** workflow after API readiness. No build is triggered merely by merging these changes.

For local development, copy/merge public values from `mobile/.env.example` into the ignored mobile environment without overwriting private/local settings, then restart Metro. EAS profile env does not automatically populate a later local `expo start` process. Do not replace existing local files wholesale.

## 4. Preserve existing games and exercise the upgrade

1. Online, sign in with the current account on web and iPhone. Open an existing unfinished account game and choose **Enable score entry** if it is untracked. Explicit preparation creates the authoritative tracked queue; a cached summary alone is not an offline game. Record starting version/history and confirm a score reaches both clients.
2. Existing device-only games stay local until explicitly reviewed/imported. Review the actual source, choose account admission, and let the retained original request sync. The account copy then becomes the playable authority; originals remain retained as read-only recovery evidence. Do not manually recreate the game or delete its original as an import workaround.
3. New games under the screen pilot are device-only initially. Use the same explicit review/import path when account sync is wanted. Starting a new local game alone is not evidence of account queue sync.
4. Put iPhone in airplane mode, force-close/reopen, resume the prepared game and enter two scores. Local saving must remain usable. Restore networking while foregrounded; automatic delivery should resume without a tap, subject to the remaining one-minute exhausted-retry cooldown. Confirm original entries appear once on web and no duplicate playable game appears.
5. Exercise background/foreground and manual Reconnect with a typed draft. Confirm the draft remains and history is not duplicated. With both clients initially caught up, disconnect one and score on both. Reconnect should retain both histories for explicit conflict review rather than silently rebase/merge.
6. Use a throwaway game for deletion checks. Verify pending deletion, eventual suppression and before-delete history across restart. Account deletion/quota/privacy/erasure require their dedicated acceptance rows; do not erase real information as a test workaround.

Record actual results, commit/build/version, API capability summary and sanitized diagnostic stage/code/duration in [the acceptance matrix](AUTOMATIC_SYNC_ACCEPTANCE.md). Real auth, native linking, mixed-client interruption, privacy/erasure and measured latency remain unverified until exercised; approval to upgrade does not manufacture test results.

## Stop and rollback

Preserve queues, receipts, tombstones, archives and originals if any check fails. Pause automatic scheduling or cloud delivery without returning pending account games to legacy writers. Reconcile/drain through the verified protocol or retain local use with sync paused. Do not clear storage, uninstall, erase receipts or blindly downgrade a pending store. Explicit server-setting rollback is separate from deploying with the enable checkbox unchecked.

References: [Expo build profiles](https://docs.expo.dev/build/eas-json/), [Expo public environment variables](https://docs.expo.dev/guides/environment-variables/), [saved architecture plan](OFFLINE_FIRST_SYNC_PLAN.md).
