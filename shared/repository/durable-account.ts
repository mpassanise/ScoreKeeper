import type {AccountStatus,GameView} from '../api';
import {AccountAccessError} from './account-access';
import {LocalRepositoryError,type ConfirmedGames} from './confirmed-games';
import type {AtomicDocuments,DocumentRecord} from './documents';
type Active={selector:string;profileId:string};
type Pending={selector:string;expectedProfileId?:string};
type Lifecycle={schemaVersion:1;active:Active|null;pending:Pending|null;blockedProfiles:string[]};
export type DurableLease=Readonly<{kind:'account';revision:number;selector:string;profileId:string}>;
export type VerificationTicket=Readonly<{kind:'verification';revision:number;selector:string}>;
const KEY='account-lifecycle';
const nonempty=(v:unknown):v is string=>typeof v==='string'&&!!v.trim();
function lifecycle(record:DocumentRecord|null):Lifecycle{
 if(!record)return {schemaVersion:1,active:null,pending:null,blockedProfiles:[]};
 const value=record.value as Lifecycle;
 if(!value||value.schemaVersion!==1||!Array.isArray(value.blockedProfiles)||!value.blockedProfiles.every(nonempty)||new Set(value.blockedProfiles).size!==value.blockedProfiles.length||(value.active!==null&&(!value.active||!nonempty(value.active.selector)||!nonempty(value.active.profileId)))||(value.pending!==null&&(!value.pending||!nonempty(value.pending.selector)||(value.pending.expectedProfileId!==undefined&&!nonempty(value.pending.expectedProfileId))))||(value.active&&value.pending)||(value.active&&value.blockedProfiles.includes(value.active.profileId)))throw new LocalRepositoryError('STORAGE_CORRUPT','Account lifecycle metadata is invalid. Existing data has been kept.');
 return value;
}
/** Durable account state shared by IndexedDB and SQLite; no tokens or email keys. */
export function createDurableAccountRepository(repository:ConfirmedGames){
 const documents:AtomicDocuments=repository.documents,issued=new WeakSet<object>(),confirmed=new WeakSet<object>();let closed=false;
 function issue<T extends object>(value:T):Readonly<T>{const proof=Object.freeze(value);issued.add(proof);return proof}
 function check(proof:DurableLease|VerificationTicket){if(closed||!issued.has(proof))throw new AccountAccessError('STALE_ACCOUNT')}
 function account(proof:DurableLease){check(proof);if(proof.kind!=='account')throw new AccountAccessError('ACCOUNT_UNVERIFIED')}
 async function current(proof:DurableLease|VerificationTicket){check(proof);const record=await documents.read(KEY),state=lifecycle(record);check(proof);
  if(record?.revision!==proof.revision||(proof.kind==='account'?state.active?.selector!==proof.selector||state.active.profileId!==proof.profileId:state.pending?.selector!==proof.selector))throw new AccountAccessError('STALE_ACCOUNT');
  return {record,state};
 }
 async function write(expected:number,state:Lifecycle){if(closed)throw new AccountAccessError('STALE_ACCOUNT');try{return await documents.write(KEY,expected,state)}catch(error){if(error instanceof LocalRepositoryError&&error.code==='STORAGE_CONFLICT')throw new AccountAccessError('STALE_ACCOUNT');throw error}}
 async function accept(proof:DurableLease|VerificationTicket,status:AccountStatus){
  if(proof.kind==='account')confirmed.delete(proof);
  const {record,state}=await current(proof),profileId=status.profileId;
  if(!nonempty(profileId))throw new AccountAccessError('ACCOUNT_UNVERIFIED');
  const expected=proof.kind==='account'?proof.profileId:state.pending?.expectedProfileId;
  if(expected&&expected!==profileId){await write(record!.revision,{...state,active:null,pending:null});throw new AccountAccessError('PROFILE_MISMATCH')}
  if(status.deletionStatus||state.blockedProfiles.includes(profileId)){await write(record!.revision,{...state,active:null,pending:null,blockedProfiles:[...new Set([...state.blockedProfiles,profileId])]});throw new AccountAccessError('ACCOUNT_DELETING')}
  const next=await write(record!.revision,{...state,pending:null,active:{selector:proof.selector,profileId}}),lease=issue({kind:'account' as const,revision:next.revision,selector:proof.selector,profileId});confirmed.add(lease);return lease;
 }
 return {
  async beginVerification(selector:string,expectedProfileId?:string):Promise<VerificationTicket>{
   if(closed)throw new AccountAccessError('STALE_ACCOUNT');
   if(!nonempty(selector)||(expectedProfileId!==undefined&&!nonempty(expectedProfileId)))throw new AccountAccessError('ACCOUNT_UNVERIFIED');
   const record=await documents.read(KEY),state=lifecycle(record),next=await write(record?.revision||0,{...state,active:null,pending:{selector,...(expectedProfileId?{expectedProfileId}:{})}});
   return issue({kind:'verification' as const,revision:next.revision,selector});
  },
  verify:accept,
  async restore(selector:string):Promise<DurableLease|null>{
   if(closed)throw new AccountAccessError('STALE_ACCOUNT');const record=await documents.read(KEY),state=lifecycle(record);
   if(closed)throw new AccountAccessError('STALE_ACCOUNT');
   return record&&state.active?.selector===selector?issue({kind:'account' as const,revision:record.revision,...state.active}):null;
  },
  async signOut(proof:DurableLease|VerificationTicket){const {record,state}=await current(proof);await write(record!.revision,{...state,active:null,pending:null})},
  async beginDeletion(proof:DurableLease){account(proof);const {record,state}=await current(proof);await write(record!.revision,{...state,active:null,pending:null,blockedProfiles:[...new Set([...state.blockedProfiles,proof.profileId])]})},
  connectionUnavailable(proof:DurableLease){account(proof);confirmed.delete(proof)},
  async readConfirmed(proof:DurableLease,gameId:string){account(proof);await current(proof);const value=await repository.readConfirmed(proof.profileId,gameId);await current(proof);return value},
  async saveConfirmed(proof:DurableLease,views:GameView[]){account(proof);const detached=JSON.parse(JSON.stringify(views)) as GameView[];await current(proof);if(!confirmed.has(proof))throw new AccountAccessError('SYNC_UNAVAILABLE');await repository.saveConfirmed(proof.profileId,detached);await current(proof)},
  async close(){closed=true;await repository.close()}
 };
}
