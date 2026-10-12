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
Console.WriteLine($"{checks} scoring checks passed.");
