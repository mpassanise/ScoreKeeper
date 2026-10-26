import type {Game} from './api';
/** Replay reductions in order: clamping must also apply to corrections/undo. */
export function countdownProgress(g:Game){
 const scores=Object.fromEntries(g.players.map(p=>[p.id,g.startingScore??0])),counts=Object.fromEntries(g.players.map(p=>[p.id,0]));
 let firstZero:string|undefined,round:number|null=null;const zeroOrder:string[]=[];
 for(const e of g.entries){
  if(!Number.isInteger(e.points)||e.points<0||e.points>100000)throw new Error('Enter a reduction from 0 to 100,000.');
  if(g.exactZero&&e.points>scores[e.playerId])throw new Error('Exact zero is required. A reduction cannot exceed the points remaining, including after a correction.');
  scores[e.playerId]=Math.max(0,scores[e.playerId]-e.points);counts[e.playerId]++;
  if(scores[e.playerId]===0&&!zeroOrder.includes(e.playerId))zeroOrder.push(e.playerId);
  if(firstZero===undefined&&scores[e.playerId]===0){firstZero=e.playerId;round=Math.max(...Object.values(counts))}
 }
 return {scores,firstZero,round,zeroOrder};
}
export function scoreTotals(g:Game):Record<string,number>{
 if(g.winner==='zero')return countdownProgress(g).scores;
 const scores=Object.fromEntries(g.players.map(p=>[p.id,0]));
 for(const e of g.entries)scores[e.playerId]=g.scoreMode==='total'?e.points:scores[e.playerId]+e.points;
 return scores;
}
export function winnerLabel(g:Pick<Game,'winner'>){return g.winner==='zero'?'First to zero wins':g.winner==='high'?'Highest score wins':'Lowest score wins'}
