import type {ConnectionState} from '../connection-status';
export type AutomaticResult='done'|'retry'|'blocked'|'cancelled';
export function automaticResult(ok:boolean,state:ConnectionState):AutomaticResult{
 if(state.status==='sign-in'||state.delivery?.phase==='account-blocked'||state.delivery?.phase==='sign-in-required'||['CAPABILITY_REQUIRED','OPERATIONS_UNAVAILABLE','PROFILE_MISMATCH','ACCOUNT_DELETION_PENDING'].includes(state.diagnostic?.code??''))return 'blocked';
 if(!ok)return 'retry';
 return state.delivery?.phase==='pending'?'retry':'done';
}
type Clock={now:()=>number;set:(work:()=>void,ms:number)=>unknown;clear:(timer:unknown)=>void};
/** Foreground work only: no polling, OS task or infinite retry loop. A local
 * save notification never waits for network and never resets a failure budget. */
export function createAutomaticSync(options:{enabled:boolean;run:(signal:AbortSignal,refresh:boolean)=>Promise<AutomaticResult>;clock?:Clock;debounceMs?:number;minGapMs?:number;retryMs?:number[];wakeCooldownMs?:number}){
 const clock=options.clock??{now:Date.now,set:(fn:()=>void,ms:number)=>setTimeout(fn,ms),clear:(t:unknown)=>clearTimeout(t as ReturnType<typeof setTimeout>)};
 const bound=(n:number|undefined,fallback:number,min:number,max:number)=>Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n!))):fallback;
 const debounce=bound(options.debounceMs,750,100,5000),gap=bound(options.minGapMs,5000,1000,60000),retries=(options.retryMs??[5000,15000]).slice(0,2).map(n=>bound(n,5000,1000,60000)),wakeCooldown=bound(options.wakeCooldownMs,60000,60000,300000);
 let live=false,closed=false,dirty=false,needsRefresh=false,blocked:false|'terminal'|'exhausted'=false,failures=0,last=-Infinity,timer:unknown=null,flight:AbortController|null=null;
 function clear(){if(timer!==null){clock.clear(timer);timer=null}}
 function arm(delay=debounce){
  if(!options.enabled||closed||!live||!dirty||blocked||flight||timer!==null)return;
  timer=clock.set(()=>{timer=null;void run()},Math.max(delay,last+gap-clock.now()));
 }
 async function run(){
  if(closed||!live||blocked||!dirty||flight)return;
  const controller=new AbortController();flight=controller;dirty=false;const refresh=needsRefresh;needsRefresh=false;last=clock.now();
  let result:AutomaticResult;try{result=await options.run(controller.signal,refresh)}catch{result=controller.signal.aborted?'cancelled':'retry'}
  if(flight!==controller)return;flight=null;
  if(closed||controller.signal.aborted||!live){dirty=true;arm();return}
  if(result==='blocked'){blocked='terminal';dirty=true;return}
  if(result==='retry'){
   dirty=true;needsRefresh=needsRefresh||refresh;if(failures>=retries.length){blocked='exhausted';return}arm(Math.round(retries[failures++]*(0.8+Math.random()*0.4)));return;
  }
  if(result==='cancelled'){dirty=true;return}
  failures=0;arm(); // At most one trailing pass for saves during the flight.
 }
 return {
  setActive(active:boolean){if(closed)return;const resumed=active&&!live;live=active;if(!active){clear();if(flight){dirty=true;flight.abort()}}else if(resumed){this.wake()}},
  request(){if(closed||!options.enabled)return;dirty=true;arm()},
  wake(){if(closed||!options.enabled)return;needsRefresh=true;if(blocked==='exhausted'&&clock.now()-last>=wakeCooldown){blocked=false;failures=0}dirty=true;arm()},
  recovered(){if(closed)return;blocked=false;failures=0;},
  close(){closed=true;live=false;clear();flight?.abort();dirty=false}
 };
}
