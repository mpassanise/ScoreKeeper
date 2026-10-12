export type Player={id:string;name:string};
export type Entry={id:string;playerId:string;points:number};
export type Game={id:string;name:string;players:Player[];winner:"high"|"low";entries:Entry[];next:string;finished:boolean;version:number;updated:string};
export type GameView={game:Game;totals:Record<string,number>;winnerIds:string[]};
export type GameSummary=Pick<Game,"id"|"name"|"players"|"winner"|"finished"|"version"|"updated"> & {turnCount:number};
export type Action={action:"score"|"edit"|"select"|"undo"|"finish"|"resume";points?:number;playerId?:string;entryId?:string};
export class ApiError extends Error{constructor(public status:number,message:string){super(message)}}
export class ScorekeeperApi{
 constructor(private base:string,private token:()=>Promise<string>){if(!/^https:\/\//.test(base)&&!/^http:\/\/localhost(?::\d+)?(?:\/|$)/.test(base))throw new Error("Use HTTPS for the API.")}
 private async request<T>(path:string,body?:unknown):Promise<T>{const response=await fetch(this.base.replace(/\/$/,"")+path,{method:body?"POST":"GET",headers:{Authorization:`Bearer ${await this.token()}`,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});const value:unknown=await response.json();if(!response.ok){const message=value&&typeof value==="object"&&"error" in value&&typeof value.error==="string"?value.error:"Request failed.";throw new ApiError(response.status,message)}return value as T}
 list(){return this.request<GameSummary[]>("/games")}
 get(id:string){return this.request<GameView>(`/games/${encodeURIComponent(id)}`)}
 create(id:string,name:string,players:string[],winner:"high"|"low"){return this.request<GameView>("/games",{id,name,players,winner})}
 act(game:Game,action:Action){return this.request<GameView>(`/games/${encodeURIComponent(game.id)}/actions`,{...action,expectedVersion:game.version})}
 import(game:Game){return this.request<GameView>("/games/import",game)}
}
