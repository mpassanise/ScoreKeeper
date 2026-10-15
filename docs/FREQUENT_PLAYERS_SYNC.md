# Frequent-player sync rollout

1. Apply `backend/migrations/003_frequent_players.sql` as a database administrator. It creates the owner-scoped roster and operation-receipt tables, and grants the existing API identity access.
2. Deploy the API after backend CI passes. `GET /account` must return `profileId`. `POST /players/sync` accepts `{profileId,changes}` and returns `{names}`. An empty changes array downloads the current roster.
3. Merge/publish the web and iPhone changes together with the rest of the release candidate. No new native dependency is required.
4. Test with two devices signed into the same account: add/rename/remove offline on each, reconnect and choose Sync Games. Confirm the lists converge and existing games retain their original names. Repeat with two different accounts and confirm their rosters remain separate.
5. Confirm account deletion removes both tables’ owner rows and clears the deleting device’s account player cache.

Guest names migrate once into the first account used for sync on that device. Guest storage is cleared only after the destination account queue has been durably saved. Each account has its own local cache and pending-change journal. Signed-in edits are saved locally before upload; guest edits remain local until sign-in. Sync Games attempts player sync even if the game request fails, and reports failure if either operation fails. Online edits sync immediately; web reconnect/focus, iPhone foreground and a 30-second active-app retry handle reconnection. Explicit Sync players is also available in Settings. Nothing runs in the iPhone background.

The server serializes profile writes with the existing owner lock and checks deletion state in the same transaction. Operation IDs are remembered in `FrequentPlayerOperations`, so a timed-out upload can be retried without applying it again. Only queued edits are uploaded; downloaded snapshots are never re-added as new edits. Concurrent changes to different names merge; changes to the same name take effect in server arrival order. Concurrent renames to different names can retain both names for the user to resolve. Identity is taken only from the validated token; the supplied profile ID is an assertion checked against that identity, never a routing key. Account deletion also removes operation receipts.

Run `node scripts/test-frequent-players.mjs` and `node scripts/test-frequent-player-sync.mjs`, plus the normal API-client and backend tests. Live Azure SQL and physical iPhone verification are still required before release.
