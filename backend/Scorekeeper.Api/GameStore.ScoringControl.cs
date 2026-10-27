using System.Data;
using Microsoft.Data.SqlClient;
using Scorekeeper.Core;
namespace Scorekeeper.Api;
public sealed class ScoringElsewhereException():Exception("Scoring is on another device. Choose Score here to continue.");
public sealed class ScoringControlChangedException():Exception("Scoring moved. Choose Score here to continue.");
public sealed class ScoringControlUnavailableException():Exception("Scoring control is not available yet.");
public sealed record ScoringControlView(bool CanScore,bool HasScorer,long Epoch);
public sealed partial class GameStore
{
 static async Task<bool> ControlReady(SqlConnection c,SqlTransaction? tx=null){await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="SELECT CASE WHEN OBJECT_ID('dbo.GameScoringControl','U') IS NULL THEN 0 WHEN COL_LENGTH('dbo.GameScoringControl','OwnerKey')=64 AND COL_LENGTH('dbo.GameScoringControl','GameId')=16 AND COL_LENGTH('dbo.GameScoringControl','DeviceId')=16 AND COL_LENGTH('dbo.GameScoringControl','Epoch')=8 THEN 1 ELSE -1 END";var ready=Convert.ToInt32(await q.ExecuteScalarAsync());if(ready<0)throw new ScoringControlUnavailableException();return ready==1;}
 public async Task<bool> ScoringControlAvailable(){await using var c=await Connect();return await ControlReady(c);}
 static async Task<(Guid Device,long Epoch)?> Control(SqlConnection c,SqlTransaction tx,string owner,Guid id){
  await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="SELECT DeviceId,Epoch FROM dbo.GameScoringControl WITH(UPDLOCK,HOLDLOCK) WHERE OwnerKey=@key AND GameId=@id";q.Parameters.Add("@key",SqlDbType.Char,64).Value=OwnerKey(owner);q.Parameters.Add("@id",SqlDbType.UniqueIdentifier).Value=id;
  await using var r=await q.ExecuteReaderAsync();return await r.ReadAsync()?(r.GetGuid(0),r.GetInt64(1)):null;
 }
 static async Task SaveControl(SqlConnection c,SqlTransaction tx,string owner,Guid id,Guid device,long epoch){
  await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="UPDATE dbo.GameScoringControl SET DeviceId=@device,Epoch=@epoch WHERE OwnerKey=@key AND GameId=@id; IF @@ROWCOUNT=0 INSERT dbo.GameScoringControl(OwnerKey,GameId,DeviceId,Epoch) VALUES(@key,@id,@device,@epoch)";
  q.Parameters.Add("@key",SqlDbType.Char,64).Value=OwnerKey(owner);q.Parameters.Add("@id",SqlDbType.UniqueIdentifier).Value=id;q.Parameters.Add("@device",SqlDbType.UniqueIdentifier).Value=device;q.Parameters.Add("@epoch",SqlDbType.BigInt).Value=epoch;await q.ExecuteNonQueryAsync();
 }
 // Runs under the same authenticated-owner lock and SQL transaction as the write.
 // Missing schema/claim preserves old clients. Once claimed, missing IDs cannot bypass control.
 static async Task GuardScoring(SqlConnection c,SqlTransaction tx,string owner,Guid id,Guid? device,bool create=false){
  if(!await ControlReady(c,tx))return;
  var control=await Control(c,tx,owner,id);
  if(control is not null&&control.Value.Device!=device)throw new ScoringElsewhereException();
  if(create&&control is null&&device is Guid d)await SaveControl(c,tx,owner,id,d,1);
 }
 public async Task<ScoringControlView?> ScoringControl(string owner,Guid id,Guid device,long? expectedEpoch=null){
  if(device==Guid.Empty||expectedEpoch is <0 or >=9007199254740991L)throw new ArgumentException("Use a valid device and scoring request.");
  await using var c=await Connect();await using var tx=(SqlTransaction)await c.BeginTransactionAsync();await LockOwner(c,tx,owner);await Guard(c,tx,owner);
  if(!await ControlReady(c,tx))throw new ScoringControlUnavailableException();
  await using(var q=c.CreateCommand()){
   q.Transaction=tx;q.CommandText="SELECT 1 FROM dbo.Games WHERE OwnerId=@owner AND GameId=@id AND COALESCE(JSON_VALUE(State,'$.deleted'),'false')<>'true'";q.Parameters.Add("@owner",SqlDbType.NVarChar,100).Value=owner;q.Parameters.Add("@id",SqlDbType.UniqueIdentifier).Value=id;
   if(await q.ExecuteScalarAsync() is null)return null;
  }
  var control=await Control(c,tx,owner,id);
  if(expectedEpoch is not null&&control?.Device!=device){
   var epoch=control?.Epoch??0;if(epoch!=expectedEpoch)throw new ScoringControlChangedException();
   await SaveControl(c,tx,owner,id,device,epoch+1);control=(device,epoch+1);
  }
  await tx.CommitAsync();return new(control?.Device==device,control is not null,control?.Epoch??0);
 }
 public IGameOperationStore ForScoringDevice(Guid? device)=>device==Guid.Empty?throw new ArgumentException("Use a valid device ID."):new DeviceStore(this,device);
 sealed class DeviceStore(GameStore store,Guid? device):IGameOperationStore{
  public Task<T> Transaction<T>(string owner,Func<IGameOperationTransaction,Task<T>> work)=>store.TransactionWithDevice(owner,device,work);
 }
}
