import {applyGameEdit} from './game-edit';
import {validateTargetEnding,targetEndRound,remainingTargetPlayers,finalRoundMessage} from './target-ending';
import {validateTargetScore,validateScoreLimit} from './score-limit';
import {ApiError,type Action,type Game,type GameView,type Rules} from "./api";
export const guestKey="scorekeeper-v1";
export type Storage={read:()=>Promise<string|null>;write:(value:string)=>Promise<void>};
export function validateRules(winner:string,rules:Rules){
 if(!["high","low"].includes(winner))throw new Error("Choose highest or lowest score wins.");
 if(!["turns","free"].includes(rules.playStyle||"turns"))throw new Error("Choose a valid play style.");
 if(!["add","total"].includes(rules.scoreMode||"add"))throw new Error("Choose a valid score entry mode.");
 if(rules.presetId!==undefined&&(typeof rules.presetId!=="string"||rules.presetId.length>60))throw new Error("Invalid preset identifier.");
 if(rules.presetVersion!==undefined&&(!Number.isInteger(rules.presetVersion)||rules.presetVersion<1))throw new Error("Invalid preset version.");
 const mode=rules.endCondition||"manual";
 if(mode==="rounds"&&rules.playStyle==="free")throw new Error("Fixed rounds require turn-based play. Choose manual or target-score ending for free-for-all.");
 if(!["manual","rounds","target"].includes(mode))throw new Error("Choose a valid ending rule.");
 if(mode==="rounds"&&(!Number.isInteger(rules.roundLimit)||rules.roundLimit!<1||rules.roundLimit!>Math.floor(10000/2)))throw new Error("Use a round limit between 1 and 5000.");
 validateTargetScore(rules);validateTargetEnding(rules);
}
export function totals(g:Game){return Object.fromEntries(g.players.map(p=>[p.id,g.scoreMode==="total"?(g.entries.filter(e=>e.playerId===p.id).at(-1)?.points||0):g.entries.filter(e=>e.playerId===p.id).reduce((n,e)=>n+e.points,0)]))}
export function completedRounds(g:Game){return Math.min(...g.players.map(p=>g.entries.filter(e=>e.playerId===p.id).length))}
export function autoEnd(g:Game):Game{
 const finalRound=targetEndRound(g);
 const reached=g.endCondition==="rounds"?completedRounds(g)>=g.roundLimit!:g.endCondition==="target"?(g.targetEnd==="round"?finalRound!==null&&completedRounds(g)>=finalRound:Object.values(totals(g)).some(t=>t>=g.targetScore!)):false;
 if(reached)return {...g,finished:true,finishReason:g.endCondition as "rounds"|"target"};
 const remaining=remainingTargetPlayers(g);
 if(remaining?.length&&!remaining.some(p=>p.id===g.next)){const start=g.players.findIndex(p=>p.id===g.next);const next=Array.from({length:g.players.length},(_,i)=>g.players[(start+i)%g.players.length]).find(p=>remaining.some(r=>r.id===p.id))!;g={...g,next:next.id}}
 return g.finishReason==="rounds"||g.finishReason==="target"?{...g,finished:false,finishReason:undefined}:g;
}
export function gameView(g:Game):GameView{const scores=totals(g);const best=g.winner==="high"?Math.max(...Object.values(scores)):Math.min(...Object.values(scores));return {game:g,totals:scores,winnerIds:g.finished&&g.entries.length?g.players.filter(p=>scores[p.id]===best).map(p=>p.id):[]}}
export function rulesLabel(g:Game){const ending= g.endCondition==="rounds"?`Round ${Math.min(completedRounds(g)+1,g.roundLimit!)} of ${g.roundLimit}`:g.endCondition==="target"?`Score limit ${g.targetScore} · ${g.targetEnd==="round"?"Ends at end of round":"Ends immediately"}`:"Finish whenever you're ready";return `${g.playStyle==="free"?"Free-for-all":"Turn-based"} · ${g.scoreMode==="total"?"Enter current totals":"Add points"} · ${ending}`}
export function validateGameCreation(name:string,names:string[],winner:"high"|"low",rules:Rules={}){
 const clean=names.map(n=>n.trim()).filter(Boolean);if(!name.trim()||name.trim().length>60||clean.length<2||clean.length>20||clean.some(n=>n.length>30)||new Set(clean.map(n=>n.toLowerCase())).size!==clean.length)throw new Error("Enter a game name and 2–20 different player names.");validateRules(winner,rules);if(rules.endCondition==="rounds"&&rules.roundLimit!*clean.length>10000)throw new Error("Round limit exceeds the maximum 10000 turns.");
 return clean;
}
export class LocalGames{
 constructor(private storage:Storage,private uuid:()=>string){}
 async read():Promise<Game[]>{const raw=await this.storage.read();let parsed:unknown;try{parsed=JSON.parse(raw||"[]")}catch{throw new Error("Saved games could not be read. Your original data has been kept.")};if(!Array.isArray(parsed)||parsed.some(g=>!g||!Array.isArray(g.players)||!Array.isArray(g.entries)||typeof g.id!=="string"))throw new Error("Saved games could not be read. Your original data has been kept.");return parsed.map(g=>({...g,version:g.version||1,updated:typeof g.updated==="number"?new Date(g.updated).toISOString():g.updated}))}
 async put(game:Game){const games=await this.read();await this.storage.write(JSON.stringify([game,...games.filter(g=>g.id!==game.id)]));return gameView(game)}
 async markDeviceOnly(id:string,deviceOnly:boolean){const g=(await this.get(id)).game;return this.put({...g,deviceOnly})}
 async list(){return(await this.read()).map(g=>({...g,turnCount:g.entries.length})).sort((a,b)=>Date.parse(b.updated)-Date.parse(a.updated))}
 async get(id:string){const g=(await this.read()).find(g=>g.id===id);if(!g)throw new Error("Game not found on this device.");return gameView(g)}
 async forget(id:string){const games=await this.read();await this.storage.write(JSON.stringify(games.filter(g=>g.id!==id)))}
 async deleteGame(game:Pick<Game,'id'|'version'>){const games=await this.read(),g=games.find(g=>g.id===game.id);if(!g)return {deleted:true};if(g.version!==game.version)throw new ApiError(409,'This game changed. Refresh before deleting.');if(g.finished)throw new Error('Only in-progress games can be deleted.');await this.storage.write(JSON.stringify(games.filter(g=>g.id!==game.id)));return {deleted:true}}
 async create(id:string,name:string,names:string[],winner:"high"|"low",rules:Rules={},options:{deviceOnly?:boolean}={}){
 const clean=validateGameCreation(name,names,winner,rules);
 const players=clean.map(name=>({id:this.uuid(),name}));const now=new Date().toISOString();return this.put({id,name:name.trim(),players,winner,...rules,...(options.deviceOnly?{deviceOnly:true}:{}),entries:[],next:players[0].id,finished:false,startedAt:now,endedAt:null,version:1,updated:now})}
 async act(game:Game,a:Action){let g=(await this.get(game.id)).game;const originalFinished=g.finished,originalEndedAt=g.endedAt;if(g.version!==game.version)throw new ApiError(409,"This game changed in another window. Refresh before scoring.");
 if(a.action==="score"||a.action==="edit"){if(!Number.isInteger(a.points)||Math.abs(a.points!)>100000)throw new Error("Points must be a whole number between -100,000 and 100,000.")}
 switch(a.action){
 case "score":if(g.finished)throw new Error("This game has finished.");if(g.entries.length>=10000)throw new Error("Game has reached the turn limit.");const playerId=g.playStyle==="free"?a.playerId:g.next;if(remainingTargetPlayers(g)?.every(p=>p.id!==playerId))throw new Error("This player has completed the final round. Score a remaining player.");if(!playerId||!g.players.some(p=>p.id===playerId))throw new Error("Choose the player receiving this score.");if(g.playStyle!=="free"&&a.playerId&&a.playerId!==g.next)throw new Error("Score the selected player's turn.");g={...g,entries:[...g.entries,{id:this.uuid(),playerId,points:a.points!}],next:g.playStyle==="free"?playerId:g.players[(g.players.findIndex(p=>p.id===g.next)+1)%g.players.length].id};g=autoEnd(g);break;
 case "select":if(remainingTargetPlayers(g)?.every(p=>p.id!==a.playerId))throw new Error("This player has completed the final round. Score a remaining player.");if(g.finished||!g.players.some(p=>p.id===a.playerId))throw new Error("Select a player in an active game.");g={...g,next:a.playerId!};break;
 case "edit":if(!g.entries.some(e=>e.id===a.entryId))throw new Error("Turn not found.");g=autoEnd({...g,entries:g.entries.map(e=>e.id===a.entryId?{...e,points:a.points!}:e)});break;
 case "undo":if(!g.entries.length)throw new Error("There is no turn to undo.");g=autoEnd({...g,next:g.entries[g.entries.length-1].playerId,entries:g.entries.slice(0,-1),finished:false,finishReason:undefined});break;
 case "rules":g=applyGameEdit(g,a.rules);break;
 case "finish":g={...g,finished:true,finishReason:"manual"};break;
 case "resume":g=autoEnd({...g,finished:false,finishReason:undefined});if(g.finished)throw new Error("Undo or edit a score to reopen a game that reached its limit.");break;
 }
 validateScoreLimit(g);
 const now=new Date().toISOString();return this.put({...g,version:g.version+1,updated:now,endedAt:g.finished?(originalFinished?originalEndedAt||null:now):null})}
}
