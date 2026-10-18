import {documentRecord,documentValue,nextDocument,type DocumentRecord} from './documents';
import {canonical,checkStored,LocalRepositoryError,requireIdentity,snapshot,type ConfirmedGames,type ConfirmedSnapshot} from './confirmed-games';
import type {GameView} from '../api';

const STORE='confirmedGames',META='repositoryMetadata';
/** Not instantiated by either app until the storage/identity acceptance gates pass. */
export async function openConfirmedGames(factory:IDBFactory,name='scorekeeper-repository-v1'):Promise<ConfirmedGames>{
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{
  let settled=false;
  const fail=(code:'STORAGE_UNAVAILABLE'|'STORAGE_BLOCKED'|'STORAGE_CORRUPT')=>{if(settled)return;settled=true;clearTimeout(timer);reject(new LocalRepositoryError(code,'Account storage could not be opened. Existing data has been kept.'))};
  const timer=setTimeout(()=>fail('STORAGE_BLOCKED'),5000);
  let request:IDBOpenDBRequest;
  try{request=factory.open(name,2)}catch{fail('STORAGE_UNAVAILABLE');return}
  request.onblocked=()=>fail('STORAGE_BLOCKED');
  request.onerror=()=>fail('STORAGE_UNAVAILABLE');
  request.onupgradeneeded=event=>{
   if(settled){request.transaction?.abort();return}
   if(event.oldVersion>1||(event.oldVersion===1&&!request.result.objectStoreNames.contains(STORE))){fail('STORAGE_CORRUPT');request.transaction?.abort();return}
   if(event.oldVersion===0)request.result.createObjectStore(STORE,{keyPath:['profileId','gameId']});
   request.result.createObjectStore(META,{keyPath:'key'});
  };
  request.onsuccess=()=>{
   if(settled){request.result.close();return}
   settled=true;clearTimeout(timer);const opened=request.result;
   if(!opened.objectStoreNames.contains(STORE)||!opened.objectStoreNames.contains(META)){opened.close();reject(new LocalRepositoryError('STORAGE_CORRUPT','Account storage schema is incomplete. Existing data has been kept.'));return}
   try{const schema=opened.transaction([STORE,META]);if(canonical(schema.objectStore(STORE).keyPath)!==canonical(['profileId','gameId'])||schema.objectStore(META).keyPath!=='key')throw Error()}catch{opened.close();reject(new LocalRepositoryError('STORAGE_CORRUPT','Account storage keys are invalid. Existing data has been kept.'));return}
   opened.onversionchange=()=>opened.close();resolve(opened);
  };
 });
 function transaction<T>(mode:IDBTransactionMode,work:(store:IDBObjectStore,setResult:(value:T)=>void,abort:(error:unknown)=>void)=>void,storeName=STORE):Promise<T>{
  return new Promise((resolve,reject)=>{
   let tx:IDBTransaction,result:T,failure:unknown;
   const abort=(error:unknown)=>{failure=error;try{tx.abort()}catch{/* Already aborted. */}};
   try{tx=db.transaction(storeName,mode,mode==='readwrite'?{durability:'strict'}:undefined)}catch{reject(new LocalRepositoryError('STORAGE_UNAVAILABLE','Account storage is unavailable. Existing data has been kept.'));return}
   tx.oncomplete=()=>resolve(result);
   tx.onabort=()=>reject(failure instanceof LocalRepositoryError?failure:new LocalRepositoryError('STORAGE_UNAVAILABLE','Account storage transaction failed. No changes were saved.'));
   // Never resolve on an individual request's success: the transaction may still fail.
   try{work(tx.objectStore(storeName),value=>{result=value},abort)}catch(error){abort(error)}
  });
 }
 return {
  documents:{
   read(key:string){requireIdentity(key);return transaction<DocumentRecord|null>('readonly',(store,done,abort)=>{const request=store.get(key);request.onsuccess=()=>{try{done(request.result===undefined?null:documentRecord(request.result))}catch(error){abort(error)}}},META)},
   write(key:string,expectedRevision:number,value:unknown){requireIdentity(key);const copy=documentValue(value);return transaction<DocumentRecord>('readwrite',(store,done,abort)=>{const request=store.get(key);request.onsuccess=()=>{try{const next=nextDocument(request.result,expectedRevision,copy);store.put({key,...next});done(next)}catch(error){abort(error)}}},META)}
  },
  readConfirmed(profileId:string,gameId:string){
   requireIdentity(profileId);requireIdentity(gameId);
   return transaction<ConfirmedSnapshot|null>('readonly',(store,done,abort)=>{
    const request=store.get([profileId,gameId]);request.onsuccess=()=>{try{done(request.result===undefined?null:checkStored(request.result,profileId,gameId))}catch(error){abort(error)}};
   });
  },
  saveConfirmed(profileId:string,views:GameView[]){
   requireIdentity(profileId);
   const records=views.map(view=>snapshot(profileId,view));
   if(new Set(records.map(record=>record.gameId)).size!==records.length)throw new LocalRepositoryError('INVALID_SNAPSHOT','Duplicate game IDs require review. Existing data has been kept.');
   return transaction<void>('readwrite',(store,done,abort)=>{
    done(undefined);
    for(const record of records){
     const read=store.get([profileId,record.gameId]);read.onsuccess=()=>{try{
      if(read.result!==undefined){
       const existing=checkStored(read.result,profileId,record.gameId);
       if(existing.serverVersion>record.serverVersion)return;
       if(existing.serverVersion===record.serverVersion){
        if(canonical(existing.view)!==canonical(record.view))throw new LocalRepositoryError('VERSION_COLLISION','Different game content has the same server version. Both sources require review.');
        return;
       }
      }
      store.put(record);
     }catch(error){abort(error)}};
    }
   });
  },
  close(){db.close()}
 };
}
