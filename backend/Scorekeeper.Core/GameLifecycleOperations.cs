using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
namespace Scorekeeper.Core;

public sealed record LifecycleOperation(int ProtocolVersion,string Kind,Guid OperationId,Guid GameId,long ExpectedVersion,Game? Game=null);
public static class GameLifecycleProtocol
{
 static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){PropertyNameCaseInsensitive=false,UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow,RespectRequiredConstructorParameters=true,AllowDuplicateProperties=false,NumberHandling=JsonNumberHandling.Strict};
 public static string Kind(string json)
 {
  if(string.IsNullOrWhiteSpace(json)||Encoding.UTF8.GetByteCount(json)>2_000_000)throw new ArgumentException("Send one bounded game operation.");
  using var doc=JsonDocument.Parse(json);
  if(doc.RootElement.ValueKind!=JsonValueKind.Object||!doc.RootElement.TryGetProperty("kind",out var kind)||kind.ValueKind!=JsonValueKind.String)throw new ArgumentException("Operation kind is required.");
  return kind.GetString()!;
 }
 public static LifecycleOperation Parse(string json)
 {
  Kind(json);var op=JsonSerializer.Deserialize<LifecycleOperation>(json,Json)??throw new ArgumentException("Operation is required.");
  if(op.ProtocolVersion!=1||op.OperationId==Guid.Empty||op.GameId==Guid.Empty||op.ExpectedVersion<0||op.ExpectedVersion>=9_007_199_254_740_991L)throw new ArgumentException("A v1 operation with stable IDs and a valid expected version is required.");
  if(op.Kind=="delete") {if(op.Game is not null)throw new ArgumentException("Deletion must not contain game data.");}
  else if(op.Kind is "create" or "import"){
   if(op.ExpectedVersion!=0||op.Game is not Game g||g.Id!=op.GameId||g.Version<1||g.Version>9_007_199_254_740_991L)throw new ArgumentException("Creation/import requires an unused ID and expected version zero.");
   Scoring.Validate(g);
   if(op.Kind=="create"&&(g.Version!=1||g.Entries.Length!=0||g.Finished||g.EndedAt is not null||g.FinishReason is not null||g.Next!=g.Players[0].Id))throw new ArgumentException("Creation requires a new unscored game.");
  }else throw new ArgumentException("Unknown operation kind.");
  return op;
 }
 public static string Fingerprint(LifecycleOperation op)=>Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(op,Json)));
}

public sealed class GameLifecycleService(IGameOperationStore store,TimeProvider time)
{
 public Task<OperationAcknowledgement> Execute(string owner,string json)
 {
  var op=GameLifecycleProtocol.Parse(json);var hash=GameLifecycleProtocol.Fingerprint(op);
  return store.Transaction(owner,async tx=>{
   if(await tx.AccountBlocked())throw new AccountOperationsBlockedException();
   var previous=await tx.ReadReceipt(op.OperationId);
   if(previous is not null){
    if(previous.OperationId!=op.OperationId||previous.GameId!=op.GameId||previous.Fingerprint!=hash)throw new OperationIdReusedException();
    var ack=previous.Acknowledgement;
    if(ack is null||ack.OperationId!=op.OperationId||ack.GameId!=op.GameId||previous.AddedEntryId is not null||ack.ObservedVersion is <1 or >9_007_199_254_740_991L||
     (ack.Outcome=="applied"?(ack.CommittedVersion!=op.ExpectedVersion+1||ack.ObservedVersion!=(op.ExpectedVersion==0?(long?)null:op.ExpectedVersion)||ack.ErrorCode is not null):
      ack.Outcome!="rejected"||ack.CommittedVersion is not null||ack.ErrorCode is not ("GAME_NOT_FOUND" or "GAME_DELETED" or "GAME_ALREADY_EXISTS" or "VERSION_CONFLICT" or "GAME_FINISHED")))throw new InvalidOperationException("Stored lifecycle receipt is inconsistent.");
    return ack;
   }
   var record=await tx.ReadGame(op.GameId);string? error=null;var now=time.GetUtcNow();
   if(record?.Deleted==true)error="GAME_DELETED";
   else if(op.Kind is "create" or "import"){
    if(record is not null)error="GAME_ALREADY_EXISTS";
    else await tx.InsertGame(op.Game! with{Version=1,Updated=now,StartedAt=op.Game.StartedAt??now});
   }else if(record is null){
    if(op.ExpectedVersion!=0)error="GAME_NOT_FOUND";
    else await tx.WriteTombstone(op.GameId,0,now);
   }else{
    if(record.State is not Game game||game.Id!=op.GameId||game.Version!=record.Version)throw new InvalidOperationException("Stored game metadata is inconsistent.");
    Scoring.Validate(game);
    if(record.Version!=op.ExpectedVersion)error="VERSION_CONFLICT";
    else if(game.Finished)error="GAME_FINISHED";
    else await tx.WriteTombstone(op.GameId,op.ExpectedVersion,now);
   }
   var result=new OperationAcknowledgement(op.OperationId,op.GameId,error is null?"applied":"rejected",error is null?op.ExpectedVersion+1:null,record?.Version,error);
   await tx.WriteReceipt(new(op.OperationId,op.GameId,hash,result,null));return result;
  });
 }
}
