import {ApiError,type AccountStatus,type GameView} from '../api';
import type {OperationAcknowledgement} from '../game-operation-contract';
import {LocalRepositoryError,snapshot} from './confirmed-games';
import {OutboxError,operationFromWire,type createGameOutbox} from './game-outbox';

type Outbox=ReturnType<typeof createGameOutbox>;
export type DeliverySession={account:(signal:AbortSignal)=>Promise<AccountStatus>;operation:(wire:string,signal:AbortSignal)=>Promise<OperationAcknowledgement>;get:(gameId:string,signal:AbortSignal)=>Promise<GameView>};
export type DeliveryTransport={open:(signal:AbortSignal)=>Promise<DeliverySession>};
export type DeliveryState={phase:'disabled'|'idle'|'connecting'|'syncing'|'retrying'|'pending'|'synced'|'needs-review'|'unavailable'|'sign-in-required'|'account-blocked'|'cancelled';stage?:'account'|'queue'|'operation'|'snapshot';attempt?:number;pending?:number;code?:string};
export type DeliveryOptions={enabled?:boolean;maxAttempts?:number;retryDelayMs?:number;stepTimeoutMs?:number;passTimeoutMs?:number;pollMs?:number;operationBudget?:number;onState?:(state:Readonly<DeliveryState>)=>void};
export type DeliveryScope={profileId:string;assert:()=>Promise<void>;blockAccount:()=>Promise<void>};
class DeliveryFailure extends Error{constructor(readonly code:string){super(code)}}
const bound=(value:number|undefined,fallback:number,min:number,max:number)=>Number.isFinite(value)?Math.max(min,Math.min(max,Math.floor(value!))):fallback;
const knownCodes=new Set(['ACCOUNT_DELETION_PENDING','ACCOUNT_DELETING','ACCOUNT_BLOCK_NOT_PERSISTED','PROFILE_MISMATCH','ACCOUNT_UNVERIFIED','SYNC_UNAVAILABLE','STALE_ACCOUNT','REQUEST_CANCELLED','DELIVERY_CANCELLED','DELIVERY_TIMEOUT','PASS_LIMIT','NEEDS_REVIEW','OPERATION_ID_REUSED','VERSION_COLLISION','CAPABILITY_REQUIRED','SNAPSHOT_UNAVAILABLE','REQUEST_TIMEOUT','DATABASE_WAKING','API_UNAVAILABLE','TOKEN_REJECTED','OPERATIONS_UNAVAILABLE','STORAGE_CONFLICT','STORAGE_UNAVAILABLE','STORAGE_BLOCKED','STORAGE_CORRUPT','INVALID_SNAPSHOT','INVALID_OPERATION','INVALID_ACKNOWLEDGEMENT','QUEUE_FULL']);
const codeOf=(e:unknown)=>e&&typeof e==='object'&&'code'in e&&typeof e.code==='string'&&knownCodes.has(e.code)?e.code:undefined;
function retryable(e:unknown){return e instanceof TypeError||e instanceof DeliveryFailure&&e.code==='DELIVERY_TIMEOUT'||e instanceof ApiError&&e.code!=='OPERATIONS_UNAVAILABLE'&&(e.status===408||e.status===429||[500,502,503,504].includes(e.status))}
function phaseFor(e:unknown):DeliveryState['phase']{
 const code=codeOf(e);
 if(['ACCOUNT_DELETION_PENDING','ACCOUNT_DELETING'].includes(code??''))return 'account-blocked';
 if(['PROFILE_MISMATCH','ACCOUNT_UNVERIFIED','SYNC_UNAVAILABLE'].includes(code??'')||e instanceof ApiError&&[401,403].includes(e.status))return 'sign-in-required';
 if(code==='STALE_ACCOUNT'||code==='REQUEST_CANCELLED'||code==='DELIVERY_CANCELLED')return 'cancelled';
 if(code==='NEEDS_REVIEW'||code==='OPERATION_ID_REUSED'||code==='VERSION_COLLISION'||e instanceof ApiError&&[400,409,410].includes(e.status))return 'needs-review';
 if(code==='PASS_LIMIT')return 'pending';return 'unavailable';
}
/** Explicitly invoked, disabled by default. No timer/request starts until connect().
 * Repeated connect calls on this instance share one pass. Different handles may
 * replay the same immutable request; server receipts, not a browser leader, prevent duplicates. */
export function createGameDelivery(outbox:Outbox,transport:DeliveryTransport,scope:DeliveryScope,options:DeliveryOptions={}){
 const enabled=options.enabled===true,maxAttempts=bound(options.maxAttempts,3,1,3),retryDelay=bound(options.retryDelayMs,500,0,5000),stepTimeout=bound(options.stepTimeoutMs,65000,5,65000),passTimeout=bound(options.passTimeoutMs,120000,10,300000),pollMs=bound(options.pollMs,250,5,1000),budget=bound(options.operationBudget,50,1,100);
 let state:DeliveryState={phase:enabled?'idle':'disabled'},active:Promise<DeliveryState>|null=null,controller:AbortController|null=null,closed=false,generation=0;
 function publish(value:DeliveryState){state={...value};try{options.onState?.(Object.freeze({...state}))}catch{/* Presentation callbacks cannot turn a save into a failure. */}return {...state}}
 function cancel(){generation++;controller?.abort()}
 async function run(passController:AbortController,runId:number):Promise<DeliveryState>{
  const signal=passController.signal;
  let fatal:unknown,polling=false;const passTimer=setTimeout(()=>{fatal=new DeliveryFailure('PASS_LIMIT');passController.abort()},passTimeout);
  const check=async()=>{
   if(closed||runId!==generation||signal.aborted)throw fatal??new DeliveryFailure('DELIVERY_CANCELLED');let abort:()=>void=()=>{};
   try{await Promise.race([scope.assert(),new Promise<void>((_,reject)=>{abort=()=>reject(fatal??new DeliveryFailure('DELIVERY_CANCELLED'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()})])}finally{signal.removeEventListener('abort',abort)}
   if(closed||runId!==generation||signal.aborted)throw fatal??new DeliveryFailure('DELIVERY_CANCELLED');
  };
  const poll=setInterval(()=>{if(polling||signal.aborted)return;polling=true;scope.assert().catch(e=>{fatal=e;passController.abort()}).finally(()=>{polling=false})},pollMs);
  async function stage<T>(name:NonNullable<DeliveryState['stage']>,work:(signal:AbortSignal)=>Promise<T>):Promise<T>{
   await check();const child=new AbortController(),abort=()=>child.abort();signal.addEventListener('abort',abort,{once:true});let timer:ReturnType<typeof setTimeout>|undefined,listener:()=>void=()=>{};
   try{
    if(signal.aborted)throw fatal??new DeliveryFailure('DELIVERY_CANCELLED');
    const value=await Promise.race([work(child.signal),new Promise<T>((_,reject)=>{listener=()=>reject(fatal??new DeliveryFailure('DELIVERY_CANCELLED'));signal.addEventListener('abort',listener,{once:true});if(signal.aborted)listener();timer=setTimeout(()=>{reject(new DeliveryFailure('DELIVERY_TIMEOUT'));child.abort()},stepTimeout)})]);
    await check();return value;
   }finally{clearTimeout(timer);signal.removeEventListener('abort',listener);signal.removeEventListener('abort',abort);child.abort()}
  }
  async function retry<T>(name:NonNullable<DeliveryState['stage']>,work:(signal:AbortSignal)=>Promise<T>){
   for(let attempt=1;;attempt++){
    publish({phase:attempt===1?'syncing':'retrying',stage:name,attempt});
    try{return await stage(name,work)}catch(e){await check();if(!retryable(e)||attempt>=maxAttempts)throw e}
    await stage(name,s=>new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{s.removeEventListener('abort',abort);resolve()},Math.min(5000,Math.floor(retryDelay*attempt*(0.75+Math.random()/2)))),abort=()=>{clearTimeout(timer);reject(new DeliveryFailure('DELIVERY_CANCELLED'))};s.addEventListener('abort',abort,{once:true});if(s.aborted)abort()}));
   }
  }
  let review=false,confirmed=0,missingSnapshot=false,reviewCode:string|undefined;
  try{
   publish({phase:'connecting',stage:'account'});
   const session=await stage('account',s=>transport.open(s)),account=await retry('account',s=>session.account(s));
   if(account.profileId!==scope.profileId)throw new DeliveryFailure('PROFILE_MISMATCH');
   if(account.deletionStatus)throw new DeliveryFailure('ACCOUNT_DELETION_PENDING');
   const cap=account.gameOperations;if(!cap||cap.version!==1||cap.atomicGameAndReceipt!==true||cap.receipts!=='retained')throw new DeliveryFailure('CAPABILITY_REQUIRED');
   const initial=await stage('queue',()=>outbox.read());
   async function refresh(gameId:string){
    try{const view=await retry('snapshot',s=>session.get(gameId,s));return await stage('queue',()=>outbox.observeSnapshot(snapshot(scope.profileId,view)))}
    catch(e){if(e instanceof ApiError&&e.status===404)throw new DeliveryFailure('SNAPSHOT_UNAVAILABLE');throw e}
   }
   async function refreshGame(gameId:string){try{return await refresh(gameId)}catch(e){if(codeOf(e)==='SNAPSHOT_UNAVAILABLE'){review=true;missingSnapshot=true;return null}throw e}}
   for(const original of initial.games){
    let changed=false;
    try{while(true){
     const current=(await stage('queue',()=>outbox.read())).games.find(g=>g.gameId===original.gameId);if(!current)break;
     await stage('queue',()=>outbox.assertDelivery(current.gameId));
     if(current.tombstone)break;
     const head=current.operations.find(i=>i.status!=='applied');
     if(head?.status==='rejected'){
      if(await stage('queue',()=>outbox.settleAlreadyDeleted(current.gameId)))break;
      review=true;
      if(head.acknowledgement?.errorCode!=='GAME_DELETED')await refreshGame(current.gameId);
      break;
     }
     if(!head){if(current.operations.length){const last=operationFromWire(current.operations.at(-1)!.wire);if(last.kind==='delete')await stage('queue',()=>outbox.settle(current.gameId));else await refreshGame(current.gameId)}break}
     if(confirmed>=budget){if(changed)await refreshGame(current.gameId);break}
     const wire=await stage('queue',()=>outbox.prepareDelivery(current.gameId,cap));if(wire===null)break;
     const op=operationFromWire(wire),acknowledgement=await retry('operation',async s=>{await outbox.assertDelivery(current.gameId);return session.operation(wire,s)});
     await stage('queue',()=>outbox.acknowledge(op.operationId,acknowledgement));confirmed++;changed=true;
     if(acknowledgement.outcome==='rejected'){continue}
     if(op.kind==='delete'){await stage('queue',()=>outbox.settle(current.gameId));break}
    }}catch(e){
     // Only known game-specific reconciliation failures are isolated. Identity,
     // authentication, protocol and storage failures still stop the whole pass.
     await check();
     if((e instanceof OutboxError&&e.code==='NEEDS_REVIEW')||(e instanceof LocalRepositoryError&&e.code==='VERSION_COLLISION')){
      review=true;reviewCode??=e.code;continue;
     }
     throw e;
    }
   }
   const final=await stage('queue',()=>outbox.read()),pending=final.games.reduce((n,g)=>n+g.operations.length,0);review=review||final.games.some(g=>g.operations.some(i=>i.status==='rejected'));
   return publish({phase:review?'needs-review':pending?'pending':'synced',pending,...(missingSnapshot?{code:'SNAPSHOT_UNAVAILABLE'}:reviewCode?{code:reviewCode}:{})});
  }catch(e){
   const problem=fatal??e,phase=phaseFor(problem);let blockFailed=false;
   if(phase==='account-blocked'){
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([scope.blockAccount(),new Promise<void>((_,reject)=>{timer=setTimeout(()=>reject(new DeliveryFailure('ACCOUNT_BLOCK_NOT_PERSISTED')),Math.min(stepTimeout,5000))})])}catch{blockFailed=true}finally{clearTimeout(timer)}
   }
   return publish({phase,code:blockFailed?'ACCOUNT_BLOCK_NOT_PERSISTED':codeOf(problem)??'DELIVERY_UNAVAILABLE'});
  }finally{clearTimeout(passTimer);clearInterval(poll)}
 }
 return {
  state(){return {...state}},
  connect():Promise<DeliveryState>{
   if(!enabled)return Promise.resolve(publish({phase:'disabled'}));
   if(closed)return Promise.resolve({...state,phase:'cancelled'});
   if(active)return active;
   const c=new AbortController();controller=c;const runId=++generation;
   // Register before run can publish state and invoke a reentrant subscriber.
   const pass=Promise.resolve().then(()=>run(c,runId)).finally(()=>{
    if(active===pass)active=null;
    if(controller===c)controller=null;
   });
   active=pass;return pass;
  },
  cancel,
  close(){closed=true;cancel()}
 };
}
