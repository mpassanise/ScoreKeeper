import type {GameSummary} from '../api';
import type {AccountGameRead} from './game-read-model';
import type {GameOutbox} from './game-outbox';
import {gameRead} from './game-outbox';
import {LocalRepositoryError,canonical} from './confirmed-games';
import type {AtomicDocuments,DocumentGuard} from './documents';

export type HomeGame={gameId:string;summary:GameSummary|null;sync:'confirmed'|'pending'|'needs-review';hidden:'pending-delete'|'deleted'|null;retained:boolean;name:string};
export type AccountGameHome={games:GameSummary[];savedCopies:HomeGame[];states:Record<string,HomeGame>};
export function gameSummary(view:Extract<AccountGameRead,{kind:'game'}>['view']):GameSummary{
 return cleanSummary({...view.game,turnCount:view.game.entries.length});
}
/** One validated queue snapshot. List omission is never deletion proof. No
 * history/receipt payloads leave this reader, and device-only rows stay separate. */
export function queueHome(state:GameOutbox,seeds:GameSummary[]):HomeGame[]{
 const rows=new Map<string,HomeGame>();
 for(const seed of seeds)if(!seed.deviceOnly)rows.set(seed.id,{gameId:seed.id,summary:seed,sync:'confirmed',hidden:null,retained:false,name:seed.name});
 const retained=new Set(state.archive.filter(b=>b.kind==='account-selected'&&b.recovery).map(b=>b.gameId));
 for(const game of state.games){
  const read=gameRead(game),prior=rows.get(game.gameId),copy=game.projection??game.base?.view??game.candidate?.view;
  rows.set(game.gameId,{gameId:game.gameId,summary:read.kind==='game'?gameSummary(read.view):null,sync:read.kind==='game'||read.kind==='pending-delete'?read.sync:'confirmed',hidden:read.kind==='deleted'?'deleted':read.kind==='pending-delete'?'pending-delete':null,retained:retained.has(game.gameId),name:copy?.game.name??prior?.name??'Saved game'});
 }
 return [...rows.values()];
}
export function homeResult(rows:HomeGame[]):AccountGameHome{
 const states=Object.fromEntries(rows.map(row=>[row.gameId,row]));
 return {states,games:rows.flatMap(row=>row.summary?[row.summary]:[]).sort((a,b)=>Date.parse(b.updated)-Date.parse(a.updated)),savedCopies:rows.filter(row=>row.hidden||row.retained||row.sync==='needs-review')};
}
export function homeStatus(row:HomeGame|undefined){return row?.sync==='needs-review'?'Review needed':row?.sync==='pending'?'Changes waiting to sync':''}

function cleanSummary(g:GameSummary):GameSummary{
 if(!g||typeof g!=='object')throw new LocalRepositoryError('STORAGE_CORRUPT','Invalid saved game summary.');
 const {id,name,players,winner,finished,version,updated,startedAt,endedAt,turnCount}=g;
 if(!id||typeof id!=='string'||typeof name!=='string'||!Array.isArray(players)||players.length<2||players.length>20||players.some(p=>!p||typeof p.id!=='string'||typeof p.name!=='string')||!['high','low'].includes(winner)||typeof finished!=='boolean'||!Number.isSafeInteger(version)||version<1||typeof updated!=='string'||!Number.isFinite(Date.parse(updated))||!Number.isSafeInteger(turnCount)||turnCount<0||turnCount>10000)throw new LocalRepositoryError('STORAGE_CORRUPT','Saved game summaries could not be checked. Existing copies have been kept.');
 return {id,name,players:players.map(p=>({id:p.id,name:p.name})),winner,finished,version,updated,startedAt,endedAt,turnCount};
}
/** Display index only, never a snapshot or write authority. Merge rather than
 * replacing on list omission, including when an offline cache supplies no rows. */
export async function retainHomeSummaries(documents:AtomicDocuments,profileId:string,seeds:GameSummary[],guard:DocumentGuard){
 const incoming=seeds.filter(g=>!g.deviceOnly).map(cleanSummary);
 const key='game-home:'+profileId,record=await documents.read(key),stored=record?.value as {schemaVersion:number;profileId:string;games:GameSummary[]}|undefined;
 if(record&&(!stored||stored.schemaVersion!==1||stored.profileId!==profileId||!Array.isArray(stored.games)||stored.games.length>1000))throw new LocalRepositoryError('STORAGE_CORRUPT','Saved game index could not be checked. Existing copies have been kept.');
 const rows=new Map<string,GameSummary>();
 for(const raw of stored?.games??[]){if(raw.deviceOnly)throw new LocalRepositoryError('STORAGE_CORRUPT','Invalid account game index.');const item=cleanSummary(raw);if(rows.has(item.id))throw new LocalRepositoryError('STORAGE_CORRUPT','Duplicate account game index.');rows.set(item.id,item)}
 for(const item of incoming){const prior=rows.get(item.id);if(!prior||item.version>prior.version)rows.set(item.id,item)}
 const value={schemaVersion:1,profileId,games:[...rows.values()]};
 if(rows.size>1000||new TextEncoder().encode(JSON.stringify(value)).byteLength>1000000)throw new LocalRepositoryError('STORAGE_UNAVAILABLE','Saved game index is full. Existing copies have been kept.');
 if(!record||canonical(record.value)!==canonical(value))await documents.write(key,record?.revision??0,value,[guard]);
 return value.games;
}
