import {verifiedOfflineGrant,checkedOfflineGrant,type OfflineWriteGrant} from './offline-write-grant';
import {adoptionSource,adoptionKey,adoptionIndexKey,adoptionReservation,checkedAdoption,checkedAdoptionIndex,adoptionReview,type AdoptionDraft} from './adoption-source';
import {supportsQueuedScoring,supportsQueuedCompletion,supportsQueuedCorrections,supportsQueuedRules,supportsQueuedDeletion} from './scoring-writer';
import {canEditGame} from '../game-edit';
import type {GameWriteOperation} from '../game-operation-contract';
import {queueHome,homeResult,retainHomeSummaries} from './game-home';
import type {AccountStatus,GameView,GameSummary} from '../api';
import {AccountAccessError} from './account-access';
import {canonical,LocalRepositoryError,snapshot,type ConfirmedGames} from './confirmed-games';
import type {AccountGameRead} from './game-read-model';
import {recoveryReview} from './game-recovery';
import {readCollisionFile,checkedCollisionFile,readGameCollision,keepGameCollision,gameCollisionKey} from './game-collisions';
import {createOperationTransport} from './operation-transport';
import {createGameDelivery,type DeliveryTransport,type DeliveryOptions} from './game-delivery';
import {clearGameReadCache,createGameOutbox,OutboxError,importedGameIds,appendableOperations} from './game-outbox';
import type {AtomicDocuments,DocumentRecord} from './documents';
type Active={selector:string;profileId:string;offlineWriteGrant?:unknown;operationSupport?:string};
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
export function createDurableAccountRepository(repository:ConfirmedGames,options:{coldWritesEnabled?:boolean;allowPendingWrites?:boolean}={}){
 const coldWritesEnabled=options.coldWritesEnabled===true,allowPendingWrites=coldWritesEnabled&&options.allowPendingWrites===true;
 const documents:AtomicDocuments=repository.documents,issued=new WeakSet<object>(),restoredRights=new WeakMap<object,string>(),confirmed=new WeakSet<object>(),offlineWrites=new WeakSet<object>(),scoring=new WeakSet<object>(),completion=new WeakSet<object>(),corrections=new WeakSet<object>(),rules=new WeakSet<object>(),deletion=new WeakSet<object>(),imports=new WeakSet<object>();let closed=false;const deliveries=new Map<{close:()=>void},DurableLease>();
 function stopDeliveries(proof?:DurableLease|VerificationTicket){
  clearGameReadCache(documents,proof?{key:KEY,revision:proof.revision}:undefined);
  for(const [worker,lease]of deliveries){
   if(!proof||(lease.revision===proof.revision&&lease.selector===proof.selector&&(proof.kind==='verification'||lease.profileId===proof.profileId)))worker.close();
  }
 }
 function issue<T extends object>(value:T):Readonly<T>{const proof=Object.freeze(value);issued.add(proof);return proof}
 function check(proof:DurableLease|VerificationTicket){if(closed||!issued.has(proof))throw new AccountAccessError('STALE_ACCOUNT')}
 function account(proof:DurableLease){check(proof);if(proof.kind!=='account')throw new AccountAccessError('ACCOUNT_UNVERIFIED')}
 async function current(proof:DurableLease|VerificationTicket){check(proof);const record=await documents.read(KEY),state=lifecycle(record);check(proof);
  if(record?.revision!==proof.revision||(proof.kind==='account'?state.active?.selector!==proof.selector||state.active.profileId!==proof.profileId:state.pending?.selector!==proof.selector))throw new AccountAccessError('STALE_ACCOUNT');
  const retained=restoredRights.get(proof);if(retained!==undefined&&(proof.kind!=='account'||canonical(checkedOfflineGrant(state.active?.offlineWriteGrant,proof.selector,proof.profileId))!==retained))throw new AccountAccessError('STALE_ACCOUNT');
  return {record,state};
 }
 async function write(expected:number,state:Lifecycle){if(closed)throw new AccountAccessError('STALE_ACCOUNT');try{return await documents.write(KEY,expected,state)}catch(error){if(error instanceof LocalRepositoryError&&error.code==='STORAGE_CONFLICT')throw new AccountAccessError('STALE_ACCOUNT');throw error}}
 function localRights(proof:DurableLease,grant:OfflineWriteGrant){
  restoredRights.set(proof,canonical(grant));
  offlineWrites.add(proof);scoring.add(proof);
  if(grant.completion)completion.add(proof);if(grant.corrections)corrections.add(proof);if(grant.rules)rules.add(proof);if(grant.deletion)deletion.add(proof);
 }
 async function accept(proof:DurableLease|VerificationTicket,input:AccountStatus){
  const status=JSON.parse(JSON.stringify(input)) as AccountStatus;
  const scoringSupported=supportsQueuedScoring(status.gameOperations),completionSupported=supportsQueuedCompletion(status.gameOperations),correctionsSupported=supportsQueuedCorrections(status.gameOperations),rulesSupported=supportsQueuedRules(status.gameOperations),deletionSupported=supportsQueuedDeletion(status.gameOperations);check(proof);if(proof.kind==='account'){stopDeliveries(proof);confirmed.delete(proof);offlineWrites.delete(proof);scoring.delete(proof);completion.delete(proof);corrections.delete(proof);rules.delete(proof);deletion.delete(proof);imports.delete(proof);}
  const {record,state}=await current(proof),profileId=status.profileId;
  if(!nonempty(profileId)){
   // An incomplete response is not a verified revocation. Keep previously
   // committed local rights, while network/import permissions remain revoked.
   if(coldWritesEnabled&&proof.kind==='account'){const grant=checkedOfflineGrant(state.active?.offlineWriteGrant,proof.selector,proof.profileId);if(grant)localRights(proof,grant)}
   throw new AccountAccessError('ACCOUNT_UNVERIFIED');
  }
  const expected=proof.kind==='account'?proof.profileId:state.pending?.expectedProfileId;
  if(expected&&expected!==profileId){await write(record!.revision,{...state,active:null,pending:null});throw new AccountAccessError('PROFILE_MISMATCH')}
  if(status.deletionStatus||state.blockedProfiles.includes(profileId)){await write(record!.revision,{...state,active:null,pending:null,blockedProfiles:[...new Set([...state.blockedProfiles,profileId])]});throw new AccountAccessError('ACCOUNT_DELETING')}
  const grant=coldWritesEnabled?verifiedOfflineGrant(proof.selector,status):undefined;
  const active:Active={selector:proof.selector,profileId,...(grant?{offlineWriteGrant:grant}:{}),...(allowPendingWrites?{operationSupport:canonical({scoring:scoringSupported,completion:completionSupported,corrections:correctionsSupported,rules:rulesSupported,deletion:deletionSupported,imports:scoringSupported&&Array.isArray(status.gameOperations?.kinds)&&status.gameOperations.kinds.includes('import')})}:{})};
  // Background verification of unchanged ownership/support must not revoke
  // another tab's legitimate local write or rotate the lifecycle every pass.
  const next=allowPendingWrites&&proof.kind==='account'&&canonical(state.active)===canonical(active)?record!:await write(record!.revision,{...state,pending:null,active}),lease=issue({kind:'account' as const,revision:next.revision,selector:proof.selector,profileId});confirmed.add(lease);offlineWrites.add(lease);if(scoringSupported)scoring.add(lease);if(completionSupported)completion.add(lease);if(correctionsSupported)corrections.add(lease);if(rulesSupported)rules.add(lease);if(deletionSupported)deletion.add(lease);if(scoringSupported&&Array.isArray(status.gameOperations?.kinds)&&status.gameOperations.kinds.includes('import'))imports.add(lease);return lease;
 }
 async function withReview(proof:DurableLease,gameId:string,read:AccountGameRead):Promise<AccountGameRead>{
  const collision=await readGameCollision(documents,proof.profileId,gameId);await current(proof);
  if(collision&&(read.kind==='game'||read.kind==='pending-delete'))return {...read,sync:'needs-review'};
  return read;
 }
 const api={
  async beginVerification(selector:string,expectedProfileId?:string):Promise<VerificationTicket>{
   if(closed)throw new AccountAccessError('STALE_ACCOUNT');
   if(!nonempty(selector)||(expectedProfileId!==undefined&&!nonempty(expectedProfileId)))throw new AccountAccessError('ACCOUNT_UNVERIFIED');
   stopDeliveries();const record=await documents.read(KEY),state=lifecycle(record),next=await write(record?.revision||0,{...state,active:null,pending:{selector,...(expectedProfileId?{expectedProfileId}:{})}});
   return issue({kind:'verification' as const,revision:next.revision,selector});
  },
  verify:accept,
  async restore(selector:string):Promise<DurableLease|null>{
   if(closed)throw new AccountAccessError('STALE_ACCOUNT');const record=await documents.read(KEY),state=lifecycle(record);
   if(closed)throw new AccountAccessError('STALE_ACCOUNT');
   if(!record||state.active?.selector!==selector)return null;
   const lease=issue({kind:'account' as const,revision:record.revision,selector:state.active.selector,profileId:state.active.profileId});
   if(coldWritesEnabled){const grant=checkedOfflineGrant(state.active.offlineWriteGrant,selector,state.active.profileId);if(grant)localRights(lease,grant)}
   return lease;
  },
  async signOut(proof:DurableLease|VerificationTicket){check(proof);stopDeliveries(proof);const {record,state}=await current(proof);await write(record!.revision,{...state,active:null,pending:null})},
  async isDeletionBlocked(profileId:string){if(closed)throw new AccountAccessError('STALE_ACCOUNT');if(!nonempty(profileId))throw new AccountAccessError('ACCOUNT_UNVERIFIED');const state=lifecycle(await documents.read(KEY));if(closed)throw new AccountAccessError('STALE_ACCOUNT');return state.blockedProfiles.includes(profileId)},
  async beginDeletion(proof:DurableLease){account(proof);stopDeliveries(proof);confirmed.delete(proof);offlineWrites.delete(proof);const {record,state}=await current(proof);await write(record!.revision,{...state,active:null,pending:null,blockedProfiles:[...new Set([...state.blockedProfiles,proof.profileId])]})},
  connectionUnavailable(proof:DurableLease){account(proof);stopDeliveries(proof);confirmed.delete(proof)},
  async readConfirmed(proof:DurableLease,gameId:string){account(proof);await current(proof);const value=await repository.readConfirmed(proof.profileId,gameId);await current(proof);return value},
  async readGame(proof:DurableLease,gameId:string):Promise<AccountGameRead>{
   account(proof);await current(proof);
   const outbox=api.outbox(proof),tracked=await outbox.readGame(gameId);if(tracked){await current(proof);return withReview(proof,gameId,tracked)}
   const cached=await repository.readConfirmed(proof.profileId,gameId);await current(proof);
   // A writer may have started tracking while the generic cache read was pending.
   const latest=await outbox.readGame(gameId);await current(proof);if(latest)return withReview(proof,gameId,latest);
   return withReview(proof,gameId,cached?{kind:'game',source:'cache',sync:'confirmed',view:cached.view,pendingOperations:0,serverVersion:cached.serverVersion}:{kind:'missing'});
  },
  async readScoringGame(proof:DurableLease,gameId:string):Promise<AccountGameRead>{
   account(proof);await current(proof);const saved=await api.outbox(proof).scoringRead(gameId,allowPendingWrites);
   const read=saved.read?await withReview(proof,gameId,saved.read):await api.readGame(proof,gameId);await current(proof);
   if(read.kind!=='game')return read;
   const permission=offlineWrites.has(proof)&&scoring.has(proof),ready=permission&&saved.eligible&&read.sync!=='needs-review';
   return {...read,canScore:ready,canChangeCompletion:offlineWrites.has(proof)&&completion.has(proof)&&saved.completionEligible&&read.sync!=='needs-review',canCorrectEntries:offlineWrites.has(proof)&&corrections.has(proof)&&saved.completionEligible&&read.sync!=='needs-review'&&read.view.game.entries.length>0,canEditRules:offlineWrites.has(proof)&&rules.has(proof)&&saved.eligible&&read.sync!=='needs-review'&&canEditGame(read.view.game),canDelete:offlineWrites.has(proof)&&deletion.has(proof)&&saved.eligible&&read.sync!=='needs-review',scoreProfileId:proof.profileId,scoreAccess:!permission?'connect':read.source!=='queue'?'untracked':ready?'ready':'paused'};
  },
  async previewAdoption(proof:DurableLease,raw:string,gameId:string,operationId:string){
   account(proof);await current(proof);if(!confirmed.has(proof))throw new AccountAccessError('SYNC_UNAVAILABLE');
   if((await api.readGame(proof,gameId)).kind!=='missing')throw new OutboxError('NEEDS_REVIEW','An account copy or deletion record already exists. Review it before preparing a device copy.');
   const source=await adoptionSource(raw,gameId,operationId),key=adoptionKey(proof.profileId,gameId),indexKey=adoptionIndexKey(proof.profileId),record=await documents.read(key),indexRecord=await documents.read(indexKey);
   const index=indexRecord?checkedAdoptionIndex(indexRecord.value,proof.profileId):{schemaVersion:1 as const,profileId:proof.profileId,copies:[]};
   let draft:AdoptionDraft,revision:number;
   if(record){draft=await checkedAdoption(record.value,proof.profileId,gameId);if(draft.sourceRaw!==source.sourceRaw)throw new OutboxError('NEEDS_REVIEW','This device game changed. Its earlier prepared copy is retained; choosing a newer source needs review.');if(index.copies.find(c=>c.gameId===gameId)?.bytes!==adoptionReservation(draft))throw new LocalRepositoryError('STORAGE_CORRUPT','Retained adoption index and copy disagree.');revision=record.revision}
   else{
    if(index.copies.some(c=>c.gameId===gameId))throw new LocalRepositoryError('STORAGE_CORRUPT','A retained adoption copy is missing. Originals have been kept.');
    draft={schemaVersion:1,profileId:proof.profileId,gameId,status:'staged',...source};index.copies.push({gameId,bytes:adoptionReservation(draft)});
    if(index.copies.length>50||index.copies.reduce((n,c)=>n+c.bytes,0)>8_000_000)throw new OutboxError('QUEUE_FULL','Retained device copies are full. Existing copies have been kept.');
    if(!documents.writeMany)throw new LocalRepositoryError('STORAGE_UNAVAILABLE','Atomic source retention is unavailable.');await current(proof);
    try{const saved=await documents.writeMany([{key,expectedRevision:0,value:draft},{key:indexKey,expectedRevision:indexRecord?.revision??0,value:index}],[{key:KEY,revision:proof.revision}]);revision=saved[0].revision}catch(error){await current(proof);throw error}
   }
   await current(proof);return {review:adoptionReview(draft),ticket:{key,revision,operationId:draft.operation.operationId,sourceRaw:draft.sourceRaw}};
  },
  async confirmAdoptionSource(proof:DurableLease,ticket:{key:string;revision:number;operationId:string;sourceRaw:string},raw:string,gameId:string){
   account(proof);await current(proof);if(!confirmed.has(proof))throw new AccountAccessError('SYNC_UNAVAILABLE');
   if(ticket.key!==adoptionKey(proof.profileId,gameId))throw new AccountAccessError('PROFILE_MISMATCH');
   const record=await documents.read(ticket.key);if(!record)throw new LocalRepositoryError('STORAGE_CORRUPT','The retained copy is missing.');const draft=await checkedAdoption(record.value,proof.profileId,gameId);
   if(draft.operation.operationId!==ticket.operationId||draft.sourceRaw!==ticket.sourceRaw)throw new LocalRepositoryError('STORAGE_CONFLICT','The reviewed copy changed. Reopen review.');
   const indexRecord=await documents.read(adoptionIndexKey(proof.profileId)),index=checkedAdoptionIndex(indexRecord?.value,proof.profileId);if(index.copies.find(c=>c.gameId===gameId)?.bytes!==adoptionReservation(draft))throw new LocalRepositoryError('STORAGE_CORRUPT','Retained adoption index and copy disagree.');
   if(draft.status==='reviewed'){await current(proof);return adoptionReview(draft)}
   if(record.revision!==ticket.revision)throw new LocalRepositoryError('STORAGE_CONFLICT','The reviewed copy changed. Reopen review.');
   const latest=await adoptionSource(raw,gameId,draft.operation.operationId);if(latest.sourceRaw!==draft.sourceRaw)throw new OutboxError('NEEDS_REVIEW','The device game changed while reviewing. Its retained copy is kept; nothing was queued.');
   if((await api.readGame(proof,gameId)).kind!=='missing')throw new OutboxError('NEEDS_REVIEW','An account copy or deletion record appeared. Nothing was queued.');
   await current(proof);try{await documents.write(ticket.key,record.revision,{...draft,status:'reviewed'},[{key:KEY,revision:proof.revision},{key:adoptionIndexKey(proof.profileId),revision:indexRecord!.revision}])}catch(error){await current(proof);throw error}await current(proof);return adoptionReview({...draft,status:'reviewed'});
  },
  async deviceAuthority(proof:DurableLease,gameId:string){
   account(proof);await current(proof);const state=await api.outbox(proof).read();await current(proof);return importedGameIds(state).includes(gameId);
  },
  async admitAdoption(proof:DurableLease,ticket:{key:string;revision:number;operationId:string;sourceRaw:string},raw:string,gameId:string):Promise<AccountGameRead>{
   account(proof);await current(proof);
   if(!confirmed.has(proof)||!offlineWrites.has(proof)||!imports.has(proof))throw new OutboxError('CAPABILITY_REQUIRED','Reconnect to a server with replay-safe game import support before adding this copy.');
   if(ticket.key!==adoptionKey(proof.profileId,gameId))throw new AccountAccessError('PROFILE_MISMATCH');
   const record=await documents.read(ticket.key);if(!record)throw new LocalRepositoryError('STORAGE_CORRUPT','The reviewed source is missing.');
   const draft=await checkedAdoption(record.value,proof.profileId,gameId);
   if(draft.status!=='reviewed'||draft.operation.operationId!==ticket.operationId||draft.sourceRaw!==ticket.sourceRaw)throw new OutboxError('NEEDS_REVIEW','Confirm the retained source before queueing it.');
   const indexKey=adoptionIndexKey(proof.profileId),indexRecord=await documents.read(indexKey),index=checkedAdoptionIndex(indexRecord?.value,proof.profileId);
   if(index.copies.find(c=>c.gameId===gameId)?.bytes!==adoptionReservation(draft))throw new LocalRepositoryError('STORAGE_CORRUPT','Retained adoption index and copy disagree.');
   const outbox=api.outbox(proof);
   // An acknowledged local admission must never be retargeted to a changed
   // source or new operation, including after restart, rejection or deletion.
   if(await outbox.hasOperation(draft.operation))return api.readScoringGame(proof,gameId);
   const source=await adoptionSource(raw,gameId,draft.operation.operationId);
   if(source.sourceRaw!==draft.sourceRaw)throw new OutboxError('NEEDS_REVIEW','The device source changed. Its reviewed copy is kept; nothing was queued.');
   if((await api.readGame(proof,gameId)).kind!=='missing')throw new OutboxError('NEEDS_REVIEW','An account copy or deletion record already exists. Nothing was queued.');
   try{await outbox.enqueue(draft.operation,false,[{key:ticket.key,revision:record.revision},{key:indexKey,revision:indexRecord!.revision}],'sync')}
   catch(error){
    await current(proof);
    if(['STALE_ACCOUNT','PROFILE_MISMATCH','ACCOUNT_DELETING','OPERATION_ID_REUSED'].includes((error as {code?:string})?.code??''))throw error;
    try{if(await outbox.hasOperation(draft.operation))return api.readScoringGame(proof,gameId)}catch(probe){await current(proof);if(['STALE_ACCOUNT','PROFILE_MISMATCH','ACCOUNT_DELETING','OPERATION_ID_REUSED'].includes((probe as {code?:string})?.code??''))throw probe;throw Object.assign(new Error('The local admission could not be confirmed. Retry this reviewed copy; its original request is retained.'),{code:'SAVE_UNCONFIRMED'})}
    throw error;
   }
   await current(proof);return api.readScoringGame(proof,gameId);
  },
  async prepareScoring(proof:DurableLease,input:GameView):Promise<AccountGameRead>{
   account(proof);const selected=JSON.parse(JSON.stringify(input)) as GameView;await current(proof);
   if(!confirmed.has(proof)||!offlineWrites.has(proof)||!scoring.has(proof))throw new AccountAccessError('SYNC_UNAVAILABLE');
   await api.outbox(proof).seedConfirmed(selected.game.id,selected);
   await current(proof);return api.readScoringGame(proof,selected.game.id);
  },
  async enqueueScoring(proof:DurableLease,input:GameWriteOperation):Promise<AccountGameRead>{
   account(proof);const operation=JSON.parse(JSON.stringify(input)) as GameWriteOperation;await current(proof);
   if(!offlineWrites.has(proof)||!scoring.has(proof))throw new AccountAccessError('SYNC_UNAVAILABLE');
   if(operation.kind==='delete'){if(!deletion.has(proof))throw new AccountAccessError('SYNC_UNAVAILABLE')}else{
   if(operation.kind!=='action'||!['score','select','finish','resume','undo','edit','rules'].includes(operation.command?.action))throw new OutboxError('INVALID_OPERATION','This game action is not available here.');
   if(['finish','resume'].includes(operation.command.action)&&!completion.has(proof))throw new AccountAccessError('SYNC_UNAVAILABLE');
   if(['undo','edit'].includes(operation.command.action)&&!corrections.has(proof))throw new AccountAccessError('SYNC_UNAVAILABLE');
   if(operation.command.action==='rules'&&!rules.has(proof))throw new AccountAccessError('SYNC_UNAVAILABLE');
   }
   const outbox=api.outbox(proof);
   for(let attempt=0;;attempt++)try{
    await outbox.enqueue(operation,true,[],'write',allowPendingWrites);break;
   }catch(error){
    if(['STALE_ACCOUNT','PROFILE_MISMATCH','ACCOUNT_DELETING','OPERATION_ID_REUSED'].includes((error as {code?:string})?.code??''))throw error;
    // A failed local acknowledgement is not proof of rollback. Confirm this
    // exact immutable request before allowing a new intent or clearing input.
    try{if(await outbox.hasOperation(operation))return api.readScoringGame(proof,operation.gameId)}catch(probeError){if(['STALE_ACCOUNT','PROFILE_MISMATCH','ACCOUNT_DELETING','OPERATION_ID_REUSED'].includes((probeError as {code?:string})?.code??''))throw probeError;throw Object.assign(new Error('The local save could not be confirmed. Retry this save; your input has been kept.'),{code:'SAVE_UNCONFIRMED'})}
    if(allowPendingWrites&&attempt===0&&(error as {code?:string})?.code==='STORAGE_CONFLICT')continue;
    throw Object.assign(error instanceof Error?error:new Error('Score could not be saved.'),{definitelyNotSaved:true});
   }
   return api.readScoringGame(proof,operation.gameId);
  },
  async readHome(proof:DurableLease,seeds:GameSummary[]){
   account(proof);await current(proof);
   const index=await retainHomeSummaries(documents,proof.profileId,seeds,{key:KEY,revision:proof.revision});
   await current(proof);const saved=await api.outbox(proof).readHomeState(),adoptedGameIds=importedGameIds(saved.state),rows=queueHome(saved.state,index,adoptedGameIds);
   // Bound concurrent document reads. Never reread/decode the queue per tile.
   for(let i=0;i<rows.length;i+=16)await Promise.all(rows.slice(i,i+16).map(async row=>{
    const saved=await readCollisionFile(documents,proof.profileId,row.gameId);if(saved.file?.active)row.sync='needs-review';if(saved.file?.history.length)row.retained=true;
   }));
   const tracked=new Map(saved.state.games.map(game=>[game.gameId,game]));for(const row of rows){const game=tracked.get(row.gameId);row.canDelete=offlineWrites.has(proof)&&deletion.has(proof)&&row.sync!=='needs-review'&&!!game?.projection&&!game.projection.game.finished&&!game.tombstone&&appendableOperations(game,allowPendingWrites)}
   await current(proof);if((await documents.read('game-outbox:'+proof.profileId))?.revision!==saved.revision)throw new LocalRepositoryError('STORAGE_CONFLICT','Saved changes updated. Reconnect to refresh the list.');await current(proof);return {...homeResult(rows),profileId:proof.profileId,adoptedGameIds};
  },
  async readRecovery(proof:DurableLease,gameId:string){
   account(proof);await current(proof);const saved=await api.outbox(proof).readRecovery(gameId),collision=await readCollisionFile(documents,proof.profileId,gameId);
   const read=saved.read?await withReview(proof,gameId,saved.read):await api.readGame(proof,gameId);await current(proof);
   // The ticket uses the review's revision. A concurrent queue update can only
   // make confirmation fail its CAS, never apply a different unseen choice.
   const review=recoveryReview(gameId,read,saved.state,saved.conflict,collision.file?.active??null,collision.file?.history??[]);
   if(!confirmed.has(proof))review.canCheckCollision=false;
   if(review.canChooseAccount&&!confirmed.has(proof)){review.canChooseAccount=false;review.message='Reconnect, then reopen this review to choose an account copy. All saved copies stay available here.'}
   return {review,revision:saved.conflict?saved.revision:null};
  },
  async previewCollisionResolution(proof:DurableLease,gameId:string,input:GameView,decisionId:string){
   account(proof);await current(proof);if(!confirmed.has(proof))throw new AccountAccessError('SYNC_UNAVAILABLE');
   const selected=snapshot(proof.profileId,input),saved=await readCollisionFile(documents,proof.profileId,gameId);
   if(selected.gameId!==gameId||!saved.file?.active||selected.serverVersion<=saved.file.active.retained.serverVersion)throw new OutboxError('NEEDS_REVIEW','A newer account copy is not available yet. Both conflicting copies stay paused.');
   const prepared=await api.outbox(proof).prepareCollisionResolution(gameId,selected,[...saved.file.active.retained.view.game.entries,...saved.file.active.observed.view.game.entries].map(e=>e.id)),result=await api.readRecovery(proof,gameId);await current(proof);
   if(!result.review.canCheckCollision)throw new OutboxError('NEEDS_REVIEW','Saved changes updated. Close and reopen this review.');
   result.review.copies.unshift({id:'new-account',label:'Newer account copy',view:selected.view,version:selected.serverVersion,deleted:false});result.review.canChooseAccount=false;result.review.canCheckCollision=false;result.review.canResolveCollision=true;
   result.review.message='A newer account copy is available. Review it before confirming. Both conflicting copies and the earlier device base will be archived; no scores will be uploaded or combined.';
   return {review:result.review,selected,decisionId,queueRevision:prepared.write.expectedRevision,collisionRevision:saved.revision};
  },
  async resolveCollision(proof:DurableLease,gameId:string,ticket:{selected:ReturnType<typeof snapshot>;decisionId:string;queueRevision:number;collisionRevision:number}){
   account(proof);await current(proof);if(!confirmed.has(proof))throw new AccountAccessError('SYNC_UNAVAILABLE');
   const selected=snapshot(proof.profileId,ticket.selected.view),saved=await readCollisionFile(documents,proof.profileId,gameId);
   const completed=saved.file?.history.find(d=>d.id===ticket.decisionId);
   if(completed){if(canonical(completed.selected)!==canonical(selected))throw new OutboxError('NEEDS_REVIEW','Review decision does not match its retained copy.');return api.readGame(proof,gameId)}
   if(selected.gameId!==gameId||!saved.file?.active||saved.revision!==ticket.collisionRevision||selected.serverVersion<=saved.file.active.retained.serverVersion)throw new OutboxError('NEEDS_REVIEW','Conflicting copies changed. Close and reopen this review.');
   const prepared=await api.outbox(proof).prepareCollisionResolution(gameId,selected,[...saved.file.active.retained.view.game.entries,...saved.file.active.observed.view.game.entries].map(e=>e.id));
   if(prepared.write.expectedRevision!==ticket.queueRevision)throw new LocalRepositoryError('STORAGE_CONFLICT','Saved changes updated. Close and reopen this review.');
   const next=checkedCollisionFile({...saved.file,active:null,history:[...saved.file.history,{id:ticket.decisionId,pair:saved.file.active,selected,prior:prepared.prior}]});
   if(!documents.writeMany)throw new LocalRepositoryError('STORAGE_UNAVAILABLE','Atomic recovery storage is unavailable. All copies have been kept.');
   await current(proof);await documents.writeMany([prepared.write,{key:gameCollisionKey(proof.profileId,gameId),expectedRevision:saved.revision,value:next}],[prepared.guard]);
   clearGameReadCache(documents);await current(proof);return api.readGame(proof,gameId);
  },
  async chooseAccountRecovery(proof:DurableLease,gameId:string,revision:number,resolutionId:string){
   account(proof);await current(proof);if(!confirmed.has(proof))throw new AccountAccessError('SYNC_UNAVAILABLE');
   const currentReview=await api.readRecovery(proof,gameId);
   const completed=(await api.outbox(proof).read()).archive.some(batch=>batch.id===resolutionId&&batch.kind==='account-selected'&&batch.gameId===gameId);
   if(!completed&&!currentReview.review.canChooseAccount)throw new OutboxError('NEEDS_REVIEW','This game cannot use an account copy yet. All saved copies have been kept.');
   const collision=await readCollisionFile(documents,proof.profileId,gameId);
   await api.outbox(proof).useAccountVersion(gameId,revision,resolutionId,[{key:gameCollisionKey(proof.profileId,gameId),revision:collision.revision}]);
   await current(proof);return api.readGame(proof,gameId);
  },
  async observeGame(proof:DurableLease,view:GameView):Promise<AccountGameRead>{
   account(proof);const observed=snapshot(proof.profileId,view);await current(proof);
   if(!confirmed.has(proof))throw new AccountAccessError('SYNC_UNAVAILABLE');
   if(await readGameCollision(documents,proof.profileId,observed.gameId)){await current(proof);throw new LocalRepositoryError('VERSION_COLLISION','Saved account versions still require review. Both copies have been kept.')}
   const outbox=api.outbox(proof),tracked=await outbox.readGame(observed.gameId);
   try{
    if(tracked)await outbox.observeSnapshot(observed);
    else await api.saveConfirmed(proof,[observed.view]);
   }catch(error){
    if((error as {code?:string})?.code!=='VERSION_COLLISION')throw error;
    // Preserve the actual authoritative base/candidate, not a local projection.
    const queued=(await outbox.read()).games.find(game=>game.gameId===observed.gameId);
    const retained=queued?.candidate??queued?.base??await api.readConfirmed(proof,observed.gameId);
    if(!retained)throw error;
    await current(proof);
    await keepGameCollision(documents,{key:KEY,revision:proof.revision},retained,observed);
    await current(proof);throw error;
   }
   // The queue is authoritative even if tracking began during the cache save.
   return api.readGame(proof,observed.gameId);
  },
  async saveConfirmed(proof:DurableLease,views:GameView[]){account(proof);const detached=JSON.parse(JSON.stringify(views)) as GameView[];await current(proof);if(!confirmed.has(proof))throw new AccountAccessError('SYNC_UNAVAILABLE');await repository.saveConfirmed(proof.profileId,detached);await current(proof)},
  outbox(proof:DurableLease){
   account(proof);
   return createGameOutbox(documents,{
    async authorize(mode){account(proof);await current(proof);if(mode!=='read'&&!(mode==='sync'?confirmed:offlineWrites).has(proof))throw new AccountAccessError('SYNC_UNAVAILABLE');return {profileId:proof.profileId,guard:{key:KEY,revision:proof.revision}}},
    async readConfirmed(gameId){account(proof);await current(proof);const value=await repository.readConfirmed(proof.profileId,gameId);await current(proof);return value}
   });
  },
  delivery(proof:DurableLease,transport:DeliveryTransport,options:DeliveryOptions={}){
   account(proof);const worker=createGameDelivery(api.outbox(proof),transport,{
    profileId:proof.profileId,
    async assert(){account(proof);await current(proof);if(!confirmed.has(proof))throw new AccountAccessError('SYNC_UNAVAILABLE')},
    async blockAccount(){await api.beginDeletion(proof)}
   },options);deliveries.set(worker,proof);const close=worker.close;worker.close=()=>{close();deliveries.delete(worker)};return worker;
  },
  httpDelivery(proof:DurableLease,base:string,getToken:(account:Readonly<{selector:string;profileId:string}>,signal:AbortSignal)=>Promise<string>,options:DeliveryOptions={}){
   account(proof);const scope={profileId:proof.profileId,async assert(){account(proof);await current(proof);if(!confirmed.has(proof))throw new AccountAccessError('SYNC_UNAVAILABLE')}};
   const transport=createOperationTransport(base,(profileId,signal)=>getToken(Object.freeze({selector:proof.selector,profileId}),signal),scope);
   return api.delivery(proof,transport,options);
  },
  async close(){closed=true;stopDeliveries();await repository.close()}

 };
 return api;
}
