# Scorekeeper public Azure identifiers

These identifiers were supplied by the owner. App permissions, redirects and the user flow still need verification in Azure. The resource names below were also supplied by the owner; deployment and connectivity remain unverified.

| Setting | Value |
|---|---|
| External tenant ID | `e8d1bba5-f80e-44fa-a71c-824ff6312d31` |
| Primary domain | `scorekeeperappcustomers.onmicrosoft.com` |
| Authority | `https://scorekeeperappcustomers.ciamlogin.com/e8d1bba5-f80e-44fa-a71c-824ff6312d31/v2.0` |
| Web client ID | `ec497d57-b98f-4a49-a5aa-c90bdb6f9562` |
| Mobile client ID | `7202edc2-fec5-4a71-b5f7-77fd49d42bb4` |
| API client ID / AuthAudience | `c6f1573d-1e0c-4830-abed-a71b47d49cc8` |
| Delegated scope (confirm exposed in Azure) | `api://c6f1573d-1e0c-4830-abed-a71b47d49cc8/Scorekeeper.Access` |

The `.onmicrosoft.com` value is the tenant's primary domain. Use `.ciamlogin.com` for customer sign-in. Do not move the Azure subscription into the customer tenant: host Functions and SQL in the existing subscription directory.

The examples are prefilled with these public values; they do not activate cloud mode themselves. The API examples now use the actual default hostname supplied from Azure.

See [Azure setup](AZURE_SETUP.md) for the resource and database identity setup. Registration values do not prove the delegated scope, admin consent or user-flow association has been configured.

## Hosted resources

| Resource | Value |
|---|---|
| Function App | `scorekeeper-api` |
| API base URL | `https://scorekeeper-api-dkdggvajgjgea7g6.westus3-01.azurewebsites.net/api` |
| SQL server | `scorekeeperapp.database.windows.net` |
| Database | `free-sql-db-4371450` |

`scorekeeperapp/free-sql-db-4371450` is the server/database resource label. Use only `free-sql-db-4371450` for the connection string's Database value.

The owner reports the SQL free offer is applied. Keep the free-limit behavior set to auto-pause until next month. `backend/azure.appsettings.example.json` contains the app-owned settings to add; preserve existing Function runtime/storage settings. Enable the Function's system-assigned identity and grant it SQL access before using the managed-identity connection.
