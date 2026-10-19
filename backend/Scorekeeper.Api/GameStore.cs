using System.Text.Json;
using System.Diagnostics;
using Microsoft.Extensions.Logging;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.SqlClient;
using Scorekeeper.Core;
namespace Scorekeeper.Api;
public sealed class AccountDeletingException : Exception;
public sealed partial class GameStore(ILogger<GameStore> logger) : IAccountDeletionStore
{
 public static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
 readonly string connectionString=Environment.GetEnvironmentVariable("ScorekeeperSql") is {Length:>0} value?value:throw new InvalidOperationException("Missing setting ScorekeeperSql.");
 public static string OwnerKey(string owner)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(owner)));
 async Task<SqlConnection> Connect(){
  var elapsed=Stopwatch.StartNew();var c=new SqlConnection(connectionString);
  try{await c.OpenAsync();logger.LogInformation("Scorekeeper database connection opened in {ElapsedMs} ms",elapsed.ElapsedMilliseconds);return c;}
  catch(Exception e){logger.LogError(e,"Scorekeeper database connection failed after {ElapsedMs} ms",elapsed.ElapsedMilliseconds);await c.DisposeAsync();throw;}
 }
 public Task<string?> DeletionState(string owner)=>Measure("account-deletion-status",async()=>
 {
  await using var c=await Connect();await using var q=c.CreateCommand();
  q.CommandText="SELECT Status FROM dbo.AccountDeletions WHERE OwnerKey=@key";q.Parameters.AddWithValue("@key",OwnerKey(owner));
  return await q.ExecuteScalarAsync() as string;
 });
 static async Task LockOwner(SqlConnection c,SqlTransaction tx,string owner)
 {
  await using var q=c.CreateCommand();q.Transaction=tx;
  q.CommandText="DECLARE @result int; EXEC @result=sys.sp_getapplock @Resource=@key,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; IF @result<0 THROW 51000,'Account is busy; retry after refreshing.',1;";q.Parameters.AddWithValue("@key","scorekeeper:"+OwnerKey(owner));await q.ExecuteNonQueryAsync();
 }
 static async Task LockOperationsSchema(SqlConnection c,SqlTransaction tx)
 {
  await using var q=c.CreateCommand();q.Transaction=tx;
  q.CommandText="DECLARE @result int; EXEC @result=sys.sp_getapplock @Resource='scorekeeper:operations-schema',@LockMode='Shared',@LockOwner='Transaction',@LockTimeout=10000; IF @result<0 THROW 51001,'Operation schema is busy; retry after refreshing.',1;";await q.ExecuteNonQueryAsync();
 }
 static async Task Guard(SqlConnection c,SqlTransaction tx,string owner)
 {
  await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="SELECT 1 FROM dbo.AccountDeletions WHERE OwnerKey=@key";q.Parameters.AddWithValue("@key",OwnerKey(owner));if(await q.ExecuteScalarAsync() is not null)throw new AccountDeletingException();
 }
 public async Task BeginDeletion(string owner)
 {
  await using var c=await Connect();await using var tx=(SqlTransaction)await c.BeginTransactionAsync();await LockOwner(c,tx,owner);
  await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="IF NOT EXISTS(SELECT 1 FROM dbo.AccountDeletions WHERE OwnerKey=@key) INSERT dbo.AccountDeletions(OwnerKey,OwnerId,Status,RequestedAt) VALUES(@key,@owner,'pending',SYSDATETIMEOFFSET())";q.Parameters.AddWithValue("@key",OwnerKey(owner));q.Parameters.AddWithValue("@owner",owner);await q.ExecuteNonQueryAsync();await tx.CommitAsync();
 }
 public async Task CompleteDeletion(string owner)
 {
  await using var c=await Connect();await using var tx=(SqlTransaction)await c.BeginTransactionAsync();await LockOwner(c,tx,owner);await LockOperationsSchema(c,tx);
  await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="IF OBJECT_ID('dbo.GameEntryReservations','U') IS NOT NULL EXEC sys.sp_executesql N'DELETE FROM dbo.GameEntryReservations WHERE OwnerKey=@key',N'@key char(64)',@key; IF OBJECT_ID('dbo.GameOperationReceipts','U') IS NOT NULL EXEC sys.sp_executesql N'DELETE FROM dbo.GameOperationReceipts WHERE OwnerKey=@key',N'@key char(64)',@key; DELETE FROM dbo.FrequentPlayerOperations WHERE OwnerId=@owner; DELETE FROM dbo.FrequentPlayers WHERE OwnerId=@owner; DELETE FROM dbo.Games WHERE OwnerId=@owner; UPDATE dbo.AccountDeletions SET Status='completed',OwnerId=NULL,CompletedAt=COALESCE(CompletedAt,SYSDATETIMEOFFSET()) WHERE OwnerKey=@key";q.Parameters.AddWithValue("@key",OwnerKey(owner));q.Parameters.AddWithValue("@owner",owner);await q.ExecuteNonQueryAsync();await tx.CommitAsync();
 }
 public async Task<Game?> Get(string owner,Guid id)
 {
  await using var c=await Connect();await using var q=c.CreateCommand();q.CommandText="SELECT State FROM dbo.Games WHERE OwnerId=@owner AND GameId=@id";q.Parameters.AddWithValue("@owner",owner);q.Parameters.AddWithValue("@id",id);
  if(await q.ExecuteScalarAsync() is not string state)return null;
  using var document=JsonDocument.Parse(state);if(document.RootElement.TryGetProperty("deleted",out var deleted)&&deleted.ValueKind==JsonValueKind.True)return null;
  return JsonSerializer.Deserialize<Game>(state,Json);
 }
 public Task<object[]> List(string owner)=>Measure("list-games",async()=>
 {
  await using var c=await Connect();await using var q=c.CreateCommand();q.CommandText="SELECT TOP (200) State FROM dbo.Games WHERE OwnerId=@owner AND COALESCE(JSON_VALUE(State,'$.deleted'),'false')<>'true' ORDER BY Updated DESC";q.Parameters.AddWithValue("@owner",owner);
  await using var r=await q.ExecuteReaderAsync();var games=new List<object>();while(await r.ReadAsync()){var g=JsonSerializer.Deserialize<Game>(r.GetString(0),Json)!;games.Add(new{g.Id,g.Name,g.Players,g.Winner,g.PlayStyle,g.ScoreMode,g.PresetId,g.PresetVersion,g.EndCondition,g.RoundLimit,g.TargetScore,g.TargetEnd,g.Finished,g.Version,g.Updated,g.StartedAt,g.EndedAt,TurnCount=g.Entries.Length});}return games.ToArray();
 });
 public async Task<bool> Insert(string owner,Game g)
 {
  await using var c=await Connect();await using var tx=(SqlTransaction)await c.BeginTransactionAsync();await LockOwner(c,tx,owner);await Guard(c,tx,owner);
  await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="INSERT INTO dbo.Games(OwnerId,GameId,Version,Updated,State) VALUES(@owner,@id,@version,@updated,@state)";Parameters(q,owner,g);
  try{await q.ExecuteNonQueryAsync();await ReserveEntries(c,tx,owner,g.Id);await tx.CommitAsync();return true;}catch(SqlException e)when(e.Number is 2601 or 2627){return false;}
 }
 // Retain only a deletion marker. The primary key prevents an old device's
 // import from recreating this game; names, players and scores are removed.
 public async Task<bool> DeleteGame(string owner,Guid id,long expected)
 {
  await using var c=await Connect();await using var tx=(SqlTransaction)await c.BeginTransactionAsync();await LockOwner(c,tx,owner);await Guard(c,tx,owner);
  await ReserveEntries(c,tx,owner,id);
  await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="UPDATE dbo.Games SET State=@state,Version=Version+1,Updated=SYSDATETIMEOFFSET() WHERE OwnerId=@owner AND GameId=@id AND Version=@expected AND COALESCE(JSON_VALUE(State,'$.deleted'),'false')<>'true' AND JSON_VALUE(State,'$.finished')='false'";
  q.Parameters.AddWithValue("@owner",owner);q.Parameters.AddWithValue("@id",id);q.Parameters.AddWithValue("@expected",expected);q.Parameters.AddWithValue("@state",JsonSerializer.Serialize(new{deleted=true},Json));var changed=await q.ExecuteNonQueryAsync()==1;await tx.CommitAsync();return changed;
 }
 public async Task<bool> Replace(string owner,Game g,long expected)
 {
  await using var c=await Connect();await using var tx=(SqlTransaction)await c.BeginTransactionAsync();await LockOwner(c,tx,owner);await Guard(c,tx,owner);
  await ReserveEntries(c,tx,owner,g.Id);
  await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="UPDATE dbo.Games SET State=@state,Version=@version,Updated=@updated WHERE OwnerId=@owner AND GameId=@id AND Version=@expected";Parameters(q,owner,g);q.Parameters.AddWithValue("@expected",expected);var changed=await q.ExecuteNonQueryAsync()==1;await ReserveEntries(c,tx,owner,g.Id);await tx.CommitAsync();return changed;
 }
 public async Task<string[]> SyncPlayers(string owner,FrequentPlayerChange[] changes)
 {
  if(changes is null||changes.Length>100||changes.Any(op=>op is null))throw new ArgumentException("Send up to 100 player changes at a time.");
  await using var c=await Connect();await using var tx=(SqlTransaction)await c.BeginTransactionAsync();await LockOwner(c,tx,owner);await Guard(c,tx,owner);
  await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="SELECT State FROM dbo.FrequentPlayers WHERE OwnerId=@owner";q.Parameters.AddWithValue("@owner",owner);
  var state=await q.ExecuteScalarAsync() as string;var names=state is null?Array.Empty<string>():JsonSerializer.Deserialize<string[]>(state,Json)!;
  foreach(var op in changes){
   await using var check=c.CreateCommand();check.Transaction=tx;check.CommandText="SELECT 1 FROM dbo.FrequentPlayerOperations WHERE OwnerId=@owner AND OperationId=@id";check.Parameters.AddWithValue("@owner",owner);check.Parameters.AddWithValue("@id",op.Id);
   if(await check.ExecuteScalarAsync() is not null)continue;
   names=FrequentPlayers.Apply(names,op);
   check.CommandText="INSERT dbo.FrequentPlayerOperations(OwnerId,OperationId,AppliedAt) VALUES(@owner,@id,SYSDATETIMEOFFSET())";await check.ExecuteNonQueryAsync();
  }
  if(names.Length>500)throw new ArgumentException("Too many saved players. Remove unused names, then sync again.");
  q.CommandText="UPDATE dbo.FrequentPlayers SET State=@state,Updated=SYSDATETIMEOFFSET() WHERE OwnerId=@owner; IF @@ROWCOUNT=0 INSERT dbo.FrequentPlayers(OwnerId,State,Updated) VALUES(@owner,@state,SYSDATETIMEOFFSET())";q.Parameters.AddWithValue("@state",JsonSerializer.Serialize(names,Json));await q.ExecuteNonQueryAsync();await tx.CommitAsync();return names;
 }
 async Task<T> Measure<T>(string operation,Func<Task<T>> work){
  var elapsed=Stopwatch.StartNew();
  logger.LogInformation("Scorekeeper SQL operation {SqlOperation} started",operation);
  try{var result=await work();logger.LogInformation("Scorekeeper SQL operation {SqlOperation} succeeded after {ElapsedMs} ms",operation,elapsed.ElapsedMilliseconds);return result;}
  catch(Exception e){logger.LogError(e,"Scorekeeper SQL operation {SqlOperation} failed after {ElapsedMs} ms; SqlNumber {SqlNumber}",operation,elapsed.ElapsedMilliseconds,(e as SqlException)?.Number);throw;}
 }
 // Conditional dynamic SQL preserves legacy deployment compatibility before migration 005.
 static async Task ReserveEntries(SqlConnection c,SqlTransaction tx,string owner,Guid gameId)
 {
  await using var q=c.CreateCommand();q.Transaction=tx;
  q.CommandText="""
   IF OBJECT_ID('dbo.GameEntryReservations','U') IS NOT NULL
   EXEC sys.sp_executesql N'INSERT dbo.GameEntryReservations(OwnerKey,GameId,EntryId)
    SELECT DISTINCT @key,@id,e.EntryId FROM dbo.Games g CROSS APPLY OPENJSON(g.State,''$.entries'') WITH(EntryId uniqueidentifier ''$.id'') e
    WHERE g.OwnerId=@owner AND g.GameId=@id AND e.EntryId IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM dbo.GameEntryReservations r WHERE r.OwnerKey=@key AND r.GameId=@id AND r.EntryId=e.EntryId)',
    N'@key char(64),@owner nvarchar(100),@id uniqueidentifier',@key,@owner,@id;
   """;
  q.Parameters.AddWithValue("@key",OwnerKey(owner));q.Parameters.AddWithValue("@owner",owner);q.Parameters.AddWithValue("@id",gameId);await q.ExecuteNonQueryAsync();
 }
 static void Parameters(SqlCommand q,string owner,Game g){q.Parameters.AddWithValue("@owner",owner);q.Parameters.AddWithValue("@id",g.Id);q.Parameters.AddWithValue("@version",g.Version);q.Parameters.AddWithValue("@updated",g.Updated);q.Parameters.AddWithValue("@state",JsonSerializer.Serialize(g,Json));}
}
