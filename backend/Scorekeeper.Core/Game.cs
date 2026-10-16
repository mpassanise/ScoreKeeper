namespace Scorekeeper.Core;
public record Player(Guid Id, string Name);
public record Entry(Guid Id, Guid PlayerId, int Points);
public record Game(Guid Id, string Name, Player[] Players, string Winner, Entry[] Entries, Guid Next, bool Finished, long Version, DateTimeOffset Updated, string EndCondition = "manual", int? RoundLimit = null, long? TargetScore = null, string? FinishReason = null, string PlayStyle = "turns", string ScoreMode = "add", string? PresetId = null, int? PresetVersion = null, DateTimeOffset? StartedAt = null, DateTimeOffset? EndedAt = null, string TargetEnd = "immediate");
public record GameView(Game Game, Dictionary<Guid,long> Totals, Guid[] WinnerIds);
public record GameRuleEdit(string Name,string Winner,string EndCondition,int? RoundLimit=null,long? TargetScore=null,string TargetEnd="immediate");
public record Command(long ExpectedVersion, string Action, int? Points = null, Guid? PlayerId = null, Guid? EntryId = null,GameRuleEdit? Rules = null);
public static class Scoring
{
 public static Game Create(Guid id, string name, string[] names, string winner, string endCondition = "manual", int? roundLimit = null, long? targetScore = null, string playStyle = "turns", string scoreMode = "add", string? presetId = null, int? presetVersion = null, string targetEnd = "immediate")
 {
  if(names is null || names.Any(n=>n is null))throw new ArgumentException("Player names are required.");
  var players=names.Select(n=>new Player(Guid.NewGuid(),n.Trim())).ToArray();
  var now=DateTimeOffset.UtcNow;
  var game=new Game(id,(name??"").Trim(),players,winner,[],players.FirstOrDefault()?.Id??Guid.Empty,false,1,now,endCondition,roundLimit,targetScore,null,playStyle,scoreMode,presetId,presetVersion,now,null,targetEnd);
  Validate(game);return game;
 }
 public static void Validate(Game g)
 {
  if(g.Players is null || g.Entries is null)throw new ArgumentException("Players and entries are required.");
  if(g.Id==Guid.Empty || string.IsNullOrWhiteSpace(g.Name) || g.Name.Length>60) throw new ArgumentException("Game name must contain 1–60 characters.");
  if(g.Winner is not ("high" or "low")) throw new ArgumentException("Winner must be high or low.");
  if(g.Players.Length is <2 or >20 || g.Players.Any(p=>p is null || p.Id==Guid.Empty || string.IsNullOrWhiteSpace(p.Name)||p.Name.Length>30)) throw new ArgumentException("Use 2–20 players with names of 1–30 characters.");
  if(g.Players.Select(p=>p.Id).Distinct().Count()!=g.Players.Length || g.Players.Select(p=>p.Name.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).Count()!=g.Players.Length) throw new ArgumentException("Player IDs and names must be unique.");
  if(g.PlayStyle is not ("turns" or "free") || g.ScoreMode is not ("add" or "total"))throw new ArgumentException("Invalid play style or score entry mode.");
  if(g.PresetId?.Length>60 || g.PresetVersion is <1)throw new ArgumentException("Invalid preset metadata.");
  if(g.EndCondition=="rounds" && g.PlayStyle=="free")throw new ArgumentException("Fixed rounds require turn-based play.");
  if(g.EndCondition is not ("manual" or "rounds" or "target"))throw new ArgumentException("Choose a valid ending rule.");
  if(g.EndCondition=="rounds" && (g.RoundLimit is null or <1 || (long)g.RoundLimit*g.Players.Length>10000))throw new ArgumentException("Use a positive round limit within 10000 turns.");
  if(g.EndCondition=="target" && (g.TargetScore is null or <1 or >100000))throw new ArgumentException("Target score must be a whole number from 1 to 100,000.");
  if(g.TargetEnd is not ("immediate" or "round"))throw new ArgumentException("Choose a valid score-limit ending.");
  if(g.TargetEnd=="round" && (g.EndCondition!="target" || g.PlayStyle!="turns"))throw new ArgumentException("End of round requires a score limit and turn-based play.");
  if(g.FinishReason is not (null or "manual" or "rounds" or "target"))throw new ArgumentException("Invalid finish reason.");
  if(g.EndedAt is not null && !g.Finished)throw new ArgumentException("An active game cannot have an end time.");
  var ids=g.Players.Select(p=>p.Id).ToHashSet();
  if(!ids.Contains(g.Next)||g.Entries.Length>10000||g.Entries.Any(e=>e is null || e.Id==Guid.Empty||!ids.Contains(e.PlayerId)||Math.Abs((long)e.Points)>1000000)||g.Entries.Select(e=>e.Id).Distinct().Count()!=g.Entries.Length)throw new ArgumentException("Invalid score history or next player.");
  if(g.Players.Any(p=>Total(g,p.Id)>100000))throw new ArgumentException("Player totals cannot exceed 100,000. Enter a smaller score.");
 }
 public static Game Apply(Game g, Command c)
 {
  if(c.ExpectedVersion!=g.Version)throw new InvalidOperationException("This game changed on another device. Refresh before scoring.");
  Game changed;
  switch(c.Action)
  {
   case "score":
    if(g.Finished)throw new ArgumentException("Resume the game before adding a turn.");
    if(c.Points is null || Math.Abs((long)c.Points.Value)>100000)throw new ArgumentException("Points must be a whole number between -100,000 and 100,000.");
    if(g.Entries.Length>=10000)throw new ArgumentException("Game has reached the turn limit.");
    var scoringPlayer=g.PlayStyle=="free"?c.PlayerId:g.Next;
    if(RemainingTargetPlayers(g) is Player[] remaining && !remaining.Any(p=>p.Id==scoringPlayer))throw new ArgumentException("This player has completed the final round. Score a remaining player.");
    if(scoringPlayer is null || !g.Players.Any(p=>p.Id==scoringPlayer))throw new ArgumentException("Choose the player receiving this score.");
    if(g.PlayStyle=="turns" && c.PlayerId is not null && c.PlayerId!=g.Next)throw new ArgumentException("Score the selected player's turn.");
    var index=Array.FindIndex(g.Players,p=>p.Id==g.Next);
    changed=g with{Entries=[..g.Entries,new Entry(Guid.NewGuid(),scoringPlayer.Value,c.Points.Value)],Next=g.PlayStyle=="free"?scoringPlayer.Value:g.Players[(index+1)%g.Players.Length].Id};break;
   case "select":
    if(RemainingTargetPlayers(g) is Player[] selectable && !selectable.Any(p=>p.Id==c.PlayerId))throw new ArgumentException("This player has completed the final round. Score a remaining player.");
    if(g.Finished || !g.Players.Any(p=>p is null || p.Id==c.PlayerId))throw new ArgumentException("Select a player in an active game.");
    changed=g with{Next=c.PlayerId!.Value};break;
   case "edit":
    if(c.Points is null||Math.Abs((long)c.Points.Value)>100000||!g.Entries.Any(e=>e is null || e.Id==c.EntryId))throw new ArgumentException("Choose an existing turn and valid points.");
    changed=g with{Entries=g.Entries.Select(e=>e.Id==c.EntryId?e with{Points=c.Points.Value}:e).ToArray()};break;
   case "undo":
    if(g.Entries.Length==0)throw new ArgumentException("There is no active turn to undo.");
    changed=g with{Next=g.Entries[^1].PlayerId,Entries=g.Entries[..^1],Finished=false,FinishReason=null};break;
   case "rules":changed=EditRules(g,c.Rules);break;
   case "finish":changed=g with{Finished=true,FinishReason="manual"};break;
   case "resume":changed=AutoEnd(g with{Finished=false,FinishReason=null});if(changed.Finished)throw new ArgumentException("Undo or edit a score to reopen a game that reached its limit.");break;
   default:throw new ArgumentException("Unknown game action.");
  }
  if(c.Action is "score" or "edit" or "undo")changed=AutoEnd(changed);
  var now=DateTimeOffset.UtcNow;
  changed=changed with{Version=g.Version+1,Updated=now,EndedAt=changed.Finished?(g.Finished?g.EndedAt:now):null};Validate(changed);return changed;
 }
 public static Game EditRules(Game g,GameRuleEdit? rules)
 {
  if(g.Finished || !string.IsNullOrEmpty(g.PresetId) && g.PresetId!="custom")throw new ArgumentException("Only in-progress custom games can be edited.");
  if(rules is null)throw new ArgumentException("Choose the game rules to save.");
  var changed=g with{Name=(rules.Name??"").Trim(),Winner=rules.Winner,EndCondition=rules.EndCondition,RoundLimit=rules.EndCondition=="rounds"?rules.RoundLimit:null,TargetScore=rules.EndCondition=="target"?rules.TargetScore:null,TargetEnd=rules.EndCondition=="target"?rules.TargetEnd:"immediate"};
  Validate(changed);
  var endingChanged=changed.EndCondition!=g.EndCondition || changed.EndCondition=="rounds" && changed.RoundLimit!=g.RoundLimit || changed.EndCondition=="target" && (changed.TargetScore!=g.TargetScore || changed.TargetEnd!=g.TargetEnd);
  if(endingChanged){
   if(changed.EndCondition=="rounds" && g.Players.Min(p=>g.Entries.Count(e=>e.PlayerId==p.Id))>=changed.RoundLimit)throw new ArgumentException("Round limit must be greater than the rounds already completed.");
   if(changed.EndCondition=="target" && (changed.Players.Any(p=>Total(changed,p.Id)>=changed.TargetScore) || changed.TargetEnd=="round" && TargetEndRound(changed) is not null))throw new ArgumentException("Choose a higher score limit so the new ending rule starts ahead of recorded scores.");
  }
  return changed;
 }
 public static long Total(Game g,Guid playerId)=>g.ScoreMode=="total"?g.Entries.LastOrDefault(e=>e.PlayerId==playerId)?.Points??0:g.Entries.Where(e=>e.PlayerId==playerId).Sum(e=>(long)e.Points);
 public static Game AutoEnd(Game g)
 {
  var finalRound=TargetEndRound(g);
  var reached=g.EndCondition=="rounds" ? g.Players.Min(p=>g.Entries.Count(e=>e.PlayerId==p.Id))>=g.RoundLimit : g.EndCondition=="target" && (g.TargetEnd=="round" ? finalRound is not null && g.Players.Min(p=>g.Entries.Count(e=>e.PlayerId==p.Id))>=finalRound : g.Players.Any(p=>Total(g,p.Id)>=g.TargetScore));
  if(reached)return g with{Finished=true,FinishReason=g.EndCondition};
  if(RemainingTargetPlayers(g) is Player[] remaining && remaining.Length>0 && !remaining.Any(p=>p.Id==g.Next)){
   var start=Array.FindIndex(g.Players,p=>p.Id==g.Next);
   var next=Enumerable.Range(0,g.Players.Length).Select(i=>g.Players[(start+i)%g.Players.Length]).First(p=>remaining.Any(r=>r.Id==p.Id));g=g with{Next=next.Id};
  }
  return g.FinishReason is "rounds" or "target" ? g with{Finished=false,FinishReason=null}:g;
 }
 public static int? TargetEndRound(Game g)
 {
  if(g.EndCondition!="target" || g.TargetEnd!="round")return null;
  var scores=g.Players.ToDictionary(p=>p.Id,p=>0L);var counts=g.Players.ToDictionary(p=>p.Id,p=>0);
  foreach(var e in g.Entries){counts[e.PlayerId]++;scores[e.PlayerId]=g.ScoreMode=="total"?e.Points:scores[e.PlayerId]+e.Points;if(scores[e.PlayerId]>=g.TargetScore)return counts.Values.Max();}
  return null;
 }
 public static Player[]? RemainingTargetPlayers(Game g){var round=TargetEndRound(g);return round is null?null:g.Players.Where(p=>g.Entries.Count(e=>e.PlayerId==p.Id)<round).ToArray();}
 public static GameView View(Game g)
 {
  var totals=g.Players.ToDictionary(p=>p.Id,p=>Total(g,p.Id));
  var best=g.Winner=="high"?totals.Values.Max():totals.Values.Min();
  return new(g,totals,g.Finished && g.Entries.Length>0?g.Players.Where(p=>totals[p.Id]==best).Select(p=>p.Id).ToArray():[]);
 }
}
