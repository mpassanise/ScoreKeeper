import type {AccountStatus,GameView} from '../api';
import {AccountAccessError} from './account-access';
import type {ConfirmedGames} from './confirmed-games';
import {createDurableAccountRepository,type DurableLease,type VerificationTicket} from './durable-account';
import {stageLegacyGames} from './legacy-staging';
export type ReadScope=Readonly<{selector:string;generation:number}>;
export type DeviceSaveReview={busy:boolean;message:string;onReview:()=>void};
/** Shadow read cache only. No API, source-storage writer, queue or offline scoring path. */
export function createRepositoryPilot(options:{enabled:boolean;open:()=>Promise<ConfirmedGames>;publish?:()=>void;onInvalidated:()=>void}){
 let generation=0,selector:string|null=null,closed=false,lease:DurableLease|undefined,proof:DurableLease|VerificationTicket|undefined;
 let opening:Promise<{raw:ConfirmedGames;access:ReturnType<typeof createDurableAccountRepository>}>|undefined;
 let deletionSelector:string|null=null;
 let tail:Promise<unknown>=Promise.resolve();
 const scopes=new WeakSet<object>();
 const stale=()=>new AccountAccessError('STALE_ACCOUNT');
 function serial<T>(work:()=>Promise<T>):Promise<T>{const result=tail.then(work);tail=result.catch(()=>{});return result}
 async function repository(){if(closed||!options.enabled)throw stale();return opening??=(options.open().then(async raw=>{if(closed){await raw.close();throw stale()}return {raw,access:createDurableAccountRepository(raw)}}).catch(e=>{opening=undefined;throw e}))}
 function valid(scope:ReadScope){if(closed||!options.enabled||!scopes.has(scope)||selector!==scope.selector||generation!==scope.generation)throw stale()}
 function capture():ReadScope|null{if(!options.enabled||closed||!selector)return null;const scope=Object.freeze({selector,generation});scopes.add(scope);return scope}
 function select(next:string|null){if(!options.enabled||closed||selector===next)return;generation++;selector=next;lease=undefined;proof=undefined;deletionSelector=null}
 return {
  enabled:options.enabled,select,capture,
  prepare(next:string){select(next);generation++;const scope=capture();return serial(async()=>{if(!options.enabled)return null;if(!scope)throw stale();valid(scope);const {access}=await repository();valid(scope);proof=(await access.restore(next))??undefined;valid(scope);proof=proof??await access.beginVerification(next);valid(scope);lease=proof.kind==='account'?proof:undefined;return scope})},
  verify(scope:ReadScope|null,status:AccountStatus){return serial(async()=>{if(!options.enabled)return;if(!scope)throw stale();valid(scope);const {access}=await repository();valid(scope);
   if(!proof)throw new AccountAccessError('ACCOUNT_UNVERIFIED');valid(scope);
   lease=await access.verify(proof,status);proof=lease;valid(scope);options.publish?.();
  })},
  record(scope:ReadScope|null,view:GameView){const detached=JSON.parse(JSON.stringify(view)) as GameView;return serial(async()=>{if(!options.enabled)return;if(!scope)throw stale();valid(scope);if(!lease)throw new AccountAccessError('ACCOUNT_UNVERIFIED');const {access}=await repository();valid(scope);await access.saveConfirmed(lease,[detached]);valid(scope)})},
  recheck(){return serial(async()=>{if(!options.enabled||!selector||!lease||closed)return;const scope=capture()!,previous=lease,{access}=await repository();valid(scope);const restored=await access.restore(scope.selector);valid(scope);
   if(!restored||restored.profileId!==previous.profileId){generation++;lease=undefined;proof=undefined;options.onInvalidated();return}
   // An external re-verification revokes writable permission until our next API verification.
   if(restored.revision!==previous.revision){generation++;lease=restored;proof=restored}
  })},
  signOut(){const oldSelector=selector,oldProof=proof;generation++;lease=undefined;proof=undefined;return serial(async()=>{if(!options.enabled||!oldSelector)return;const {access}=await repository();const restored=await access.restore(oldSelector);const candidate=restored??oldProof;
   if(candidate){await access.signOut(candidate);options.publish?.()}if(selector===oldSelector)selector=null;
  })},
  beginDeletion(verifiedProfileId?:string){const oldSelector=selector;generation++;lease=undefined;return serial(async()=>{if(!options.enabled)return;if(!oldSelector)throw stale();if(deletionSelector===oldSelector)return;const {access}=await repository();const candidate=await access.restore(oldSelector);if(!candidate){if(!verifiedProfileId||!await access.isDeletionBlocked(verifiedProfileId))throw new AccountAccessError('ACCOUNT_UNVERIFIED')}else{if(verifiedProfileId&&candidate.profileId!==verifiedProfileId)throw new AccountAccessError('PROFILE_MISMATCH');await access.beginDeletion(candidate);}deletionSelector=oldSelector;proof=undefined;options.publish?.()})},
  stage(raw:string){return serial(async()=>{if(!options.enabled)throw stale();const {raw:repo}=await repository();const journal=await stageLegacyGames(repo.documents,'scorekeeper-v1',raw);return journal})},
  async close(){closed=true;generation++;lease=undefined;proof=undefined;await tail;const opened=await opening?.catch(()=>undefined);await opened?.access.close()}
 };
}
export type RepositoryPilot=ReturnType<typeof createRepositoryPilot>;
