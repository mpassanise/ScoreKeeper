# Scorekeeper branding

The approved Sk mark uses lime lettering on teal, with a thin teal separation at the overlap.

- `mobile/assets/icon.png`: 1024 × 1024 opaque PNG, configured as the Expo and iOS icon. The iOS production build embeds it for App Store delivery.
- `public/scorekeeper-logo.png`: 512 × 512 website/header asset.
- `public/apple-touch-icon.png`: 180 × 180 iPhone website shortcut icon.
- `public/favicon.png`: 32 × 32 browser favicon.

The same mark appears in the web and native app headers. Web changes take effect when deployed; existing browser shortcuts may cache the previous icon. Native home-screen and App Store icons require a new binary build.

From the repository root, after pulling the latest changes:

```powershell
cd mobile
npm ci
npx eas-cli build --platform ios --profile preview
```

Install the new preview to verify the icon and account deletion. When ready for App Store distribution, use the production profile:

```powershell
npx eas-cli build --platform ios --profile production
```

The icon is supplied by that build; uploading these source files alone does not update an existing App Store release.
