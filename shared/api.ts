import {validateTargetEnding} from './target-ending';
import {validateTargetScore,validateScoreAction,validateScoreLimit} from './score-limit';
export type Player={id:string;name:string};
export type Entry={id:string;playerId:string;points:number};
export type Rules={playStyle?:"turns"|"free";scoreMode?:"add"|"total";presetId?:string;presetVersion?:number;endCondition?:"manual"|"rounds"|"target";roundLimit?:number;targetScore?:number;targetEnd?:"immediate"|"round"};
export type Game=Rules & {id:string;name:string;players:Player[];winner:"high"|"low";entries:Entry[];next:string;finished:boolean;deviceOnly?:boolean;startedAt?:string|null;endedAt?:string|null;finishReason?:"manual"|"rounds"|"target";version:number;updated:string};
export type GameView={game:Game;totals:Record<string,number>;winnerIds:string[]};
export type GameSummary=Pick<Game,"id"|"name"|"players"|"winner"|"finished"|"version"|"updated"|"startedAt"|"endedAt"|"deviceOnly"> & {turnCount:number};
export type Action={action:"score"|"edit"|"select"|"undo"|"finish"|"resume";points?:number;playerId?:string;entryId?:string};
export type AccountStatus={scoringRulesEnabled?:boolean;scoringRulesVersion?:number;deletionEnabled:boolean;deletionStatus:"pending"|"completed"|null};
export type AccountDeletion={status:"pending"|"completed";message:string};
export class ApiError extends Error{constructor(public status:number,message:string){super(message)}}
export class ScorekeeperApi{
 constructor(private base:string,private token:()=>Promise<string>){if(!/^https:\/\//.test(base)&&!/^http:\/\/localhost(?::\d+)?(?:\/|$)/.test(base))throw new Error("Use HTTPS for the API.")}
 private async request<T>(path:string,body?:unknown):Promise<T>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
  const work=async()=>{const accessToken=await this.token();if(controller.signal.aborted)throw new ApiError(503,'Account connection timed out.');const response=await fetch(this.base.replace(/\/$/,"")+path,{method:body?"POST":"GET",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined,signal:controller.signal});const value:unknown=await response.json().catch(()=>null);if(!response.ok){const message=value&&typeof value==="object"&&"error" in value&&typeof value.error==="string"?value.error:"Request failed.";throw new ApiError(response.status,message)}return value as T};
  try{return await Promise.race([work(),new Promise<T>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ApiError(503,'Account connection timed out. Please try syncing again.'))},8000)})])}finally{clearTimeout(timer!)}
 }

 private async requireRoundEnding(rules:Rules){if(rules.targetEnd==='round'&&((await this.account()).scoringRulesVersion||0)<3)throw new Error('End-of-round scoring is not available for your account yet. Sync Games after the API update, or sign out to play locally.')}
 account(){return this.request<AccountStatus>("/account")}
 deleteAccount(confirmation:string){return this.request<AccountDeletion>("/account/delete",{confirmation})}
 list(){return this.request<GameSummary[]>("/games")}
 get(id:string){return this.request<GameView>(`/games/${encodeURIComponent(id)}`)}
 create(id:string,name:string,players:string[],winner:"high"|"low",rules:Rules={}){validateTargetScore(rules);validateTargetEnding(rules);const save=()=>this.request<GameView>("/games",{id,name,players,winner,...rules});return rules.targetEnd==="round"?this.requireRoundEnding(rules).then(save):save()}
 act(game:Game,action:Action){validateScoreAction(game,action);const save=()=>this.request<GameView>(`/games/${encodeURIComponent(game.id)}/actions`,{...action,expectedVersion:game.version});return game.targetEnd==="round"?this.requireRoundEnding(game).then(save):save()}
 import(game:Game){validateTargetScore(game);validateScoreLimit(game);validateTargetEnding(game);const save=()=>this.request<GameView>("/games/import",game);return game.targetEnd==="round"?this.requireRoundEnding(game).then(save):save()}
}
