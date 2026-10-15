import type {PlayerChange,PlayerProfile} from './frequent-player-sync';
import {validateTargetEnding} from './target-ending';
import {validateTargetScore,validateScoreAction,validateScoreLimit} from './score-limit';
export type Player={id:string;name:string};
export type Entry={id:string;playerId:string;points:number};
export type Rules={playStyle?:"turns"|"free";scoreMode?:"add"|"total";presetId?:string;presetVersion?:number;endCondition?:"manual"|"rounds"|"target";roundLimit?:number;targetScore?:number;targetEnd?:"immediate"|"round"};
export type Game=Rules & {id:string;name:string;players:Player[];winner:"high"|"low";entries:Entry[];next:string;finished:boolean;deviceOnly?:boolean;startedAt?:string|null;endedAt?:string|null;finishReason?:"manual"|"rounds"|"target";version:number;updated:string};
export type GameView={game:Game;totals:Record<string,number>;winnerIds:string[]};
export type GameSummary=Pick<Game,"id"|"name"|"players"|"winner"|"finished"|"version"|"updated"|"startedAt"|"endedAt"|"deviceOnly"> & {turnCount:number};
export type Action={action:"score"|"edit"|"select"|"undo"|"finish"|"resume";points?:number;playerId?:string;entryId?:string};
export type AccountStatus={profileId?:string;scoringRulesEnabled?:boolean;scoringRulesVersion?:number;deletionEnabled:boolean;deletionStatus:"pending"|"completed"|null};
export type AccountDeletion={status:"pending"|"completed";message:string};
export class ApiError extends Error{constructor(public status:number,message:string,public code?:string){super(message)}}
export class ScorekeeperApi{
 constructor(private base:string,private token:()=>Promise<string>){if(!/^https:\/\//.test(base)&&!/^http:\/\/localhost(?::\d+)?(?:\/|$)/.test(base))throw new Error("Use HTTPS for the API.")}
 // Token acquisition and API I/O have separate budgets. A cold Function/SQL
 // connection must not lose its entire budget to a silent token refresh.
 private async accessToken(){
  let timer:ReturnType<typeof setTimeout>;
  try{return await Promise.race([this.token(),new Promise<string>((_,reject)=>{timer=setTimeout(()=>reject(new ApiError(408,'Sign-in token refresh timed out. Please sign out and sign in again.')),30000)})])}finally{clearTimeout(timer!)}
 }
 private async request<T>(path:string,body?:unknown):Promise<T>{
  const accessToken=await this.accessToken(),read=body===undefined;
  // Retry only safe reads. A timed-out write may already have committed.
  for(let attempt=0;attempt<(read?3:1);attempt++){
   const controller=new AbortController(),started=Date.now();let timer:ReturnType<typeof setTimeout>;
   try{
    const work=async()=>{
     const response=await fetch(this.base.replace(/\/$/,"")+path,{method:read?"GET":"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:read?undefined:JSON.stringify(body),signal:controller.signal});
     const value:unknown=await response.json().catch(()=>null);
     if(!response.ok){
      const data=value&&typeof value==="object"?value as Record<string,unknown>:{};
      const message=typeof data.error==="string"?data.error:"Request failed.";
      const details=[`${read?'GET':'POST'} ${path.replace(/\/games\/[^/]+/, '/games/:id')}`,`HTTP ${response.status}`,`attempt ${attempt+1}`,`${Date.now()-started} ms`,typeof data.code==='string'?data.code:'',typeof data.stage==='string'?`stage=${data.stage}`:'',typeof data.sqlNumber==='number'?`SQL ${data.sqlNumber}`:''].filter(Boolean).join(' · ');
      const reference=typeof data.requestId==="string"?` Reference: ${data.requestId}.`:"";
      throw new ApiError(response.status,message+reference+` Details: ${details}.`,typeof data.code==="string"?data.code:undefined);
     }
     return value as T;
    };
    return await Promise.race([work(),new Promise<T>((_,reject)=>{timer=setTimeout(()=>{reject(new ApiError(408,read?'Account service did not respond in time. Please try Sync Games again.':'Save confirmation timed out. Refresh before retrying; the change may already be saved.','REQUEST_TIMEOUT'));controller.abort()},30000)})]);
   }catch(error){
    const transient=error instanceof ApiError&&(error.code==='REQUEST_TIMEOUT'||error.code==='DATABASE_WAKING');
    if(!read||!transient||attempt===2)throw error;
   }finally{clearTimeout(timer!)}
   await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
  }
  throw new ApiError(503,'Account service is unavailable.');
 }

 private async requireRoundEnding(rules:Rules){if(rules.targetEnd==='round'&&((await this.account()).scoringRulesVersion||0)<3)throw new Error('End-of-round scoring is not available for your account yet. Sync Games after the API update, or sign out to play locally.')}
 syncFrequentPlayers(profileId:string,changes:PlayerChange[]){return this.request<PlayerProfile>("/players/sync",{profileId,changes})}
 account(){return this.request<AccountStatus>("/account")}
 deleteAccount(confirmation:string){return this.request<AccountDeletion>("/account/delete",{confirmation})}
 list(){return this.request<GameSummary[]>("/games")}
 get(id:string){return this.request<GameView>(`/games/${encodeURIComponent(id)}`)}
 create(id:string,name:string,players:string[],winner:"high"|"low",rules:Rules={}){validateTargetScore(rules);validateTargetEnding(rules);const save=()=>this.request<GameView>("/games",{id,name,players,winner,...rules});return rules.targetEnd==="round"?this.requireRoundEnding(rules).then(save):save()}
 act(game:Game,action:Action){validateScoreAction(game,action);const save=()=>this.request<GameView>(`/games/${encodeURIComponent(game.id)}/actions`,{...action,expectedVersion:game.version});return game.targetEnd==="round"?this.requireRoundEnding(game).then(save):save()}
 import(game:Game){validateTargetScore(game);validateScoreLimit(game);validateTargetEnding(game);const save=()=>this.request<GameView>("/games/import",game);return game.targetEnd==="round"?this.requireRoundEnding(game).then(save):save()}
}
