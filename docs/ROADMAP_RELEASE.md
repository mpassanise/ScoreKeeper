# Guest play and game rules release

## Implemented

- Web and Expo guest play with device-local saves and restoration of the last open guest game.
- Explicit import into a signed-in account; local originals remain intact. Conflicting IDs preserve the existing account game.
- Winner rule remains highest or lowest score. Game ending is separate: manual, fixed rounds, or first to a target (highest-score games).
- A round requires one recorded turn per player; repeated selection of one player cannot finish a round prematurely.
- Target games end immediately at or above the target. Undo reopens a game if its ending condition is no longer met; editing scores reevaluates automatic completion.
- Existing games default to manual endings. No SQL schema migration is required for the new rules; they live in the existing JSON game state.
- Web account label prefers the returned name, falling back to username/email.
- Preserve the iPhone number pad and separate positive/negative toggle from the latest GitHub change.

## Activation order

1. Publish the website. Guest play and guest ending rules work without a backend deployment.
2. Deploy `backend/Scorekeeper.Api` to the existing `scorekeeper-api` Function App using the working Azure deployment procedure. Preserve environment variables and database settings. `/account` now includes `scoringRulesEnabled: true`; both clients hide account ending options until this flag is returned. Sign out/in or reopen the app after updating the API.
3. Install mobile dependencies using `npm ci` inside `mobile`, then build a new Expo binary (`eas build --platform ios --profile preview` for device testing, or `--profile production` for TestFlight/App Store distribution). AsyncStorage adds a native dependency, so this needs a new binary, not just a website deployment.
4. Complete the tenant/provider setup in [IDENTITY_PROVIDERS.md](IDENTITY_PROVIDERS.md).

The Azure API and native binary are not automatically deployed by Sites or by saving this source. Website publication does not update the binary currently in App Store review.

## Verification

Run from the repository root:

```sh
node scripts/test-api-client.mjs
node scripts/test-local-games.mjs
pnpm exec tsc --noEmit
dotnet run --project backend/Scorekeeper.Tests/Scorekeeper.Tests.csproj -c Release
dotnet build backend/Scorekeeper.Api/Scorekeeper.Api.csproj -c Release
```

Run from `mobile`:

```sh
npm run typecheck
npx expo export --platform ios --output-dir /tmp/scorekeeper-ios
```

Device acceptance: create a guest game, add scores, close/reopen the app, verify scores and selected game return; complete fixed-round and target games; undo the completion; sign in and explicitly import; sign out and confirm account games are not in guest history. Test the cloud rules after the API deployment. Browser interaction and physical iPhone testing remain required.

## Account linking

Entra remains the source of authenticated account IDs. Adding a new sign-in provider does not guarantee it links to an existing password account. Do not merge identities by email, particularly Apple relay addresses. Verified account linking is deferred until the identity model and tenant behavior have been tested; this release does not claim to implement it.

## Working with local changes

The GitHub release branch is based on the latest main commit and preserves its iPhone keypad change. Other development checkouts and any changes on your own computer have not been overwritten. Commit or stash your local work before switching branches, then merge or cherry-pick the release branch into that work as appropriate.
