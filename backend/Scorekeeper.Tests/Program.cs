using Scorekeeper.Core;
var checks=0;
void Check(bool value,string name){checks++;if(!value)throw new Exception(name);}
void Throws<T>(Action action,string name)where T:Exception{try{action();throw new Exception(name);}catch(T){checks++;}}
var g=Scoring.Create(Guid.NewGuid(),"Scrabble",["Mike","Stephanie"],"high");
Check(g.Next==g.Players[0].Id,"first player");
g=Scoring.Apply(g,new(g.Version,"score",18));Check(g.Next==g.Players[1].Id,"advance turn");
g=Scoring.Apply(g,new(g.Version,"score",24));Check(g.Next==g.Players[0].Id,"wrap turn order");
g=Scoring.Apply(g,new(g.Version,"score",-3));Check(Scoring.View(g).Totals[g.Players[0].Id]==15,"negative score total");
var oldNext=g.Next;g=Scoring.Apply(g,new(g.Version,"edit",30,EntryId:g.Entries[0].Id));Check(g.Next==oldNext,"edit keeps next player");Check(Scoring.View(g).Totals[g.Players[0].Id]==27,"edited total");
g=Scoring.Apply(g,new(g.Version,"undo"));Check(g.Next==g.Players[0].Id && g.Entries.Length==2,"undo restores player");
Throws<InvalidOperationException>(()=>Scoring.Apply(g,new(g.Version-1,"score",10)),"stale version rejected");
Throws<ArgumentException>(()=>Scoring.Apply(g,new(g.Version,"select",PlayerId:Guid.NewGuid())),"foreign player rejected");
Throws<ArgumentException>(()=>Scoring.Apply(g,new(g.Version,"score",int.MinValue)),"overflow input rejected");
g=Scoring.Apply(g,new(g.Version,"finish"));Check(Scoring.View(g).WinnerIds.SequenceEqual([g.Players[0].Id]),"high winner");
Throws<ArgumentException>(()=>Scoring.Apply(g,new(g.Version,"score",3)),"finished games block scores");
g=Scoring.Apply(g,new(g.Version,"edit",24,EntryId:g.Entries[0].Id));Check(Scoring.View(g).WinnerIds.Length==2,"ties include both winners");
var low=Scoring.Create(Guid.NewGuid(),"Golf",["A","B"],"low");low=Scoring.Apply(low,new(low.Version,"score",7));low=Scoring.Apply(low,new(low.Version,"score",4));low=Scoring.Apply(low,new(low.Version,"finish"));Check(Scoring.View(low).WinnerIds.SequenceEqual([low.Players[1].Id]),"low winner");
Throws<ArgumentException>(()=>Scoring.Create(Guid.NewGuid(),"Game",["Mike"," mike "],"high"),"duplicate names rejected");
Throws<ArgumentException>(()=>Scoring.Validate(g with{Next=Guid.NewGuid()}),"invalid imports rejected");
// New game endings, round fairness and correction after automatic completion.
var rounds=Scoring.Create(Guid.NewGuid(),"Rounds",["A","B"],"high","rounds",1);
rounds=Scoring.Apply(rounds,new(rounds.Version,"score",5));Check(!rounds.Finished,"wait for every player");
rounds=Scoring.Apply(rounds,new(rounds.Version,"select",PlayerId:rounds.Players[0].Id));
rounds=Scoring.Apply(rounds,new(rounds.Version,"score",5));Check(!rounds.Finished,"extra turn is not a full round");
rounds=Scoring.Apply(rounds,new(rounds.Version,"score",10));Check(rounds.Finished&&Scoring.View(rounds).WinnerIds.Length==2,"complete round supports ties");
rounds=Scoring.Apply(rounds,new(rounds.Version,"undo"));Check(!rounds.Finished&&rounds.Next==rounds.Players[1].Id,"undo reopens completed round");
var target=Scoring.Create(Guid.NewGuid(),"Target",["A","B"],"high","target",targetScore:20);
target=Scoring.Apply(target,new(target.Version,"score",25));Check(target.Finished&&target.Entries.Length==1,"target ends immediately on overshoot");
Throws<ArgumentException>(()=>Scoring.Apply(target,new(target.Version,"resume")),"limit cannot be resumed while met");
target=Scoring.Apply(target,new(target.Version,"edit",10,EntryId:target.Entries[0].Id));Check(!target.Finished,"edit below target reopens");
target=Scoring.Apply(target,new(target.Version,"edit",20,EntryId:target.Entries[0].Id));Check(target.Finished,"edit to target ends");
Throws<ArgumentException>(()=>Scoring.Create(Guid.NewGuid(),"Bad",["A","B"],"high","rounds",2,playStyle:"free"),"free rounds rejected");
Throws<ArgumentException>(()=>Scoring.Create(Guid.NewGuid(),"Bad",["A","B"],"high","rounds",0),"zero rounds rejected");
var legacy=System.Text.Json.JsonSerializer.Deserialize<Game>("{\"Id\":\""+Guid.NewGuid()+"\",\"Name\":\"Old\",\"Players\":[],\"Winner\":\"high\",\"Entries\":[],\"Next\":\""+Guid.NewGuid()+"\",\"Finished\":false,\"Version\":1,\"Updated\":\"2026-10-01T00:00:00Z\"}");
Check(legacy?.EndCondition=="manual" && legacy.PlayStyle=="turns" && legacy.ScoreMode=="add","legacy JSON defaults to turn-based additive manual games");
var free=Scoring.Create(Guid.NewGuid(),"Free",["A","B"],"high",playStyle:"free");var b=free.Players[1].Id;
Throws<ArgumentException>(()=>Scoring.Apply(free,new(free.Version,"score",4)),"free needs an explicit player");
Throws<ArgumentException>(()=>Scoring.Apply(free,new(free.Version,"score",4,PlayerId:Guid.NewGuid())),"free rejects a foreign player");
free=Scoring.Apply(free,new(free.Version,"score",4,PlayerId:b));free=Scoring.Apply(free,new(free.Version,"score",6,PlayerId:b));Check(Scoring.View(free).Totals[b]==10&&free.Next==b,"free scores same player twice without rotating");
var snapshot=Scoring.Create(Guid.NewGuid(),"Totals",["A","B"],"high","target",targetScore:50,playStyle:"free",scoreMode:"total");var a=snapshot.Players[0].Id;
snapshot=Scoring.Apply(snapshot,new(snapshot.Version,"score",30,PlayerId:a));snapshot=Scoring.Apply(snapshot,new(snapshot.Version,"score",40,PlayerId:a));Check(Scoring.View(snapshot).Totals[a]==40&&!snapshot.Finished,"total snapshots replace not add");
snapshot=Scoring.Apply(snapshot,new(snapshot.Version,"edit",80,EntryId:snapshot.Entries[0].Id));Check(Scoring.View(snapshot).Totals[a]==40&&!snapshot.Finished,"older snapshot edit does not replace newest");
snapshot=Scoring.Apply(snapshot,new(snapshot.Version,"undo"));Check(Scoring.View(snapshot).Totals[a]==80&&snapshot.Finished,"undo restores and reevaluates previous total");
snapshot=Scoring.Apply(snapshot,new(snapshot.Version,"edit",20,EntryId:snapshot.Entries[0].Id));Check(!snapshot.Finished,"correcting current total reopens game");
var penalties=Scoring.Create(Guid.NewGuid(),"Penalties",["A","B"],"low","target",targetScore:20,playStyle:"free");penalties=Scoring.Apply(penalties,new(penalties.Version,"score",20,PlayerId:penalties.Players[0].Id));Check(penalties.Finished&&Scoring.View(penalties).WinnerIds.SequenceEqual([penalties.Players[1].Id]),"threshold ending independent of winner rule");
Throws<ArgumentException>(()=>Scoring.Create(Guid.NewGuid(),"Impossible",["A","B"],"high","target",targetScore:1000001,scoreMode:"total"),"unreachable total limit rejected");
var timed=Scoring.Create(Guid.NewGuid(),"Timed",["A","B"],"high","target",targetScore:10);
var started=timed.StartedAt;Check(started is not null&&started==timed.Updated&&timed.EndedAt is null,"creation records start only");
timed=Scoring.Apply(timed,new(timed.Version,"score",10));var ended=timed.EndedAt;Check(ended is not null&&timed.StartedAt==started,"automatic finish records end and preserves start");
timed=Scoring.Apply(timed,new(timed.Version,"edit",11,EntryId:timed.Entries[0].Id));Check(timed.EndedAt==ended,"editing finished scores preserves end");
timed=Scoring.Apply(timed,new(timed.Version,"undo"));Check(timed.EndedAt is null&&timed.StartedAt==started,"undo completion clears end");
timed=Scoring.Apply(timed,new(timed.Version,"finish"));Check(timed.EndedAt is not null,"manual finish records end");
timed=Scoring.Apply(timed,new(timed.Version,"resume"));Check(timed.EndedAt is null&&timed.StartedAt==started,"resume clears end and preserves start");
var roundTrip=System.Text.Json.JsonSerializer.Deserialize<Game>(System.Text.Json.JsonSerializer.Serialize(timed));Check(roundTrip?.StartedAt==started,"metadata survives import JSON round-trip");
Check(legacy?.StartedAt is null && legacy?.EndedAt is null,"legacy games do not fabricate timestamps");
Throws<ArgumentException>(()=>Scoring.Validate(timed with{EndedAt=DateTimeOffset.UtcNow}),"active game cannot have end timestamp");
var tenant=Guid.NewGuid();var customer=Guid.NewGuid();var owner=$"{tenant:D}:{customer:D}";
var store=new FakeDeletionStore();var directory=new FakeDirectory(tenant.ToString());var service=new AccountDeletionService(store,directory);
async Task Reject<T>(string account,string confirmation,string name)where T:Exception{try{await service.Delete(account,confirmation);throw new Exception(name);}catch(T){checks++;}}
await Reject<ArgumentException>(owner,"delete","confirmation is exact");Check(store.State is null&&directory.Calls==0,"confirmation failure has no effects");
await Reject<UnauthorizedAccessException>($"{Guid.NewGuid()}:{customer:D}","DELETE","foreign tenant rejected");
directory.IsConfigured=false;await Reject<InvalidOperationException>(owner,"DELETE","disabled deletion rejected");Check(store.State is null,"disabled leaves account active");directory.IsConfigured=true;
directory.Reject=true;await Reject<ArgumentException>(owner,"DELETE","non-customer rejected");Check(store.State is null,"verification precedes recording");directory.Reject=false;
directory.Fail=true;var result=await service.Delete(owner,"DELETE");Check(result.Status=="pending"&&store.State=="pending"&&!store.Removed,"directory failure retains durable request and data");Check(directory.Target==customer,"target is authenticated owner");
directory.Fail=false;store.Fail=true;result=await service.Delete(owner,"DELETE");Check(result.Status=="pending"&&directory.Deleted&&!store.Removed,"SQL failure after identity deletion remains pending");
store.Fail=false;result=await service.Delete(owner,"DELETE");Check(result.Status=="completed"&&store.Removed&&store.State=="completed","retry completes after identity is gone");
var calls=directory.Calls;result=await service.Delete(owner,"DELETE");Check(result.Status=="completed"&&directory.Calls==calls,"completed retry is idempotent");
foreach(var mode in new[]{"add","total"}){
 var cap=Scoring.Create(Guid.NewGuid(),"Cap",["A","B"],"high",playStyle:"free",scoreMode:mode);
 var player=cap.Players[0].Id;cap=Scoring.Apply(cap,new(cap.Version,"score",9999,PlayerId:player));
 Check(Scoring.Total(cap,player)==9999,"exact score cap accepted");
 Throws<ArgumentException>(()=>Scoring.Apply(cap,new(cap.Version,"score",mode=="add"?1:10000,PlayerId:player)),"score overflow rejected");
 Throws<ArgumentException>(()=>Scoring.Apply(cap,new(cap.Version,"edit",10000,EntryId:cap.Entries[0].Id)),"edit overflow rejected");
 cap=Scoring.Apply(cap,new(cap.Version,"score",-5,PlayerId:player));Check(Scoring.Total(cap,player)==(mode=="add"?9994:-5),"negative score adjustments accepted");
}
Throws<ArgumentException>(()=>Scoring.Create(Guid.NewGuid(),"Cap",["A","B"],"high","target",targetScore:10000),"target overflow rejected");
Check(Scoring.Create(Guid.NewGuid(),"Cap",["A","B"],"high","target",targetScore:9999).TargetScore==9999,"exact target cap accepted");
// Score-limit end-of-round grants each remaining player one turn.
var final=Scoring.Create(Guid.NewGuid(),"Final round",["A","B","C"],"high","target",targetScore:20,targetEnd:"round");
final=Scoring.Apply(final,new(final.Version,"score",20));Check(!final.Finished&&Scoring.TargetEndRound(final)==1,"threshold starts final round");
Throws<ArgumentException>(()=>Scoring.Apply(final,new(final.Version,"select",PlayerId:final.Players[0].Id)),"completed final-round player cannot be selected again");
final=Scoring.Apply(final,new(final.Version,"score",25));Check(!final.Finished&&final.Next==final.Players[2].Id,"another threshold does not restart final round");
final=Scoring.Apply(final,new(final.Version,"score",0));Check(final.Finished&&Scoring.View(final).WinnerIds.SequenceEqual([final.Players[1].Id]),"remaining player can win; zero-score turn completes round");
final=Scoring.Apply(final,new(final.Version,"undo"));Check(!final.Finished&&final.Next==final.Players[2].Id,"undo last final-round turn reopens");
final=Scoring.Apply(final,new(final.Version,"edit",5,EntryId:final.Entries[0].Id));Check(Scoring.TargetEndRound(final)==1,"other threshold preserves final round after correction");
final=Scoring.Apply(final,new(final.Version,"edit",5,EntryId:final.Entries[1].Id));Check(Scoring.TargetEndRound(final)==null&&!final.Finished,"correction removing all crossings cancels final round");
final=Scoring.Apply(final,new(final.Version,"score",0));final=Scoring.Apply(final,new(final.Version,"score",15));Check(Scoring.TargetEndRound(final)==2&&!final.Finished,"later threshold starts second final round");
final=Scoring.Apply(final,new(final.Version,"score",15));final=Scoring.Apply(final,new(final.Version,"score",20));Check(final.Finished&&Scoring.View(final).WinnerIds.Length==3,"final round uses final totals including ties");
var roundSnapshot=Scoring.Create(Guid.NewGuid(),"Snapshots",["A","B"],"low","target",targetScore:20,scoreMode:"total",targetEnd:"round");
roundSnapshot=Scoring.Apply(roundSnapshot,new(roundSnapshot.Version,"score",20));roundSnapshot=Scoring.Apply(roundSnapshot,new(roundSnapshot.Version,"score",10));Check(roundSnapshot.Finished&&Scoring.View(roundSnapshot).WinnerIds.SequenceEqual([roundSnapshot.Players[1].Id]),"round ending supports current totals and lowest winner");
var last=Scoring.Create(Guid.NewGuid(),"Last player",["A","B"],"high","target",targetScore:20,targetEnd:"round");last=Scoring.Apply(last,new(last.Version,"score",0));last=Scoring.Apply(last,new(last.Version,"score",20));Check(last.Finished,"threshold on last player ends at current round boundary");
Throws<ArgumentException>(()=>Scoring.Create(Guid.NewGuid(),"Bad",["A","B"],"high","target",targetScore:20,playStyle:"free",targetEnd:"round"),"free-for-all round ending rejected");
Throws<ArgumentException>(()=>Scoring.Create(Guid.NewGuid(),"Bad",["A","B"],"high",targetEnd:"round"),"round modifier requires target ending");
Throws<ArgumentException>(()=>Scoring.Create(Guid.NewGuid(),"Bad",["A","B"],"high",targetEnd:"unknown"),"unknown target ending rejected");
Check(legacy?.TargetEnd=="immediate","legacy JSON keeps immediate target ending");
Console.WriteLine($"{checks} scoring and deletion checks passed.");
sealed class FakeDeletionStore:IAccountDeletionStore
{
 public string? State;public bool Removed,Fail;
 public Task<string?> DeletionState(string owner)=>Task.FromResult(State);
 public Task BeginDeletion(string owner){State="pending";return Task.CompletedTask;}
 public Task CompleteDeletion(string owner){if(Fail)throw new Exception("SQL unavailable");Removed=true;State="completed";return Task.CompletedTask;}
}
sealed class FakeDirectory(string tenant):ICustomerDirectory
{
 public bool IsConfigured{get;set;}=true;public string TenantId=>tenant;public bool Reject,Fail,Deleted;public Guid Target;public int Calls;
 public Task VerifyCustomer(Guid id){Calls++;Target=id;if(Reject)throw new ArgumentException("Not a customer");return Task.CompletedTask;}
 public Task DeleteCustomer(Guid id){Calls++;Target=id;if(Fail)throw new Exception("Graph unavailable");Deleted=true;return Task.CompletedTask;}
}
