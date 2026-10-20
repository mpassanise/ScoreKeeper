import {canonical,checkStored,LocalRepositoryError,type ConfirmedSnapshot} from './confirmed-games';
import type {AtomicDocuments,DocumentRecord,DocumentGuard} from './documents';

/** Preserve the first contradictory pair until an explicit recovery decision.
 * A later GET (even a higher version) is not permission to erase this evidence. */
export type GameCollision={schemaVersion:1;profileId:string;gameId:string;retained:ConfirmedSnapshot;observed:ConfirmedSnapshot};
export const gameCollisionKey=(profileId:string,gameId:string)=>'game-collision:'+JSON.stringify([profileId,gameId]);
function check(record:DocumentRecord,profileId:string,gameId:string):GameCollision{
 try{
  const value=record.value as GameCollision;
  if(value?.schemaVersion!==1||value.profileId!==profileId||value.gameId!==gameId)throw Error();
  const retained=checkStored(value.retained,profileId,gameId),observed=checkStored(value.observed,profileId,gameId);
  if(retained.serverVersion!==observed.serverVersion||canonical(retained.view)===canonical(observed.view))throw Error();
  return {...value,retained,observed};
 }catch{throw new LocalRepositoryError('STORAGE_CORRUPT','Saved game review evidence is invalid. Existing copies have been kept.')}
}
export async function readGameCollision(documents:AtomicDocuments,profileId:string,gameId:string){
 const record=await documents.read(gameCollisionKey(profileId,gameId));return record?check(record,profileId,gameId):null;
}
export async function keepGameCollision(documents:AtomicDocuments,guard:DocumentGuard,retained:ConfirmedSnapshot,observed:ConfirmedSnapshot){
 const profileId=retained.profileId,gameId=retained.gameId,documentKey=gameCollisionKey(profileId,gameId);
 const value:GameCollision={schemaVersion:1,profileId,gameId,retained,observed};
 check({revision:1,value},profileId,gameId);
 // Bound recovery writes; quota/capacity errors must remain visible, never be
 // converted into a successful transient review message.
 if(new TextEncoder().encode(JSON.stringify(value)).byteLength>8*1024*1024)throw new LocalRepositoryError('STORAGE_UNAVAILABLE','Game review evidence exceeds device capacity. Existing copies have been kept.');
 const existing=await documents.read(documentKey);
 if(existing){check(existing,profileId,gameId);return}
 await documents.write(documentKey,0,value,[guard]);
}
