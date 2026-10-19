# Replay-safe game operation contract — Phase 3, increment 1

Date: 2026-10-19. Status: inactive foundation; SQL adapter, HTTP endpoint and capability discovery are not implemented. Web and iPhone continue their existing online writers. Do not enable an account outbox from this PR.

## Operation identity and command semantics

`shared/game-operation-contract.ts` defines the future wire envelope for both clients. `GameOperationProtocol` strictly parses and validates the same envelope. An operation has protocolVersion 1, kind `action`, a stable operationId, gameId, and a command with an expected server version. The server derives ownership from authenticated context, never from the body. IDs are nonempty UUIDs; the expected version is a positive integer below JavaScript's maximum safe integer so the next version is representable.

| Command | Explicit semantic fields |
| --- | --- |
| score | points, playerId, newly allocated entryId; additive and current-total modes retain their existing meaning |
| edit | points, existing entryId |
| undo | the specific last entryId; reject if it is no longer last |
| select | playerId |
| rules | the existing whitelisted rule edit |
| finish / resume | no extra command fields |

A zero-point additive turn uses `score` with points 0 and its own entry ID. In total mode, preserving a player's total requires sending the current total, rather than interpreting zero as “no change.” These semantics are unchanged. The new coordinator uses the existing scoring engine, with optional stable entry ID and server commit time parameters; legacy calls keep their existing defaults.

Clients allocate an operation ID and score-entry ID once, durably save them with the original payload, and reuse that exact request after restart or a lost acknowledgement. They never change expectedVersion, targets or payload under the same operation ID. Rejected work needs explicit review; a new reviewed command gets a new ID. Automatic conflict merges are outside this contract. Game creation/import/deletion operation envelopes are separate follow-up work and are not covered by an action capability.

## Fingerprint and receipts

The server deserializes into a typed, bounded envelope before any asynchronous transaction work. Unknown JSON properties, duplicate properties, unknown protocol/kind/actions, irrelevant fields and missing targets are rejected. A SHA-256 hash of the typed envelope fixes property order, GUID representation, integer types and absent optional defaults. Semantically equivalent object-key ordering produces the same server hash. Hashes are server-generated; clients do not send them. This is the .NET typed serialization format, not a general JavaScript or RFC 8785 canonicalizer. The shared fixture verifies one exact wire example across C# and client type checks.

Receipts are keyed by authenticated owner plus operation ID. They contain the fingerprint, game ID, optional added-entry ID and an acknowledgement with outcome, committed version, observed version and typed error code. They contain no replacement game snapshot. A historical applied receipt can acknowledge an operation after a later game deletion, but cannot supply a game to resurrect. Subsequent authoritative deletion reconciliation still wins.

Receipts must be retained for the supported lifetime of the account, with no timed expiry that lets old submissions become new operations. Historical successful score-entry IDs remain reserved after undo. A successful command and its receipt commit atomically. Version conflict, not-found, deleted, undo-target-changed, entry-ID-reused and invalid-game-command outcomes also get terminal receipts, so later state changes cannot reinterpret the old request. Authentication, blocked-account, malformed input and transaction/storage failures do not acknowledge a mutation.

## Transaction boundary and SQL integration requirements

`GameOperationService` depends on `IGameOperationStore`. The port is deliberately not registered with the API. An implementation must:

1. Open one SQL transaction and acquire the same authenticated owner lock used by legacy writes and account deletion. Read/write game rows, deletion markers, receipts and entry-ID reservations in that transaction.
2. Check durable account deletion blocking **before** returning an old receipt.
3. Look up an existing receipt before ordinary version checks. Return it for a matching fingerprint; reject changed payload/target reuse of an operation ID.
4. For a new operation, check the game's deletion marker and expected version, explicit command targets, and historical entry-ID use. Apply the existing scoring engine without rebasing.
5. Write the game with a version predicate and the receipt together, including terminal rejection receipts. A write/commit failure must roll everything back. An uncertain commit is recovered by replaying the original operation ID.
6. Return only after commit. Preserve minimal tombstones; absence from the capped list is never a deletion signal. Do not advertise support until actual SQL transaction/replay and old-client compatibility tests pass.

The in-memory transactional fixture exercises coordinator behavior, not Azure SQL durability/locking. Existing `GameStore` has no operation receipts. Its completed-account deletion record expiry is also **not** an acceptable long-term replay barrier; resolve durable minimal account deletion markers and receipt cleanup together before capability activation. Never deploy a capability flag based on interface tests alone.

## Evidence

The existing .NET test runner now includes the actual coordinator tests: repeated/concurrent replay, changed payload ID reuse, stable entry IDs, injected commit times, zero-point turns, current-total scoring, failure between game/receipt writes, post-commit acknowledgement loss, explicit undo targets, entry IDs retained after undo, terminal rejected outcomes, account isolation, game/account deletion and strict wire parsing. A JSON fixture is consumed by C# tests and a TypeScript contract check for both clients. All existing scoring/deletion tests remain required.

```sh
dotnet build backend/Scorekeeper.Api/Scorekeeper.Api.csproj -c Release
dotnet run --project backend/Scorekeeper.Tests/Scorekeeper.Tests.csproj -c Release
node scripts/test-game-operation-contract.mjs
node scripts/test-repository-pilot.mjs
```

## Deployment and next increment

No API/schema deployment is required to activate anything in this PR: there is no active operation route or capability. Publish the merged PR #64 web fixes with its pilot flags still disabled. An iPhone build can wait for device-pilot acceptance; SQLite still requires a binary that includes its native module. No EAS cloud build is requested here.

Next implement the SQL receipt adapter, additive schema and authenticated action endpoint with missing-schema/capability gating, integration tests, persistent deletion barriers and receipt retention. Then add stable creation/import/deletion protocols and deploy the additive API/schema before any dependent client queue. Continue browser/iPhone Phase 2 acceptance independently. Only after those gates should an atomic local outbox and local-first account scoring pilot begin.
