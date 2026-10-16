import type {GameView} from '../api';
import {gameView,validateRules} from '../local-games';
import {validateScoreLimit} from '../score-limit';

/** Confirmed reads only. No projection, outbox, guest adoption or network writes. */
export type ConfirmedSnapshot={schemaVersion:1;profileId:string;gameId:string;serverVersion:number;view:GameView};
export type ConfirmedGames={
 readConfirmed(profileId:string,gameId:string):Promise<ConfirmedSnapshot|null>;
 saveConfirmed(profileId:string,views:GameView[]):Promise<void>;
 close():void;
};
export class LocalRepositoryError extends Error{
 constructor(readonly code:'INVALID_SNAPSHOT'|'VERSION_COLLISION'|'STORAGE_UNAVAILABLE'|'STORAGE_BLOCKED'|'STORAGE_CORRUPT',message:string){super(message);this.name='LocalRepositoryError'}
}
export function requireIdentity(value:string){
 if(typeof value!=='string'||!value.trim())throw new LocalRepositoryError('INVALID_SNAPSHOT','A stable account and game identity is required.');
 return value;
}
/** Stable comparison ignores property order and absent optional JSON fields. */
export function canonical(value:unknown):string{
 function order(v:unknown):unknown{
  if(Array.isArray(v))return v.map(order);
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,order(x)]));
  return v;
 }
 return JSON.stringify(order(value));
}
export function snapshot(profileId:string,input:GameView):ConfirmedSnapshot{
 try{
  requireIdentity(profileId);
  // Detached JSON copy prevents caller mutation while a transaction is queued.
  const view=JSON.parse(JSON.stringify(input)) as GameView,g=view.game;
  if(!g||!requireIdentity(g.id)||g.deviceOnly||typeof g.name!=='string'||typeof g.finished!=='boolean'||!Number.isSafeInteger(g.version)||g.version<1||typeof g.updated!=='string'||!Number.isFinite(Date.parse(g.updated)))throw Error();
  if(!Array.isArray(g.players)||g.players.length<2||g.players.length>20||g.players.some(p=>!p||!requireIdentity(p.id)||typeof p.name!=='string')||new Set(g.players.map(p=>p.id)).size!==g.players.length)throw Error();
  if(!g.players.some(p=>p.id===g.next)||!Array.isArray(g.entries)||g.entries.length>10000||g.entries.some(e=>!e||!requireIdentity(e.id)||!g.players.some(p=>p.id===e.playerId)||!Number.isSafeInteger(e.points)||Math.abs(e.points)>100000)||new Set(g.entries.map(e=>e.id)).size!==g.entries.length)throw Error();
  validateRules(g.winner,g);validateScoreLimit(g);
  const expected=gameView(g);
  if(canonical(view.totals)!==canonical(expected.totals)||!Array.isArray(view.winnerIds)||canonical([...view.winnerIds].sort())!==canonical([...expected.winnerIds].sort()))throw Error();
  return {schemaVersion:1,profileId,gameId:g.id,serverVersion:g.version,view};
 }catch{throw new LocalRepositoryError('INVALID_SNAPSHOT','A complete, valid account game is required. Existing data has been kept.')}
}
export function checkStored(value:unknown,profileId:string,gameId:string):ConfirmedSnapshot{
 try{
  const record=value as ConfirmedSnapshot;
  if(!record||record.schemaVersion!==1||record.profileId!==profileId||record.gameId!==gameId)throw Error();
  const checked=snapshot(profileId,record.view);
  if(checked.gameId!==gameId||checked.serverVersion!==record.serverVersion)throw Error();
  return checked;
 }catch{throw new LocalRepositoryError('STORAGE_CORRUPT','Saved account data could not be validated. It has been kept for recovery.')}
}
