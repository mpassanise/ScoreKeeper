import {LocalRepositoryError} from './confirmed-games';
export type DocumentRecord={revision:number;value:unknown};
export type DocumentGuard={key:string;revision:number};
export function documentGuards(guards:readonly DocumentGuard[]=[]):DocumentGuard[]{
 if(!Array.isArray(guards)||guards.length>8||guards.some(g=>!g||typeof g.key!=='string'||!g.key.trim()||!Number.isSafeInteger(g.revision)||g.revision<0))throw new LocalRepositoryError('STORAGE_CONFLICT','Invalid transaction guard.');
 return guards.map(g=>({...g}));
}
export function checkDocumentGuard(existing:unknown,guard:DocumentGuard){
 if((existing===undefined?0:documentRecord(existing).revision)!==guard.revision)throw new LocalRepositoryError('STORAGE_CONFLICT','Account or repository state changed. Existing data has been kept.');
}
export type DocumentWrite={key:string;expectedRevision:number;value:unknown};
export function documentWrites(writes:readonly DocumentWrite[]):DocumentWrite[]{
 if(!Array.isArray(writes)||!writes.length||writes.length>8||new Set(writes.map(w=>w?.key)).size!==writes.length||writes.some(w=>!w||typeof w.key!=='string'||!w.key.trim()||!Number.isSafeInteger(w.expectedRevision)||w.expectedRevision<0))throw new LocalRepositoryError('STORAGE_CONFLICT','Invalid atomic document batch.');
 return writes.map(w=>({...w,value:documentValue(w.value)}));
}
export type AtomicDocuments={writeMany?:(writes:readonly DocumentWrite[],guards?:readonly DocumentGuard[])=>Promise<DocumentRecord[]>;read:(key:string)=>Promise<DocumentRecord|null>;write:(key:string,expectedRevision:number,value:unknown,guards?:readonly DocumentGuard[])=>Promise<DocumentRecord>};
export function documentValue(value:unknown):unknown{try{const raw=JSON.stringify(value);if(raw===undefined)throw Error();return JSON.parse(raw)}catch{throw new LocalRepositoryError('STORAGE_CORRUPT','Repository metadata could not be encoded. Existing data has been kept.')}}
export function documentRecord(value:unknown):DocumentRecord{
 const record=value as DocumentRecord;
 if(!record||!Number.isSafeInteger(record.revision)||record.revision<1||!Object.prototype.hasOwnProperty.call(record,'value'))throw new LocalRepositoryError('STORAGE_CORRUPT','Repository metadata is invalid. Existing data has been kept.');
 return {revision:record.revision,value:documentValue(record.value)};
}
export function nextDocument(existing:unknown,expectedRevision:number,value:unknown):DocumentRecord{
 const revision=existing===undefined?0:documentRecord(existing).revision;
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||revision!==expectedRevision)throw new LocalRepositoryError('STORAGE_CONFLICT','Repository metadata changed. Refresh before retrying.');
 if(revision>=Number.MAX_SAFE_INTEGER)throw new LocalRepositoryError('STORAGE_CORRUPT','Repository metadata revision is invalid.');
 return {revision:revision+1,value};
}
