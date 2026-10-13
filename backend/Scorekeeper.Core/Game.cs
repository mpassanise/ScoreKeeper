namespace Scorekeeper.Core;
public record Player(Guid Id, string Name);
public record Entry(Guid Id, Guid PlayerId, int Points);
public record Game(Guid Id, string Name, Player[] Players, string Winner, Entry[] Entries, Guid Next, bool Finished, long Version, DateTimeOffset Updated, string EndCondition = "manual", int? RoundLimit = null, long? TargetScore = null, string? FinishReason = null);
public record GameView(Game Game, Dictionary<Guid,long> Totals, Guid[] WinnerIds);
public record Command(long ExpectedVersion, string Action, int? Points = null, Guid? PlayerId = null, Guid? EntryId = null);
public static class Scoring
{
 public static Game Create(Guid id, string name, string[] names, string winner, string endCondition = "manual", int? roundLimit = null, long? targetScore = null)
 {
  if(names is null || names.Any(n=>n is null))throw new ArgumentException("Player names are required.");
  var players=names.Select(n=>new Player(Guid.NewGuid(),n.Trim())).ToArray();
  var game=new Game(id,(name??"").Trim(),players,winner,[],players.FirstOrDefault()?.Id??Guid.Empty,false,1,DateTimeOffset.UtcNow,endCondition,roundLimit,targetScore);
  Validate(game);return game;
 }
 public static void Validate(Game g)
 {
  if(g.Players is null || g.Entries is null)throw new ArgumentException("Players and entries are required.");
  if(g.Id==Guid.Empty || string.IsNullOrWhiteSpace(g.Name) || g.Name.Length>60) throw new ArgumentException("Game name must contain 1–60 characters.");
  if(g.Winner is not ("high" or "low")) throw new ArgumentException("Winner must be high or low.");
  if(g.Players.Length is <2 or >20 || g.Players.Any(p=>p is null || p.Id==Guid.Empty || string.IsNullOrWhiteSpace(p.Name)||p.Name.Length>30)) throw new ArgumentException("Use 2–20 players with names of 1–30 characters.");
  if(g.Players.Select(p=>p.Id).Distinct().Count()!=g.Players.Length || g.Players.Select(p=>p.Name.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).Count()!=g.Players.Length) throw new ArgumentException("Player IDs and names must be unique.");
  if(g.EndCondition is not ("manual" or "rounds" or "target"))throw new ArgumentException("Choose a valid ending rule.");
  if(g.EndCondition=="rounds" && (g.RoundLimit is null or <1 || (long)g.RoundLimit*g.Players.Length>10000))throw new ArgumentException("Use a positive round limit within 10000 turns.");
  if(g.EndCondition=="target" && (g.Winner!="high" || g.TargetScore is null or <1 or >10000000000))throw new ArgumentException("Target score requires highest score wins and a positive whole number up to 10000000000.");
  if(g.FinishReason is not (null or "manual" or "rounds" or "target"))throw new ArgumentException("Invalid finish reason.");
  var ids=g.Players.Select(p=>p.Id).ToHashSet();
  if(!ids.Contains(g.Next)||g.Entries.Length>10000||g.Entries.Any(e=>e is null || e.Id==Guid.Empty||!ids.Contains(e.PlayerId)||Math.Abs((long)e.Points)>1000000)||g.Entries.Select(e=>e.Id).Distinct().Count()!=g.Entries.Length)throw new ArgumentException("Invalid score history or next player.");
 }
 public static Game Apply(Game g, Command c)
 {
  if(c.ExpectedVersion!=g.Version)throw new InvalidOperationException("This game changed on another device. Refresh before scoring.");
  Game changed;
  switch(c.Action)
  {
   case "score":
    if(g.Finished)throw new ArgumentException("Resume the game before adding a turn.");
    if(c.Points is null || Math.Abs((long)c.Points.Value)>1000000)throw new ArgumentException("Points must be a whole number between -1000000 and 1000000.");
    if(g.Entries.Length>=10000)throw new ArgumentException("Game has reached the turn limit.");
    var index=Array.FindIndex(g.Players,p=>p.Id==g.Next);
    changed=g with{Entries=[..g.Entries,new Entry(Guid.NewGuid(),g.Next,c.Points.Value)],Next=g.Players[(index+1)%g.Players.Length].Id};break;
   case "select":
    if(g.Finished || !g.Players.Any(p=>p is null || p.Id==c.PlayerId))throw new ArgumentException("Select a player in an active game.");
    changed=g with{Next=c.PlayerId!.Value};break;
   case "edit":
    if(c.Points is null||Math.Abs((long)c.Points.Value)>1000000||!g.Entries.Any(e=>e is null || e.Id==c.EntryId))throw new ArgumentException("Choose an existing turn and valid points.");
    changed=g with{Entries=g.Entries.Select(e=>e.Id==c.EntryId?e with{Points=c.Points.Value}:e).ToArray()};break;
   case "undo":
    if(g.Entries.Length==0)throw new ArgumentException("There is no active turn to undo.");
    changed=g with{Next=g.Entries[^1].PlayerId,Entries=g.Entries[..^1],Finished=false,FinishReason=null};break;
   case "finish":changed=g with{Finished=true,FinishReason="manual"};break;
   case "resume":changed=AutoEnd(g with{Finished=false,FinishReason=null});if(changed.Finished)throw new ArgumentException("Undo or edit a score to reopen a game that reached its limit.");break;
   default:throw new ArgumentException("Unknown game action.");
  }
  if(c.Action is "score" or "edit" or "undo")changed=AutoEnd(changed);
  changed=changed with{Version=g.Version+1,Updated=DateTimeOffset.UtcNow};Validate(changed);return changed;
 }
 public static Game AutoEnd(Game g)
 {
  var reached=g.EndCondition=="rounds" ? g.Players.Min(p=>g.Entries.Count(e=>e.PlayerId==p.Id))>=g.RoundLimit : g.EndCondition=="target" && g.Players.Any(p=>g.Entries.Where(e=>e.PlayerId==p.Id).Sum(e=>(long)e.Points)>=g.TargetScore);
  if(reached)return g with{Finished=true,FinishReason=g.EndCondition};
  return g.FinishReason is "rounds" or "target" ? g with{Finished=false,FinishReason=null}:g;
 }
 public static GameView View(Game g)
 {
  var totals=g.Players.ToDictionary(p=>p.Id,p=>g.Entries.Where(e=>e.PlayerId==p.Id).Sum(e=>(long)e.Points));
  var best=g.Winner=="high"?totals.Values.Max():totals.Values.Min();
  return new(g,totals,g.Finished && g.Entries.Length>0?g.Players.Where(p=>totals[p.Id]==best).Select(p=>p.Id).ToArray():[]);
 }
}
