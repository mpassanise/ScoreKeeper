import type {AdoptionReview} from './adoption-source';
import type {GameWriteOperation} from '../game-operation-contract';
import type {AccountStatus,GameView,GameSummary} from '../api';
import {AccountAccessError} from './account-access';
import type {ConfirmedGames} from './confirmed-games';
import type {GameRecoveryReview} from './game-recovery';
import type {DeliveryState,DeliveryOptions} from './game-delivery';
export type ManualDeliveryRequest={base:string;getToken:(account:Readonly<{selector:string;profileId:string}>,signal:AbortSignal)=>Promise<string>;signal?:AbortSignal;onState?:(state:Readonly<DeliveryState>)=>void;options?:Omit<DeliveryOptions,'enabled'|'onState'>};
import {createDurableAccountRepository,type DurableLease,type VerificationTicket} from './durable-account';
import {stageLegacyGames} from './legacy-staging';
export type ReadScope=Readonly<{selector:string;generation:number}>;
export type DeviceSaveReview={busy:boolean;message:string;onReview:()=>void};
/** Gated account repository pilot. Manual delivery is separately disabled;
 * score admission has its own flag; no automatic adoption/replay is activated. */
export function createRepositoryPilot(options:{enabled:boolean;recoveryEnabled?:boolean;scoringEnabled?:boolean;coldWritesEnabled?:boolean;automaticSyncEnabled?:boolean;adoptionEnabled?:boolean;admissionEnabled?:boolean;collisionResolutionEnabled?:boolean;deliveryEnabled?:boolean;open:()=>Promise<ConfirmedGames>;publish?:()=>void;onQueued?:()=>void;onInvalidated:()=>void}){
 let generation=0,selector:string|null=null,closed=false,lease:DurableLease|undefined,proof:DurableLease|VerificationTicket|undefined;
 let opening:Promise<{raw:ConfirmedGames;access:ReturnType<typeof createDurableAccountRepository>}>|undefined;
 let deletionSelector:string|null=null,signOutIntent:{selector:string;proof?:DurableLease|VerificationTicket}|null=null;
 let tail:Promise<unknown>=Promise.resolve();
 type ManualFlight={scope:ReadScope;base:string;controller:AbortController;worker?:ReturnType<ReturnType<typeof createDurableAccountRepository>['httpDelivery']>;promise:Promise<DeliveryState>};
 let manual:ManualFlight|null=null;
 function stopDelivery(){const prior=manual;if(prior){prior.controller.abort();prior.worker?.close();if(manual===prior)manual=null}}
 const scopes=new WeakSet<object>();
 const collisionReviews=new WeakMap<object,{scope:ReadScope;lease:DurableLease;gameId:string;ticket:Pick<Awaited<ReturnType<ReturnType<typeof createDurableAccountRepository>['previewCollisionResolution']>>,'selected'|'decisionId'|'queueRevision'|'collisionRevision'>}>();
 const adoptions=new WeakMap<object,{selector:string;profileId:string;gameId:string;ticket:{key:string;revision:number;operationId:string;sourceRaw:string}}>();
 const reviews=new WeakMap<object,{scope:ReadScope;lease:DurableLease;gameId:string;revision:number;resolutionId:string}>();
 const stale=()=>new AccountAccessError('STALE_ACCOUNT');
 function invalidateScope(scope:ReadScope){
  if(scopes.has(scope)&&selector===scope.selector&&generation===scope.generation&&!closed){stopDelivery();generation++;lease=undefined;proof=undefined;options.onInvalidated()}
 }
 function invalidate(scope:ReadScope,error:unknown){
  const code=(error as {code?:string})?.code;
  if(code==='STALE_ACCOUNT'||code==='PROFILE_MISMATCH'||code==='ACCOUNT_DELETING')invalidateScope(scope);
 }
 function serial<T>(work:()=>Promise<T>):Promise<T>{const result=tail.then(work);tail=result.catch(()=>{});return result}
 async function repository(){if(closed||!options.enabled)throw stale();return opening??=(options.open().then(async raw=>{if(closed){await raw.close();throw stale()}return {raw,access:createDurableAccountRepository(raw,{coldWritesEnabled:options.scoringEnabled===true&&options.coldWritesEnabled===true,allowPendingWrites:options.scoringEnabled===true&&options.coldWritesEnabled===true&&options.automaticSyncEnabled===true})}}).catch(e=>{opening=undefined;throw e}))}
 function valid(scope:ReadScope){if(closed||!options.enabled||!scopes.has(scope)||selector!==scope.selector||generation!==scope.generation)throw stale()}
 function capture():ReadScope|null{if(!options.enabled||closed||!selector)return null;const scope=Object.freeze({selector,generation});scopes.add(scope);return scope}
 function select(next:string|null){if(!options.enabled||closed||selector===next)return;stopDelivery();generation++;selector=next;lease=undefined;proof=undefined;deletionSelector=null}
 return {
  enabled:options.enabled,select,capture,invalidate(scope:ReadScope|null){if(scope)invalidateScope(scope)},
  prepare(next:string,keepScope=false){select(next);if(keepScope&&lease&&proof===lease){const scope=capture();return serial(async()=>{if(!scope)throw stale();valid(scope);return scope})}stopDelivery();generation++;const scope=capture();return serial(async()=>{if(!options.enabled)return null;if(!scope)throw stale();valid(scope);const {access}=await repository();valid(scope);proof=(await access.restore(next))??undefined;valid(scope);proof=proof??await access.beginVerification(next);valid(scope);lease=proof.kind==='account'?proof:undefined;return scope})},
  verify(scope:ReadScope|null,status:AccountStatus){return serial(async()=>{if(!options.enabled)return;if(!scope)throw stale();valid(scope);const {access}=await repository();valid(scope);
   if(!proof)throw new AccountAccessError('ACCOUNT_UNVERIFIED');valid(scope);stopDelivery();
   try{lease=await access.verify(proof,status)}catch(error){invalidate(scope,error);throw error}
   proof=lease;valid(scope);options.publish?.();
  })},
  record(scope:ReadScope|null,view:GameView){const detached=JSON.parse(JSON.stringify(view)) as GameView;return serial(async()=>{if(!options.enabled)return;if(!scope)throw stale();valid(scope);if(!lease)throw new AccountAccessError('ACCOUNT_UNVERIFIED');const {access}=await repository();valid(scope);await access.observeGame(lease,detached);valid(scope)})},
  readGame(scope:ReadScope|null,gameId:string){return serial(async()=>{
   if(!options.enabled)return null;if(!scope)throw stale();valid(scope);
   const {access}=await repository();valid(scope);
   try{
    if(!lease){const restored=await access.restore(scope.selector);valid(scope);if(!restored)throw new AccountAccessError('ACCOUNT_UNVERIFIED');lease=restored;proof=restored}
    const value=await (options.scoringEnabled?access.readScoringGame(lease,gameId):access.readGame(lease,gameId));valid(scope);return value;
   }catch(error){invalidate(scope,error);throw error}
  })},
  previewAdoption(scope:ReadScope|null,raw:string,gameId:string,operationId:string){return serial(async()=>{
   if(!options.enabled||!options.adoptionEnabled||!scope)throw stale();valid(scope);if(!lease)throw new AccountAccessError('ACCOUNT_UNVERIFIED');const captured=lease,{access}=await repository();valid(scope);
   try{const value=await access.previewAdoption(captured,raw,gameId,operationId);valid(scope);adoptions.set(value.review,{selector:scope.selector,profileId:captured.profileId,gameId,ticket:value.ticket});return value.review}catch(error){invalidate(scope,error);throw error}
  })},
  confirmAdoptionSource(scope:ReadScope|null,review:AdoptionReview,raw:string){return serial(async()=>{
   if(!options.enabled||!options.adoptionEnabled||!scope)throw stale();valid(scope);if(!lease)throw new AccountAccessError('ACCOUNT_UNVERIFIED');const stored=adoptions.get(review);if(!stored||stored.selector!==scope.selector||stored.profileId!==lease.profileId)throw stale();const captured=lease,{access}=await repository();valid(scope);
   try{const value=await access.confirmAdoptionSource(captured,stored.ticket,raw,stored.gameId);valid(scope);return value}catch(error){invalidate(scope,error);throw error}
  })},
  deviceAuthority(scope:ReadScope|null,gameId:string){return serial(async()=>{
   if(!options.enabled||!options.recoveryEnabled||!scope)throw stale();valid(scope);const {access}=await repository();valid(scope);
   try{if(!lease){const restored=await access.restore(scope.selector);valid(scope);if(!restored)throw new AccountAccessError('ACCOUNT_UNVERIFIED');lease=restored;proof=restored}const result=await access.deviceAuthority(lease,gameId);valid(scope);return result}catch(error){invalidate(scope,error);throw error}
  })},
  admitAdoption(scope:ReadScope|null,review:AdoptionReview,raw:string){return serial(async()=>{
   if(!options.enabled||!options.scoringEnabled||!options.adoptionEnabled||!options.admissionEnabled||!scope)throw stale();valid(scope);if(!lease)throw new AccountAccessError('ACCOUNT_UNVERIFIED');
   const stored=adoptions.get(review);if(!stored||stored.selector!==scope.selector||stored.profileId!==lease.profileId)throw stale();const captured=lease,{access}=await repository();valid(scope);
   try{const read=await access.admitAdoption(captured,stored.ticket,raw,stored.gameId);valid(scope);options.publish?.();try{options.onQueued?.()}catch{/* Scheduling cannot turn a durable save into a failure. */}return read}catch(error){invalidate(scope,error);throw error}
  })},
  creationProfile(scope:ReadScope|null){return serial(async()=>{if(!scope)throw stale();valid(scope);const {access}=await repository();valid(scope);if(!lease){lease=await access.restore(scope.selector)??undefined;valid(scope);if(lease)proof=lease}if(!lease)throw new AccountAccessError('ACCOUNT_UNVERIFIED');return lease.profileId})},
  enqueueCreation(scope:ReadScope|null,input:import('../game-operation-contract').GameLifecycleOperation,expectedProfileId:string){const detached=JSON.parse(JSON.stringify(input)) as import('../game-operation-contract').GameLifecycleOperation;return serial(async()=>{
   if(!options.enabled||!options.scoringEnabled||!options.coldWritesEnabled||!options.automaticSyncEnabled||!scope)throw stale();valid(scope);
   const {access}=await repository();valid(scope);
   if(!lease){lease=await access.restore(scope.selector)??undefined;valid(scope);if(lease)proof=lease}
   if(!lease)throw new AccountAccessError('ACCOUNT_UNVERIFIED');
   const captured=lease;if(captured.profileId!==expectedProfileId)throw new AccountAccessError('PROFILE_MISMATCH');
   try{const read=await access.enqueueCreation(captured,detached);valid(scope);options.publish?.();try{options.onQueued?.()}catch{/* Local durability does not depend on scheduling. */}return read}catch(error){invalidate(scope,error);throw error}
  })},
  prepareScoring(scope:ReadScope|null,input:GameView,expectedProfileId:string){const detached=JSON.parse(JSON.stringify(input)) as GameView;return serial(async()=>{
   if(!options.enabled||!options.scoringEnabled||!scope)throw stale();valid(scope);if(!lease)throw new AccountAccessError('ACCOUNT_UNVERIFIED');const captured=lease;
   if(captured.profileId!==expectedProfileId)throw Object.assign(new Error('Account changed. Reopen the game before preparing score entry.'),{code:'SCORING_BINDING_CHANGED'});
   const {access}=await repository();valid(scope);
   try{const read=await access.prepareScoring(captured,detached);valid(scope);options.publish?.();return read}catch(error){invalidate(scope,error);throw error}
  })},
  enqueueScoring(scope:ReadScope|null,input:GameWriteOperation,expectedProfileId:string){const detached=JSON.parse(JSON.stringify(input)) as GameWriteOperation;return serial(async()=>{
   if(!options.enabled||!options.scoringEnabled||!scope)throw stale();valid(scope);if(!lease)throw new AccountAccessError('ACCOUNT_UNVERIFIED');const captured=lease;if(captured.profileId!==expectedProfileId)throw Object.assign(new Error('This save belongs to a different account profile. Its input has been kept.'),{code:'SCORING_BINDING_CHANGED'});const {access}=await repository();valid(scope);
   try{const read=await access.enqueueScoring(captured,detached);valid(scope);options.publish?.();try{options.onQueued?.()}catch{/* Scheduling cannot turn a durable save into a failure. */}return read}catch(error){invalidate(scope,error);throw error}
  })},
  readHome(scope:ReadScope|null,seeds:GameSummary[]){const detached=JSON.parse(JSON.stringify(seeds)) as GameSummary[];return serial(async()=>{
   if(!options.enabled||!options.recoveryEnabled)return null;if(!scope)throw stale();valid(scope);
   const {access}=await repository();valid(scope);
   try{
    if(!lease){const restored=await access.restore(scope.selector);valid(scope);if(!restored)throw new AccountAccessError('ACCOUNT_UNVERIFIED');lease=restored;proof=restored}
    const result=await access.readHome(lease,detached);valid(scope);return result;
   }catch(error){invalidate(scope,error);throw error}
  })},
  readRecovery(scope:ReadScope|null,gameId:string,resolutionId:string){return serial(async()=>{
   if(!options.enabled||!options.recoveryEnabled)return null;if(!scope)throw stale();valid(scope);
   const {access}=await repository();valid(scope);
   try{
    if(!lease){const restored=await access.restore(scope.selector);valid(scope);if(!restored)throw new AccountAccessError('ACCOUNT_UNVERIFIED');lease=restored;proof=restored}
    const result=await access.readRecovery(lease,gameId);valid(scope);if(!options.collisionResolutionEnabled)result.review.canCheckCollision=false;if(options.scoringEnabled)result.review.read=await access.readScoringGame(lease,gameId);valid(scope);
    if(result.review.canChooseAccount&&result.revision!==null)reviews.set(result.review,{scope,lease,gameId,revision:result.revision,resolutionId});
    return result.review;
   }catch(error){invalidate(scope,error);throw error}
  })},
  previewCollisionResolution(scope:ReadScope|null,gameId:string,input:GameView,decisionId:string){const detached=JSON.parse(JSON.stringify(input)) as GameView;return serial(async()=>{
   if(!options.enabled||!options.recoveryEnabled||!options.collisionResolutionEnabled||!scope)throw stale();valid(scope);if(!lease)throw stale();stopDelivery();const captured=lease,{access}=await repository();valid(scope);
   try{const ticket=await access.previewCollisionResolution(captured,gameId,detached,decisionId);valid(scope);collisionReviews.set(ticket.review,{scope,lease:captured,gameId,ticket:{selected:JSON.parse(JSON.stringify(ticket.selected)),decisionId:ticket.decisionId,queueRevision:ticket.queueRevision,collisionRevision:ticket.collisionRevision}});return ticket.review}catch(error){invalidate(scope,error);throw error}
  })},
  resolveCollision(scope:ReadScope|null,review:GameRecoveryReview){return serial(async()=>{
   if(!options.enabled||!options.recoveryEnabled||!options.collisionResolutionEnabled||!scope)throw stale();valid(scope);
   const preview=collisionReviews.get(review);if(!preview||preview.scope!==scope||preview.lease!==lease)throw stale();stopDelivery();const {access}=await repository();valid(scope);
   try{const picked=await access.resolveCollision(preview.lease,preview.gameId,preview.ticket);const read=options.scoringEnabled?await access.readScoringGame(preview.lease,preview.gameId):picked;valid(scope);options.publish?.();return read}catch(error){invalidate(scope,error);throw error}
  })},
  chooseAccountRecovery(scope:ReadScope|null,review:GameRecoveryReview){return serial(async()=>{
   if(!options.enabled||!options.recoveryEnabled||!scope)throw stale();valid(scope);
   const ticket=reviews.get(review);if(!ticket||ticket.scope!==scope||ticket.lease!==lease)throw stale();stopDelivery();
   const {access}=await repository();valid(scope);
   try{const picked=await access.chooseAccountRecovery(ticket.lease,ticket.gameId,ticket.revision,ticket.resolutionId);const read=options.scoringEnabled?await access.readScoringGame(ticket.lease,ticket.gameId):picked;valid(scope);options.publish?.();return read}catch(error){invalidate(scope,error);throw error}
  })},
  manualDeliver(scope:ReadScope|null,request:ManualDeliveryRequest):Promise<DeliveryState>{
   if(!options.enabled||!options.deliveryEnabled)return Promise.resolve({phase:'disabled'});
   try{if(!scope)throw stale();valid(scope)}catch(error){return Promise.reject(error)}
   if(manual&&manual.scope.selector===scope.selector&&manual.scope.generation===scope.generation&&manual.base===request.base)return manual.promise;
   stopDelivery();
   const flight:ManualFlight={scope:scope!,base:request.base,controller:new AbortController(),promise:undefined!};
   const abort=()=>{flight.controller.abort();flight.worker?.close()};
   request.signal?.addEventListener('abort',abort,{once:true});if(request.signal?.aborted)abort();
   function active(){valid(flight.scope);if(flight.controller.signal.aborted)throw Object.assign(new Error('Sync cancelled. Saved changes have been kept.'),{code:'REQUEST_CANCELLED'})}
   // Only acquire a worker under the pilot lock. Network delivery runs outside
   // it so cached reads, sign-out and account deletion never wait for a pass.
   flight.promise=Promise.resolve().then(()=>serial(async()=>{
    active();if(!lease)throw new AccountAccessError('ACCOUNT_UNVERIFIED');const captured=lease,{access}=await repository();active();
    const worker=access.httpDelivery(captured,request.base,async(account,signal)=>{active();const token=await request.getToken(account,signal);active();return token},{maxAttempts:2,stepTimeoutMs:30000,passTimeoutMs:60000,operationBudget:25,...request.options,enabled:true,onState:state=>{try{active();if(lease===captured)request.onState?.(state)}catch{/* Cancelled or stale presentation must not escape its account. */}}});
    flight.worker=worker;active();return worker;
   })).then(async worker=>{const result=await worker.connect();if(result.code==='STALE_ACCOUNT'||result.code==='PROFILE_MISMATCH')invalidate(flight.scope,{code:result.code});if(result.phase==='account-blocked')invalidate(flight.scope,{code:'ACCOUNT_DELETING'});return result}).catch(error=>{invalidate(flight.scope,error);throw error}).finally(()=>{flight.worker?.close();request.signal?.removeEventListener('abort',abort);if(manual===flight)manual=null});
   manual=flight;return flight.promise;
  },
  recheck(){return serial(async()=>{if(!options.enabled||!selector||!lease||closed)return;const scope=capture()!,previous=lease,{access}=await repository();valid(scope);let restored:DurableLease|null;try{restored=await access.restore(scope.selector)}catch(error){invalidate(scope,error);throw error}valid(scope);
   if(!restored||restored.profileId!==previous.profileId){stopDelivery();generation++;lease=undefined;proof=undefined;options.onInvalidated();return}
   // External lifecycle changes replace local grants with the committed rights.
   // Network/import permission still requires our own fresh verification.
   if(restored.revision!==previous.revision){stopDelivery();generation++;lease=restored;proof=restored}
  })},
  signOut(){stopDelivery();const oldSelector=selector,oldProof=proof;if(oldSelector&&signOutIntent?.selector!==oldSelector)signOutIntent={selector:oldSelector,proof:oldProof};generation++;lease=undefined;proof=undefined;return serial(async()=>{if(!options.enabled||!oldSelector)return;const intent=signOutIntent;if(!intent||intent.selector!==oldSelector)return;const {access}=await repository();const restored=await access.restore(oldSelector);const candidate=restored??intent.proof;
   if(candidate){try{await access.signOut(candidate)}catch(error){if((error as {code?:string})?.code!=='STALE_ACCOUNT'||await access.restore(oldSelector))throw error}options.publish?.()}
   if(signOutIntent===intent)signOutIntent=null;if(selector===oldSelector)selector=null;
  })},
  beginDeletion(verifiedProfileId?:string){stopDelivery();const oldSelector=selector;generation++;lease=undefined;return serial(async()=>{if(!options.enabled)return;if(!oldSelector)throw stale();if(deletionSelector===oldSelector)return;const {access}=await repository();const candidate=await access.restore(oldSelector);if(!candidate){if(!verifiedProfileId||!await access.isDeletionBlocked(verifiedProfileId))throw new AccountAccessError('ACCOUNT_UNVERIFIED')}else{if(verifiedProfileId&&candidate.profileId!==verifiedProfileId)throw new AccountAccessError('PROFILE_MISMATCH');await access.beginDeletion(candidate);}deletionSelector=oldSelector;proof=undefined;options.publish?.()})},
  stage(raw:string){return serial(async()=>{if(!options.enabled)throw stale();const {raw:repo}=await repository();const journal=await stageLegacyGames(repo.documents,'scorekeeper-v1',raw);return journal})},
  async close(){stopDelivery();closed=true;generation++;lease=undefined;proof=undefined;await tail;const opened=await opening?.catch(()=>undefined);await opened?.access.close()}
 };
}
export type RepositoryPilot=ReturnType<typeof createRepositoryPilot>;
