using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
namespace Scorekeeper.Core;

// The API capability remains gated; clients must not infer support from these types.
public sealed record ActionOperation(int ProtocolVersion,string Kind,Guid OperationId,Guid GameId,Command Command);
public sealed record OperationAcknowledgement(Guid OperationId,Guid GameId,string Outcome,long? CommittedVersion,long? ObservedVersion,string? ErrorCode);
public sealed record OperationReceipt(Guid OperationId,Guid GameId,string Fingerprint,OperationAcknowledgement Acknowledgement,Guid? AddedEntryId);
public sealed record OperationGame(long Version,bool Deleted,Game? State);
public sealed class OperationIdReusedException():Exception("This operation ID was already used with a different request.");
public sealed class AccountOperationsBlockedException():Exception("Account deletion has been requested. Operations are blocked.");

/// <summary>The implementation MUST serialize by authenticated owner, and atomically commit
/// game state, entry-ID reservation and receipt, or roll them all back. Never return before commit.</summary>
public interface IGameOperationStore
{
 Task<T> Transaction<T>(string authenticatedOwner,Func<IGameOperationTransaction,Task<T>> work);
}
public interface IGameOperationTransaction
{
 Task<bool> AccountBlocked();
 Task<OperationReceipt?> ReadReceipt(Guid operationId);
 Task<OperationGame?> ReadGame(Guid gameId);
 // Includes current legacy entries and successful historical receipts, even after undo.
 Task<bool> EntryIdUsed(Guid gameId,Guid entryId);
 Task WriteGame(Game game,long expectedVersion);
 Task InsertGame(Game game);
 Task WriteTombstone(Guid gameId,long expectedVersion,DateTimeOffset updated);
 Task WriteReceipt(OperationReceipt receipt);
}

public static class GameOperationProtocol
{
 static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){PropertyNameCaseInsensitive=false,UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow,RespectRequiredConstructorParameters=true,AllowDuplicateProperties=false,NumberHandling=JsonNumberHandling.Strict};
 public static ActionOperation Parse(string json)
 {
  if(string.IsNullOrWhiteSpace(json)||Encoding.UTF8.GetByteCount(json)>2_000_000)throw new ArgumentException("Send one bounded game operation.");
  var operation=JsonSerializer.Deserialize<ActionOperation>(json,Json)??throw new ArgumentException("Operation is required.");
  Validate(operation);return operation;
 }
 public static string Fingerprint(ActionOperation operation)
 {
  Validate(operation);
  // The typed envelope fixes property order, number types, GUID spelling and optional defaults.
  // No user-supplied owner, object-key ordering or ignored JSON properties enter this hash.
  return Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(operation,Json)));
 }
 public static void Validate(ActionOperation operation)
 {
  if(operation.ProtocolVersion!=1||operation.Kind!="action"||operation.OperationId==Guid.Empty||operation.GameId==Guid.Empty||operation.Command is null)throw new ArgumentException("A v1 action operation and stable IDs are required.");
  var c=operation.Command;
  if(c.ExpectedVersion<1||c.ExpectedVersion>=9_007_199_254_740_991L)throw new ArgumentException("A valid expected server version is required.");
  var valid=c.Action switch{
   "score"=>c.Points is >=-100000 and <=100000&&c.PlayerId is Guid p&&p!=Guid.Empty&&c.EntryId is Guid e&&e!=Guid.Empty&&c.Rules is null,
   "edit"=>c.Points is >=-100000 and <=100000&&c.EntryId is Guid e&&e!=Guid.Empty&&c.PlayerId is null&&c.Rules is null,
   "undo"=>c.EntryId is Guid e&&e!=Guid.Empty&&c.Points is null&&c.PlayerId is null&&c.Rules is null,
   "select"=>c.PlayerId is Guid p&&p!=Guid.Empty&&c.Points is null&&c.EntryId is null&&c.Rules is null,
   "rules"=>c.Rules is not null&&c.Points is null&&c.EntryId is null&&c.PlayerId is null,
   "finish" or "resume"=>c.Points is null&&c.EntryId is null&&c.PlayerId is null&&c.Rules is null,
   _=>false
  };
  if(!valid)throw new ArgumentException("Use an explicit player/entry target and only the fields for this action.");
 }
}

public sealed class GameOperationService(IGameOperationStore store,TimeProvider? clock=null)
{
 readonly TimeProvider time=clock??TimeProvider.System;
 public Task<OperationAcknowledgement> Execute(string authenticatedOwner,string json)
 {
  if(string.IsNullOrWhiteSpace(authenticatedOwner))throw new UnauthorizedAccessException();
  if(GameLifecycleProtocol.Kind(json)!="action")return new GameLifecycleService(store,time).Execute(authenticatedOwner,json);
  // Parse/detach and hash before entering any asynchronous storage work.
  var operation=GameOperationProtocol.Parse(json);var hash=GameOperationProtocol.Fingerprint(operation);
  return store.Transaction(authenticatedOwner,async tx=>{
   // Account deletion blocks even old acknowledgements; never return deleted-account contents.
   if(await tx.AccountBlocked())throw new AccountOperationsBlockedException();
   var previous=await tx.ReadReceipt(operation.OperationId);
   if(previous is not null){
    if(previous.OperationId!=operation.OperationId||previous.GameId!=operation.GameId||previous.Fingerprint!=hash)throw new OperationIdReusedException();
    var ack=previous.Acknowledgement;
    if(ack is null||ack.OperationId!=operation.OperationId||ack.GameId!=operation.GameId||
     (ack.Outcome=="applied"?(ack.CommittedVersion!=operation.Command.ExpectedVersion+1||ack.ObservedVersion!=operation.Command.ExpectedVersion||ack.ErrorCode is not null):
      ack.Outcome!="rejected"||ack.CommittedVersion is not null||ack.ErrorCode is not ("GAME_NOT_FOUND" or "GAME_DELETED" or "VERSION_CONFLICT" or "UNDO_TARGET_CHANGED" or "ENTRY_ID_REUSED" or "INVALID_GAME_COMMAND")))throw new InvalidOperationException("Stored receipt is inconsistent.");
    var expectedEntry=ack.Outcome=="applied"&&operation.Command.Action=="score"?operation.Command.EntryId:null;
    if(previous.AddedEntryId!=expectedEntry||ack.ObservedVersion is <1 or >9_007_199_254_740_991L)throw new InvalidOperationException("Stored receipt metadata is inconsistent.");
    return ack; // Before version checks: retries may follow later game changes.
   }
   var record=await tx.ReadGame(operation.GameId);var command=operation.Command;
   string? error=null;Game? changed=null;
   if(record is null)error="GAME_NOT_FOUND";
   else if(record.Deleted)error="GAME_DELETED";
   else{
    var game=record.State??throw new InvalidOperationException("Stored game is missing.");
    if(record.Version<1||record.Version>9_007_199_254_740_991L||record.Version!=game.Version||game.Id!=operation.GameId)throw new InvalidOperationException("Stored game metadata is inconsistent.");
    Scoring.Validate(game);
    if(record.Version!=command.ExpectedVersion)error="VERSION_CONFLICT";
    else if(command.Action=="undo"&&game.Entries.LastOrDefault()?.Id!=command.EntryId)error="UNDO_TARGET_CHANGED";
    else if(command.Action=="score"&&await tx.EntryIdUsed(operation.GameId,command.EntryId!.Value))error="ENTRY_ID_REUSED";
    else try{changed=Scoring.Apply(game,command,command.Action=="score"?command.EntryId:null,time.GetUtcNow());}
     catch(ArgumentException){error="INVALID_GAME_COMMAND";}
   }
   var acknowledgement=new OperationAcknowledgement(operation.OperationId,operation.GameId,changed is null?"rejected":"applied",changed?.Version,record?.Version,error);
   if(changed is not null)await tx.WriteGame(changed,command.ExpectedVersion);
   // Rejections are terminal too. Review creates a NEW operation; it must not mutate the old payload.
   await tx.WriteReceipt(new(operation.OperationId,operation.GameId,hash,acknowledgement,changed is not null&&command.Action=="score"?command.EntryId:null));
   return acknowledgement;
  });
 }
}
