import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {mock} from 'node:test';
import {setImmediate as turn} from 'node:timers/promises';
const output=mkdtempSync(path.join(tmpdir(),'scorekeeper-connection-')),originalFetch=globalThis.fetch;
try{
 execFileSync(process.execPath,['node_modules/typescript/bin/tsc','shared/connection-status.ts','shared/api.ts','--target','ES2022','--module','commonjs','--moduleResolution','node','--skipLibCheck','--outDir',output],{stdio:'inherit'});
 writeFileSync(path.join(output,'package.json'),'{"type":"commonjs"}');
 const {createConnectionStatus,connectionText,needsSignIn,isConnectionFailure}=await import(pathToFileURL(path.join(output,'connection-status.js')).href);
 const {ScorekeeperApi}=await import(pathToFileURL(path.join(output,'api.js')).href);
 const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
 {
  const connection=createConnectionStatus(),pending=deferred();let calls=0;
  connection.reset('A');
  const first=connection.connect(async()=>{calls++;await pending.promise});
  assert.equal(connection.connect(async()=>{calls++}),first,'repeated reconnect shares one attempt');
  await turn();assert.equal(calls,1);assert.equal(connection.getSnapshot().status,'connecting');
  pending.resolve();assert.equal(await first,true);assert.equal(connection.getSnapshot().status,'connected');
  const last=connection.getSnapshot().lastConnectedAt;assert.ok(last);
  await connection.connect(async()=>{throw {errorCode:'interaction_required'}});
  assert.equal(connection.getSnapshot().status,'sign-in');assert.equal(connection.getSnapshot().lastConnectedAt,last);
  connection.offline();assert.equal(connection.getSnapshot().status,'offline');
  assert.ok(!connectionText(connection.getSnapshot()).includes('saved'),'status never claims account scores were saved locally');
  await connection.connect(async()=>{});assert.equal(connection.getSnapshot().status,'connected');
 }
 {
  const connection=createConnectionStatus(),pending=deferred();let leaked=false,signal;
  connection.reset('A');
  const work=connection.connect(async(valid,s)=>{signal=s;await pending.promise;if(valid())leaked=true});
  await turn();connection.reset('B');assert.equal(signal.aborted,true);assert.equal(await work,false);
  pending.resolve();await turn();assert.equal(leaked,false);assert.equal(connection.getSnapshot().lastConnectedAt,null);
  assert.equal(connection.getSnapshot().status,'idle');
 }
 mock.timers.enable({apis:['setTimeout']});
 try{
  const connection=createConnectionStatus(15000),pending=deferred();let signal,requests=0;
  connection.reset('A');
  globalThis.fetch=async(_url,options)=>{requests++;signal=options.signal;await pending.promise;return {ok:true,json:async()=>[]}};
  const work=connection.connect(async(valid,s)=>{const api=new ScorekeeperApi('https://example.test',async()=>'token',{signal:s,readAttempts:1});await api.list();assert.equal(valid(),true)});
  await turn();assert.equal(requests,1);mock.timers.tick(15000);await turn();
  assert.equal(await work,false);assert.equal(signal.aborted,true);assert.equal(connection.getSnapshot().status,'unavailable');
  pending.resolve();await turn();assert.equal(connection.getSnapshot().lastConnectedAt,null,'late read cannot mark a timed-out attempt connected');
  assert.equal(requests,1,'cancelled read never retries');
  // Cancellation while token acquisition is pending cannot issue an HTTP request later.
  const token=deferred(),abort=new AbortController();requests=0;
  const api=new ScorekeeperApi('https://example.test',()=>token.promise,{signal:abort.signal,readAttempts:1});
  const read=api.list(),rejected=assert.rejects(read,e=>e.code==='REQUEST_CANCELLED');
  abort.abort();await rejected;token.resolve('late-token');await turn();assert.equal(requests,0);
  // One-attempt reconnect reads do not enter the legacy GET backoff.
  globalThis.fetch=async()=>{requests++;return {ok:false,status:503,json:async()=>({code:'DATABASE_WAKING'})}};
  const once=new ScorekeeperApi('https://example.test',async()=>'token',{readAttempts:1});
  await assert.rejects(once.list(),e=>e.code==='DATABASE_WAKING');assert.equal(requests,1);
 }finally{mock.timers.reset()}
 mock.timers.enable({apis:['setTimeout']});
 try{
  const c=createConnectionStatus(),pending=deferred();c.reset('A');let signal;
  globalThis.fetch=async(_url,options)=>{signal=options.signal;await pending.promise;return {ok:true,json:async()=>[]}};
  const work=c.connect(async(_valid,s,step)=>step('games',()=>new ScorekeeperApi('https://example.test',async()=>'token',{signal:s,readAttempts:1}).list()));
  await turn();mock.timers.tick(15000);await turn();
  assert.equal(signal.aborted,false,'15-second slow notice must not cancel API I/O');
  assert.equal(c.getSnapshot().status,'connecting');assert.equal(c.getSnapshot().slow,true);
  mock.timers.tick(5000);pending.resolve();assert.equal(await work,true);assert.equal(c.getSnapshot().slow,false);
  const hanging=deferred();globalThis.fetch=async()=>hanging.promise;
  const timed=c.connect(async(_valid,s,step)=>step('games',()=>new ScorekeeperApi('https://example.test',async()=>'token',{signal:s,readAttempts:1}).list()));
  await turn();mock.timers.tick(30000);await turn();assert.equal(await timed,false);
  assert.equal(c.getSnapshot().diagnostic.code,'REQUEST_TIMEOUT','API timeout is preserved instead of outer watchdog');
  assert.equal(c.getSnapshot().diagnostic.stage,'games');
  const guard=c.connect(async(_valid,_s,step)=>Promise.all([step('games',()=>hanging.promise),step('players',()=>hanging.promise)]).then(()=>{}));
  await turn();mock.timers.tick(120000);await turn();assert.equal(await guard,false);
  assert.equal(c.getSnapshot().diagnostic.code,'RECONNECT_TIMEOUT');
  assert.deepEqual(c.getSnapshot().diagnostic.pendingStages,['games','players']);
 }finally{mock.timers.reset()}
 assert.equal(needsSignIn({params:{error:'invalid_grant'}}),true);
 assert.equal(needsSignIn({status:401}),true);
 assert.equal(needsSignIn({errorCode:'timed_out'}),false,'a timeout alone does not prove interaction is required');
 assert.equal(needsSignIn({status:503}),false);
 assert.equal(isConnectionFailure({errorCode:'timed_out'}),true);
 assert.equal(isConnectionFailure(new Error('Invalid points')),false);
 assert.equal(isConnectionFailure({status:409}),false);
 const failed=createConnectionStatus();failed.reset('A');await failed.connect(async()=>{});failed.fail({errorCode:'timed_out'});assert.equal(failed.getSnapshot().status,'unavailable','foreground connection failures expose Reconnect after a prior successful refresh');

 {
  const reports=[],c=createConnectionStatus(15000,value=>reports.push(value));c.reset('A');
  const secret='private@example.test bearer-secret https://example.test/?code=private';
  await c.connect(async(_valid,_signal,step)=>{await step('games',async()=>{throw {status:503,code:'DATABASE_WAKING',message:secret,requestId:'12345678-1234-1234-1234-123456789abc'}})});
  assert.equal(c.getSnapshot().diagnostic.stage,'games');assert.equal(c.getSnapshot().diagnostic.code,'DATABASE_WAKING');
  assert.equal(c.getSnapshot().diagnostic.httpStatus,503);assert.equal(reports.length,1);
  assert.ok(!JSON.stringify(reports).includes('private'));assert.ok(!JSON.stringify(reports).includes('bearer-secret'));
  assert.equal(reports[0].requestId,'12345678-1234-1234-1234-123456789abc');
  await c.connect(async(_valid,_signal,step)=>{await step('account',async()=>{throw {code:secret,requestId:secret}})});
  assert.equal(c.getSnapshot().diagnostic.code,'UNCLASSIFIED_ERROR');assert.equal(c.getSnapshot().diagnostic.requestId,undefined);
  assert.ok(!JSON.stringify(reports).includes('private'));
  await c.connect(async()=>{});assert.equal(c.getSnapshot().diagnostic,undefined,'success clears stale failure details');
  await c.connect(async(_valid,_signal,step)=>step('authentication',async()=>{throw {errorCode:'interaction_required',message:secret}}));
  assert.equal(c.getSnapshot().status,'sign-in');assert.equal(c.getSnapshot().diagnostic.stage,'authentication');
 }
 mock.timers.enable({apis:['setTimeout']});
 try{
  const reports=[],c=createConnectionStatus(15000,value=>reports.push(value));c.reset('A');
  const pending=deferred();const p=c.connect(async(_valid,_signal,step)=>Promise.all([step('games',()=>pending.promise),step('authentication',()=>pending.promise)]).then(()=>{}));
  await turn();mock.timers.tick(15000);assert.equal(await p,false);assert.equal(c.getSnapshot().diagnostic.stage,'authentication');
  assert.equal(c.getSnapshot().diagnostic.code,'RECONNECT_TIMEOUT');assert.equal(reports.length,1);
  pending.resolve();await turn();assert.equal(reports.length,1,'late completion emits no extra failure');
 }finally{mock.timers.reset()}
 {
  const c=createConnectionStatus(),pending=deferred(),external=new AbortController();let signal,late=false;c.reset('A');const pass=c.connect(async(valid,s)=>{signal=s;await pending.promise;if(valid())late=true},external.signal);await turn();external.abort();assert.equal(await pass,false);assert.equal(signal.aborted,true);assert.equal(c.getSnapshot().status,'idle');pending.resolve();await turn();assert.equal(late,false);assert.equal(c.getSnapshot().lastConnectedAt,null);
  const already=new AbortController();already.abort();assert.equal(await c.connect(async()=>assert.fail('Aborted before network'),already.signal),false);
  const next=deferred();c.reset('B');const manual=c.connect(async()=>next.promise);external.abort();next.resolve();assert.equal(await manual,true,'old cancellation cannot cancel a new manual/account pass');
 }
 console.log('Connection recovery: single-flight, account isolation, offline/retry, auth classification, bounded timeout, cancelled I/O and token-wait cancellation passed.');
}finally{globalThis.fetch=originalFetch;rmSync(output,{recursive:true,force:true})}

