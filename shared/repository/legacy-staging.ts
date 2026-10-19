import {LocalGames,gameView} from '../local-games';
import {snapshot,LocalRepositoryError,canonical,requireIdentity} from './confirmed-games';
import type {AtomicDocuments} from './documents';
type Manifest={count:number|null;ids:string[];valid:boolean};
type Version=Manifest & {number:number;raw:string};
export type StagingJournal={schemaVersion:1;sourceId:string;status:'validated'|'review';versions:Version[]};
async function inspect(raw:string):Promise<Manifest>{
 let parsed:unknown;try{parsed=JSON.parse(raw)}catch{return {count:null,ids:[],valid:false}}
 if(!Array.isArray(parsed))return {count:null,ids:[],valid:false};
 const ids=parsed.map(g=>g&&typeof g.id==='string'?g.id:'');
 try{
  const games=await new LocalGames({read:async()=>raw,write:async()=>{throw Error('read only')}},()=>{throw Error('IDs must not be allocated')}).read();
  for(const game of games)snapshot('validation-only',gameView({...game,deviceOnly:undefined}));
  return {count:games.length,ids,valid:ids.every(Boolean)&&new Set(ids).size===ids.length};
 }catch{return {count:parsed.length,ids,valid:false}}
}
async function journal(value:unknown,sourceId:string):Promise<StagingJournal>{
 const j=value as StagingJournal;
 if(!j||j.schemaVersion!==1||j.sourceId!==sourceId||!['validated','review'].includes(j.status)||!Array.isArray(j.versions)||!j.versions.length)throw new LocalRepositoryError('STORAGE_CORRUPT','Migration staging metadata is invalid. Original data has been kept.');
 for(const [index,version]of j.versions.entries()){
  if(!version||version.number!==index+1||typeof version.raw!=='string'||canonical(await inspect(version.raw))!==canonical({count:version.count,ids:version.ids,valid:version.valid}))throw new LocalRepositoryError('STORAGE_CORRUPT','Migration copy validation failed. Original data has been kept.');
 }
 if(new Set(j.versions.map(v=>v.raw)).size!==j.versions.length||j.status!==(j.versions.length===1&&j.versions[0].valid?'validated':'review'))throw new LocalRepositoryError('STORAGE_CORRUPT','Migration review state is invalid. Original data has been kept.');
 return j;
}
/** Copy/validate/mark only. No owner inference, upload, source write or deletion API. */
export async function stageLegacyGames(documents:AtomicDocuments,sourceId:string,raw:string):Promise<StagingJournal>{
 requireIdentity(sourceId);if(typeof raw!=='string')throw new LocalRepositoryError('INVALID_SNAPSHOT','A complete source copy is required.');
 const key='legacy-staging:'+sourceId,manifest=await inspect(raw);
 for(let attempt=0;attempt<5;attempt++){
  const existing=await documents.read(key),previous=existing?await journal(existing.value,sourceId):null;
  if(previous?.versions.some(version=>version.raw===raw))return previous;
  const versions=[...(previous?.versions||[]),{number:(previous?.versions.length||0)+1,raw,...manifest}];
  const next:StagingJournal={schemaVersion:1,sourceId,status:versions.length===1&&manifest.valid?'validated':'review',versions};
  try{await documents.write(key,existing?.revision||0,next);return next}catch(error){if(!(error instanceof LocalRepositoryError)||error.code!=='STORAGE_CONFLICT')throw error}
 }
 throw new LocalRepositoryError('STORAGE_CONFLICT','Migration staging changed in another session. Retry with the original source retained.');
}
