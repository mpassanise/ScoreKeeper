# Display name, Google and Apple sign-in

These changes require administrator access to the external tenant and the provider consoles. The existing clients already redirect to the shared Entra user flow; providers configured there will appear on the hosted sign-in page for web and iPhone. No fake Google/Apple buttons are added before the providers are active.

## Fix the Microsoft-hosted “unknown” label

1. Switch Entra admin center to external tenant `e8d1bba5-f80e-44fa-a71c-824ff6312d31` (Scorekeeper App Customers).
2. Inspect a test customer under Users. Verify the built-in **Display name** is populated; a custom username field is separate.
3. Under External Identities → User flows, open the flow associated with both the web and mobile registrations. Add the built-in **Display Name** signup attribute and mark it required in its page layout. It can be labeled “Name” for customers. Verify this value is persisted to the customer's built-in displayName and returned as the profile name.
4. For existing users, correct the built-in Display name to their supplied name/username after verifying the right user. Do not change their object IDs or recreate accounts: games are owned by the existing authenticated ID.
5. Sign completely out and back in, then test Microsoft's account picker. A cached Microsoft session may continue showing an old value until renewed. If the built-in name was already populated, inspect the user-flow/profile claim behavior before changing fields.

The website now prefers `account.name`, with a username/email fallback. That client change does not modify Microsoft's hosted account picker itself.

Official reference: https://learn.microsoft.com/en-us/entra/external-id/customers/concept-user-attributes

## Google

1. Create/configure an OAuth web application in Google Cloud for Entra federation, using Microsoft's current guide below for its required redirect URLs and consent-screen settings.
2. Configure Google under Entra → External Identities → All identity providers with its client ID and client secret.
3. Add Google to the same user flow used by both clients. Move the Google OAuth app out of test-only mode when ready for public users, completing any required verification.
4. Test signup, returning sign-in, sign-out and game isolation from web and an iPhone development build.

Tenant-specific primary callback:

```text
https://scorekeeperappcustomers.ciamlogin.com/e8d1bba5-f80e-44fa-a71c-824ff6312d31/federation/oauth2
```

Use the full list in the current official guide, not only this callback:
https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-google-federation-customers

## Apple

1. In Apple Developer, enable Sign in with Apple for the existing App ID `com.mpassanise.scorekeeper`.
2. Create a Services ID associated with that primary App ID. Configure Entra's domains and return URLs using the current Microsoft guide. Domain: `scorekeeperappcustomers.ciamlogin.com`; primary return URL is the callback above.
3. Create a Sign in with Apple key for that primary App ID. Configure Apple's Services ID, Team ID, Key ID and `.p8` key in Entra's Apple provider configuration.
4. Enable Apple in the same Entra user flow as Google/email login.
5. Test both Share My Email and Hide My Email, first registration, repeat login and cancelled login on web and an iPhone build. Confirm the signup flow collects a usable display name if the provider does not return one.
6. Follow Microsoft's current credential renewal requirements. Keep the provider key/client secrets only in the provider/Entra configuration; never in `EXPO_PUBLIC_*`, `NEXT_PUBLIC_*`, source control or chat.

Official guide:
https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-apple-federation-customers

## Account ownership

Keep the existing tenant and API token validation. Do not identify or merge owners by email or displayed name. A provider login may create a distinct Entra customer account; verified linking to an existing account is a separate follow-up. Test this before telling users that switching providers preserves their cloud history.
