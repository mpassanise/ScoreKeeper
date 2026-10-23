import type {DeliveryState} from './game-delivery';
import type {ReadScope,RepositoryPilot,ManualDeliveryRequest} from './pilot';

/** Manual connection actions only. No legacy write fallback or automatic replay. */
export async function runManualDelivery(pilot:RepositoryPilot,scope:ReadScope|null,request:ManualDeliveryRequest){
 const result=await pilot.manualDeliver(scope,request);
 if(['synced','pending','needs-review'].includes(result.phase))return result;
 const signIn=result.phase==='sign-in-required';
 throw Object.assign(new Error(signIn?'Sign in to the same account before syncing saved changes.':'Saved changes could not be synced. They have been kept on this device.'),{code:signIn?'SIGN_IN_REQUIRED':result.code??'DELIVERY_UNAVAILABLE',...(signIn?{status:401}:{})});
}
export function manualDeliveryText(state:Readonly<DeliveryState>|undefined):string|undefined{
 if(!state)return undefined;
 switch(state.phase){
  case 'connecting':case 'syncing':return 'Syncing saved changes in the background. You can keep using games on this device.';
  case 'retrying':return 'Retrying the same saved changes. You can keep using games on this device.';
  case 'synced':return 'Your games are up to date.';
  case 'pending':return 'Changes are saved on this device and waiting to sync. Sync will retry automatically when connected.';
  case 'needs-review':return 'A game changed on another device and needs attention. Open that game to continue. Your changes are safely saved here.';
  case 'sign-in-required':return 'Sign in to the same account to sync saved changes. Device copies are kept.';
  case 'account-blocked':return 'Account deletion is pending. Saved device copies have been kept.';
  case 'unavailable':return state.code==='CAPABILITY_REQUIRED'||state.code==='OPERATIONS_UNAVAILABLE'?'Account sync for saved changes is not available yet. Device copies have been kept.':'Saved changes could not be synced. Device copies are kept; try Reconnect.';
  case 'cancelled':return 'Sync paused. Saved changes have been kept for the next connection.';
  default:return undefined;
 }
}

/** An explicit sync waits for an existing read-only refresh, then runs once.
 * Repeated gestures share the same intent; a different account cannot adopt it. */
export function createManualSync(){
 let active:{key:string;promise:Promise<boolean>}|null=null;
 function run(key:string,isCurrent:()=>boolean,waitForRead:()=>Promise<void>,work:()=>Promise<boolean>){
  if(active?.key===key)return active.promise;
  const pass={key,promise:undefined! as Promise<boolean>};
  pass.promise=Promise.resolve().then(async()=>{await waitForRead();return isCurrent()?work():false}).finally(()=>{if(active===pass)active=null});
  active=pass;return pass.promise;
 }
 return {run,runAfter(key:string,isCurrent:()=>boolean,waitForRead:()=>Promise<void>,work:()=>Promise<boolean>){
  // A save queued after an earlier pass took its snapshot must not disappear
  // into that pass's result. Wait, then capture a fresh delivery intent.
  const prior=active?.key===key?active.promise:Promise.resolve(false);
  return prior.catch(()=>false).then(()=>isCurrent()?run(key,isCurrent,waitForRead,work):false);
 }};
}
