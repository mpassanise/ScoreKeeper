import {LocalRepositoryError} from './confirmed-games';
export type DocumentRecord={revision:number;value:unknown};
export type AtomicDocuments={read:(key:string)=>Promise<DocumentRecord|null>;write:(key:string,expectedRevision:number,value:unknown)=>Promise<DocumentRecord>};
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
