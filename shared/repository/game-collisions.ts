import {canonical,checkStored,LocalRepositoryError,type ConfirmedSnapshot} from './confirmed-games';
import type {AtomicDocuments,DocumentRecord,DocumentGuard} from './documents';

/** Original pairs are never erased, including after explicit resolution. */
export type GameCollision={schemaVersion:1;profileId:string;gameId:string;retained:ConfirmedSnapshot;observed:ConfirmedSnapshot};
export type CollisionDecision={id:string;pair:GameCollision;selected:ConfirmedSnapshot;prior:ConfirmedSnapshot|null};
export type CollisionFile={schemaVersion:2;profileId:string;gameId:string;active:GameCollision|null;history:CollisionDecision[]};
export const gameCollisionKey=(profileId:string,gameId:string)=>'game-collision:'+JSON.stringify([profileId,gameId]);
function checkPair(value:GameCollision,profileId:string,gameId:string):GameCollision{
 if(value?.schemaVersion!==1||value.profileId!==profileId||value.gameId!==gameId)throw Error();
 const retained=checkStored(value.retained,profileId,gameId),observed=checkStored(value.observed,profileId,gameId);
 if(retained.serverVersion!==observed.serverVersion||canonical(retained.view)===canonical(observed.view))throw Error();
 return {...value,retained,observed};
}
function check(record:DocumentRecord,profileId:string,gameId:string):CollisionFile{
 try{
  const value=record.value as CollisionFile|GameCollision;
  if(value?.schemaVersion===1)return {schemaVersion:2,profileId,gameId,active:checkPair(value,profileId,gameId),history:[]};
  if(value?.schemaVersion!==2||value.profileId!==profileId||value.gameId!==gameId||!Array.isArray(value.history)||value.history.length>20||new Set(value.history.map(d=>d.id)).size!==value.history.length)throw Error();
  const history=value.history.map(d=>{
   if(!d||typeof d.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(d.id))throw Error();
   const pair=checkPair(d.pair,profileId,gameId),selected=checkStored(d.selected,profileId,gameId),prior=d.prior===null?null:checkStored(d.prior,profileId,gameId);
   if(selected.serverVersion<=pair.retained.serverVersion||prior&&selected.serverVersion<=prior.serverVersion)throw Error();return {...d,pair,selected,prior};
  });
  if(!value.active&&!history.length)throw Error();
  return {...value,active:value.active===null?null:checkPair(value.active,profileId,gameId),history};
 }catch{throw new LocalRepositoryError('STORAGE_CORRUPT','Saved game review evidence is invalid. Existing copies have been kept.')}
}
export async function readCollisionFile(documents:AtomicDocuments,profileId:string,gameId:string){
 const record=await documents.read(gameCollisionKey(profileId,gameId));return {revision:record?.revision??0,file:record?check(record,profileId,gameId):null};
}
export async function readGameCollision(documents:AtomicDocuments,profileId:string,gameId:string){return (await readCollisionFile(documents,profileId,gameId)).file?.active??null}
export function checkedCollisionFile(file:CollisionFile){if(file.history.length>20)throw new LocalRepositoryError('STORAGE_UNAVAILABLE','Game review archive is full. Existing copies have been kept.');check({revision:1,value:file},file.profileId,file.gameId);if(new TextEncoder().encode(JSON.stringify(file)).byteLength>8*1024*1024)throw new LocalRepositoryError('STORAGE_UNAVAILABLE','Game review archive is full. Existing copies have been kept.');return file}
export async function keepGameCollision(documents:AtomicDocuments,guard:DocumentGuard,retained:ConfirmedSnapshot,observed:ConfirmedSnapshot){
 const profileId=retained.profileId,gameId=retained.gameId,documentKey=gameCollisionKey(profileId,gameId);
 const value:GameCollision={schemaVersion:1,profileId,gameId,retained,observed};checkPair(value,profileId,gameId);
 const saved=await readCollisionFile(documents,profileId,gameId);if(saved.file?.active)return;
 const next=saved.file?checkedCollisionFile({...saved.file,active:value}):value;
 if(new TextEncoder().encode(JSON.stringify(next)).byteLength>8*1024*1024)throw new LocalRepositoryError('STORAGE_UNAVAILABLE','Game review evidence exceeds device capacity. Existing copies have been kept.');
 await documents.write(documentKey,saved.revision,next,[guard]);
}
