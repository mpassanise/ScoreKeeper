# Build iPhone for TestFlight

The manually triggered `.github/workflows/testflight.yml` builds the production iPhone app and optionally uploads that exact build to App Store Connect. It waits for both operations and does not submit a public App Store release. It runs only from `main`, serializes production builds, and uses the existing remote automatic build-number increment in `mobile/eas.json`.

## One-time setup

1. Create an Expo access token at https://expo.dev/accounts/mpassanise-dev/settings/access-tokens. Use an account with access to the Scorekeeper EAS project.
2. In https://github.com/mpassanise/ScoreKeeper/settings/secrets/actions, add a **repository secret** named `EXPO_TOKEN`. Paste the token only into GitHub's secret field; never commit it or paste it into chat.
3. In App Store Connect, open Scorekeeper > App Information > General Information. Copy its numeric **Apple ID** (not the bundle identifier, team ID, or Expo project ID).
4. In https://github.com/mpassanise/ScoreKeeper/settings/variables/actions, add a **repository variable** named `ASC_APP_ID` with that numeric ID. The workflow adds it to the submission profile for the runner only; it does not modify the repository.
5. Configure stored Apple submission credentials on your computer:

```powershell
cd C:\Dev\personal_dev\Repos\ScoreKeeper\mobile
npx eas-cli credentials --platform ios
```

Select **production**, then **App Store Connect: Manage your API Key**, then **Set up your project to use an API Key for EAS Submit**. Expo will guide you through the Apple login/authorization. Your successful production builds have already configured signing certificates and provisioning profiles; those must remain valid. Store the submission key in Expo, not this repository.

## Run

After merging the workflow, open https://github.com/mpassanise/ScoreKeeper/actions and select **Build iPhone for TestFlight** > **Run workflow**. Choose **main** and leave **Upload the finished build to TestFlight** checked. Uncheck it for a build without an upload.

The action installs locked dependencies, checks TypeScript, builds on EAS, verifies the returned iOS build finished, and submits by that build's ID. Its run summary includes a link to the build. A queued EAS build can take time; the GitHub job waits up to three hours. If the job is cancelled or times out, check Expo before starting another build because cancellation of a GitHub job does not necessarily cancel an EAS operation.

After upload, Apple processing and external TestFlight review are separate steps. Assign the new build to your external group and notify testers after approval. Do not submit an App Store version unless you intend a public release.

## Troubleshooting

- **Missing EXPO_TOKEN:** add the repository secret, or replace an expired/revoked token.
- **Missing ASC_APP_ID:** add the numeric Apple ID as a repository variable, or run with upload unchecked.
- **App Store Connect API Keys cannot be set up in non-interactive mode:** complete the credentials step above.
- **Signing credentials expired:** repair them through `npx eas-cli credentials --platform ios`, then retry.
- **Build failed:** submission is skipped. Inspect the EAS build link/logs.
- **Upload failed after a successful build:** reuse the displayed build ID with `npx eas-cli submit --platform ios --profile production --id <build-id>` after fixing submission credentials, rather than creating another build.

References: https://docs.expo.dev/build/building-on-ci/ and https://docs.expo.dev/submit/ios/
