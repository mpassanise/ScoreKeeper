import type {GameSummary} from './api';
type Storage={read:(key:string)=>Promise<string|null>;write:(key:string,value:string)=>Promise<void>;remove:(key:string)=>Promise<void>};
function summary(g:GameSummary):GameSummary{const {id,name,players,winner,finished,version,updated,startedAt,endedAt,turnCount}=g;return {id,name,players:players.map(({id,name})=>({id,name})),winner,finished,version,updated,startedAt,endedAt,turnCount}}
// This is a display cache, never a source for score writes or account identity.
export function createGameListCache(storage:Storage){
 let queue=Promise.resolve();
 const key=(profile:string)=>'scorekeeper-game-list-v1:'+encodeURIComponent(profile);
 function serialize(work:()=>Promise<void>){const next=queue.then(work);queue=next.catch(()=>{});return next}
 return {
  async read(profile:string|undefined):Promise<GameSummary[]>{
   if(!profile)return [];
   try{await queue;const value=JSON.parse(await storage.read(key(profile))||'null');if(!value||value.version!==1||!Array.isArray(value.games))return [];
    return value.games.filter((g:GameSummary)=>g&&typeof g.id==='string'&&typeof g.name==='string'&&typeof g.finished==='boolean'&&typeof g.version==='number'&&typeof g.updated==='string'&&typeof g.turnCount==='number'&&Array.isArray(g.players)&&g.players.every(p=>p&&typeof p.id==='string'&&typeof p.name==='string')&&!g.deviceOnly).slice(0,200);
   }catch{return []}
  },
  write(profile:string|undefined,games:GameSummary[]){if(!profile)return Promise.resolve();const value=JSON.stringify({version:1,games:games.filter(g=>!g.deviceOnly).slice(0,200).map(summary)});return serialize(()=>storage.write(key(profile),value))},
  clear(profile:string|undefined){return profile?serialize(()=>storage.remove(key(profile))):Promise.resolve()}
 };
}
