# Deploy Azure API from GitHub

The **Deploy Azure API** action runs manually from `main`. It builds the .NET 10 API, runs the scoring/account-deletion tests, publishes and validates the package, then deploys the exact package to the existing Function App. It checks that `/api/account` rejects an anonymous request with HTTP 401.

Build and deployment are separate jobs. Only the deployment job can request a GitHub OIDC token. Concurrent production deployments are serialized. The artifact is retained for seven days.

The action does not create or replace your Function App, apply database migrations, or edit application settings. Existing SQL access, runtime secrets, CORS, and authentication configuration stay in Azure. The Functions action detects the hosting plan with OIDC, including Flex Consumption. No publish profile or Azure client secret is stored in GitHub.

## One-time Azure setup

1. In the Azure portal, create a **user-assigned managed identity** named `scorekeeper-github-deploy` in the subscription that hosts `scorekeeper-api`. Use your existing resource group.
2. Open the existing **scorekeeper-api Function App > Access control (IAM) > Add role assignment**. Assign **Website Contributor** to the new deployment identity, scoped to this Function App. Do not grant subscription-wide Contributor. Keep the Function App's existing managed identity for SQL access unchanged; this new identity is for deployment only.
3. Open the new identity's **Federated credentials > Add credential**. Select the GitHub Actions scenario and configure:

| Field | Value |
|---|---|
| GitHub organization/owner | `mpassanise` |
| Repository | `ScoreKeeper` |
| Entity type | Branch |
| Branch | `main` |
| Issuer | `https://token.actions.githubusercontent.com` |
| Subject | `repo:mpassanise/ScoreKeeper:ref:refs/heads/main` |
| Audience | `api://AzureADTokenExchange` |

4. Copy the new identity's Client ID, Directory/Tenant ID, and Subscription ID from Azure. This tenant is the tenant that owns your Azure subscription, not necessarily the separate customer sign-in tenant used by Scorekeeper.

## GitHub configuration

In https://github.com/mpassanise/ScoreKeeper/settings/variables/actions, create these **repository variables**:

| Variable | Value |
|---|---|
| `AZURE_CLIENT_ID` | Client ID of the new deployment managed identity |
| `AZURE_TENANT_ID` | Tenant/directory ID that owns the Azure subscription |
| `AZURE_SUBSCRIPTION_ID` | Subscription containing the Function App |
| `AZURE_RESOURCE_GROUP` | Existing resource group containing `scorekeeper-api` |
| `AZURE_FUNCTIONAPP_NAME` | Optional; defaults to `scorekeeper-api` |

These identifiers are not passwords. Authentication uses short-lived GitHub OIDC tokens and the trust/role assignment configured in Azure.

## Run and verify

After merging the workflow, open https://github.com/mpassanise/ScoreKeeper/actions, select **Deploy Azure API**, choose **Run workflow**, and select **main**.

The action stops before deployment if the build or tests fail. After deployment, it retries the anonymous authentication check while the app starts. Check the run summary for the API URL.

The HTTP 401 check verifies the route is running and anonymous access is rejected; it does not prove database connectivity or every signed-in operation. Confirm a signed-in game can be opened, scored, edited, and synced after a release.

If deployment succeeds but the smoke check fails, inspect the deployed app before retrying: the new package may already be live. Authentication failure during `azure/login` usually means a wrong tenant/client ID or mismatched federated subject; HTTP 403 during deployment usually means the Website Contributor role is missing or hasn't propagated.

This workflow is independent of **Build iPhone for TestFlight**. Deploy API changes first, then build/upload the iPhone update. Running either action does not run the other.

References: https://learn.microsoft.com/en-us/azure/azure-functions/functions-how-to-github-actions and https://github.com/Azure/functions-action
