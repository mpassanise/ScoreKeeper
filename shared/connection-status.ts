import type {DeliveryState} from './repository/game-delivery';
// Network calls keep their own 30-second token/I/O budgets. This is only
// a final guard for the full, nonblocking multi-step refresh.
export const RECONNECT_WATCHDOG_MS=120000;
export type ConnectionStage='authentication'|'account'|'games'|'game'|'players'|'imports'|'device'|'delivery'|'unknown';
export type ConnectionDiagnostic={attempt:string;stage:ConnectionStage;code:string;elapsedMs:number;httpStatus?:number;requestId?:string;pendingStages?:ConnectionStage[]};
export type ConnectionState={status:'idle'|'connecting'|'connected'|'unavailable'|'offline'|'sign-in';lastConnectedAt:number|null;diagnostic?:ConnectionDiagnostic;slow?:boolean;delivery?:Readonly<DeliveryState>};
export type ConnectionStep=<T>(stage:ConnectionStage,work:()=>Promise<T>)=>Promise<T>;
class StepError extends Error{constructor(readonly stage:ConnectionStage,readonly original:unknown){super('Connection step failed')}}
function originalError(error:unknown):unknown{return error instanceof StepError?error.original:error}
export function needsSignIn(error:unknown):boolean{
 error=originalError(error);
 if(!error||typeof error!=='object')return false;
 const e=error as {status?:number;errorCode?:string;code?:string;params?:{error?:string}};
 return e.status===401||['interaction_required','login_required','consent_required','invalid_grant','no_account_error','SIGN_IN_REQUIRED'].includes(e.params?.error||e.errorCode||e.code||'');
}
export function isConnectionFailure(error:unknown):boolean{
 error=originalError(error);
 if(needsSignIn(error)||error instanceof TypeError)return true;
 if(!error||typeof error!=='object')return false;
 const e=error as {status?:number;errorCode?:string};
 return e.status===0||e.status===408||e.status===429||(typeof e.status==='number'&&e.status>=500)||e.errorCode==='timed_out'||!!e.errorCode?.includes('timeout');
}
const safeCodes=new Set(['interaction_required','login_required','consent_required','invalid_grant','no_account_error','SIGN_IN_REQUIRED','timed_out','monitor_window_timeout','monitor_popup_timeout','block_iframe_reload','interaction_in_progress','no_network_connectivity','REQUEST_TIMEOUT','REQUEST_CANCELLED','DATABASE_WAKING','DATABASE_UNAVAILABLE','ACCOUNT_DELETION_PENDING','GAME_DELETED','PROFILE_MISMATCH','RECONNECT_TIMEOUT','CAPABILITY_REQUIRED','OPERATIONS_UNAVAILABLE','DELIVERY_UNAVAILABLE','DELIVERY_TIMEOUT','PASS_LIMIT','NEEDS_REVIEW','VERSION_COLLISION','STORAGE_CONFLICT','STORAGE_UNAVAILABLE','STORAGE_CORRUPT']);
function diagnostic(error:unknown,attempt:string,stage:ConnectionStage,started:number):ConnectionDiagnostic{
 const source=originalError(error);
 const e=(source&&typeof source==='object'?source:{}) as {status?:unknown;code?:unknown;errorCode?:unknown;params?:{error?:unknown};requestId?:unknown};
 const code=e.params?.error||e.errorCode||e.code;
 const status=typeof e.status==='number'&&Number.isInteger(e.status)&&e.status>=0&&e.status<=599?e.status:undefined;
 const requestId=typeof e.requestId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(e.requestId)?e.requestId:undefined;
 return {attempt,stage:error instanceof StepError?error.stage:stage,code:typeof code==='string'&&safeCodes.has(code)?code:source instanceof TypeError?'NETWORK_ERROR':'UNCLASSIFIED_ERROR',elapsedMs:Math.max(0,Date.now()-started),...(status!==undefined?{httpStatus:status}:{}),...(requestId?{requestId}:{})};
}
export function connectionText(state:ConnectionState){switch(state.status){
 case 'connecting':return state.slow?'Still connecting to your account…':'Connecting to your account…';
 case 'connected':return state.delivery?.phase==='needs-review'?'Account connected · sync needs attention':state.delivery?.phase==='pending'?'Account connected · changes waiting':'Account connected';
 case 'offline':return 'Offline · account sync unavailable';
 case 'sign-in':return 'Sign in to reconnect your account';
 case 'unavailable':return 'Account sync unavailable';
 default:return 'Account connection not checked';
}}
export function connectionFailureText(stage:ConnectionStage){
 return {authentication:'Sign-in could not finish.',account:'Account settings could not be loaded.',games:'Saved games could not be loaded.',game:'The open game could not be refreshed.',players:'Frequent players could not be synced.',imports:'Local import checks could not finish.',device:'Saved device data could not be read.',delivery:'Saved game changes could not be synced. Device copies have been kept.',unknown:'The connection could not be completed.'}[stage];
}
export function createConnectionStatus(timeoutMs=RECONNECT_WATCHDOG_MS,report?:(value:ConnectionDiagnostic)=>void){
 let state:ConnectionState={status:'idle',lastConnectedAt:null},identity:string|null=null,generation=0;
 let flight:Promise<boolean>|null=null,cancel:(()=>void)|null=null;
 const listeners=new Set<()=>void>();
 const publish=(patch:Partial<ConnectionState>)=>{state={...state,...patch};listeners.forEach(fn=>fn())};
 const emit=(value:ConnectionDiagnostic)=>{try{report?.(value)}catch{/* Diagnostics cannot break recovery. */}};
 function invalidate(){generation++;cancel?.();cancel=null;flight=null}
 function reset(next:string|null){if(identity===next)return;invalidate();identity=next;publish({status:'idle',lastConnectedAt:null,diagnostic:undefined,slow:false,delivery:undefined})}
 function offline(){invalidate();publish({status:'offline',diagnostic:undefined,slow:false})}
 function fail(error:unknown){invalidate();const value=diagnostic(error,'action-'+generation,'unknown',Date.now());publish({status:needsSignIn(error)?'sign-in':'unavailable',diagnostic:value,slow:false});emit(value)}
 function connect(work:(isCurrent:()=>boolean,signal:AbortSignal,step:ConnectionStep,reportDelivery:(state:Readonly<DeliveryState>)=>void)=>Promise<void>,externalSignal?:AbortSignal):Promise<boolean>{
  if(externalSignal?.aborted)return Promise.resolve(false);
  if(flight)return flight;
  if(identity===null)return Promise.resolve(false);
  const attempt=++generation,controller=new AbortController(),started=Date.now(),attemptId='connect-'+started.toString(36)+'-'+attempt;
  const valid=()=>attempt===generation&&identity!==null;
  let timer:ReturnType<typeof setTimeout>,sequence=0;
  const pending=new Map<number,ConnectionStage>();
  const step:ConnectionStep=async(stage,run)=>{const id=++sequence;pending.set(id,stage);try{return await run()}catch(error){throw error instanceof StepError?error:new StepError(stage,error)}finally{pending.delete(id)}};
  publish({status:'connecting',diagnostic:undefined,slow:false});
  const slowTimer=setTimeout(()=>{if(valid())publish({slow:true})},15000);
  const stopped=new Promise<boolean>(resolve=>{
   cancel=()=>{controller.abort();resolve(false)};
   timer=setTimeout(()=>{
    if(valid()){
     const stages=[...pending.values()],stage=stages.includes('authentication')?'authentication':stages[0]||'unknown';
     const value={...diagnostic({code:'RECONNECT_TIMEOUT'},attemptId,stage,started),pendingStages:[...new Set(stages)]};
     generation++;controller.abort();publish({status:'unavailable',diagnostic:value,slow:false});emit(value);
    }
    resolve(false);
   },timeoutMs);
  });
  const workResult=Promise.resolve().then(()=>work(valid,controller.signal,step,delivery=>{if(valid())publish({delivery:{...delivery}})})).then(()=>{if(!valid())return false;publish({status:'connected',lastConnectedAt:Date.now(),diagnostic:undefined,slow:false});return true},error=>{if(!valid())return false;const value=diagnostic(error,attemptId,'unknown',started);publish({status:needsSignIn(error)?'sign-in':'unavailable',diagnostic:value,slow:false});emit(value);return false});
  const abortExternal=()=>{if(valid()){invalidate();publish({status:state.lastConnectedAt?'connected':'idle',diagnostic:undefined,slow:false,delivery:state.delivery?{phase:'cancelled'}:undefined})}};
  externalSignal?.addEventListener('abort',abortExternal,{once:true});
  const result=Promise.race([workResult,stopped]).finally(()=>{externalSignal?.removeEventListener('abort',abortExternal);clearTimeout(timer);clearTimeout(slowTimer);if(flight===result){flight=null;cancel=null}});
  flight=result;return result;
 }
 return {getSnapshot:()=>state,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn)}},reset,offline,fail,connect,whenIdle:()=>flight?flight.then(()=>{}):Promise.resolve()};
}

