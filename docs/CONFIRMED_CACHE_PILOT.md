# Confirmed-read cache pilot: web and iPhone

Phase 2, iteration 5. Default: disabled. No API deployment is required for this PR.

## What changes

Both apps can exercise the durable repository in shadow mode. Existing cloud GETs still supply the visible game. A verified full game response is copied into the API profile's partition. Scores, game creation, edits and imports retain their existing paths. No queue exists and no cached account game is opened for offline scoring.

| Build-time setting | Default | Effect when true |
| --- | --- | --- |
| `NEXT_PUBLIC_CONFIRMED_CACHE_PILOT` | false | Web IndexedDB shadow cache and tab lifecycle checks |
| `EXPO_PUBLIC_CONFIRMED_CACHE_PILOT` | false | Native SQLite shadow cache and resume lifecycle checks |
| `NEXT_PUBLIC_LEGACY_STAGING_PILOT` | false | Web Account → Device saves review; requires cache pilot |
| `EXPO_PUBLIC_LEGACY_STAGING_PILOT` | false | Native Account → Device saves review; requires cache pilot |

Only the exact string `true` enables a flag. Nothing is added to production EAS profiles or hosting environment configuration. With flags absent/false, hooks install no storage/lifecycle listeners and open no new database. The native module is loaded dynamically in the enabled opener; adding the package still changes the next native binary. **Build/install a new iPhone binary with expo-sqlite before enabling the native flag.** An OTA update cannot install a native module.

## Identity and failure handling

A refresh binds a durable permission revision before its API response is accepted. Each capture is issued by the controller, bound to its selected auth identity and invalidated by a new verification attempt, sign-out, deletion, account switch or external revision change. Tokens and email addresses never enter repository metadata or cross-tab messages. Notifications merely trigger a database recheck; they cannot grant account access.

Web uses BroadcastChannel plus storage-event fallback and window-focus rechecks. Native uses AppState active rechecks. Storage errors during optional caching do not turn a cloud save into a failed score or block ordinary online refresh. They produce a device-copy notice. Sign-out/deletion are different: the local access barrier must commit before the app claims completion or issues the account deletion POST. Failed barriers keep physical records, hide the account view, surface the error and require retry. A blocked deletion profile may retry the server deletion after restart without regaining cached access; `isDeletionBlocked` is only a recovery check, never an account verification grant.

Only confirmed GET snapshots are copied. New cache reads are deliberately not exposed: game deletions/tombstones and full mutation-versus-account-switch UI races must be accepted before a cache may supply a visible account game. The current summary cache and existing online writers remain the baseline. Do not describe account scores as locally queued or guaranteed offline.

## Device-save review

Account → Device saves → Check device saves copies the complete `scorekeeper-v1` value into the transactional staging journal and inspects IDs, counts and content. The action does not infer an owner. The source remains intact. Repeating the same review reuses its copy; changed input retains both copies and asks for review. Malformed/duplicate-ID data is retained for recovery. This is a diagnostic pilot action, not migration completion or an account import. Guest frequent-player adoption remains outside this increment.

## Verification and next gate

```sh
npm ci --prefix tests/offline --ignore-scripts --no-audit --no-fund
node scripts/test-repository-pilot.mjs
node scripts/test-durable-repository.mjs
node scripts/test-account-access.mjs
npx tsc --noEmit
cd mobile
npm run typecheck
npx expo export --platform ios --output-dir /tmp/scorekeeper-mobile
```

The automated pilot suite exercises IndexedDB emulation and real SQLite files. It covers disabled-open behavior, detached inputs, identity scoping, external sign-out/focus-resume checks, pre-dispatch permission revisions, deletion retry after restart, preservation, repeated source review and late-open cleanup. This is not physical iOS SQLite, browser quota/eviction or multi-device API acceptance evidence.

Before enabling a test cohort, verify both themes and Account review layout on narrow screens; unchanged behavior with both flags off; cold start and repeated resume; no native module load with flags off; two browser tabs switching/signing out during GETs and mutations; sign-out/deletion with failed local commits and server errors; changed/corrupt source review without source deletion; and metadata corruption/blocked storage. Preserve unsent input through sign-in and account changes. Keep a known copy of test game IDs/counts/content and compare after restart.

Rollback: set flags false and rebuild the web bundle/native JS with the same runtime as appropriate. No queued writes need draining. Do not delete either database or the legacy source. The additive SQLite dependency can remain in the binary. Expanding beyond shadow mode requires another reviewed increment; replay-safe API capability and an atomic local outbox are mandatory before offline account writes.
