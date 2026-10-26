import type {Action,Game,GameRuleEdit} from './api';
import {targetEndRound} from './target-ending';
export function canEditGame(game:Game){return !game.finished&&(!game.presetId||game.presetId==='custom')}
function total(game:Game,id:string){const entries=game.entries.filter(e=>e.playerId===id);return game.scoreMode==='total'?(entries.at(-1)?.points??0):entries.reduce((sum,e)=>sum+e.points,0)}
export function completedEditRounds(game:Game){return Math.min(...game.players.map(p=>game.entries.filter(e=>e.playerId===p.id).length))}
export function minimumEditTarget(game:Game,targetEnd:'immediate'|'round'){
 let highest=Math.max(0,...game.players.map(p=>total(game,p.id)));
 if(targetEnd==='round'){const scores=new Map(game.players.map(p=>[p.id,0]));for(const entry of game.entries){const value=game.scoreMode==='total'?entry.points:(scores.get(entry.playerId)??0)+entry.points;scores.set(entry.playerId,value);highest=Math.max(highest,value)}}
 return highest+1;
}
/** Explicitly assign the editable fields: never spread a caller's object into a saved game. */
export function applyGameEdit(game:Game,rules:GameRuleEdit|undefined):Game{
 if(!canEditGame(game))throw new Error('Only in-progress custom games can be edited.');
 if(!rules)throw new Error('Choose the game rules to save.');
 const name=typeof rules.name==='string'?rules.name.trim():'';
 if(!name||name.length>60)throw new Error('Game name must contain 1–60 characters.');
 if(!['high','low','zero'].includes(rules.winner))throw new Error('Choose highest or lowest score wins.');
 if((game.winner==='zero')!==(rules.winner==='zero'))throw new Error('The countdown winner type is fixed after starting. Start a new game to change it.');
 if(game.winner==='zero'){if(rules.endCondition!==game.endCondition||rules.targetScore!==0||(rules.targetEnd??'immediate')!==(game.targetEnd??'immediate'))throw new Error('Countdown scoring and ending rules are fixed after starting.');return {...game,name}}
 if(!['manual','rounds','target'].includes(rules.endCondition))throw new Error('Choose a valid ending rule.');
 const changed:Game={...game,name,winner:rules.winner,endCondition:rules.endCondition,roundLimit:rules.endCondition==='rounds'?rules.roundLimit:undefined,targetScore:rules.endCondition==='target'?rules.targetScore:undefined,targetEnd:rules.endCondition==='target'?(rules.targetEnd??'immediate'):'immediate'};
 if(changed.endCondition==='rounds'&&(game.playStyle==='free'||!Number.isInteger(changed.roundLimit)||changed.roundLimit!<1||changed.roundLimit!*game.players.length>10000))throw new Error('Fixed rounds require turn-based play and a positive limit within 10,000 turns.');
 if(changed.endCondition==='target'&&(!Number.isInteger(changed.targetScore)||changed.targetScore!<1||changed.targetScore!>100000))throw new Error('Target score must be a whole number from 1 to 100,000.');
 if(!['immediate','round'].includes(changed.targetEnd!)||changed.targetEnd==='round'&&game.playStyle==='free')throw new Error('End of round requires turn-based play.');
 const endingChanged=changed.endCondition!==(game.endCondition??'manual')||changed.endCondition==='rounds'&&changed.roundLimit!==game.roundLimit||changed.endCondition==='target'&&(changed.targetScore!==game.targetScore||changed.targetEnd!==(game.targetEnd??'immediate'));
 if(endingChanged){
  if(changed.endCondition==='rounds'&&changed.roundLimit!<=completedEditRounds(game))throw new Error('Round limit must be greater than the rounds already completed.');
  if(changed.endCondition==='target'&&(game.players.some(p=>total(changed,p.id)>=changed.targetScore!)||changed.targetEnd==='round'&&targetEndRound(changed)!==null))throw new Error('Choose a higher score limit so the new ending rule starts ahead of recorded scores.');
 }
 return changed;
}
export type GameEditDraft={name:string;winner:'high'|'low'|'zero';endCondition:'manual'|'rounds'|'target';limit:string;targetEnd:'immediate'|'round'};
export function gameEditDraft(game:Game):GameEditDraft{return {name:game.name,winner:game.winner,endCondition:game.endCondition??'manual',limit:String(game.endCondition==='rounds'?game.roundLimit??10:game.targetScore??100),targetEnd:game.targetEnd??'immediate'}}
export function changeEditEnding(game:Game,draft:GameEditDraft,endCondition:GameEditDraft['endCondition']):GameEditDraft{return {...draft,endCondition,limit:endCondition===draft.endCondition?draft.limit:String(endCondition==='rounds'?Math.max(10,completedEditRounds(game)+1):Math.min(100000,Math.max(100,minimumEditTarget(game,draft.targetEnd))))}}
export function gameEditAction(game:Game,draft:GameEditDraft):Action{
 if(game.winner!=='zero'&&draft.endCondition!=='manual'&&!/^\d+$/.test(draft.limit))throw new Error('Enter a positive whole-number limit.');
 const rules:GameRuleEdit={name:draft.name,winner:draft.winner,endCondition:draft.endCondition,...(draft.endCondition==='rounds'?{roundLimit:Number(draft.limit)}:draft.endCondition==='target'?{targetScore:Number(draft.limit),targetEnd:draft.targetEnd}:{})};
 applyGameEdit(game,rules);return {action:'rules',rules};
}
