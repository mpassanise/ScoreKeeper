using System.Data;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using Scorekeeper.Core;
namespace Scorekeeper.Api;
public sealed class GameOperationsUnavailableException():Exception("Replay-safe game actions are not enabled for this service.");
public sealed partial class GameStore:IGameOperationStore
{
 readonly bool gameOperationsEnabled=Environment.GetEnvironmentVariable("ScorekeeperGameOperationsEnabled")=="true";
 // Readiness is checked on every operation; an environment flag alone never grants support.
 const string ReadySql="""
 IF OBJECT_ID('dbo.GameOperationSchema','U') IS NULL OR OBJECT_ID('dbo.GameOperationReceipts','U') IS NULL OR OBJECT_ID('dbo.GameEntryReservations','U') IS NULL
  SELECT 0;
 ELSE IF ISNULL(COL_LENGTH('dbo.GameOperationSchema','Version'),0)<>4
  OR ISNULL(COL_LENGTH('dbo.GameOperationReceipts','OwnerKey'),0)<>64
  OR ISNULL(COL_LENGTH('dbo.GameOperationReceipts','OperationId'),0)<>16
  OR ISNULL(COL_LENGTH('dbo.GameOperationReceipts','GameId'),0)<>16
  OR ISNULL(COL_LENGTH('dbo.GameOperationReceipts','Fingerprint'),0)<>64
  OR ISNULL(COL_LENGTH('dbo.GameOperationReceipts','Acknowledgement'),0)<>4000
  OR ISNULL(COL_LENGTH('dbo.GameOperationReceipts','AddedEntryId'),0)<>16
  OR ISNULL(COL_LENGTH('dbo.GameEntryReservations','OwnerKey'),0)<>64
  OR ISNULL(COL_LENGTH('dbo.GameEntryReservations','GameId'),0)<>16
  OR ISNULL(COL_LENGTH('dbo.GameEntryReservations','EntryId'),0)<>16
  SELECT 0;
 ELSE EXEC(N'SELECT CASE WHEN EXISTS(SELECT 1 FROM dbo.GameOperationSchema WHERE Version=2)
  AND NOT EXISTS(SELECT 1 FROM dbo.GameOperationSchema WHERE Version<>2)
  AND EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(''dbo.GameOperationReceipts'') AND name=''PK_GameOperationReceipts'' AND is_primary_key=1 AND is_disabled=0)
  AND EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(''dbo.GameOperationReceipts'') AND name=''UX_GameOperationReceipts_Entry'' AND is_unique=1 AND has_filter=1 AND is_disabled=0)
  AND EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(''dbo.GameEntryReservations'') AND name=''PK_GameEntryReservations'' AND is_primary_key=1 AND is_disabled=0)
  THEN 1 ELSE 0 END');
 """;
 static async Task<bool> OperationsReady(SqlConnection c,SqlTransaction? tx=null)
 {
  await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText=ReadySql;
  try{return Convert.ToInt32(await q.ExecuteScalarAsync())==1;}
  catch(SqlException e)when(e.Number is 207 or 208 or 229){return false;}
 }
 public async Task<object?> OperationCapability()
 {
  if(!gameOperationsEnabled)return null;
  await using var c=await Connect();if(!await OperationsReady(c))return null;
  return new{Version=1,Kinds=new[]{"action","create","import","delete"},Actions=new[]{"score","edit","undo","select","rules","finish","resume"},Receipts="retained",AtomicGameAndReceipt=true};
 }
 public Task<T> Transaction<T>(string authenticatedOwner,Func<IGameOperationTransaction,Task<T>> work)=>TransactionWithDevice(authenticatedOwner,null,work);
 async Task<T> TransactionWithDevice<T>(string authenticatedOwner,Guid? device,Func<IGameOperationTransaction,Task<T>> work)
 {
  if(string.IsNullOrWhiteSpace(authenticatedOwner))throw new UnauthorizedAccessException();
  if(!gameOperationsEnabled)throw new GameOperationsUnavailableException();
  await using var c=await Connect();await using var tx=(SqlTransaction)await c.BeginTransactionAsync();
  await LockOwner(c,tx,authenticatedOwner);
  if(!await OperationsReady(c,tx))throw new GameOperationsUnavailableException();
  await Guard(c,tx,authenticatedOwner);
  var result=await work(new SqlOperationTransaction(c,tx,authenticatedOwner,device));
  await tx.CommitAsync(); // Never retry an uncertain commit under a new operation ID.
  return result;
 }
 sealed class SqlOperationTransaction(SqlConnection c,SqlTransaction tx,string owner,Guid? device):IGameOperationTransaction
 {
  readonly string key=OwnerKey(owner);
  SqlCommand Query(string sql){var q=c.CreateCommand();q.Transaction=tx;q.CommandText=sql;q.Parameters.Add("@key",SqlDbType.Char,64).Value=key;return q;}
  public async Task<bool> AccountBlocked()
  {
   await using var q=Query("SELECT 1 FROM dbo.AccountDeletions WHERE OwnerKey=@key");return await q.ExecuteScalarAsync() is not null;
  }
  public async Task<OperationReceipt?> ReadReceipt(Guid operationId)
  {
   await using var q=Query("SELECT GameId,Fingerprint,Acknowledgement,AddedEntryId FROM dbo.GameOperationReceipts WHERE OwnerKey=@key AND OperationId=@id");q.Parameters.Add("@id",SqlDbType.UniqueIdentifier).Value=operationId;
   await using var r=await q.ExecuteReaderAsync();if(!await r.ReadAsync())return null;
   try{return new(operationId,r.GetGuid(0),r.GetString(1),JsonSerializer.Deserialize<OperationAcknowledgement>(r.GetString(2),Json)??throw new InvalidOperationException("Stored receipt is missing."),r.IsDBNull(3)?null:r.GetGuid(3));}
   catch(JsonException e){throw new InvalidOperationException("Stored receipt is invalid.",e);}
  }
  public async Task<OperationGame?> ReadGame(Guid gameId)
  {
   await GuardScoring(c,tx,owner,gameId,device);
   await using var q=Query("SELECT Version,State FROM dbo.Games WITH(UPDLOCK,HOLDLOCK) WHERE OwnerId=@owner AND GameId=@id");q.Parameters.Add("@owner",SqlDbType.NVarChar,100).Value=owner;q.Parameters.Add("@id",SqlDbType.UniqueIdentifier).Value=gameId;
   await using var r=await q.ExecuteReaderAsync();if(!await r.ReadAsync())return null;var version=r.GetInt64(0);if(version<1||version>9_007_199_254_740_991L)throw new InvalidOperationException("Stored game version is invalid.");var raw=r.GetString(1);
   try{using var document=JsonDocument.Parse(raw);if(document.RootElement.TryGetProperty("deleted",out var deleted)&&deleted.ValueKind==JsonValueKind.True)return new(version,true,null);
    var game=JsonSerializer.Deserialize<Game>(raw,Json)??throw new InvalidOperationException("Stored game is missing.");Scoring.Validate(game);return new(version,false,game);
   }catch(Exception e)when(e is JsonException or ArgumentException){throw new InvalidOperationException("Stored game is invalid.",e);}
  }
  public async Task<bool> EntryIdUsed(Guid gameId,Guid entryId)
  {
   await using var q=Query("SELECT 1 FROM dbo.GameEntryReservations WHERE OwnerKey=@key AND GameId=@id AND EntryId=@entry UNION ALL SELECT 1 FROM dbo.GameOperationReceipts WHERE OwnerKey=@key AND GameId=@id AND AddedEntryId=@entry; SELECT 1 FROM dbo.Games CROSS APPLY OPENJSON(State,'$.entries') WITH(EntryId uniqueidentifier '$.id') entries WHERE OwnerId=@owner AND GameId=@id AND entries.EntryId=@entry;");
   q.Parameters.Add("@id",SqlDbType.UniqueIdentifier).Value=gameId;q.Parameters.Add("@entry",SqlDbType.UniqueIdentifier).Value=entryId;q.Parameters.Add("@owner",SqlDbType.NVarChar,100).Value=owner;
   await using var r=await q.ExecuteReaderAsync();if(await r.ReadAsync())return true;return await r.NextResultAsync()&&await r.ReadAsync();
  }
  public async Task WriteGame(Game game,long expectedVersion)
  {
   await ReserveEntries(c,tx,owner,game.Id);
   await using var q=Query("UPDATE dbo.Games SET State=@state,Version=@version,Updated=@updated WHERE OwnerId=@owner AND GameId=@id AND Version=@expected AND COALESCE(JSON_VALUE(State,'$.deleted'),'false')<>'true'");
   Parameters(q,owner,game);q.Parameters.Add("@expected",SqlDbType.BigInt).Value=expectedVersion;
   if(await q.ExecuteNonQueryAsync()!=1)throw new InvalidOperationException("Operation storage changed unexpectedly. Retry the original operation.");
   await ReserveEntries(c,tx,owner,game.Id);
  }
  public async Task InsertGame(Game game)
  {
   await GuardScoring(c,tx,owner,game.Id,device,true);
   await using var q=Query("INSERT dbo.Games(OwnerId,GameId,Version,Updated,State) VALUES(@owner,@id,@version,@updated,@state)");
   Parameters(q,owner,game);await q.ExecuteNonQueryAsync();await ReserveEntries(c,tx,owner,game.Id);
  }
  public async Task WriteTombstone(Guid gameId,long expectedVersion,DateTimeOffset updated)
  {
   await ReserveEntries(c,tx,owner,gameId);
   await using var q=Query(expectedVersion==0?
    "INSERT dbo.Games(OwnerId,GameId,Version,Updated,State) VALUES(@owner,@id,1,@updated,N'{\"deleted\":true}')":
    "UPDATE dbo.Games SET State=N'{\"deleted\":true}',Version=Version+1,Updated=@updated WHERE OwnerId=@owner AND GameId=@id AND Version=@expected AND JSON_VALUE(State,'$.finished')='false' AND COALESCE(JSON_VALUE(State,'$.deleted'),'false')<>'true'");
   q.Parameters.Add("@owner",SqlDbType.NVarChar,100).Value=owner;q.Parameters.Add("@id",SqlDbType.UniqueIdentifier).Value=gameId;
   q.Parameters.Add("@updated",SqlDbType.DateTimeOffset).Value=updated;q.Parameters.Add("@expected",SqlDbType.BigInt).Value=expectedVersion;
   if(await q.ExecuteNonQueryAsync()!=1)throw new InvalidOperationException("Deletion storage changed unexpectedly.");
  }
  public async Task WriteReceipt(OperationReceipt receipt)
  {
   await using var q=Query("INSERT dbo.GameOperationReceipts(OwnerKey,OperationId,GameId,Fingerprint,Acknowledgement,AddedEntryId) VALUES(@key,@id,@game,@hash,@ack,@entry)");
   q.Parameters.Add("@id",SqlDbType.UniqueIdentifier).Value=receipt.OperationId;q.Parameters.Add("@game",SqlDbType.UniqueIdentifier).Value=receipt.GameId;
   q.Parameters.Add("@hash",SqlDbType.Char,64).Value=receipt.Fingerprint;q.Parameters.Add("@ack",SqlDbType.NVarChar,2000).Value=JsonSerializer.Serialize(receipt.Acknowledgement,Json);
   q.Parameters.Add("@entry",SqlDbType.UniqueIdentifier).Value=(object?)receipt.AddedEntryId??DBNull.Value;await q.ExecuteNonQueryAsync();
  }
 }
}
