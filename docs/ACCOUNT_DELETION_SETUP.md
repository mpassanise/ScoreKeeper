# Enable account deletion

The web and iPhone apps now include **Account → Delete account**. Privacy and support pages are public:

- https://scorekeeper-mike.mpassanise.chatgpt.site/privacy
- https://scorekeeper-mike.mpassanise.chatgpt.site/support

The API must be upgraded and given Microsoft Graph permission before deletion is available. Do these steps in order. No existing account is deleted by setup.

## 1. Update the SQL database first

Pull the latest repository. In the Azure SQL query editor, select database **free-sql-db-4371450** on **scorekeeperapp.database.windows.net**. Sign in as the same administrator used for the original schema.

Open `backend/migrations/002_account_deletion.sql`, paste its full contents and run it. It creates the deletion-request table and grants the Function App SQL user the required permissions. It does not delete any game data.

**Apply this migration before publishing the API.** The updated API checks the new table on game requests; skipping the migration prevents scoring from working.

## 2. Give the API permission to delete customer identities

In Microsoft Entra admin center, switch to the **Scorekeeper customer external tenant**, not your Azure subscription's workforce directory. Verify tenant ID:

`e8d1bba5-f80e-44fa-a71c-824ff6312d31`

1. Open **App registrations → Scorekeeper API**, application ID `c6f1573d-1e0c-4830-abed-a71b47d49cc8`.
2. Open **API permissions → Add a permission → Microsoft Graph**.
3. Choose **Application permissions**. This is a server permission; do not choose Delegated permissions here.
4. Search for and select **User.ReadWrite.All**, then **Add permissions**.
5. Choose **Grant admin consent** for this customer tenant and confirm. The permission must show **Granted**. An administrator authorized to grant Microsoft Graph application permissions may be needed.

The existing web/mobile delegated `Scorekeeper.Access` scope remains in place. No additional permission is needed on the web/mobile registrations. Do not give the deletion application a directory administrator role. The implementation is restricted to the signed-in customer's own local account; it does not expose a client-supplied user ID.

## 3. Create a server-only credential

In the same **Scorekeeper API** registration:

1. Open **Certificates & secrets → Client secrets → New client secret**.
2. Name it `Scorekeeper account deletion` and select an expiration you can maintain. Set yourself a reminder to rotate it before expiration.
3. Copy the new secret's **Value**, not its Secret ID. The value is shown only once.
4. In Azure Portal, open Function App **scorekeeper-api → Settings → Environment variables** (sometimes labeled Configuration).
5. Add the following application settings, save/apply and allow the app to restart:

| Name | Value |
| --- | --- |
| `AccountDeletionEnabled` | `true` |
| `GraphClientId` | `c6f1573d-1e0c-4830-abed-a71b47d49cc8` |
| `GraphClientSecret` | The client secret **Value** you just copied |

Keep existing `AuthTenantId`, `AuthAuthority`, `AuthAudience`, `AuthScope` and `ScorekeeperSql` settings. `AuthTenantId` must refer to the customer tenant above.

**The secret belongs only in Azure Function App settings.** Do not put it in GitHub, Expo, website settings, `NEXT_PUBLIC_*`, `EXPO_PUBLIC_*`, or chat. Rotate it if exposed. A Key Vault reference can be used instead of a plain application-setting value if you already use Key Vault.

`GET /api/account` reports whether these settings are present; it does not prove that Graph consent, secret validity or SQL access are correct. The disposable-account test below checks those together.

## 4. Deploy the updated API

On your Windows computer, from your repository folder:

```powershell
git pull
cd backend/Scorekeeper.Api
func azure functionapp publish scorekeeper-api --dotnet-isolated
```

The `--dotnet-isolated` flag explicitly selects the worker runtime when Core Tools cannot detect it from the project files. If you see "Worker runtime cannot be None", use the command above with that flag.

Use the same working .NET isolated deployment setup you used previously. The project targets .NET 10. If publish reports a runtime mismatch, use the existing deployment instructions in `docs/AZURE_SETUP.md`; do not switch to the in-process runtime.

After deployment, open the website, sign in and open **Account**. The deletion button becomes enabled after typing `DELETE` when server configuration is present. If settings remain unavailable, check Function App logs and that migration 002 ran in the database used by `ScorekeeperSql`.

## 5. Rebuild the iPhone app

The website has its new UI, but an already installed native app must be rebuilt to receive it:

```powershell
# From the repository root
cd mobile
npm ci
npx eas-cli build --platform ios --profile preview
```

Install that build as before. It uses the already deployed API; it does not require a development server. After validation, create the App Store build with `--profile production` when ready. Do not run EAS from the repository root.

## 6. Test with a disposable account

Use a new test customer account whose data you are willing to delete; do not use your main account or a tenant administrator.

1. Create a game, add scores and confirm the same account sees them on web and iPhone.
2. Keep a different customer account with a game for comparison.
3. Open **Account**, type `DELETE` and submit. Expect completion and sign-out.
4. In the customer tenant, confirm the test user moved to **Deleted users**. In SQL, confirm that customer's game rows are gone. The different account's games must remain.
5. Confirm the deleted identity cannot sign back in. Creating a new account with the same email should give a new identity and an empty game list.
6. A still-valid old access token must receive HTTP 410 from game endpoints during the deletion-marker period. The account endpoints remain available for idempotent completion/retry while that token is valid.
7. Check public `/privacy` and `/support` without signing in, and confirm both links open inside the iPhone app.

Unit tests cover confirmation, owner restriction, configuration/verification failure, pending requests, retries after identity deletion, and completed-request idempotency. They do not replace this Azure integration test.

## Interrupted deletion and operator recovery

Deletion records a pending request first, blocks scoring for that account, deletes the customer identity through Graph, then atomically removes that customer's SQL games and marks completion. Network, permission or SQL failures leave the request pending. Users can retry from Account while their access token remains valid. Do not tell them it completed until the API confirms it.

Review pending requests promptly, especially after changing permissions or rotating secrets:

```sql
SELECT OwnerId, RequestedAt
FROM dbo.AccountDeletions
WHERE Status = 'pending'
ORDER BY RequestedAt;
```

There is no recurring timer, to avoid keeping the free SQL database active. Pending requests remain durable for operator completion. If Graph failed, correct the permission/secret, then let the customer retry. If the customer can no longer access Account, the operator should verify that the exact local customer identity was deleted in the **customer tenant**, or delete that specific customer there first, then complete its recorded SQL request. Do not restore a pending account merely to let it score again.

Only after verifying/removing that customer identity, copy its exact `OwnerId` from the pending row into this guarded transaction. It contains `tenant-guid:customer-object-guid`. Do not replace the owner predicate with a broad delete.

```sql
SET XACT_ABORT ON;
DECLARE @owner nvarchar(100) = N'PASTE-EXACT-PENDING-OWNER-ID';
DECLARE @key char(64) = CONVERT(char(64), HASHBYTES('SHA2_256', CONVERT(varchar(100), @owner)), 2);
DECLARE @resource nvarchar(255) = N'scorekeeper:' + @key;
DECLARE @result int;
BEGIN TRANSACTION;
EXEC @result = sys.sp_getapplock @Resource=@resource,
    @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=10000;
IF @result < 0 THROW 51000, 'Could not acquire account lock.', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.AccountDeletions
               WHERE OwnerKey=@key AND OwnerId=@owner AND Status='pending')
    THROW 51000, 'Exact pending request not found; nothing was deleted.', 1;
DELETE FROM dbo.Games WHERE OwnerId=@owner;
UPDATE dbo.AccountDeletions SET Status='completed', OwnerId=NULL,
    CompletedAt=SYSDATETIMEOFFSET() WHERE OwnerKey=@key;
COMMIT;
```

Completed markers keep only a one-way account hash and timestamps; raw owner IDs are removed. Completed markers do not expire automatically: delayed offline operations must not recreate an explicitly deleted account. Tokens issued with a lifetime over 24 hours are still rejected independently. With migration 004 installed, completion also removes operation receipts; the minimal hashed deletion block remains. Microsoft Entra's deleted identities may remain recoverable for 30 days, and SQL backup copies expire according to your configured retention. The privacy page discloses these limits. Older browser-local games are separate and are removed by clearing website data.

## App Store links

Use the public privacy URL for App Store Connect's **Privacy Policy URL**, and the support URL for **Support URL**. Account deletion must also be tested in the final native build. Complete App Privacy disclosures based on actual collection (including account identifiers and game/player content); do not claim “no data collected” for a cloud account app.
