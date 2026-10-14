using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.SqlClient;
using Scorekeeper.Core;
namespace Scorekeeper.Api;
public sealed class AccountDeletingException : Exception;
public sealed class GameStore : IAccountDeletionStore
{
 public static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
 readonly string connectionString=TokenVerifier.Required("ScorekeeperSql");
 public static string OwnerKey(string owner)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(owner)));
 async Task<SqlConnection> Connect(){var c=new SqlConnection(connectionString);try{await c.OpenAsync();return c;}catch{await c.DisposeAsync();throw;}}
 public async Task<string?> DeletionState(string owner)
 {
  await using var c=await Connect();await using var q=c.CreateCommand();
  q.CommandText="DELETE TOP (100) FROM dbo.AccountDeletions WHERE CompletedAt < DATEADD(day,-30,SYSDATETIMEOFFSET()); SELECT Status FROM dbo.AccountDeletions WHERE OwnerKey=@key";q.Parameters.AddWithValue("@key",OwnerKey(owner));
  return await q.ExecuteScalarAsync() as string;
 }
 static async Task LockOwner(SqlConnection c,SqlTransaction tx,string owner)
 {
  await using var q=c.CreateCommand();q.Transaction=tx;
  q.CommandText="DECLARE @result int; EXEC @result=sys.sp_getapplock @Resource=@key,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; IF @result<0 THROW 51000,'Account is busy; retry after refreshing.',1;";q.Parameters.AddWithValue("@key","scorekeeper:"+OwnerKey(owner));await q.ExecuteNonQueryAsync();
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
  await using var c=await Connect();await using var tx=(SqlTransaction)await c.BeginTransactionAsync();await LockOwner(c,tx,owner);
  await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="DELETE FROM dbo.Games WHERE OwnerId=@owner; UPDATE dbo.AccountDeletions SET Status='completed',OwnerId=NULL,CompletedAt=COALESCE(CompletedAt,SYSDATETIMEOFFSET()) WHERE OwnerKey=@key";q.Parameters.AddWithValue("@key",OwnerKey(owner));q.Parameters.AddWithValue("@owner",owner);await q.ExecuteNonQueryAsync();await tx.CommitAsync();
 }
 public async Task<Game?> Get(string owner,Guid id)
 {
  await using var c=await Connect();await using var q=c.CreateCommand();q.CommandText="SELECT State FROM dbo.Games WHERE OwnerId=@owner AND GameId=@id";q.Parameters.AddWithValue("@owner",owner);q.Parameters.AddWithValue("@id",id);
  return await q.ExecuteScalarAsync() is string state?JsonSerializer.Deserialize<Game>(state,Json):null;
 }
 public async Task<object[]> List(string owner)
 {
  await using var c=await Connect();await using var q=c.CreateCommand();q.CommandText="SELECT TOP (200) State FROM dbo.Games WHERE OwnerId=@owner ORDER BY Updated DESC";q.Parameters.AddWithValue("@owner",owner);
  await using var r=await q.ExecuteReaderAsync();var games=new List<object>();while(await r.ReadAsync()){var g=JsonSerializer.Deserialize<Game>(r.GetString(0),Json)!;games.Add(new{g.Id,g.Name,g.Players,g.Winner,g.PlayStyle,g.ScoreMode,g.PresetId,g.PresetVersion,g.EndCondition,g.RoundLimit,g.TargetScore,g.TargetEnd,g.Finished,g.Version,g.Updated,g.StartedAt,g.EndedAt,TurnCount=g.Entries.Length});}return games.ToArray();
 }
 public async Task<bool> Insert(string owner,Game g)
 {
  await using var c=await Connect();await using var tx=(SqlTransaction)await c.BeginTransactionAsync();await LockOwner(c,tx,owner);await Guard(c,tx,owner);
  await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="INSERT INTO dbo.Games(OwnerId,GameId,Version,Updated,State) VALUES(@owner,@id,@version,@updated,@state)";Parameters(q,owner,g);
  try{await q.ExecuteNonQueryAsync();await tx.CommitAsync();return true;}catch(SqlException e)when(e.Number is 2601 or 2627){return false;}
 }
 public async Task<bool> Replace(string owner,Game g,long expected)
 {
  await using var c=await Connect();await using var tx=(SqlTransaction)await c.BeginTransactionAsync();await LockOwner(c,tx,owner);await Guard(c,tx,owner);
  await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="UPDATE dbo.Games SET State=@state,Version=@version,Updated=@updated WHERE OwnerId=@owner AND GameId=@id AND Version=@expected";Parameters(q,owner,g);q.Parameters.AddWithValue("@expected",expected);var changed=await q.ExecuteNonQueryAsync()==1;await tx.CommitAsync();return changed;
 }
 static void Parameters(SqlCommand q,string owner,Game g){q.Parameters.AddWithValue("@owner",owner);q.Parameters.AddWithValue("@id",g.Id);q.Parameters.AddWithValue("@version",g.Version);q.Parameters.AddWithValue("@updated",g.Updated);q.Parameters.AddWithValue("@state",JsonSerializer.Serialize(g,Json));}
}
