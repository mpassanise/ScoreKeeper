namespace Scorekeeper.Core;
public static partial class Scoring
{
 public static (Dictionary<Guid,long> Scores,Guid? FirstZero,int? Round) Countdown(Game g)
 {
  var scores=g.Players.ToDictionary(p=>p.Id,p=>g.StartingScore??0);var counts=g.Players.ToDictionary(p=>p.Id,p=>0);
  Guid? first=null;int? round=null;
  foreach(var e in g.Entries){
   if(e.Points is <0 or >100000)throw new ArgumentException("Enter a reduction from 0 to 100,000.");
   if(g.ExactZero==true&&e.Points>scores[e.PlayerId])throw new ArgumentException("Exact zero is required. A reduction cannot exceed the points remaining, including after a correction.");
   scores[e.PlayerId]=Math.Max(0,scores[e.PlayerId]-e.Points);counts[e.PlayerId]++;
   if(first is null&&scores[e.PlayerId]==0){first=e.PlayerId;round=counts.Values.Max();}
  }
  return (scores,first,round);
 }
}
