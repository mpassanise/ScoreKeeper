# SQL game operation receipts — Phase 3, increment 2

Status: additive backend implementation; default disabled. Neither web nor iPhone queues account writes. No production migration, API deployment or EAS build is performed by this PR.

## Behavior and compatibility

`GameStore.Operations.cs` implements the existing transactional port with actual SQL connections. Each operation opens one transaction, takes the same owner application lock as legacy saves and account deletion, verifies schema readiness and the account deletion block, then commits state and receipt together. It returns only after commit and never retries an uncertain commit automatically.

Migration `004_game_operation_receipts.sql` adds an immutable receipt table and schema marker without moving or deleting existing games. The receipt primary key is owner hash + operation ID. A filtered unique index reserves successful score-entry IDs by account/game even after undo. Receipts contain fingerprints and acknowledgement metadata, without game snapshots. Repeated migration validates the installed shape/version and preserves existing receipts. Unknown or incomplete schemas fail closed.

The existing API routes keep their paths and scoring behavior. Existing clients ignore the new optional `gameOperations` account field. New clients must require a compatible capability and explicitly inspect each acknowledgement; they must not switch writers merely because the endpoint exists.

## Protocol HTTP surface

- `POST /api/game-operations`: same Entra validation and authenticated owner derivation as existing game handlers. The body is the strict raw v1 action envelope from [the protocol contract](REPLAY_SAFE_GAME_OPERATIONS.md). The body is bounded to 2 MB and invalid UTF-8/unknown fields are rejected.
- HTTP 200 returns an `OperationAcknowledgement`, for either `outcome: applied` **or** `outcome: rejected`. A rejected receipt is terminal and is not a saved score. Clients must check outcome/errorCode, not merely response.ok. Review creates a new operation ID instead of changing the old payload.
- Changed-payload operation-ID reuse: HTTP 409, `OPERATION_ID_REUSED`, with no new acknowledgement.
- Malformed/invalid envelope: HTTP 400; no mutation receipt.
- Missing/invalid credentials: HTTP 401. Account deletion: HTTP 410, `ACCOUNT_DELETION_PENDING`, including when retrying an old accepted operation.
- Disabled flag or missing/unsupported schema: HTTP 503, `OPERATIONS_UNAVAILABLE`. Preserve the original pending operation; never resubmit it under a new ID.
- SQL/transport/commit failures: existing sanitized 503 diagnostics. An uncertain response is not proof of failure. Recovery repeats the identical operation ID and payload.

`GET /api/account` exposes `gameOperations: null` unless `ScorekeeperGameOperationsEnabled` is exactly `true`, schema version 1 is ready, and the account is not deleting. Enabled capability includes version, supported actions, retained receipts and atomic game/receipt commit semantics. Creation/import/deletion operation envelopes remain unsupported; this capability covers actions only. It must not enable a general offline game writer.

## Account deletion and retention

Completed account deletion markers no longer expire automatically. The marker keeps the existing hashed account key, deletion status and timestamps; completion removes its raw owner ID. This permanent minimal block is required to stop delayed replays after receipts are purged. The existing access-token lifetime bound remains independent.

Account completion deletes operation receipts in the same owner-locked transaction as games and frequent-player data, if migration 004 is installed. The conditional delete remains compatible with databases that have not installed 004. Historical receipts have no time-based expiry while the account remains active. Do not add receipt cleanup without a versioned expired-operation policy. The privacy page and account-deletion setup guide describe the minimal retained security record.

## Evidence and limits

The `sql-operations` CI job starts a disposable SQL Server 2022 container. The test executable permits loopback servers only, creates a random test database and SQL login, runs the actual migrations, then runs the production GameStore source as the application database user. It removes the disposable database/login afterward. It does not connect to Azure or use production credentials. Other CI jobs continue existing API, web and mobile checks.

SQL checks cover: missing schema and flag-off gating; migration repetition/unknown-version rejection; persisted receipts across new service instances; independent-connection concurrent replay; changed-payload rejection; a trigger-injected receipt failure rolling back the game; post-commit response loss; legacy/new writer contention; historical entry-ID reservation after undo; account/game isolation; game tombstones; account deletion receipt purge; and completed marker retention past 100 days. The linked-source test project exercises the actual storage implementation without hosting Azure Functions.

This is real SQL Server transaction evidence, not a production Azure SQL or Entra end-to-end acceptance result. Authenticated HTTP/identity-deletion tests and browser/physical-iPhone pilot gates remain open. The local workspace may lack a SQL Server runtime; CI is the required real-database gate.

## Deployment sequence after merge

1. Keep `ScorekeeperGameOperationsEnabled` absent or `false`. Existing web/mobile pilot flags and all offline-write flags remain off. No iPhone build is required for this backend step.
2. As database administrator, run `backend/migrations/004_game_operation_receipts.sql` against the intended Scorekeeper database. Base schema and migrations 002/003 must already be installed. Substitute the managed-identity database user if it is not `scorekeeper-api`. The app receives SELECT/INSERT/DELETE on receipts and SELECT on the schema marker; it does not receive receipt UPDATE or schema DDL rights.
3. Run the existing **Deploy Azure API** workflow from merged `main`, leaving the feature flag off. That workflow does not run SQL migrations. The app can deploy safely before 004 while disabled, but installing 004 first is the preferred order.
4. Verify unauthenticated requests are rejected; sign in and exercise legacy game create/read/score/delete plus account/player sync. Confirm account discovery still returns `gameOperations: null` while disabled. Finish browser/iPhone shadow-cache acceptance separately.
5. Enable the flag only for a deliberate backend test/pilot after all API instances are on the permanent-deletion-marker implementation. Verify capability, identical double submission with one score effect, changed payload rejection, stale-version receipt, and account deletion blocking through authenticated HTTP. Do not enable a client queue yet.
6. Next implement stable creation/import/deletion protocols and the client-side atomic outbox/acknowledgement recovery under their release gates. Deploy compatible API/schema before admitting those clients.

Rollback before queue activation: set the flag false and retain both new tables and all existing data. Disabling removes the advertised capability and rejects new operation calls while legacy clients keep working. After accepting queued clients, do not roll back to an API that expires account deletion markers or removes replay support. Preserve a compatible recovery path for any unknown/pending outcomes. Never clear local storage or delete receipts to repair a connection problem.
