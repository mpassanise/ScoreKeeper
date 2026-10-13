namespace Scorekeeper.Core;
public record Player(Guid Id, string Name);
public record Entry(Guid Id, Guid PlayerId, int Points);
public record Game(Guid Id, string Name, Player[] Players, string Winner, Entry[] Entries, Guid Next, bool Finished, long Version, DateTimeOffset Updated, string EndCondition = "manual", int? RoundLimit = null, long? TargetScore = null, string? FinishReason = null, string PlayStyle = "turns", string ScoreMode = "add", string? PresetId = null, int? PresetVersion = null, DateTimeOffset? StartedAt = null, DateTimeOffset? EndedAt = null);
public record GameView(Game Game, Dictionary<Guid,long> Totals, Guid[] WinnerIds);
public record Command(long ExpectedVersion, string Action, int? Points = null, Guid? PlayerId = null, Guid? EntryId = null);
public static class Scoring
{
 public static Game Create(Guid id, string name, string[] names, string winner, string endCondition = "manual", int? roundLimit = null, long? targetScore = null, string playStyle = "turns", string scoreMode = "add", string? presetId = null, int? presetVersion = null)
 {
  if(names is null || names.Any(n=>n is null))throw new ArgumentException("Player names are required.");
  var players=names.Select(n=>new Player(Guid.NewGuid(),n.Trim())).ToArray();
  var now=DateTimeOffset.UtcNow;
  var game=new Game(id,(name??"").Trim(),players,winner,[],players.FirstOrDefault()?.Id??Guid.Empty,false,1,now,endCondition,roundLimit,targetScore,null,playStyle,scoreMode,presetId,presetVersion,now,null);
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
  if(g.EndCondition=="target" && g.ScoreMode=="total" && g.TargetScore>1000000)throw new ArgumentException("A score limit for current totals cannot exceed 1000000.");
  if(g.EndCondition=="target" && (g.TargetScore is null or <1 or >10000000000))throw new ArgumentException("Target score must be a positive whole number up to 10000000000.");
  if(g.FinishReason is not (null or "manual" or "rounds" or "target"))throw new ArgumentException("Invalid finish reason.");
  if(g.EndedAt is not null && !g.Finished)throw new ArgumentException("An active game cannot have an end time.");
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
    var scoringPlayer=g.PlayStyle=="free"?c.PlayerId:g.Next;
    if(scoringPlayer is null || !g.Players.Any(p=>p.Id==scoringPlayer))throw new ArgumentException("Choose the player receiving this score.");
    if(g.PlayStyle=="turns" && c.PlayerId is not null && c.PlayerId!=g.Next)throw new ArgumentException("Score the selected player's turn.");
    var index=Array.FindIndex(g.Players,p=>p.Id==g.Next);
    changed=g with{Entries=[..g.Entries,new Entry(Guid.NewGuid(),scoringPlayer.Value,c.Points.Value)],Next=g.PlayStyle=="free"?scoringPlayer.Value:g.Players[(index+1)%g.Players.Length].Id};break;
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
  var now=DateTimeOffset.UtcNow;
  changed=changed with{Version=g.Version+1,Updated=now,EndedAt=changed.Finished?(g.Finished?g.EndedAt:now):null};Validate(changed);return changed;
 }
 public static long Total(Game g,Guid playerId)=>g.ScoreMode=="total"?g.Entries.LastOrDefault(e=>e.PlayerId==playerId)?.Points??0:g.Entries.Where(e=>e.PlayerId==playerId).Sum(e=>(long)e.Points);
 public static Game AutoEnd(Game g)
 {
  var reached=g.EndCondition=="rounds" ? g.Players.Min(p=>g.Entries.Count(e=>e.PlayerId==p.Id))>=g.RoundLimit : g.EndCondition=="target" && g.Players.Any(p=>Total(g,p.Id)>=g.TargetScore);
  if(reached)return g with{Finished=true,FinishReason=g.EndCondition};
  return g.FinishReason is "rounds" or "target" ? g with{Finished=false,FinishReason=null}:g;
 }
 public static GameView View(Game g)
 {
  var totals=g.Players.ToDictionary(p=>p.Id,p=>Total(g,p.Id));
  var best=g.Winner=="high"?totals.Values.Max():totals.Values.Min();
  return new(g,totals,g.Finished && g.Entries.Length>0?g.Players.Where(p=>totals[p.Id]==best).Select(p=>p.Id).ToArray():[]);
 }
}
