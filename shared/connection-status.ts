export type ConnectionState={status:'idle'|'connecting'|'connected'|'unavailable'|'offline'|'sign-in';lastConnectedAt:number|null};
export function needsSignIn(error:unknown):boolean{
 if(!error||typeof error!=='object')return false;
 const e=error as {status?:number;errorCode?:string;code?:string;params?:{error?:string}};
 return e.status===401||['interaction_required','login_required','consent_required','invalid_grant','no_account_error','SIGN_IN_REQUIRED'].includes(e.params?.error||e.errorCode||e.code||'');
}
export function isConnectionFailure(error:unknown):boolean{
 if(needsSignIn(error)||error instanceof TypeError)return true;
 if(!error||typeof error!=='object')return false;
 const e=error as {status?:number;errorCode?:string};
 return e.status===0||e.status===408||e.status===429||(typeof e.status==='number'&&e.status>=500)||e.errorCode==='timed_out'||!!e.errorCode?.includes('timeout');
}
export function connectionText(state:ConnectionState){switch(state.status){
 case 'connecting':return 'Connecting to your account…';
 case 'connected':return 'Account connected';
 case 'offline':return 'Offline · account sync unavailable';
 case 'sign-in':return 'Sign in to reconnect your account';
 case 'unavailable':return 'Account sync unavailable';
 default:return 'Account connection not checked';
}}
export function createConnectionStatus(timeoutMs=15000){
 let state:ConnectionState={status:'idle',lastConnectedAt:null},identity:string|null=null,generation=0;
 let flight:Promise<boolean>|null=null,cancel:(()=>void)|null=null;
 const listeners=new Set<()=>void>();
 const publish=(patch:Partial<ConnectionState>)=>{state={...state,...patch};listeners.forEach(fn=>fn())};
 function invalidate(){generation++;cancel?.();cancel=null;flight=null}
 function reset(next:string|null){if(identity===next)return;invalidate();identity=next;publish({status:'idle',lastConnectedAt:null})}
 function offline(){invalidate();publish({status:'offline'})}
 function fail(error:unknown){invalidate();publish({status:needsSignIn(error)?'sign-in':'unavailable'})}
 function connect(work:(isCurrent:()=>boolean,signal:AbortSignal)=>Promise<void>):Promise<boolean>{
  if(flight)return flight;
  if(identity===null)return Promise.resolve(false);
  const attempt=++generation,controller=new AbortController();
  const valid=()=>attempt===generation&&identity!==null;
  let timer:ReturnType<typeof setTimeout>;
  publish({status:'connecting'});
  // Cancellation/timeouts stop UI ownership, not server writes. Only read/sync
  // work with its own replay-safe contract belongs here; never score commands.
  const stopped=new Promise<boolean>(resolve=>{cancel=()=>{controller.abort();resolve(false)};timer=setTimeout(()=>{if(valid()){generation++;controller.abort();publish({status:'unavailable'})}resolve(false)},timeoutMs)});
  const workResult=Promise.resolve().then(()=>work(valid,controller.signal)).then(()=>{if(!valid())return false;publish({status:'connected',lastConnectedAt:Date.now()});return true},error=>{if(!valid())return false;publish({status:needsSignIn(error)?'sign-in':'unavailable'});return false});
  const result=Promise.race([workResult,stopped]).finally(()=>{clearTimeout(timer);if(flight===result){flight=null;cancel=null}});
  flight=result;return result;
 }
 return {getSnapshot:()=>state,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn)}},reset,offline,fail,connect};
}

