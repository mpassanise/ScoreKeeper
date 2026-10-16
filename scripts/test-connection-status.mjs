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
 assert.equal(needsSignIn({params:{error:'invalid_grant'}}),true);
 assert.equal(needsSignIn({status:401}),true);
 assert.equal(needsSignIn({errorCode:'timed_out'}),false,'a timeout alone does not prove interaction is required');
 assert.equal(needsSignIn({status:503}),false);
 assert.equal(isConnectionFailure({errorCode:'timed_out'}),true);
 assert.equal(isConnectionFailure(new Error('Invalid points')),false);
 assert.equal(isConnectionFailure({status:409}),false);
 const failed=createConnectionStatus();failed.reset('A');await failed.connect(async()=>{});failed.fail({errorCode:'timed_out'});assert.equal(failed.getSnapshot().status,'unavailable','foreground connection failures expose Reconnect after a prior successful refresh');
 console.log('Connection recovery: single-flight, account isolation, offline/retry, auth classification, bounded timeout, cancelled I/O and token-wait cancellation passed.');
}finally{globalThis.fetch=originalFetch;rmSync(output,{recursive:true,force:true})}

