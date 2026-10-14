# Account connection timeouts

## Confirmed client defect

Both clients used shared/api.ts with one eight-second timer covering token acquisition, HTTP, and reading the response body. The configured SQL connection timeout is 30 seconds. The client could therefore abort before a legitimate connection attempt completed. A displayed signed-in email does not prove a usable access token or database connection.

The corrected client gives token acquisition its own 30-second budget and each API attempt 30 seconds. GET requests retry up to twice after a request timeout or a backend-classified transient SQL failure, with one- and two-second delays (at most 93 seconds of API work, plus token acquisition). POST requests are never automatically retried. A timed-out mutation requires refreshing before retrying because the server might have committed it.

This corrects premature failure; it does not establish why production was slow. Azure SQL serverless resume is a hypothesis until dependency logs or database state confirm it. Do not disable free-limit auto-pause or change the pricing tier as a diagnostic shortcut.

## Production evidence

In the Function App's Application Insights resource, open Logs and run these queries immediately after reproducing a signed-in failure. Paste results without access tokens, connection strings or user identifiers.

```kusto
requests
| where timestamp > ago(30m)
| where url has "/api/games" or url has "/api/account"
| project timestamp, name, resultCode, duration, success, operation_Id
| order by timestamp desc
```

```kusto
dependencies
| where timestamp > ago(30m)
| project timestamp, type, target, name, resultCode, duration, success, operation_Id
| order by timestamp desc
```

```kusto
exceptions
| where timestamp > ago(30m)
| project timestamp, type, outerMessage, innermostMessage, operation_Id
| order by timestamp desc
```

With the diagnostic API deployed, this query distinguishes token-validation time, SQL connection time, and later handler failures. RequestId is also included in backend error responses so support can correlate them.

```kusto
traces
| where timestamp > ago(30m)
| where message startswith "Scorekeeper"
| project timestamp, message, customDimensions, operation_Id
| order by timestamp desc
```

Interpret SQL error numbers: 40613 can indicate a database resuming/unavailable; -2 is a timeout, not proof of resume; 18456/229 indicate login/permission problems; 208 can indicate missing schema. Other errors require inspecting the actual exception. Correlate the operation_Id across tables. No request row may indicate a browser CORS/network issue, wrong hostname, token acquisition delay, or telemetry configuration/sampling, rather than SQL.

An anonymous /api/games 401 only verifies the HTTP route and rejection of anonymous requests. It never opens the authenticated SQL path and is not an end-to-end health check.

## Rollout and verification

1. Merge the GitHub fix and run Deploy Azure API from main to enable diagnostics and classify database failures.
2. The Sites web version uses the corrected shared client after publication. Hard-refresh the web page.
3. Run Build iPhone for TestFlight from main and install the new build.
4. Reproduce after idle, then immediately repeat. Compare request and SQL dependency times. Confirm listing, opening and scoring a game, then refresh from the other client.
5. If either fails, collect the queries above and the displayed reference. Fix the measured Azure issue rather than extending retries indefinitely.

Reference: https://learn.microsoft.com/en-us/azure/azure-sql/database/serverless-tier-auto-pause-resume
