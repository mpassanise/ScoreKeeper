using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Scorekeeper.Core;
namespace Scorekeeper.Api;
public record DeleteInput(string Confirmation);
public record CreateInput(Guid Id,string Name,string[] Players,string Winner,string EndCondition="manual",int? RoundLimit=null,long? TargetScore=null);
public class Functions(TokenVerifier auth,GameStore store,ILogger<Functions> logger,ICustomerDirectory directory,AccountDeletionService deletion)
{
 [Function("ListGames")]public Task<HttpResponseData> List([HttpTrigger(AuthorizationLevel.Anonymous,"get",Route="games")]HttpRequestData r)=>Run(r,async owner=>await Reply(r,200,await store.List(owner)));
 [Function("ReadGame")]public Task<HttpResponseData> Read([HttpTrigger(AuthorizationLevel.Anonymous,"get",Route="games/{id:guid}")]HttpRequestData r,Guid id)=>Run(r,async owner=>await store.Get(owner,id) is Game g?await Reply(r,200,Scoring.View(g)):await Reply(r,404,new{error="Game not found."}));
 [Function("CreateGame")]public Task<HttpResponseData> Create([HttpTrigger(AuthorizationLevel.Anonymous,"post",Route="games")]HttpRequestData r)=>Run(r,async owner=>{var input=await Body<CreateInput>(r);var g=Scoring.Create(input.Id,input.Name,input.Players,input.Winner,input.EndCondition,input.RoundLimit,input.TargetScore);return await store.Insert(owner,g)?await Reply(r,201,Scoring.View(g)):await Reply(r,409,new{error="A game with this ID already exists."});});
 [Function("GameAction")]public Task<HttpResponseData> Action([HttpTrigger(AuthorizationLevel.Anonymous,"post",Route="games/{id:guid}/actions")]HttpRequestData r,Guid id)=>Run(r,async owner=>{var c=await Body<Command>(r);var g=await store.Get(owner,id);if(g is null)return await Reply(r,404,new{error="Game not found."});var updated=Scoring.Apply(g,c);return await store.Replace(owner,updated,c.ExpectedVersion)?await Reply(r,200,Scoring.View(updated)):await Reply(r,409,new{error="This game changed on another device. Refresh before scoring."});});
 [Function("ImportGame")]public Task<HttpResponseData> Import([HttpTrigger(AuthorizationLevel.Anonymous,"post",Route="games/import")]HttpRequestData r)=>Run(r,async owner=>{var g=await Body<Game>(r);Scoring.Validate(g);g=g with{Version=1,Updated=DateTimeOffset.UtcNow};return await store.Insert(owner,g)?await Reply(r,201,Scoring.View(g)):await Reply(r,409,new{error="Already imported. Existing cloud game was preserved."});});
 [Function("AccountStatus")]public Task<HttpResponseData> Account([HttpTrigger(AuthorizationLevel.Anonymous,"get",Route="account")]HttpRequestData r)=>Run(r,async owner=>await Reply(r,200,new{ScoringRulesEnabled=true,DeletionEnabled=directory.IsConfigured,DeletionStatus=await store.DeletionState(owner)}),allowDeleted:true);
 [Function("DeleteAccount")]public Task<HttpResponseData> Delete([HttpTrigger(AuthorizationLevel.Anonymous,"post",Route="account/delete")]HttpRequestData r)=>Run(r,async owner=>{var input=await Body<DeleteInput>(r);var outcome=await deletion.Delete(owner,input.Confirmation);if(outcome.Failure is not null)logger.LogError(outcome.Failure,"Account deletion remains pending");return await Reply(r,outcome.Status=="completed"?200:202,new{outcome.Status,outcome.Message});},allowDeleted:true);
 async Task<HttpResponseData> Run(HttpRequestData r,Func<string,Task<HttpResponseData>> action,bool allowDeleted=false)
 {
  try{var owner=await auth.Owner(r);if(!allowDeleted&&await store.DeletionState(owner) is not null)return await Reply(r,410,new{error="Account deletion has been requested. Open Account to retry deletion or sign out."});return await action(owner);}
  catch(UnauthorizedAccessException){var response=await Reply(r,401,new{error="Sign in with a valid Scorekeeper access token."});response.Headers.Add("WWW-Authenticate","Bearer");return response;}
  catch(AccountDeletingException){return await Reply(r,410,new{error="Account deletion has been requested. No scores were saved."});}
  catch(InvalidOperationException e)when(e.Message=="Account deletion is not configured yet."){return await Reply(r,503,new{error="Account deletion is not available right now. Your account has not been changed."});}
  catch(JsonException){return await Reply(r,400,new{error="Invalid request JSON."});}
  catch(ArgumentException e){return await Reply(r,400,new{error=e.Message});}
  catch(InvalidOperationException e)when(e.Message.StartsWith("This game changed")){return await Reply(r,409,new{error=e.Message});}
  catch(Exception e){logger.LogError(e,"Scorekeeper request failed");return await Reply(r,503,new{error="Scorekeeper is temporarily unavailable. Your device has not received a confirmed save; refresh before retrying."});}
 }
 static async Task<T> Body<T>(HttpRequestData r)
 {
  using var buffer=new MemoryStream();var chunk=new byte[8192];int read;while((read=await r.Body.ReadAsync(chunk))>0){if(buffer.Length+read>2_000_000)throw new ArgumentException("Request is too large.");buffer.Write(chunk,0,read);}return JsonSerializer.Deserialize<T>(buffer.ToArray(),GameStore.Json)??throw new ArgumentException("Request body is required.");
 }
 static async Task<HttpResponseData> Reply(HttpRequestData r,int status,object data){var response=r.CreateResponse((HttpStatusCode)status);response.Headers.Add("Content-Type","application/json; charset=utf-8");response.Headers.Add("Cache-Control","no-store");await response.WriteStringAsync(JsonSerializer.Serialize(data,GameStore.Json));return response;}
}
