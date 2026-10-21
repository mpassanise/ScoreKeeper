import type {ConnectionState} from '../connection-status';
export type AutomaticResult='done'|'retry'|'blocked'|'cancelled';
export function automaticResult(ok:boolean,state:ConnectionState):AutomaticResult{
 if(state.status==='sign-in'||state.delivery?.phase==='account-blocked'||state.delivery?.phase==='sign-in-required'||['CAPABILITY_REQUIRED','OPERATIONS_UNAVAILABLE','PROFILE_MISMATCH','ACCOUNT_DELETION_PENDING'].includes(state.diagnostic?.code??''))return 'blocked';
 if(!ok)return 'retry';
 return state.delivery?.phase==='pending'?'retry':'done';
}
type Clock={now:()=>number;set:(work:()=>void,ms:number)=>unknown;clear:(timer:unknown)=>void};
/** Foreground work only. Optional periodic refresh discovers cross-device changes
 * and retries transient failures after cooldown. Saves never wait for network or
 * reset the failure budget; authentication/capability blocks stay parked. */
export function createAutomaticSync(options:{enabled:boolean;run:(signal:AbortSignal,refresh:boolean)=>Promise<AutomaticResult>;clock?:Clock;debounceMs?:number;minGapMs?:number;retryMs?:number[];wakeCooldownMs?:number;refreshIntervalMs?:number}){
 const clock=options.clock??{now:Date.now,set:(fn:()=>void,ms:number)=>setTimeout(fn,ms),clear:(t:unknown)=>clearTimeout(t as ReturnType<typeof setTimeout>)};
 const bound=(n:number|undefined,fallback:number,min:number,max:number)=>Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n!))):fallback;
 const debounce=bound(options.debounceMs,750,100,5000),gap=bound(options.minGapMs,5000,1000,60000),retries=(options.retryMs??[5000,15000]).slice(0,2).map(n=>bound(n,5000,1000,60000)),wakeCooldown=bound(options.wakeCooldownMs,60000,60000,300000);
 const refreshInterval=options.refreshIntervalMs?bound(options.refreshIntervalMs,30000,30000,300000):0;
 let refreshTimer:unknown=null;
 let live=false,closed=false,dirty=false,needsRefresh=false,blocked:false|'terminal'|'exhausted'=false,failures=0,last=-Infinity,timer:unknown=null,flight:AbortController|null=null;
 function stopRefresh(){if(refreshTimer!==null){clock.clear(refreshTimer);refreshTimer=null}}
 function scheduleRefresh(){
  if(!options.enabled||closed||!live||!refreshInterval||refreshTimer!==null)return;
  refreshTimer=clock.set(()=>{refreshTimer=null;if(closed||!live)return;controls.wake();scheduleRefresh()},refreshInterval);
 }
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
 const controls={
  setActive(active:boolean){if(closed)return;const resumed=active&&!live;live=active;if(!active){stopRefresh();clear();if(flight){dirty=true;flight.abort()}}else if(resumed){this.wake();scheduleRefresh()}},
  request(){if(closed||!options.enabled)return;dirty=true;arm()},
  wake(){
   if(closed||!options.enabled)return;needsRefresh=true;dirty=true;
   if(blocked==='exhausted'){
    const remaining=last+wakeCooldown-clock.now();
    if(remaining<=0){blocked=false;failures=0}
    else if(live&&timer===null){
     // Preserve a connectivity/foreground/periodic wake through cooldown.
     // Multiple refresh ticks share this single recovery timer.
     timer=clock.set(()=>{timer=null;if(!closed&&live&&blocked==='exhausted'){blocked=false;failures=0;arm(0)}},remaining);
    }
   }
   arm();
  },
  recovered(){if(closed)return;if(blocked==='exhausted')clear();blocked=false;failures=0;},
  close(){closed=true;live=false;stopRefresh();clear();flight?.abort();dirty=false}
 };
 return controls;
}
