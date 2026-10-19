using Scorekeeper.Core;
using System.Text.Json;

static class OperationChecks
{
 static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
 public static async Task Run()
 {
  var checks=0;void Check(bool value,string name){if(!value)throw new Exception("Operation contract: "+name);checks++;}
  async Task Throws<T>(Func<Task> work)where T:Exception{try{await work();throw new Exception("Expected "+typeof(T).Name);}catch(T){checks++;}}
  var owner="verified-owner-A";var store=new TransactionFixture();var now=DateTimeOffset.Parse("2026-10-19T03:00:00Z");
  var service=new GameOperationService(store,new FixedTime(now));
  var game=Scoring.Create(Guid.Parse("11111111-1111-4111-8111-111111111111"),"Game",["One","Two"],"high");store.Seed(owner,game);
  string Wire(Guid id,Command command)=>JsonSerializer.Serialize(new ActionOperation(1,"action",id,game.Id,command),Json);
  var operationId=Guid.NewGuid();var entryId=Guid.NewGuid();var wire=Wire(operationId,new(game.Version,"score",10,game.Next,entryId));
  var first=await service.Execute(owner,wire);var retry=await service.Execute(owner,wire);
  Check(first==retry&&first.Outcome=="applied"&&first.CommittedVersion==2,"same receipt returned before stale version check");
  Check(store.Game(owner,game.Id)!.Entries.Length==1&&store.Game(owner,game.Id)!.Entries[0].Id==entryId,"one score with client stable entry ID");
  Check(store.Game(owner,game.Id)!.Updated==now,"server commit time injected");
  await Throws<OperationIdReusedException>(()=>service.Execute(owner,Wire(operationId,new(game.Version,"score",11,game.Next,entryId))));
  Check(store.Game(owner,game.Id)!.Entries.Length==1,"ID reuse cannot add another score");
  // Losing the response AFTER commit is recovered from the original receipt.
  var current=store.Game(owner,game.Id)!;var lostWire=Wire(Guid.NewGuid(),new(current.Version,"score",0,current.Next,Guid.NewGuid()));store.LoseAcknowledgement=true;
  await Throws<IOException>(()=>service.Execute(owner,lostWire));var lost=await service.Execute(owner,lostWire);
  Check(lost.Outcome=="applied"&&store.Game(owner,game.Id)!.Entries.Length==2,"lost acknowledgement replays one zero-point turn");
  // Failure between game mutation and receipt write must roll back both.
  current=store.Game(owner,game.Id)!;var crashWire=Wire(Guid.NewGuid(),new(current.Version,"score",3,current.Next,Guid.NewGuid()));store.FailReceipt=true;
  await Throws<IOException>(()=>service.Execute(owner,crashWire));Check(store.Game(owner,game.Id)!.Version==current.Version,"receipt failure rolls back game write");
  store.FailReceipt=false;await service.Execute(owner,crashWire);Check(store.Game(owner,game.Id)!.Entries.Length==3,"same operation recovers after rollback");
  current=store.Game(owner,game.Id)!;
  var undo=await service.Execute(owner,Wire(Guid.NewGuid(),new(current.Version,"undo",EntryId:entryId)));
  Check(undo.ErrorCode=="UNDO_TARGET_CHANGED"&&store.Game(owner,game.Id)!.Version==current.Version,"undo cannot target a different last entry");
  var undoneEntry=current.Entries[^1];await service.Execute(owner,Wire(Guid.NewGuid(),new(current.Version,"undo",EntryId:undoneEntry.Id)));
  current=store.Game(owner,game.Id)!;var reused=await service.Execute(owner,Wire(Guid.NewGuid(),new(current.Version,"score",9,current.Next,undoneEntry.Id)));
  Check(reused.ErrorCode=="ENTRY_ID_REUSED","undo does not free an entry ID for reuse");
  var staleWire=Wire(Guid.NewGuid(),new(1,"finish"));var stale=await service.Execute(owner,staleWire);Check(stale.ErrorCode=="VERSION_CONFLICT"&&stale.CommittedVersion is null,"conflicts are not acknowledgements of a score");
  Check(stale==await service.Execute(owner,staleWire),"rejected outcomes are stable receipts too");
  var foreign=await service.Execute("verified-owner-B",wire);Check(foreign.ErrorCode=="GAME_NOT_FOUND","same operation ID is isolated by owner");
  // A once-missing game cannot turn a rejected operation into a mutation later.
  store.Seed("verified-owner-B",game);Check(foreign==await service.Execute("verified-owner-B",wire)&&store.Game("verified-owner-B",game.Id)!.Entries.Length==0,"terminal rejection is never reinterpreted");
  var totals=game with{ScoreMode="total",PlayStyle="free"};store.Seed("totals",totals);var totalOne=await service.Execute("totals",Wire(Guid.NewGuid(),new(1,"score",30,game.Next,Guid.NewGuid())));
  var totalTwo=await service.Execute("totals",Wire(Guid.NewGuid(),new(2,"score",40,game.Next,Guid.NewGuid())));
  Check(totalOne.Outcome=="applied"&&totalTwo.Outcome=="applied"&&Scoring.Total(store.Game("totals",game.Id)!,game.Next)==40,"current totals retain total-mode semantics");
  // Concurrent copies enter a transaction; exactly one mutation is committed.
  store.Seed("concurrent",game);var concurrent=await Task.WhenAll(Enumerable.Range(0,10).Select(_=>service.Execute("concurrent",wire)));
  Check(concurrent.All(value=>value==concurrent[0])&&store.Game("concurrent",game.Id)!.Entries.Length==1,"concurrent replay applies once");
  store.Delete(owner,game.Id);var deleted=await service.Execute(owner,Wire(Guid.NewGuid(),new(current.Version,"finish")));
  Check(deleted.ErrorCode=="GAME_DELETED"&&store.Game(owner,game.Id) is null,"deletion marker prevents resurrection");
  Check(first==await service.Execute(owner,wire),"old receipt returns metadata only, never a deleted game snapshot");
  store.Blocked.Add(owner);await Throws<AccountOperationsBlockedException>(()=>service.Execute(owner,wire));
  await Throws<UnauthorizedAccessException>(()=>service.Execute("",wire));
  await Throws<ArgumentException>(()=>service.Execute("A",Wire(Guid.NewGuid(),new(1,"score",3,game.Next))));
  await Throws<JsonException>(()=>service.Execute("A",wire.Replace("\"kind\":\"action\"","\"kind\":\"action\",\"owner\":\"other\"")));
  await Throws<JsonException>(()=>service.Execute("A",wire.Replace("\"kind\":\"action\"","\"kind\":\"action\",\"kind\":\"action\"")));
  var normalized=JsonSerializer.Serialize(GameOperationProtocol.Parse(wire),Json);
  Check(GameOperationProtocol.Fingerprint(GameOperationProtocol.Parse(wire))==GameOperationProtocol.Fingerprint(GameOperationProtocol.Parse(normalized)),"typed round-trip has one fingerprint");
  var fixture=JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory,"game-operation-v1.json")));
  var fixtureOperation=GameOperationProtocol.Parse(fixture.RootElement.GetProperty("operation").GetRawText());
  Check(GameOperationProtocol.Fingerprint(fixtureOperation)==fixture.RootElement.GetProperty("fingerprint").GetString(),"web/native/server shared wire fingerprint fixture");
  Console.WriteLine($"{checks} replay-safe operation checks passed (transaction fixture; no SQL adapter enabled).");
 }
 sealed class FixedTime(DateTimeOffset now):TimeProvider{public override DateTimeOffset GetUtcNow()=>now;}
 sealed class TransactionFixture:IGameOperationStore
 {
  readonly SemaphoreSlim gate=new(1,1);Dictionary<(string,Guid),OperationGame> games=[];Dictionary<(string,Guid),OperationReceipt> receipts=[];
  public HashSet<string> Blocked=[];public bool LoseAcknowledgement,FailReceipt;
  static T Clone<T>(T value)=>JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(value,Json),Json)!;
  public void Seed(string owner,Game game)=>games[(owner,game.Id)]=new(game.Version,false,Clone(game));
  public Game? Game(string owner,Guid id)=>games.GetValueOrDefault((owner,id))?.State;
  public void Delete(string owner,Guid id)=>games[(owner,id)]=new(games[(owner,id)].Version+1,true,null);
  public async Task<T> Transaction<T>(string owner,Func<IGameOperationTransaction,Task<T>> work)
  {
   await gate.WaitAsync();try{
    await Task.Yield(); // Hold the transaction while concurrent submissions queue.
    var nextGames=games.ToDictionary(p=>p.Key,p=>Clone(p.Value));var nextReceipts=receipts.ToDictionary(p=>p.Key,p=>p.Value);
    var result=await work(new Tx(this,owner,nextGames,nextReceipts));games=nextGames;receipts=nextReceipts;
    if(LoseAcknowledgement){LoseAcknowledgement=false;throw new IOException("lost response after commit");}return result;
   }finally{gate.Release();}
  }
  sealed class Tx(TransactionFixture parent,string owner,Dictionary<(string,Guid),OperationGame> games,Dictionary<(string,Guid),OperationReceipt> receipts):IGameOperationTransaction
  {
   public Task<bool> AccountBlocked()=>Task.FromResult(parent.Blocked.Contains(owner));
   public Task<OperationReceipt?> ReadReceipt(Guid id)=>Task.FromResult(receipts.GetValueOrDefault((owner,id)));
   public Task<OperationGame?> ReadGame(Guid id)=>Task.FromResult(games.GetValueOrDefault((owner,id)));
   public Task<bool> EntryIdUsed(Guid gameId,Guid entryId)=>Task.FromResult(games.GetValueOrDefault((owner,gameId))?.State?.Entries.Any(e=>e.Id==entryId)==true||receipts.Any(p=>p.Key.Item1==owner&&p.Value.GameId==gameId&&p.Value.AddedEntryId==entryId));
   public Task WriteGame(Game game,long expected){if(games[(owner,game.Id)].Version!=expected)throw new InvalidOperationException("CAS failed");games[(owner,game.Id)]=new(game.Version,false,Clone(game));return Task.CompletedTask;}
   public Task WriteReceipt(OperationReceipt receipt){if(parent.FailReceipt)throw new IOException("failed before receipt commit");receipts.Add((owner,receipt.OperationId),receipt);return Task.CompletedTask;}
  }
 }
}
