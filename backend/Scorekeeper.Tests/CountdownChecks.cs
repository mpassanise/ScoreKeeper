using Scorekeeper.Core;
using System.Text.Json;
public static class CountdownChecks
{
 public static void Run(){
  void Check(bool ok,string message){if(!ok)throw new Exception(message);}
  void Reject(Action action){try{action();}catch(ArgumentException){return;}throw new Exception("Countdown should reject invalid request");}
  Game New(bool exact=false,string ending="immediate",string play="turns")=>Scoring.Create(Guid.NewGuid(),"Countdown",["A","B"],"zero",endCondition:"target",targetScore:0,scoreMode:"subtract",targetEnd:ending,startingScore:100,exactZero:exact,playStyle:play);
  var g=New();var first=g.Players[0].Id;Check(Scoring.Total(g,first)==100,"starting total");
  Reject(()=>Scoring.Create(Guid.NewGuid(),"Bad",["A","B"],"zero"));
  Reject(()=>Scoring.Create(Guid.NewGuid(),"Bad",["A","B"],"zero",endCondition:"target",targetScore:0,scoreMode:"subtract",startingScore:100001));
  Reject(()=>Scoring.Apply(g,new(g.Version,"score",-1)));
  g=Scoring.Apply(g,new(g.Version,"score",130));Check(g.Finished&&Scoring.Total(g,first)==0&&Scoring.View(g).WinnerIds.SequenceEqual([first]),"clamp wins");
  g=Scoring.Apply(g,new(g.Version,"undo"));Check(!g.Finished&&Scoring.Total(g,first)==100,"undo restores starting balance");
  var exact=New(true);Reject(()=>Scoring.Apply(exact,new(exact.Version,"score",101)));exact=Scoring.Apply(exact,new(exact.Version,"score",60));exact=Scoring.Apply(exact,new(exact.Version,"score",0));exact=Scoring.Apply(exact,new(exact.Version,"score",40));
  Reject(()=>Scoring.Apply(exact,new(exact.Version,"edit",80,EntryId:exact.Entries[0].Id)));
  exact=Scoring.Apply(exact,new(exact.Version,"edit",50,EntryId:exact.Entries[0].Id));Check(!exact.Finished&&Scoring.Total(exact,exact.Players[0].Id)==10,"correction replays history");
  var round=New(ending:"round");round=Scoring.Apply(round,new(round.Version,"score",100));Check(!round.Finished&&Scoring.RemainingTargetPlayers(round)!.Length==1,"wait for remaining round");
  Reject(()=>Scoring.Apply(round,new(round.Version,"select",PlayerId:round.Players[0].Id)));round=Scoring.Apply(round,new(round.Version,"score",100));Check(round.Finished&&Scoring.View(round).WinnerIds.SequenceEqual([round.Players[0].Id]),"first zero wins final-round ties");
  round=Scoring.Apply(round,new(round.Version,"undo"));Check(!round.Finished,"undo reopens final round");
  var free=New(play:"free");free=Scoring.Apply(free,new(free.Version,"score",100,PlayerId:free.Players[1].Id));Check(Scoring.View(free).WinnerIds.SequenceEqual([free.Players[1].Id]),"free selection");Reject(()=>New(ending:"round",play:"free"));
  var rename=New();var edited=Scoring.EditRules(rename,new("Renamed","zero","target",TargetScore:0));Check(edited.StartingScore==100&&edited.Name=="Renamed","rename preserves countdown settings");Reject(()=>Scoring.EditRules(rename,new("Changed","high","manual")));
  // Appending optional record members must not change old v1 receipt hashes.
  using var fixture=JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory,"game-lifecycle-v1.json")));
  var op=GameLifecycleProtocol.Parse(fixture.RootElement.GetProperty("wire").GetString()!);Check(GameLifecycleProtocol.Fingerprint(op)==fixture.RootElement.GetProperty("fingerprint").GetString(),"legacy lifecycle fingerprint retained");
  var current=New();var lifecycle=new LifecycleOperation(1,"create",Guid.NewGuid(),current.Id,0,current);var hash=GameLifecycleProtocol.Fingerprint(lifecycle);Check(hash!=GameLifecycleProtocol.Fingerprint(lifecycle with{Game=current with{ExactZero=true}}),"countdown options affect immutable fingerprint");
  var json=JsonSerializer.Serialize(lifecycle,new JsonSerializerOptions(JsonSerializerDefaults.Web));Check(GameLifecycleProtocol.Parse(json).Game!.StartingScore==100,"countdown strict wire round trip");
  Console.WriteLine("Countdown API: validation, clamp/exact, first-to-zero round wins, corrections/undo, free play and legacy receipt fingerprint compatibility passed.");
 }
}
