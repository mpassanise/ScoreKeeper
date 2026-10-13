import {ApiError,type Action,type Game,type GameView,type Rules} from "./api";
export const guestKey="scorekeeper-v1";
export type Storage={read:()=>Promise<string|null>;write:(value:string)=>Promise<void>};
export function validateRules(winner:string,rules:Rules){
 const mode=rules.endCondition||"manual";
 if(!["manual","rounds","target"].includes(mode))throw new Error("Choose a valid ending rule.");
 if(mode==="rounds"&&(!Number.isInteger(rules.roundLimit)||rules.roundLimit!<1||rules.roundLimit!>Math.floor(10000/2)))throw new Error("Use a round limit between 1 and 5000.");
 if(mode==="target"&&(winner!=="high"||!Number.isInteger(rules.targetScore)||rules.targetScore!<1||rules.targetScore!>10000000000))throw new Error("Target score requires highest score wins and a positive whole number up to 10000000000.");
}
export function totals(g:Game){return Object.fromEntries(g.players.map(p=>[p.id,g.entries.filter(e=>e.playerId===p.id).reduce((n,e)=>n+e.points,0)]))}
export function completedRounds(g:Game){return Math.min(...g.players.map(p=>g.entries.filter(e=>e.playerId===p.id).length))}
export function autoEnd(g:Game):Game{
 const reached=g.endCondition==="rounds"?completedRounds(g)>=g.roundLimit!:g.endCondition==="target"?Object.values(totals(g)).some(t=>t>=g.targetScore!):false;
 if(reached)return {...g,finished:true,finishReason:g.endCondition as "rounds"|"target"};
 return g.finishReason==="rounds"||g.finishReason==="target"?{...g,finished:false,finishReason:undefined}:g;
}
export function gameView(g:Game):GameView{const scores=totals(g);const best=g.winner==="high"?Math.max(...Object.values(scores)):Math.min(...Object.values(scores));return {game:g,totals:scores,winnerIds:g.finished&&g.entries.length?g.players.filter(p=>scores[p.id]===best).map(p=>p.id):[]}}
export function rulesLabel(g:Game){return g.endCondition==="rounds"?`Round ${Math.min(completedRounds(g)+1,g.roundLimit!)} of ${g.roundLimit}`:g.endCondition==="target"?`First to ${g.targetScore}`:"Finish whenever you're ready"}
export class LocalGames{
 constructor(private storage:Storage,private uuid:()=>string){}
 async read():Promise<Game[]>{const raw=await this.storage.read();let parsed:unknown;try{parsed=JSON.parse(raw||"[]")}catch{throw new Error("Saved games could not be read. Your original data has been kept.")};if(!Array.isArray(parsed)||parsed.some(g=>!g||!Array.isArray(g.players)||!Array.isArray(g.entries)||typeof g.id!=="string"))throw new Error("Saved games could not be read. Your original data has been kept.");return parsed.map(g=>({...g,version:g.version||1,updated:typeof g.updated==="number"?new Date(g.updated).toISOString():g.updated}))}
 async put(game:Game){const games=await this.read();await this.storage.write(JSON.stringify([game,...games.filter(g=>g.id!==game.id)]));return gameView(game)}
 async list(){return(await this.read()).map(g=>({...g,turnCount:g.entries.length})).sort((a,b)=>Date.parse(b.updated)-Date.parse(a.updated))}
 async get(id:string){const g=(await this.read()).find(g=>g.id===id);if(!g)throw new Error("Game not found on this device.");return gameView(g)}
 async create(id:string,name:string,names:string[],winner:"high"|"low",rules:Rules={}){
 const clean=names.map(n=>n.trim()).filter(Boolean);if(!name.trim()||name.trim().length>60||clean.length<2||clean.length>20||clean.some(n=>n.length>30)||new Set(clean.map(n=>n.toLowerCase())).size!==clean.length)throw new Error("Enter a game name and 2–20 different player names.");validateRules(winner,rules);if(rules.endCondition==="rounds"&&rules.roundLimit!*clean.length>10000)throw new Error("Round limit exceeds the maximum 10000 turns.");
 const players=clean.map(name=>({id:this.uuid(),name}));return this.put({id,name:name.trim(),players,winner,...rules,entries:[],next:players[0].id,finished:false,version:1,updated:new Date().toISOString()})}
 async act(game:Game,a:Action){let g=(await this.get(game.id)).game;if(g.version!==game.version)throw new ApiError(409,"This game changed in another window. Refresh before scoring.");
 if(a.action==="score"||a.action==="edit"){if(!Number.isInteger(a.points)||Math.abs(a.points!)>1000000)throw new Error("Points must be a whole number between -1000000 and 1000000.")}
 switch(a.action){
 case "score":if(g.finished)throw new Error("This game has finished.");if(g.entries.length>=10000)throw new Error("Game has reached the turn limit.");g={...g,entries:[...g.entries,{id:this.uuid(),playerId:g.next,points:a.points!}],next:g.players[(g.players.findIndex(p=>p.id===g.next)+1)%g.players.length].id};g=autoEnd(g);break;
 case "select":if(g.finished||!g.players.some(p=>p.id===a.playerId))throw new Error("Select a player in an active game.");g={...g,next:a.playerId!};break;
 case "edit":if(!g.entries.some(e=>e.id===a.entryId))throw new Error("Turn not found.");g=autoEnd({...g,entries:g.entries.map(e=>e.id===a.entryId?{...e,points:a.points!}:e)});break;
 case "undo":if(!g.entries.length)throw new Error("There is no turn to undo.");g=autoEnd({...g,next:g.entries[g.entries.length-1].playerId,entries:g.entries.slice(0,-1),finished:false,finishReason:undefined});break;
 case "finish":g={...g,finished:true,finishReason:"manual"};break;
 case "resume":g=autoEnd({...g,finished:false,finishReason:undefined});if(g.finished)throw new Error("Undo or edit a score to reopen a game that reached its limit.");break;
 }
 return this.put({...g,version:g.version+1,updated:new Date().toISOString()})}
}
