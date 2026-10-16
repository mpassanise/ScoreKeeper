using System.Net;
using System.Diagnostics;
using Microsoft.Data.SqlClient;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Scorekeeper.Core;
namespace Scorekeeper.Api;
public record SyncPlayersInput(string ProfileId,FrequentPlayerChange[] Changes);
public record DeleteInput(string Confirmation);
public record DeleteGameInput(long ExpectedVersion);
public record CreateInput(Guid Id,string Name,string[] Players,string Winner,string EndCondition="manual",int? RoundLimit=null,long? TargetScore=null,string PlayStyle="turns",string ScoreMode="add",string? PresetId=null,int? PresetVersion=null,string TargetEnd="immediate");
public class Functions(TokenVerifier auth,GameStore store,ILogger<Functions> logger,ICustomerDirectory directory,AccountDeletionService deletion)
{
 [Function("ListGames")]public Task<HttpResponseData> List([HttpTrigger(AuthorizationLevel.Anonymous,"get",Route="games")]HttpRequestData r)=>Run(r,async owner=>await Reply(r,200,await store.List(owner)));
 [Function("ReadGame")]public Task<HttpResponseData> Read([HttpTrigger(AuthorizationLevel.Anonymous,"get",Route="games/{id:guid}")]HttpRequestData r,Guid id)=>Run(r,async owner=>await store.Get(owner,id) is Game g?await Reply(r,200,Scoring.View(g)):await Reply(r,404,new{error="Game not found."}));
 [Function("DeleteGame")]public Task<HttpResponseData> DeleteGame([HttpTrigger(AuthorizationLevel.Anonymous,"post",Route="games/{id:guid}/delete")]HttpRequestData r,Guid id)=>Run(r,async owner=>{var input=await Body<DeleteGameInput>(r);if(input.ExpectedVersion<1)throw new ArgumentException("A valid game version is required.");var g=await store.Get(owner,id);if(g is null)return await Reply(r,200,new{deleted=true});if(g.Version!=input.ExpectedVersion)return await Reply(r,409,new{error="This game changed on another device. Refresh before deleting."});if(g.Finished)throw new ArgumentException("Only in-progress games can be deleted.");return await store.DeleteGame(owner,id,input.ExpectedVersion)?await Reply(r,200,new{deleted=true}):await Reply(r,409,new{error="This game changed on another device. Refresh before deleting."});});
 [Function("CreateGame")]public Task<HttpResponseData> Create([HttpTrigger(AuthorizationLevel.Anonymous,"post",Route="games")]HttpRequestData r)=>Run(r,async owner=>{var input=await Body<CreateInput>(r);var g=Scoring.Create(input.Id,input.Name,input.Players,input.Winner,input.EndCondition,input.RoundLimit,input.TargetScore,input.PlayStyle,input.ScoreMode,input.PresetId,input.PresetVersion,input.TargetEnd);return await store.Insert(owner,g)?await Reply(r,201,Scoring.View(g)):await Reply(r,409,new{error="A game with this ID already exists."});});
 [Function("GameAction")]public Task<HttpResponseData> Action([HttpTrigger(AuthorizationLevel.Anonymous,"post",Route="games/{id:guid}/actions")]HttpRequestData r,Guid id)=>Run(r,async owner=>{var c=await Body<Command>(r);var g=await store.Get(owner,id);if(g is null)return await Reply(r,404,new{error="Game not found."});var updated=Scoring.Apply(g,c);return await store.Replace(owner,updated,c.ExpectedVersion)?await Reply(r,200,Scoring.View(updated)):await Reply(r,409,new{error="This game changed on another device. Refresh before scoring."});});
 [Function("ImportGame")]public Task<HttpResponseData> Import([HttpTrigger(AuthorizationLevel.Anonymous,"post",Route="games/import")]HttpRequestData r)=>Run(r,async owner=>{var g=await Body<Game>(r);Scoring.Validate(g);g=g with{Version=1,Updated=DateTimeOffset.UtcNow};return await store.Insert(owner,g)?await Reply(r,201,Scoring.View(g)):await store.Get(owner,g.Id) is null?await Reply(r,410,new{error="This game was deleted from your account.",code="GAME_DELETED"}):await Reply(r,409,new{error="Already imported. Existing cloud game was preserved."});});
 [Function("AccountStatus")]public Task<HttpResponseData> Account([HttpTrigger(AuthorizationLevel.Anonymous,"get",Route="account")]HttpRequestData r)=>Run(r,async owner=>await Reply(r,200,new{ProfileId=GameStore.OwnerKey(owner),ScoringRulesEnabled=true,ScoringRulesVersion=3,DeletionEnabled=directory.IsConfigured,DeletionStatus=await store.DeletionState(owner)}),allowDeleted:true);
 [Function("SyncFrequentPlayers")]public Task<HttpResponseData> SyncPlayers([HttpTrigger(AuthorizationLevel.Anonymous,"post",Route="players/sync")]HttpRequestData r)=>Run(r,async owner=>{var input=await Body<SyncPlayersInput>(r);if(input.ProfileId!=GameStore.OwnerKey(owner))throw new UnauthorizedAccessException();return await Reply(r,200,new{Names=await store.SyncPlayers(owner,input.Changes)});});
 [Function("DeleteAccount")]public Task<HttpResponseData> Delete([HttpTrigger(AuthorizationLevel.Anonymous,"post",Route="account/delete")]HttpRequestData r)=>Run(r,async owner=>{var input=await Body<DeleteInput>(r);var outcome=await deletion.Delete(owner,input.Confirmation);if(outcome.Failure is not null)logger.LogError(outcome.Failure,"Account deletion remains pending");return await Reply(r,outcome.Status=="completed"?200:202,new{outcome.Status,outcome.Message});},allowDeleted:true);
 async Task<HttpResponseData> Run(HttpRequestData r,Func<string,Task<HttpResponseData>> action,bool allowDeleted=false)
 {
  var elapsed=Stopwatch.StartNew();var stage="token-validation";
  var requestId=Activity.Current?.TraceId.ToString()??Guid.NewGuid().ToString("N");
  using var scope=logger.BeginScope(new Dictionary<string,object>{{"RequestId",requestId}});
  logger.LogInformation("Scorekeeper request started {Method} {Path}; RequestId {RequestId}",r.Method,r.Url.AbsolutePath,requestId);
  try{
   var owner=await auth.Owner(r);
   logger.LogInformation("Scorekeeper authentication completed in {ElapsedMs} ms",elapsed.ElapsedMilliseconds);
   stage="deletion-state";
   if(!allowDeleted&&await store.DeletionState(owner) is not null)return await Reply(r,410,new{error="Account deletion has been requested. Open Account to retry deletion or sign out."});
   stage="handler";return await action(owner);
  }
  catch(UnauthorizedAccessException){var response=await Reply(r,401,new{error="Sign in with a valid Scorekeeper access token.",code="TOKEN_REJECTED",requestId,stage});response.Headers.Add("WWW-Authenticate","Bearer");return response;}
  catch(AccountDeletingException){return await Reply(r,410,new{error="Account deletion has been requested. No scores were saved."});}
  catch(InvalidOperationException e)when(e.Message=="Account deletion is not configured yet."){return await Reply(r,503,new{error="Account deletion is not available right now. Your account has not been changed."});}
  catch(JsonException){return await Reply(r,400,new{error="Invalid request JSON."});}
  catch(ArgumentException e){return await Reply(r,400,new{error=e.Message});}
  catch(InvalidOperationException e)when(e.Message.StartsWith("This game changed")){return await Reply(r,409,new{error=e.Message});}
  catch(SqlException e){
   logger.LogError(e,"Scorekeeper SQL failure at {Stage} after {ElapsedMs} ms; SqlNumber {SqlNumber}; RequestId {RequestId}",stage,elapsed.ElapsedMilliseconds,e.Number,requestId);
   var transient=e.Number is -2 or 40613 or 40197 or 40501 or 49918 or 49919 or 49920 or 10928 or 10929;
   return await Reply(r,503,new{error=transient?"Account database is starting or temporarily busy. Please try syncing again.":"Account database is unavailable. Please contact support with this reference.",code=transient?"DATABASE_WAKING":"DATABASE_UNAVAILABLE",requestId,stage,sqlNumber=e.Number});
  }
  catch(Exception e){logger.LogError(e,"Scorekeeper request failed at {Stage} after {ElapsedMs} ms; RequestId {RequestId}",stage,elapsed.ElapsedMilliseconds,requestId);return await Reply(r,503,new{error="Scorekeeper is temporarily unavailable. Your device has not received a confirmed save; refresh before retrying.",code="API_UNAVAILABLE",requestId,stage});}
  finally{logger.LogInformation("Scorekeeper {Method} {Path} completed at {Stage} in {ElapsedMs} ms; RequestId {RequestId}",r.Method,r.Url.AbsolutePath,stage,elapsed.ElapsedMilliseconds,requestId);}
 }
 static async Task<T> Body<T>(HttpRequestData r)
 {
  using var buffer=new MemoryStream();var chunk=new byte[8192];int read;while((read=await r.Body.ReadAsync(chunk))>0){if(buffer.Length+read>2_000_000)throw new ArgumentException("Request is too large.");buffer.Write(chunk,0,read);}return JsonSerializer.Deserialize<T>(buffer.ToArray(),GameStore.Json)??throw new ArgumentException("Request body is required.");
 }
 static async Task<HttpResponseData> Reply(HttpRequestData r,int status,object data){var response=r.CreateResponse((HttpStatusCode)status);response.Headers.Add("Content-Type","application/json; charset=utf-8");response.Headers.Add("Cache-Control","no-store");await response.WriteStringAsync(JsonSerializer.Serialize(data,GameStore.Json));return response;}
}
