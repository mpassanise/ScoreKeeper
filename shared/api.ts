import {applyGameEdit} from './game-edit';
import type {PlayerChange,PlayerProfile} from './frequent-player-sync';
import {validateTargetEnding} from './target-ending';
import {validateTargetScore,validateScoreAction,validateScoreLimit} from './score-limit';
export type Player={id:string;name:string};
export type Entry={id:string;playerId:string;points:number};
export type Rules={playStyle?:"turns"|"free";scoreMode?:"add"|"total";presetId?:string;presetVersion?:number;endCondition?:"manual"|"rounds"|"target";roundLimit?:number;targetScore?:number;targetEnd?:"immediate"|"round"};
export type Game=Rules & {id:string;name:string;players:Player[];winner:"high"|"low";entries:Entry[];next:string;finished:boolean;deviceOnly?:boolean;startedAt?:string|null;endedAt?:string|null;finishReason?:"manual"|"rounds"|"target";version:number;updated:string};
export type GameView={game:Game;totals:Record<string,number>;winnerIds:string[]};
export type GameSummary=Pick<Game,"id"|"name"|"players"|"winner"|"finished"|"version"|"updated"|"startedAt"|"endedAt"|"deviceOnly"> & {turnCount:number};
export type GameRuleEdit={name:string;winner:"high"|"low";endCondition:"manual"|"rounds"|"target";roundLimit?:number;targetScore?:number;targetEnd?:"immediate"|"round"};
export type Action={rules?:GameRuleEdit;action:"score"|"edit"|"select"|"undo"|"finish"|"resume"|"rules";points?:number;playerId?:string;entryId?:string};
export type AccountStatus={gameEditingEnabled?:boolean;profileId?:string;scoringRulesEnabled?:boolean;scoringRulesVersion?:number;deletionEnabled:boolean;deletionStatus:"pending"|"completed"|null};
export type AccountDeletion={status:"pending"|"completed";message:string};
export class ApiError extends Error{constructor(public status:number,message:string,public code?:string,public requestId?:string){super(message)}}
function cancelled(){return new ApiError(499,'Connection attempt cancelled.','REQUEST_CANCELLED')}
async function abortable<T>(work:Promise<T>,signal?:AbortSignal):Promise<T>{
 if(!signal)return work;
 let abort:()=>void=()=>{};
 try{return await Promise.race([work,new Promise<T>((_,reject)=>{abort=()=>reject(cancelled());signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()})])}
 finally{signal.removeEventListener('abort',abort)}
}
export class ScorekeeperApi{
 constructor(private base:string,private token:()=>Promise<string>,private options:{signal?:AbortSignal;readAttempts?:number}={}){if(!/^https:\/\//.test(base)&&!/^http:\/\/localhost(?::\d+)?(?:\/|$)/.test(base))throw new Error("Use HTTPS for the API.")}
 // Token acquisition and API I/O have separate budgets. A cold Function/SQL
 // connection must not lose its entire budget to a silent token refresh.
 private async accessToken(){
  let timer:ReturnType<typeof setTimeout>;
  try{return await Promise.race([this.token(),new Promise<string>((_,reject)=>{timer=setTimeout(()=>reject(new ApiError(408,'Sign-in token refresh timed out. Use Reconnect to try again.')),30000)})])}finally{clearTimeout(timer!)}
 }
 private async request<T>(path:string,body?:unknown):Promise<T>{
  const signal=this.options.signal;if(signal?.aborted)throw cancelled();
  const accessToken=await abortable(this.accessToken(),signal),read=body===undefined;
  const attempts=read?Math.max(1,Math.min(3,this.options.readAttempts??3)):1;
  // Retry only safe reads. A timed-out write may already have committed.
  for(let attempt=0;attempt<attempts;attempt++){
   if(signal?.aborted)throw cancelled();
   const controller=new AbortController(),started=Date.now(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});let timer:ReturnType<typeof setTimeout>;
   try{
    const work=async()=>{
     const response=await fetch(this.base.replace(/\/$/,"")+path,{method:read?"GET":"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:read?undefined:JSON.stringify(body),signal:controller.signal});
     const value:unknown=await response.json().catch(()=>null);
     if(!response.ok){
      const data=value&&typeof value==="object"?value as Record<string,unknown>:{};
      const message=typeof data.error==="string"?data.error:"Request failed.";
      const details=[`${read?'GET':'POST'} ${path.replace(/\/games\/[^/]+/, '/games/:id')}`,`HTTP ${response.status}`,`attempt ${attempt+1}`,`${Date.now()-started} ms`,typeof data.code==='string'?data.code:'',typeof data.stage==='string'?`stage=${data.stage}`:'',typeof data.sqlNumber==='number'?`SQL ${data.sqlNumber}`:''].filter(Boolean).join(' · ');
      const reference=typeof data.requestId==="string"?` Reference: ${data.requestId}.`:"";
      throw new ApiError(response.status,message+reference+` Details: ${details}.`,typeof data.code==="string"?data.code:undefined,typeof data.requestId==="string"?data.requestId:undefined);
     }
     return value as T;
    };
    return await abortable(Promise.race([work(),new Promise<T>((_,reject)=>{timer=setTimeout(()=>{reject(new ApiError(408,read?'Account service did not respond in time. Please try Sync Games again.':'Save confirmation timed out. Refresh before retrying; the change may already be saved.','REQUEST_TIMEOUT'));controller.abort()},30000)})]),signal);
   }catch(error){
    const transient=error instanceof ApiError&&(error.code==='REQUEST_TIMEOUT'||error.code==='DATABASE_WAKING');
    if(!read||!transient||attempt===attempts-1)throw error;
   }finally{clearTimeout(timer!);signal?.removeEventListener('abort',abort)}
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
 async deleteGame(game:Pick<Game,'id'|'version'>){try{return await this.request<{deleted:boolean}>(`/games/${encodeURIComponent(game.id)}/delete`,{expectedVersion:game.version})}catch(e){if(e instanceof ApiError&&e.status===404)throw new Error('Game deletion requires the latest API deployment. Your game has been kept.');throw e}}
 create(id:string,name:string,players:string[],winner:"high"|"low",rules:Rules={}){validateTargetScore(rules);validateTargetEnding(rules);const save=()=>this.request<GameView>("/games",{id,name,players,winner,...rules});return rules.targetEnd==="round"?this.requireRoundEnding(rules).then(save):save()}
 act(game:Game,action:Action){validateScoreAction(game,action);if(action.action==='rules')applyGameEdit(game,action.rules);const save=()=>this.request<GameView>(`/games/${encodeURIComponent(game.id)}/actions`,{...action,expectedVersion:game.version});return action.action==='rules'?this.account().then(status=>{if(!status.gameEditingEnabled)throw new Error('Editing account games requires the latest API deployment. Your game has not changed.');return save()}):game.targetEnd==="round"?this.requireRoundEnding(game).then(save):save()}
 import(game:Game){validateTargetScore(game);validateScoreLimit(game);validateTargetEnding(game);const save=()=>this.request<GameView>("/games/import",game);return game.targetEnd==="round"?this.requireRoundEnding(game).then(save):save()}
}
