using System.Data;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Scorekeeper.Api;
using Scorekeeper.Core;

// Disposable, local SQL Server only. Never run against a production Azure connection.
var configured=Environment.GetEnvironmentVariable("SCOREKEEPER_SQL_TEST_CONNECTION")??throw new InvalidOperationException("Set a local SQL Server test connection.");
var admin=new SqlConnectionStringBuilder(configured);
if(!(admin.DataSource=="localhost"||admin.DataSource.StartsWith("localhost,",StringComparison.Ordinal)||admin.DataSource=="127.0.0.1"||admin.DataSource.StartsWith("127.0.0.1,",StringComparison.Ordinal)))throw new InvalidOperationException("Integration tests require a disposable loopback SQL Server.");
admin.InitialCatalog="master";var suffix=Guid.NewGuid().ToString("N");var database="ScorekeeperTest_"+suffix;var login="ScorekeeperTest_"+suffix;var password="Aa9!"+Guid.NewGuid().ToString("N");var checks=0;
void Check(bool value,string name){if(!value)throw new Exception("SQL integration: "+name);checks++;}
async Task Reject<T>(Func<Task> work)where T:Exception{try{await work();throw new Exception("Expected "+typeof(T).Name);}catch(T){checks++;}}
async Task Sql(string connection,string sql){await using var c=new SqlConnection(connection);await c.OpenAsync();await using var q=c.CreateCommand();q.CommandText=sql;q.CommandTimeout=60;await q.ExecuteNonQueryAsync();}
async Task<long> Count(string connection,string table,string owner){await using var c=new SqlConnection(connection);await c.OpenAsync();await using var q=c.CreateCommand();q.CommandText=$"SELECT COUNT_BIG(*) FROM dbo.{table} WHERE OwnerKey=@owner";q.Parameters.Add("@owner",SqlDbType.Char,64).Value=GameStore.OwnerKey(owner);return (long)(await q.ExecuteScalarAsync())!;}
var dbAdmin=new SqlConnectionStringBuilder(admin.ConnectionString){InitialCatalog=database};
async Task<bool> CleanupWaitingInTrigger(){await using var c=new SqlConnection(dbAdmin.ConnectionString);await c.OpenAsync();await using var q=c.CreateCommand();q.CommandText="SELECT COUNT(*) FROM sys.dm_exec_requests WHERE database_id=DB_ID() AND wait_type='WAITFOR'";return Convert.ToInt32(await q.ExecuteScalarAsync())>0;}
var dbApp=new SqlConnectionStringBuilder(dbAdmin.ConnectionString){UserID=login,Password=password,IntegratedSecurity=false};
GameStore Store(bool enabled=true){Environment.SetEnvironmentVariable("ScorekeeperSql",dbApp.ConnectionString);Environment.SetEnvironmentVariable("ScorekeeperGameOperationsEnabled",enabled?"true":"false");return new(NullLogger<GameStore>.Instance);}
var migrations=new[]{"backend/schema.sql","backend/migrations/002_account_deletion.sql","backend/migrations/003_frequent_players.sql","backend/migrations/004_game_operation_receipts.sql","backend/migrations/005_game_lifecycle_operations.sql"};
// GitHub's SQL container can be starting while the project restores.
for(var attempt=0;;attempt++){try{await Sql(admin.ConnectionString,"SELECT 1");break;}catch(SqlException)when(attempt<30){await Task.Delay(1000);}}
try{
 await Sql(admin.ConnectionString,$"CREATE DATABASE [{database}]; CREATE LOGIN [{login}] WITH PASSWORD='{password}';");
 await Sql(dbAdmin.ConnectionString,$"CREATE USER [scorekeeper-api] FOR LOGIN [{login}];");
 foreach(var file in migrations[..3])await Sql(dbAdmin.ConnectionString,File.ReadAllText(file));
 await Sql(dbAdmin.ConnectionString,"GRANT SELECT,INSERT,UPDATE,DELETE ON dbo.Games TO [scorekeeper-api];");
 var store=Store();var service=new GameOperationService(store);var owner="sql-owner-A";
 var game=Scoring.Create(Guid.NewGuid(),"SQL",["One","Two"],"high");Check(await store.Insert(owner,game),"legacy creation works before migration");
 string Wire(Guid op,Game source,int points=10,Guid? entry=null)=>JsonSerializer.Serialize(new ActionOperation(1,"action",op,source.Id,new(source.Version,"score",points,source.Next,entry??Guid.NewGuid())),GameStore.Json);
 var op=Guid.NewGuid();var entryId=Guid.NewGuid();var wire=Wire(op,game,entry:entryId);
 Check(await store.OperationCapability() is null,"missing schema never advertises capability");await Reject<GameOperationsUnavailableException>(()=>service.Execute(owner,wire));
 await Sql(dbAdmin.ConnectionString,File.ReadAllText(migrations[3]));
 Check(await store.OperationCapability() is null,"schema 004 alone cannot advertise lifecycle support");
 // Seed an actual v1 receipt before upgrading, including a score subsequently undone by a legacy client.
 var priorOwner="sql-prior-v1";var priorGame=game with{Id=Guid.NewGuid()};await store.Insert(priorOwner,priorGame);
 var priorEntry=Guid.NewGuid();var priorOp=Guid.NewGuid();var priorWire=Wire(priorOp,priorGame,entry:priorEntry);
 var priorAck=new OperationAcknowledgement(priorOp,priorGame.Id,"applied",2,1,null);
 var priorHash=GameOperationProtocol.Fingerprint(GameOperationProtocol.Parse(priorWire));
 var scoredPrior=Scoring.Apply(priorGame,new(1,"score",10,priorGame.Next),priorEntry);
 await store.Replace(priorOwner,scoredPrior,1);await store.Replace(priorOwner,Scoring.Apply(scoredPrior,new(2,"undo")),2);
 await Sql(dbAdmin.ConnectionString,$"INSERT dbo.GameOperationReceipts(OwnerKey,OperationId,GameId,Fingerprint,Acknowledgement,AddedEntryId) VALUES('{GameStore.OwnerKey(priorOwner)}','{priorOp}','{priorGame.Id}','{priorHash}',N'{JsonSerializer.Serialize(priorAck,GameStore.Json)}','{priorEntry}')");
 var unicodeOwner="sql-owner-\u00e9-\U0001F3B2";var backfilled=Scoring.Apply(game with{Id=Guid.NewGuid()},new(1,"score",9));await store.Insert(unicodeOwner,backfilled);
 var migrationRaceOwner="sql-migration-delete-race";var migrationRaceGame=Scoring.Apply(Scoring.Create(Guid.NewGuid(),"Migration race",["One","Two"],"high"),new(1,"score",4));await store.Insert(migrationRaceOwner,migrationRaceGame);
 await Sql(dbAdmin.ConnectionString,$"INSERT dbo.FrequentPlayers(OwnerId,State,Updated) VALUES(N'{migrationRaceOwner}',N'[]',SYSDATETIMEOFFSET())");await store.BeginDeletion(migrationRaceOwner);
 await Sql(dbAdmin.ConnectionString,$"CREATE TRIGGER dbo.TestDeletionMigrationRace ON dbo.FrequentPlayers AFTER DELETE AS BEGIN IF EXISTS(SELECT 1 FROM deleted WHERE OwnerId=N'{migrationRaceOwner}') WAITFOR DELAY '00:00:05'; END");
 var cleanupTask=store.CompleteDeletion(migrationRaceOwner);
 var cleanupPaused=false;for(var attempt=0;attempt<100&&!cleanupPaused;attempt++){cleanupPaused=await CleanupWaitingInTrigger();if(!cleanupPaused)await Task.Delay(50);}
 Check(cleanupPaused,"account cleanup reached the migration interleaving point");
 var migrationTask=Sql(dbAdmin.ConnectionString,File.ReadAllText(migrations[4]));await Task.WhenAll(cleanupTask,migrationTask);
 await Sql(dbAdmin.ConnectionString,"DROP TRIGGER dbo.TestDeletionMigrationRace");
 Check(await Count(dbAdmin.ConnectionString,"GameEntryReservations",migrationRaceOwner)==0&&await store.Get(migrationRaceOwner,migrationRaceGame.Id) is null,"schema lock prevents migration backfill from surviving completed account deletion");
 await Sql(dbAdmin.ConnectionString,File.ReadAllText(migrations[4]));
 Check(await Count(dbAdmin.ConnectionString,"GameEntryReservations",unicodeOwner)==1,"migration backfills identifiers with identical UTF-8 owner hash");
 Check(await store.OperationCapability() is not null,"enabled installed lifecycle schema advertises operations");
 Check(priorAck==await service.Execute(priorOwner,priorWire)&&(await store.Get(priorOwner,priorGame.Id))!.Entries.Length==0,"pre-upgrade action receipt still replays after legacy undo without resurrecting score");
 Check(await Count(dbAdmin.ConnectionString,"GameEntryReservations",priorOwner)==1,"migration backfills undone historical receipt entry");
 var off=Store(false);Check(await off.OperationCapability() is null,"flag-off capability remains null after migration");await Reject<GameOperationsUnavailableException>(()=>new GameOperationService(off).Execute(owner,wire));store=Store();service=new(store);
 var first=await service.Execute(owner,wire);var reopened=new GameOperationService(Store());Check(first==await reopened.Execute(owner,wire),"receipt survives fresh store/service instance");
 Check((await store.Get(owner,game.Id))!.Entries.Single().Id==entryId&&await Count(dbAdmin.ConnectionString,"GameOperationReceipts",owner)==1,"stable entry and one durable receipt");
 await Reject<OperationIdReusedException>(()=>service.Execute(owner,Wire(op,game,11,entryId)));
 Check((await store.Get(owner,game.Id))!.Version==2,"changed payload cannot mutate the game");
 await Sql(dbAdmin.ConnectionString,File.ReadAllText(migrations[4]));Check(first==await service.Execute(owner,wire),"repeated migration preserves receipt and acknowledgement");
 var concurrentOwner="sql-concurrent";Check(await store.Insert(concurrentOwner,game),"seed concurrent game");
 var values=await Task.WhenAll(Enumerable.Range(0,8).Select(_=>new GameOperationService(Store()).Execute(concurrentOwner,wire)));
 Check(values.All(value=>value==values[0])&&(await store.Get(concurrentOwner,game.Id))!.Entries.Length==1,"independent SQL connections replay concurrently once");
 var lostOwner="sql-lost";await store.Insert(lostOwner,game);await Reject<IOException>(()=>new GameOperationService(new LostResponse(Store())).Execute(lostOwner,wire));
 var recovered=await new GameOperationService(Store()).Execute(lostOwner,wire);Check(recovered.Outcome=="applied"&&(await store.Get(lostOwner,game.Id))!.Entries.Length==1,"post-commit lost response recovers from SQL receipt");
 var crashOwner="sql-crash";await store.Insert(crashOwner,game);
 await Sql(dbAdmin.ConnectionString,"CREATE TRIGGER dbo.TestReceiptFailure ON dbo.GameOperationReceipts AFTER INSERT AS THROW 51010,'injected receipt failure',1;");
 await Reject<SqlException>(()=>service.Execute(crashOwner,wire));Check((await store.Get(crashOwner,game.Id))!.Version==1&&await Count(dbAdmin.ConnectionString,"GameOperationReceipts",crashOwner)==0,"receipt failure rolls back real SQL game update");
 await Sql(dbAdmin.ConnectionString,"DROP TRIGGER dbo.TestReceiptFailure");await service.Execute(crashOwner,wire);Check((await store.Get(crashOwner,game.Id))!.Version==2,"retry after rollback commits once");
 var legacyOwner="sql-legacy-race";await store.Insert(legacyOwner,game);var legacyGame=Scoring.Apply(game,new(1,"score",7));
 var actionTask=service.Execute(legacyOwner,wire);var legacyTask=store.Replace(legacyOwner,legacyGame,1);await Task.WhenAll(actionTask,legacyTask);
 Check((actionTask.Result.Outcome=="applied")!=legacyTask.Result&&(await store.Get(legacyOwner,game.Id))!.Entries.Length==1,"legacy writer shares owner lock and version check");
 var current=(await store.Get(owner,game.Id))!;await service.Execute(owner,JsonSerializer.Serialize(new ActionOperation(1,"action",Guid.NewGuid(),game.Id,new(current.Version,"undo",EntryId:entryId)),GameStore.Json));
 current=(await store.Get(owner,game.Id))!;var reused=await service.Execute(owner,Wire(Guid.NewGuid(),current,entry:entryId));Check(reused.ErrorCode=="ENTRY_ID_REUSED","entry-ID reservation survives undo in SQL");
 Check(await store.DeleteGame(owner,game.Id,current.Version),"legacy delete succeeds");var deleted=await service.Execute(owner,Wire(Guid.NewGuid(),current));Check(deleted.ErrorCode=="GAME_DELETED"&&await store.Get(owner,game.Id) is null,"game tombstone rejects replay without resurrection");
 var other=await service.Execute("sql-other",wire);Check(other.ErrorCode=="GAME_NOT_FOUND","operation/game scope cannot cross accounts");
 await store.BeginDeletion(lostOwner);await Reject<AccountDeletingException>(()=>service.Execute(lostOwner,wire));await Reject<AccountDeletingException>(()=>store.Insert(lostOwner,game with{Id=Guid.NewGuid()}));
 await store.CompleteDeletion(lostOwner);Check(await Count(dbAdmin.ConnectionString,"GameOperationReceipts",lostOwner)==0,"account completion removes receipts");
 await Sql(dbAdmin.ConnectionString,"UPDATE dbo.AccountDeletions SET CompletedAt=DATEADD(day,-100,SYSDATETIMEOFFSET()) WHERE Status='completed'");Check(await store.DeletionState(lostOwner)=="completed","completed deletion marker does not expire");await Reject<AccountDeletingException>(()=>service.Execute(lostOwner,wire));
 string Life(string kind,Guid id,Game? value,long expected=0,Guid? operation=null)=>JsonSerializer.Serialize(new LifecycleOperation(1,kind,operation??Guid.NewGuid(),id,expected,value),GameStore.Json);
 var lifeOwner="sql-lifecycle";var fresh=game with{Id=Guid.NewGuid()};var create=Life("create",fresh.Id,fresh);
 await Reject<IOException>(()=>new GameOperationService(new LostResponse(Store())).Execute(lifeOwner,create));var created=await service.Execute(lifeOwner,create);
 Check(created.Outcome=="applied"&&created.CommittedVersion==1&&created.ObservedVersion is null&&(await store.Get(lifeOwner,fresh.Id))!.Players.SequenceEqual(fresh.Players),"lost create response preserves stable player and game IDs");
 Check((await service.Execute(lifeOwner,Life("create",fresh.Id,fresh))).ErrorCode=="GAME_ALREADY_EXISTS","new operation never adopts an existing ID");
 var raced=fresh with{Id=Guid.NewGuid()};var races=await Task.WhenAll(Enumerable.Range(0,8).Select(_=>new GameOperationService(Store()).Execute(lifeOwner,Life("create",raced.Id,raced))));
 Check(races.Count(a=>a.Outcome=="applied")==1&&races.Count(a=>a.ErrorCode=="GAME_ALREADY_EXISTS")==7,"different concurrent create operations create exactly one game");
 var history=Scoring.Apply(fresh with{Id=Guid.NewGuid()},new(1,"score",17));var import=Life("import",history.Id,history);
 await Reject<IOException>(()=>new GameOperationService(new LostResponse(Store())).Execute(lifeOwner,import));var importedAck=await service.Execute(lifeOwner,import);var imported=(await store.Get(lifeOwner,history.Id))!;
 Check(imported.Version==1&&imported.Entries.SequenceEqual(history.Entries)&&importedAck.Outcome=="applied","lost import response retains history IDs with server version one");
 Check(await store.Replace(lifeOwner,Scoring.Apply(imported,new(1,"undo")),1),"legacy undo of imported entry");imported=(await store.Get(lifeOwner,history.Id))!;
 Check((await service.Execute(lifeOwner,Wire(Guid.NewGuid(),imported,entry:history.Entries[0].Id))).ErrorCode=="ENTRY_ID_REUSED","import reservation survives legacy undo");
 var deletion=Life("delete",fresh.Id,null,1);
 Check((await service.Execute(lifeOwner,Life("delete",fresh.Id,null,2))).ErrorCode=="VERSION_CONFLICT","stale delete rejected");
 await Sql(dbAdmin.ConnectionString,"CREATE TRIGGER dbo.TestLifecycleFailure ON dbo.GameOperationReceipts AFTER INSERT AS THROW 51010,'injected lifecycle receipt failure',1;");
 await Reject<SqlException>(()=>service.Execute(lifeOwner,deletion));Check(await store.Get(lifeOwner,fresh.Id) is not null,"delete receipt failure rolls back tombstone");
 var rolledBack=fresh with{Id=Guid.NewGuid()};var rolledBackWire=Life("import",rolledBack.Id,Scoring.Apply(rolledBack,new(1,"score",2)));
 var reservationsBefore=await Count(dbAdmin.ConnectionString,"GameEntryReservations",lifeOwner);
 await Reject<SqlException>(()=>service.Execute(lifeOwner,rolledBackWire));Check(await store.Get(lifeOwner,rolledBack.Id) is null&&await Count(dbAdmin.ConnectionString,"GameEntryReservations",lifeOwner)==reservationsBefore,"failed import rolls back game and reservations");
 await Sql(dbAdmin.ConnectionString,"DROP TRIGGER dbo.TestLifecycleFailure");
 await Reject<IOException>(()=>new GameOperationService(new LostResponse(Store())).Execute(lifeOwner,deletion));var removed=await service.Execute(lifeOwner,deletion);
 Check(removed.Outcome=="applied"&&await store.Get(lifeOwner,fresh.Id) is null&&created==await service.Execute(lifeOwner,create),"lost deletion response recovers; old create receipt cannot resurrect game");
 var cancelled=fresh with{Id=Guid.NewGuid()};await service.Execute(lifeOwner,Life("delete",cancelled.Id,null));
 Check((await service.Execute(lifeOwner,Life("import",cancelled.Id,cancelled))).ErrorCode=="GAME_DELETED","tombstone before delayed import prevents resurrection");
 var finished=Scoring.Apply(fresh with{Id=Guid.NewGuid()},new(1,"finish"));await service.Execute(lifeOwner,Life("import",finished.Id,finished));
 Check((await service.Execute(lifeOwner,Life("delete",finished.Id,null,1))).ErrorCode=="GAME_FINISHED","completed games cannot be deleted");
 await Reject<OperationIdReusedException>(()=>service.Execute(lifeOwner,Life("delete",fresh.Id,null,1,created.OperationId)));
 await store.BeginDeletion(lifeOwner);await Reject<AccountDeletingException>(()=>service.Execute(lifeOwner,create));await store.CompleteDeletion(lifeOwner);
 Check(await Count(dbAdmin.ConnectionString,"GameEntryReservations",lifeOwner)==0&&await Count(dbAdmin.ConnectionString,"GameOperationReceipts",lifeOwner)==0,"account deletion purges lifecycle reservations and receipts");
 // Re-running 004 after the version advance must fail, without erasing receipts.
 await Reject<SqlException>(()=>Sql(dbAdmin.ConnectionString,File.ReadAllText(migrations[3])));
 await Sql(dbAdmin.ConnectionString,"UPDATE dbo.GameOperationSchema SET Version=99");Check(await store.OperationCapability() is null,"unknown schema fails closed");await Reject<GameOperationsUnavailableException>(()=>service.Execute(owner,wire));
 await Reject<SqlException>(()=>Sql(dbAdmin.ConnectionString,File.ReadAllText(migrations[4])));await Sql(dbAdmin.ConnectionString,"UPDATE dbo.GameOperationSchema SET Version=2");Check(first==await service.Execute(owner,wire),"failed migration preserves historical receipt");
 // Single-device scoring control is additive and enforced inside the owner transaction.
 await Sql(dbAdmin.ConnectionString,File.ReadAllText("backend/migrations/006_game_scoring_control.sql"));
 await Sql(dbAdmin.ConnectionString,File.ReadAllText("backend/migrations/006_game_scoring_control.sql"));
 var controlStore=Store();var controllerOwner="sql-controller";var deviceA=Guid.NewGuid();var deviceB=Guid.NewGuid();var deviceC=Guid.NewGuid();
 var controlledGame=Scoring.Create(Guid.NewGuid(),"Controlled",["One","Two"],"high");
 var createControl=JsonSerializer.Serialize(new LifecycleOperation(1,"create",Guid.NewGuid(),controlledGame.Id,0,controlledGame),GameStore.Json);
 var serviceA=new GameOperationService(controlStore.ForScoringDevice(deviceA));var serviceB=new GameOperationService(controlStore.ForScoringDevice(deviceB));
 var createdControl=await serviceA.Execute(controllerOwner,createControl);
 Check(createdControl.Outcome=="applied"&&(await controlStore.ScoringControl(controllerOwner,controlledGame.Id,deviceA))!.CanScore,"creator has scoring control");
 Check(!(await controlStore.ScoringControl(controllerOwner,controlledGame.Id,deviceB))!.CanScore,"other device is read-only");
 var movedControl=await controlStore.ScoringControl(controllerOwner,controlledGame.Id,deviceB,1);
 Check(movedControl is {CanScore:true,Epoch:2},"takeover moves control");
 Check((await controlStore.Get(controllerOwner,controlledGame.Id))!.Version==1,"takeover does not mutate game revision or scoring");
 await Reject<ScoringElsewhereException>(()=>serviceA.Execute(controllerOwner,Wire(Guid.NewGuid(),controlledGame)));
 Check(await Count(dbApp.ConnectionString,"GameOperationReceipts",controllerOwner)==1,"blocked writer creates no terminal rejection receipt");
 var scoredControl=await serviceB.Execute(controllerOwner,Wire(Guid.NewGuid(),controlledGame));Check(scoredControl.Outcome=="applied","new device scores");
 Check(await serviceA.Execute(controllerOwner,createControl)==createdControl,"lost acknowledgement retries retain original receipt after takeover");
 await Reject<ScoringElsewhereException>(()=>controlStore.Replace(controllerOwner,controlledGame with{Version=3},2));
 await Reject<ScoringElsewhereException>(()=>controlStore.DeleteGame(controllerOwner,controlledGame.Id,2));
 await Reject<ScoringControlChangedException>(()=>controlStore.ScoringControl(controllerOwner,controlledGame.Id,deviceA,1));
 var takenBack=await controlStore.ScoringControl(controllerOwner,controlledGame.Id,deviceA,2);
 Check(takenBack is {CanScore:true,Epoch:3}&&(await controlStore.ScoringControl(controllerOwner,controlledGame.Id,deviceA,2))!.Epoch==3,"lost takeover reply is idempotent");
 async Task<bool> RaceClaim(Guid device){try{await controlStore.ScoringControl(controllerOwner,controlledGame.Id,device,3);return true;}catch(ScoringControlChangedException){return false;}}
 var claims=await Task.WhenAll(RaceClaim(deviceB),RaceClaim(deviceC));Check(claims.Count(x=>x)==1,"concurrent takeovers choose only one device");
 Check(await controlStore.ScoringControl("another-account",controlledGame.Id,deviceA,0) is null,"other account cannot read or claim control");
 Check(await controlStore.ScoringControl(controllerOwner,Guid.NewGuid(),deviceA,0) is null,"claim cannot create or resurrect a missing game");
 await controlStore.BeginDeletion(controllerOwner);await Reject<AccountDeletingException>(()=>controlStore.ScoringControl(controllerOwner,controlledGame.Id,deviceA,4));await controlStore.CompleteDeletion(controllerOwner);Check(await Count(dbApp.ConnectionString,"GameScoringControl",controllerOwner)==0,"account deletion removes device-control rows");
 var unclaimed=Scoring.Create(Guid.NewGuid(),"Old client",["One","Two"],"high");Check(await controlStore.Insert("sql-unclaimed",unclaimed),"legacy creation remains unclaimed");Check((await new GameOperationService(controlStore).Execute("sql-unclaimed",Wire(Guid.NewGuid(),unclaimed))).Outcome=="applied","legacy scoring remains unchanged before claim");
 Console.WriteLine($"{checks} real SQL operation integration checks passed using the application database user.");
}finally{
 SqlConnection.ClearAllPools();await Sql(admin.ConnectionString,$"IF DB_ID('{database}') IS NOT NULL BEGIN ALTER DATABASE [{database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{database}]; END; IF EXISTS(SELECT 1 FROM sys.sql_logins WHERE name='{login}') DROP LOGIN [{login}];");
}
sealed class LostResponse(IGameOperationStore store):IGameOperationStore
{
 public async Task<T> Transaction<T>(string owner,Func<IGameOperationTransaction,Task<T>> work){await store.Transaction(owner,work);throw new IOException("response lost after SQL commit");}
}
