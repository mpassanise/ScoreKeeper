import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {setImmediate as turn} from 'node:timers/promises';
const require=createRequire(import.meta.url),ts=require('typescript');
const compile=file=>ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function evaluate(code,load){const module={exports:{}};new Function('require','module','exports',code)(load,module,module.exports);return module.exports}
const {createAutomaticSync}=evaluate(compile('shared/repository/automatic-sync.ts'),()=>{throw Error('unexpected import')});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
function clock(){let now=0,id=0;const timers=new Map();return {now:()=>now,set:(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id},clear:id=>timers.delete(id),size:()=>timers.size,async advance(ms){const end=now+ms;for(let i=0;i<100;i++){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end){now=end;await turn();return}now=next[1].at;timers.delete(next[0]);next[1].fn();await turn()}throw Error('timer loop')}}}
function harness({monitorFails=false,initial='active'}={}){
 const time=clock(),snapshots=[],networkListeners=new Set(),appListeners=new Set();let refs=[],index=0,effects=[],cleanups=[],app=initial,reads=0,subscriptions=0;
 const react={useRef:value=>refs[index++]??(refs[index-1]={current:value}),useEffect:fn=>effects.push(fn)};
 const network={addNetworkStateListener:fn=>{subscriptions++;if(monitorFails)throw Error('monitor unavailable');networkListeners.add(fn);return {remove:()=>networkListeners.delete(fn)}},getNetworkStateAsync:()=>{reads++;if(monitorFails)return Promise.reject(Error('snapshot unavailable'));const d=deferred();snapshots.push(d);return d.promise}};
 const native={AppState:{get currentState(){return app},addEventListener:(name,fn)=>{assert.equal(name,'change');appListeners.add(fn);return {remove:()=>appListeners.delete(fn)}}}};
 const api=evaluate(compile('mobile/useAutomaticSync.ts'),name=>name==='react'?react:name==='react-native'?native:name==='expo-network'?network:{createAutomaticSync:options=>createAutomaticSync({...options,clock:time,retryMs:[]})});
 return {time,snapshots,render(enabled,key,run){index=0;return api.useAutomaticSync(enabled,key,run)},commit(){cleanups.forEach(fn=>fn?.());cleanups=effects.splice(0).map(fn=>fn())},close(){cleanups.forEach(fn=>fn?.());cleanups=[]},network(state){for(const fn of [...networkListeners])fn(state)},app(state){app=state;for(const fn of [...appListeners])fn(state)},listeners:()=>networkListeners.size+appListeners.size,counts:()=>({reads,subscriptions}),captureNetwork:()=>[...networkListeners][0]};
}
{
 const h=harness();let calls=0;h.render(true,'A',async()=>{calls++;return 'done'});h.commit();
 h.network({isConnected:false});await h.time.advance(10000);assert.equal(calls,0,'offline before debounce prevents startup requests');
 h.snapshots[0].resolve({isConnected:true});await turn();await h.time.advance(1000);assert.equal(calls,0,'stale initial snapshot cannot overwrite newer offline event');
 h.network({});h.network({isInternetReachable:false});await h.time.advance(1000);assert.equal(calls,0,'unknown state cannot reopen an offline gate');
 h.network({isConnected:true});await h.time.advance(750);assert.equal(calls,1,'network recovery wakes without AppState change');
 for(let i=0;i<50;i++)h.network({isConnected:true});await h.time.advance(100000);assert.equal(calls,1,'duplicate online events do not poll');
 h.app('background');h.network({isConnected:false});h.network({isConnected:true});await h.time.advance(100000);assert.equal(calls,1,'network cannot run background work');h.app('active');await h.time.advance(750);assert.equal(calls,2);h.close();assert.equal(h.listeners(),0);assert.equal(h.time.size(),0);
}
{
 const h=harness(),hold=deferred(),signals=[];h.render(true,'A',async signal=>{signals.push(signal);if(signals.length===1)await hold.promise;return 'done'});h.commit();await h.time.advance(750);h.network({isConnected:false});assert.equal(signals[0].aborted,true);h.network({isConnected:true});hold.resolve();await turn();await h.time.advance(5000);assert.equal(signals.length,2,'cancelled pass resumes once after recovery');h.close();
}
{
 const h=harness();let calls=0;h.render(true,'A',async()=>{calls++;return calls===1?'retry':'done'});h.commit();await h.time.advance(750);assert.equal(calls,1);
 h.network({isConnected:false});h.network({isConnected:true});await h.time.advance(59999);assert.equal(calls,1,'restore respects exhausted retry cooldown');await h.time.advance(1);assert.equal(calls,2,'sole restoration event survives cooldown');h.close();
}
{
 const h=harness();let calls=0;const a=h.render(true,'A',async()=>{calls++;return 'blocked'});h.commit();await h.time.advance(750);h.network({isConnected:false});h.network({isConnected:true});await h.time.advance(100000);assert.equal(calls,1,'network cannot bypass auth/capability block');a.recovered();a.request();await h.time.advance(750);assert.equal(calls,2);h.close();
}
{
 const h=harness();let a=0,b=0;h.render(true,'A',async()=>{a++;return 'done'});h.commit();const late=h.captureNetwork();h.render(true,'B',async()=>{b++;return 'done'});late({isConnected:false});late({isConnected:true});await h.time.advance(750);assert.equal(a+b,0,'old account events cannot call new render callback');h.commit();h.snapshots[0].resolve({isConnected:false});late({isConnected:false});await turn();await h.time.advance(750);assert.equal(b,1,'disposed events and initial snapshots cannot affect new account');h.close();h.snapshots[1].resolve({isConnected:true});await turn();await h.time.advance(100000);assert.equal(b,1);assert.equal(h.listeners(),0);
}
{
 const h=harness({monitorFails:true});let calls=0;h.render(true,'A',async()=>{calls++;return 'done'});h.commit();await turn();await h.time.advance(750);assert.equal(calls,1,'monitor failure retains bounded AppState fallback');h.close();assert.equal(h.listeners(),0);
 const off=harness();off.render(false,'A',async()=>{throw Error('disabled')});off.commit();assert.deepEqual(off.counts(),{reads:0,subscriptions:0});assert.equal(off.listeners(),0);off.close();
}
console.log('Native connectivity: actual hook + shared scheduler cover restore, cooldown, offline cancellation, stale snapshot/account events, background/terminal gates, duplicate events, disabled and monitor failure paths');
