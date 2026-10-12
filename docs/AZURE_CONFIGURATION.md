# Scorekeeper public Azure identifiers

These identifiers were supplied by the owner. App permissions, redirects and the user flow still need verification in Azure. API URL and SQL server/database names remain pending.

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

The examples are prefilled with these public values; they do not activate cloud mode themselves. Do not replace `YOUR-APP` until the Function App's actual default hostname is known. Azure may use a generated/hash-based hostname; copy it from the Function App Overview rather than constructing it from the app name.

See [Azure setup](AZURE_SETUP.md) for the resource and database identity setup. Registration values do not prove the delegated scope, admin consent or user-flow association has been configured.
