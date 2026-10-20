import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {mock} from 'node:test';
import {setImmediate as turn} from 'node:timers/promises';
const output=mkdtempSync(path.join(tmpdir(),'scorekeeper-account-refresh-')),originalFetch=globalThis.fetch;
try{
 execFileSync(process.execPath,['node_modules/typescript/bin/tsc','shared/account-refresh.ts','shared/connection-status.ts','shared/frequent-player-sync.ts','--target','ES2022','--module','commonjs','--moduleResolution','node','--strict','--skipLibCheck','--outDir',output],{stdio:'inherit'});
 writeFileSync(path.join(output,'package.json'),'{"type":"commonjs"}');
 const require=createRequire(import.meta.url),{readAccountSnapshot}=require(path.join(output,'account-refresh.js')),{ScorekeeperApi}=require(path.join(output,'api.js')),{createConnectionStatus}=require(path.join(output,'connection-status.js')),{createSyncedPlayersStore}=require(path.join(output,'frequent-player-sync.js'));
 const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r}),resolve:v=>resolve(v)}};
 const step=async(_stage,work)=>work();
 const pending=deferred(),events=[];
 const api={account:async()=>{events.push('account');return pending.promise},list:async()=>{events.push('games');return []},get:async id=>{events.push('game:'+id);return {game:{id}}}};
 const read=readAccountSnapshot({api,expectedProfileId:'A',gameId:'selected',isCurrent:()=>true,step});await turn();assert.deepEqual(events,['account']);
 pending.resolve({profileId:'A',deletionStatus:null});const result=await read;assert.deepEqual(events,['account','games','game:selected']);assert.equal(result.status.profileId,'A');
 for(const status of [{profileId:'B',deletionStatus:null},{profileId:'A',deletionStatus:'pending'}]){
  events.length=0;let observed=null;await assert.rejects(()=>readAccountSnapshot({api:{...api,account:async()=>status},expectedProfileId:'A',isCurrent:()=>true,step,onAccountStatus:async value=>{observed=value}}));assert.deepEqual(events,[],'identity/deletion failure never starts game reads');assert.equal(observed,status,'pilot receives lifecycle denials before refresh aborts');
 }
 // Manual work and game-id resolution must follow complete account validation,
 // while the lifecycle observer still receives denial evidence.
 for(const status of [{profileId:'B',deletionStatus:null},{profileId:'A',deletionStatus:'pending'}]){
  let manual=0,resolved=0,observed=0;await assert.rejects(()=>readAccountSnapshot({api:{...api,account:async()=>status},expectedProfileId:'A',isCurrent:()=>true,step,onAccountStatus:async()=>{observed++},afterAccountVerified:async()=>{manual++},resolveGameId:async id=>{resolved++;return id}}));assert.equal(observed,1);assert.equal(manual,0);assert.equal(resolved,0);
 }
 const order=[];await readAccountSnapshot({api:{account:async()=>({profileId:'A',deletionStatus:null}),list:async()=>{order.push('list');return []},get:async()=>assert.fail('known deleted game must not be read')},expectedProfileId:'A',gameId:'deleted',isCurrent:()=>true,step,onAccountStatus:async()=>{order.push('status')},afterAccountVerified:async()=>{order.push('manual')},resolveGameId:async()=>{order.push('resolve');return undefined}});assert.deepEqual(order,['status','manual','resolve','list']);
 let valid=true;const stale=deferred();events.length=0;
 const switching=readAccountSnapshot({api:{...api,account:()=>stale.promise},expectedProfileId:'A',isCurrent:()=>valid,step});valid=false;stale.resolve({profileId:'A',deletionStatus:null});assert.equal(await switching,null);assert.deepEqual(events,[]);
 valid=true;const gameWait=deferred();const late=readAccountSnapshot({api:{account:async()=>({profileId:'A',deletionStatus:null}),list:()=>gameWait.promise,get:api.get},isCurrent:()=>valid,step});await turn();valid=false;gameWait.resolve([]);assert.equal(await late,null,'late games cannot populate a switched account');
 // Exercise the actual players store: local activation has no remote; attach it
 // only after the coordinated account/game reads, and await exactly one sync.
 const storage=new Map(),players=createSyncedPlayersStore({read:async k=>storage.get(k)??null,write:async(k,v)=>{storage.set(k,v)}},()=> 'op');let posts=0;
 await players.activate('A',null);await players.sync();assert.equal(posts,0);
 await players.activate('A',{syncFrequentPlayers:async(id,changes)=>{posts++;assert.equal(id,'A');assert.deepEqual(changes,[]);return {names:[]}}});await players.sync();assert.equal(posts,1);
 mock.timers.enable({apis:['setTimeout']});
 try{
  let requests=[];globalThis.fetch=async(url,options)=>{requests.push({url,method:options.method});if(requests.length===1)return new Promise(()=>{});return {ok:true,json:async()=>url.endsWith('/account')?{profileId:'A',deletionStatus:null}:[]}};
  const connection=createConnectionStatus();connection.reset('identity');
  const work=connection.connect(async(isCurrent,signal,tracked)=>{
   const remote=new ScorekeeperApi('https://example.test/api',async()=>'token',{signal,readAttempts:2});
   const snapshot=await readAccountSnapshot({api:remote,expectedProfileId:'A',isCurrent,step:tracked});assert.ok(snapshot);
  });
  await turn();assert.equal(requests.length,1);assert.ok(requests[0].url.endsWith('/account'));
  mock.timers.tick(30000);await turn();assert.equal(connection.getSnapshot().status,'connecting');assert.equal(requests.length,1);
  mock.timers.tick(1000);await turn();assert.equal(await work,true);assert.deepEqual(requests.map(r=>r.url.split('/').at(-1)),['account','account','games']);assert.ok(requests.every(r=>r.method==='GET'));assert.equal(connection.getSnapshot().status,'connected','first coordinated attempt recovers without a second tap');
  requests=[];globalThis.fetch=async(url)=>{requests.push(url);return {ok:false,status:401,json:async()=>({error:'Sign in'})}};
  const failure=connection.connect(async(isCurrent,signal,tracked)=>readAccountSnapshot({api:new ScorekeeperApi('https://example.test/api',async()=>'token',{signal,readAttempts:2}),isCurrent,step:tracked}));
  assert.equal(await failure,false);assert.equal(requests.length,1);assert.equal(connection.getSnapshot().status,'sign-in');
 }finally{mock.timers.reset()}
 console.log('Account refresh: account-first order, no premature game/player requests, identity/deletion guards, late-result isolation, timeout recovery within one connection attempt and 401 non-retry passed.');
}finally{globalThis.fetch=originalFetch;rmSync(output,{recursive:true,force:true})}
