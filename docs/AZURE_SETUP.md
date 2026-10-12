# Scorekeeper Azure setup

The source is ready for local validation and account setup. It is not a deployed API. The existing website still uses device-local scoring until all four web configuration values are supplied. No Azure resources are created automatically by this repository.

## 1. Lowest-cost hosting

Use an eligible existing pay-as-you-go subscription and a dedicated resource group.

- Azure Functions v4, **Flex Consumption**, .NET isolated **10**. Use on-demand instances only; set **zero Always Ready** instances. Choose the lowest supported memory allocation suitable for the app (start at 512 MB) and limit maximum scale. Functions runtime storage is separately billable even within the compute grant.
- Azure SQL **free database offer**, not the regular paid serverless tier. Select **Auto-pause the database until next month** at the free limit. Do not select “Continue using database for additional charges.” The free allowance is 100,000 vCore-seconds, 32 GB data and 32 GB backup each month. Resuming a sleeping database can delay the first request; the API may return 503 while it wakes. Refresh and retry only after checking game state.
- Use the existing website URL; no custom domain is required.
- Use small logging retention and sampling if enabling Application Insights. Create a small Azure budget with email alerts. Budgets are notifications, not a spending cap.

Azure Functions has a free compute allowance on eligible subscriptions, but storage, networking and optional monitoring can still incur small charges. Do not promise a hard $0 bill.

## 2. Public registration with Entra External ID

Create an **external tenant**, separate from a workforce tenant. Create a sign-up/sign-in user flow using email and password or email one-time passcode. Add both client applications to the flow. The first 50,000 monthly active users are covered by the Basic free tier; avoid SMS features and paid add-ons.

Register three applications:

1. **Scorekeeper API**: expose delegated scope `Scorekeeper.Access` under `api://<api-client-id>`. Set `api.requestedAccessTokenVersion` to `2`. Ensure access tokens have the tenant ID (`tid`), customer object ID (`oid`) and delegated scope (`scp`). The API does not accept ID tokens or app-only tokens.
2. **Scorekeeper web**: SPA platform; redirect URI `https://scorekeeper-mike.mpassanise.chatgpt.site/` and local URI `http://localhost:5173/`. Grant the API's delegated scope, then grant administrator consent in the external tenant. Associate it with the user flow.
3. **Scorekeeper mobile**: public native client; Mobile and desktop platform; register `scorekeeper://auth` as a custom redirect URI. Grant the same delegated API scope and admin consent. Associate it with the user flow. No client secret belongs in either client.

Use the authority from the external tenant's metadata, normally `https://<subdomain>.ciamlogin.com/<tenant-id>/v2.0`. The API pins HTTPS metadata, issuer, tenant, audience, signing algorithm, expiration and delegated scope. Every database query scopes access to the token's tenant/customer ID. Never accept an owner ID from a client body.

## 3. Database and Function settings

Apply `backend/schema.sql` with a database administrator. Enable the Function App's system-assigned managed identity. Create a database user for that identity and grant only SELECT, INSERT and UPDATE on dbo.Games, using the commented commands in the schema. Assign an Entra administrator to the SQL server to create the identity user.

Set Function App environment variables:

| Setting | Value |
|---|---|
| `FUNCTIONS_WORKER_RUNTIME` | `dotnet-isolated` |
| `AuthAuthority` | External tenant authority above |
| `AuthTenantId` | External directory's GUID |
| `AuthAudience` | API application client ID (v2 access token audience) |
| `AuthScope` | `Scorekeeper.Access` |
| `ScorekeeperSql` | `Server=tcp:<server>.database.windows.net,1433;Database=<database>;Authentication=Active Directory Managed Identity;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;` |

Use the Function runtime's own managed storage configuration. Configure Function App CORS to permit exactly the live website origin and your local web origin, not `*`. SQL firewall connectivity must allow the Function App to connect; if using “Allow Azure services,” understand this is a broad network rule and SQL authentication is still required. Private endpoints add cost and are unnecessary for the initial personal deployment.

Deploy after local verification:

```sh
dotnet publish backend/Scorekeeper.Api/Scorekeeper.Api.csproj -c Release
cd backend/Scorekeeper.Api
func azure functionapp publish <your-function-app-name> --dotnet-isolated
```

Run an authenticated smoke test: create a game, score two turns, edit, undo, fetch from a second client. Repeat the previous version of a mutation and confirm 409. Use a second customer account and confirm it cannot read the first account's game. Anonymous requests should return 401. A paused/unavailable database must not result in a claimed successful score save.

## 4. Web configuration

Copy `.env.example` to `.env.local` for local work. Set the four public values. The API URL ends in `/api`. The web client uses MSAL and authorization-code/PKCE sign-in. No secrets are included in these settings.

Once the hosted API and sign-in are verified, supply those same public values to the web build, build and publish through Sites. `NEXT_PUBLIC_*` settings are build-time values, so a rebuild is required. The original local scores remain under browser storage key `scorekeeper-v1`. Signed-in customers can choose **Import games from this browser**. Imports preserve original player/turn IDs; duplicate cloud IDs return conflict and never overwrite an existing cloud game. Import only your own local games into your account. Local originals remain until manually removed.

## 5. iPhone without a Mac

Copy `mobile/.env.example` to `mobile/.env`, using the native application's client ID. Install the locked dependencies and run Metro:

```sh
cd mobile
npm ci
npx expo start --dev-client
```

OAuth cannot be tested in Expo Go because it cannot customize the app's redirect scheme. Use an EAS **development build** instead:

```sh
npx eas-cli login
npx eas-cli build:configure
npx eas-cli build --platform ios --profile development
```

This builds in the cloud; no Mac is needed. Physical iOS development builds and TestFlight distribution require an Apple Developer membership and Apple signing setup. EAS free build quotas/queues and Apple's membership fees are separate from Azure hosting. An Android development build is another way to test account syncing without Apple's membership cost.

The app stores OAuth credentials using SecureStore. Game totals, winner calculation and turn order come from the C# API. Pull to refresh, or return to the foreground, to see changes from another device. Both clients reject stale mutations rather than merging simultaneous scoring. Offline score entry is intentionally deferred; no score is displayed as saved before the API confirms it.

## Public values needed to activate the apps

- Hosted Function API URL
- External tenant authority and tenant ID
- API client ID and exposed delegated scope
- Web client ID
- Mobile client ID

These are public identifiers. Do not send passwords, client secrets, storage keys or Azure access tokens in chat.
