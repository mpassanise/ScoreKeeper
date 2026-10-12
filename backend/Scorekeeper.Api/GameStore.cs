using System.Text.Json;
using Microsoft.Data.SqlClient;
using Scorekeeper.Core;
namespace Scorekeeper.Api;
public sealed class GameStore
{
 public static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
 readonly string connectionString=TokenVerifier.Required("ScorekeeperSql");
 async Task<SqlConnection> Connect(){var c=new SqlConnection(connectionString);await c.OpenAsync();return c;}
 public async Task<Game?> Get(string owner,Guid id)
 {
  await using var c=await Connect();await using var q=c.CreateCommand();q.CommandText="SELECT State FROM dbo.Games WHERE OwnerId=@owner AND GameId=@id";q.Parameters.AddWithValue("@owner",owner);q.Parameters.AddWithValue("@id",id);
  return await q.ExecuteScalarAsync() is string state?JsonSerializer.Deserialize<Game>(state,Json):null;
 }
 public async Task<object[]> List(string owner)
 {
  await using var c=await Connect();await using var q=c.CreateCommand();q.CommandText="SELECT TOP (200) State FROM dbo.Games WHERE OwnerId=@owner ORDER BY Updated DESC";q.Parameters.AddWithValue("@owner",owner);
  await using var r=await q.ExecuteReaderAsync();var games=new List<object>();while(await r.ReadAsync()){var g=JsonSerializer.Deserialize<Game>(r.GetString(0),Json)!;games.Add(new{g.Id,g.Name,g.Players,g.Winner,g.Finished,g.Version,g.Updated,TurnCount=g.Entries.Length});}return games.ToArray();
 }
 public async Task<bool> Insert(string owner,Game g)
 {
  await using var c=await Connect();await using var q=c.CreateCommand();q.CommandText="INSERT INTO dbo.Games(OwnerId,GameId,Version,Updated,State) VALUES(@owner,@id,@version,@updated,@state)";Parameters(q,owner,g);
  try{await q.ExecuteNonQueryAsync();return true;}catch(SqlException e)when(e.Number is 2601 or 2627){return false;}
 }
 public async Task<bool> Replace(string owner,Game g,long expected)
 {
  await using var c=await Connect();await using var q=c.CreateCommand();q.CommandText="UPDATE dbo.Games SET State=@state,Version=@version,Updated=@updated WHERE OwnerId=@owner AND GameId=@id AND Version=@expected";Parameters(q,owner,g);q.Parameters.AddWithValue("@expected",expected);return await q.ExecuteNonQueryAsync()==1;
 }
 static void Parameters(SqlCommand q,string owner,Game g){q.Parameters.AddWithValue("@owner",owner);q.Parameters.AddWithValue("@id",g.Id);q.Parameters.AddWithValue("@version",g.Version);q.Parameters.AddWithValue("@updated",g.Updated);q.Parameters.AddWithValue("@state",JsonSerializer.Serialize(g,Json));}
}
