import type {Game,GameView} from '../api';
import {LocalGames,gameView} from '../local-games';
import {canonical,LocalRepositoryError} from './confirmed-games';
import {operationFromWire} from './game-outbox';
export type AdoptionOperation={protocolVersion:1;kind:'import';operationId:string;gameId:string;expectedVersion:0;game:Omit<Game,'deviceOnly'>};
export type AdoptionDraft={schemaVersion:1;profileId:string;gameId:string;status:'staged'|'reviewed';sourceRaw:string;operation:AdoptionOperation};
export type AdoptionReview={profileId:string;gameId:string;sourceVersion:number;status:'staged'|'reviewed';view:GameView};
export function adoptionBytes(value:string){let bytes=0;for(const char of value){const c=char.codePointAt(0)!;bytes+=c<128?1:c<2048?2:c<65536?3:4}return bytes}
export const adoptionIndexKey=(profileId:string)=>'adoption-index:'+profileId;
export type AdoptionIndex={schemaVersion:1;profileId:string;copies:{gameId:string;bytes:number}[]};
export function checkedAdoptionIndex(value:unknown,profileId:string):AdoptionIndex{
 const x=value as AdoptionIndex;if(!x||x.schemaVersion!==1||x.profileId!==profileId||Object.keys(x).some(k=>!['schemaVersion','profileId','copies'].includes(k))||!Array.isArray(x.copies)||x.copies.length>50||new Set(x.copies.map(c=>c?.gameId)).size!==x.copies.length||x.copies.some(c=>!c||typeof c.gameId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(c.gameId)||c.gameId==='00000000-0000-0000-0000-000000000000'||Object.keys(c).some(k=>!['gameId','bytes'].includes(k))||!Number.isSafeInteger(c.bytes)||c.bytes<1)||x.copies.reduce((n,c)=>n+c.bytes,0)>8_000_000)throw new LocalRepositoryError('STORAGE_CORRUPT','Adoption index is invalid. Retained copies have been kept.');return JSON.parse(JSON.stringify(x)) as AdoptionIndex;
}
export function adoptionReservation(draft:AdoptionDraft){return adoptionBytes(JSON.stringify({...draft,status:'reviewed'}))}
const fail=()=>new LocalRepositoryError('INVALID_SNAPSHOT','This device copy needs review. Its original has been kept.');
export const adoptionKey=(profileId:string,gameId:string)=>'adoption-source:'+JSON.stringify([profileId,gameId]);
/** Read/validate one explicitly device-only source. Never allocate replacement IDs
 * or write the original storage. Preserve original values before normalization. */
export async function adoptionSource(raw:string,gameId:string,operationId:string){
 try{
  if(typeof raw!=='string'||raw.length>2_000_000||adoptionBytes(raw)>2_000_000)throw fail();
  const parsed:unknown=JSON.parse(raw);if(!Array.isArray(parsed)||parsed.length>1000||parsed.some(g=>!g||typeof g.id!=='string')||new Set(parsed.map(g=>g.id)).size!==parsed.length)throw fail();
  const original=parsed.find(g=>g.id===gameId);if(!original||original.deviceOnly!==true)throw fail();
  const sourceRaw=JSON.stringify(original),games=await new LocalGames({read:async()=>JSON.stringify([original]),write:async()=>{throw fail()}},()=>{throw fail()}).read();
  const {deviceOnly,...game}=games[0];
  const operation=operationFromWire(JSON.stringify({protocolVersion:1,kind:'import',operationId,gameId,expectedVersion:0,game}));if(operation.kind!=='import')throw fail();
  return {sourceRaw,operation:operation as AdoptionOperation};
 }catch{throw fail()}
}
export async function checkedAdoption(value:unknown,profileId:string,gameId:string):Promise<AdoptionDraft>{
 try{
  const d=value as AdoptionDraft;
  if(!d||d.schemaVersion!==1||d.profileId!==profileId||d.gameId!==gameId||!['staged','reviewed'].includes(d.status)||typeof d.sourceRaw!=='string'||Object.keys(d).some(k=>!['schemaVersion','profileId','gameId','status','sourceRaw','operation'].includes(k)))throw fail();
  const source=await adoptionSource('['+d.sourceRaw+']',gameId,d.operation.operationId);
  if(source.sourceRaw!==d.sourceRaw||canonical(source.operation)!==canonical(d.operation))throw fail();return JSON.parse(JSON.stringify(d)) as AdoptionDraft;
 }catch{throw new LocalRepositoryError('STORAGE_CORRUPT','The retained adoption copy could not be validated. Originals have been kept.')}
}
export function adoptionReview(draft:AdoptionDraft):AdoptionReview{return {profileId:draft.profileId,gameId:draft.gameId,sourceVersion:draft.operation.game.version,status:draft.status,view:gameView(JSON.parse(JSON.stringify(draft.operation.game)) as Game)}};
