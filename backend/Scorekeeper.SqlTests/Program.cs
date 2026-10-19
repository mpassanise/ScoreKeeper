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
var dbApp=new SqlConnectionStringBuilder(dbAdmin.ConnectionString){UserID=login,Password=password,IntegratedSecurity=false};
GameStore Store(bool enabled=true){Environment.SetEnvironmentVariable("ScorekeeperSql",dbApp.ConnectionString);Environment.SetEnvironmentVariable("ScorekeeperGameOperationsEnabled",enabled?"true":"false");return new(NullLogger<GameStore>.Instance);}
var migrations=new[]{"backend/schema.sql","backend/migrations/002_account_deletion.sql","backend/migrations/003_frequent_players.sql","backend/migrations/004_game_operation_receipts.sql"};
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
 Check(await store.OperationCapability() is not null,"enabled installed schema advertises actions");
 var off=Store(false);Check(await off.OperationCapability() is null,"flag-off capability remains null after migration");await Reject<GameOperationsUnavailableException>(()=>new GameOperationService(off).Execute(owner,wire));store=Store();service=new(store);
 var first=await service.Execute(owner,wire);var reopened=new GameOperationService(Store());Check(first==await reopened.Execute(owner,wire),"receipt survives fresh store/service instance");
 Check((await store.Get(owner,game.Id))!.Entries.Single().Id==entryId&&await Count(dbAdmin.ConnectionString,"GameOperationReceipts",owner)==1,"stable entry and one durable receipt");
 await Reject<OperationIdReusedException>(()=>service.Execute(owner,Wire(op,game,11,entryId)));
 Check((await store.Get(owner,game.Id))!.Version==2,"changed payload cannot mutate the game");
 await Sql(dbAdmin.ConnectionString,File.ReadAllText(migrations[3]));Check(first==await service.Execute(owner,wire),"repeated migration preserves receipt and acknowledgement");
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
 await Sql(dbAdmin.ConnectionString,"UPDATE dbo.GameOperationSchema SET Version=99");Check(await store.OperationCapability() is null,"unknown schema fails closed");await Reject<GameOperationsUnavailableException>(()=>service.Execute(owner,wire));
 await Reject<SqlException>(()=>Sql(dbAdmin.ConnectionString,File.ReadAllText(migrations[3])));await Sql(dbAdmin.ConnectionString,"UPDATE dbo.GameOperationSchema SET Version=1");Check(first==await service.Execute(owner,wire),"failed migration preserves historical receipt");
 Console.WriteLine($"{checks} real SQL operation integration checks passed using the application database user.");
}finally{
 SqlConnection.ClearAllPools();await Sql(admin.ConnectionString,$"IF DB_ID('{database}') IS NOT NULL BEGIN ALTER DATABASE [{database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{database}]; END; IF EXISTS(SELECT 1 FROM sys.sql_logins WHERE name='{login}') DROP LOGIN [{login}];");
}
sealed class LostResponse(IGameOperationStore store):IGameOperationStore
{
 public async Task<T> Transaction<T>(string owner,Func<IGameOperationTransaction,Task<T>> work){await store.Transaction(owner,work);throw new IOException("response lost after SQL commit");}
}
