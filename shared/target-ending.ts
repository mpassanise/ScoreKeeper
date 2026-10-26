import {countdownProgress} from './scoring';
import type {Game,Rules} from './api';
export function validateTargetEnding(rules:Rules){
 if(rules.targetEnd!==undefined&&!['immediate','round'].includes(rules.targetEnd))throw new Error('Choose a valid score-limit ending.');
 if(rules.targetEnd==='round'&&(rules.endCondition!=='target'||rules.playStyle==='free'))throw new Error('End of round requires a score limit and turn-based play.');
}
// Derive the first triggering round from history so corrections and undo are reversible.
export function targetEndRound(g:Game):number|null{
 if(g.endCondition!=='target'||g.targetEnd!=='round')return null;
 if(g.winner==='zero')return countdownProgress(g).round;
 const scores=new Map(g.players.map(p=>[p.id,0])),counts=new Map(g.players.map(p=>[p.id,0]));
 for(const e of g.entries){counts.set(e.playerId,(counts.get(e.playerId)||0)+1);scores.set(e.playerId,g.scoreMode==='total'?e.points:(scores.get(e.playerId)||0)+e.points);if((scores.get(e.playerId)||0)>=g.targetScore!)return Math.max(...counts.values())}
 return null;
}
export function remainingTargetPlayers(g:Game){const round=targetEndRound(g);return round===null?null:g.players.filter(p=>g.entries.filter(e=>e.playerId===p.id).length<round)}
export function finalRoundMessage(g:Game){if(g.finished)return '';const remaining=remainingTargetPlayers(g);return remaining?.length?`${g.winner==='zero'?'Zero':'Score limit'} reached. Finish this round — ${remaining.length} ${remaining.length===1?'turn':'turns'} remaining.`:''}
