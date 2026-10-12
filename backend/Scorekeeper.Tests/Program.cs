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
