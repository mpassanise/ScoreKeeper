import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const output=path.resolve('.sites-runtime/api-tests');mkdirSync(output,{recursive:true});
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','shared/api.ts','--target','ES2022','--module','commonjs','--moduleResolution','node','--skipLibCheck','--outDir',output],{stdio:'inherit'});
writeFileSync(path.join(output,'package.json'),'{"type":"commonjs"}');
const {ScorekeeperApi,ApiError}=await import(pathToFileURL(path.join(output,'api.js')).href);
const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({game:{version:8}})}};
const game={id:'game',version:7,players:[{id:'a',name:'A'},{id:'b',name:'B'}],entries:[],next:'a'};
const api=new ScorekeeperApi('https://api.example.test/api/',async()=>'valid-token');
await api.act(game,{action:'score',points:-3});
assert.equal(calls[0].url,'https://api.example.test/api/games/game/actions');
assert.equal(calls[0].options.headers.Authorization,'Bearer valid-token');
assert.deepEqual(JSON.parse(calls[0].options.body),{action:'score',points:-3,expectedVersion:7});
globalThis.fetch=async()=>{calls.push({});return{ok:false,status:409,json:async()=>({error:'Conflict'})}};
await assert.rejects(()=>api.act(game,{action:'undo'}),e=>e instanceof ApiError&&e.status===409);
assert.equal(calls.length,2,'mutations must not be automatically retried');
assert.throws(()=>new ScorekeeperApi('http://remote.example/api',async()=>''));
globalThis.fetch=async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({status:'pending',message:'Retry'})}};
const deletion=await api.deleteAccount('DELETE');
assert.equal(deletion.status,'pending');
assert.equal(calls[2].url,'https://api.example.test/api/account/delete');
assert.equal(calls[2].options.method,'POST');
assert.deepEqual(JSON.parse(calls[2].options.body),{confirmation:'DELETE'},'no client-supplied owner');
await api.account();assert.equal(calls[3].options.method,'GET');assert.equal(calls[3].url,'https://api.example.test/api/account');
globalThis.fetch=async()=>{calls.push({});return{ok:false,status:503,json:async()=>{throw new SyntaxError('HTML')}}};
await assert.rejects(()=>api.deleteAccount('DELETE'),e=>e instanceof ApiError&&e.status===503);
assert.equal(calls.length,5,'account deletion failures must not be retried automatically');
console.log('API client request, conflict, deletion and HTTPS checks passed.');

const previousCalls=calls.length;
assert.throws(()=>api.act(game,{action:'score',points:100001}),/100,000/);
assert.throws(()=>api.create('new','Too high',['A','B'],'high',{endCondition:'target',targetScore:100001}),/100,000/);
assert.equal(calls.length,previousCalls,'invalid scores and targets are rejected before any server request');
console.log('Cloud client rejects over-limit totals and targets before sending.');

// Drive the real request timers without waiting for a cold-start budget in CI.
const {mock}=await import('node:test');
const {setImmediate:nextTurn}=await import('node:timers/promises');
mock.timers.enable({apis:['setTimeout']});
try{
 let requests=0,signal;
 globalThis.fetch=async(_url,options)=>{requests++;signal=options.signal;return new Promise(()=>{})};
 const slowRead=api.list();
 await nextTurn();mock.timers.tick(8000);await nextTurn();
 assert.equal(requests,1);assert.equal(signal.aborted,false,'a cold read must survive the old eight-second cutoff');
 mock.timers.tick(22000);await nextTurn();
 assert.equal(signal.aborted,true,'timed-out network request is aborted');
 mock.timers.tick(1000);await nextTurn();assert.equal(requests,2,'safe read retries after a timed-out request');
 mock.timers.tick(30000);await nextTurn();mock.timers.tick(2000);await nextTurn();
 const exhausted=assert.rejects(slowRead,e=>e instanceof ApiError&&e.code==='REQUEST_TIMEOUT');
 mock.timers.tick(30000);await exhausted;assert.equal(requests,3,'read retries are bounded');
 requests=0;
 const write=api.act(game,{action:'undo'});
 const writeFailure=assert.rejects(write,/change may already be saved/);
 await nextTurn();mock.timers.tick(30000);await writeFailure;
 assert.equal(requests,1,'a timed-out score mutation is never replayed');
 requests=0;
 globalThis.fetch=async()=>{requests++;return requests===1?{ok:false,status:503,json:async()=>({error:'Starting',code:'DATABASE_WAKING',requestId:'trace'})}:{ok:true,json:async()=>[]}};
 const resume=api.list();await nextTurn();mock.timers.tick(1000);await nextTurn();
 assert.deepEqual(await resume,[]);assert.equal(requests,2,'transient SQL availability errors recover');
 requests=0;globalThis.fetch=async()=>{requests++;return{ok:false,status:503,json:async()=>({error:'Database unavailable',code:'DATABASE_UNAVAILABLE',requestId:'support-reference'})}};
 await assert.rejects(api.list(),/support-reference/);assert.equal(requests,1,'configuration failures are not retried');
 requests=0;globalThis.fetch=async()=>{requests++;return{ok:false,status:401,json:async()=>({error:'Invalid token'})}};
 await assert.rejects(api.list(),e=>e.status===401);assert.equal(requests,1,'invalid credentials are not retried');
 const waitingToken=new ScorekeeperApi('https://api.example.test',async()=>new Promise(()=>{}));
 const tokenFailure=assert.rejects(waitingToken.list(),/Sign-in token refresh timed out/);
 mock.timers.tick(30000);await tokenFailure;assert.equal(requests,1,'token timeout never reaches the API');

 // iPhone recovery retries one timed-out safe read, but never prompts/retries auth failures.
 let recoveryCalls=0;
 globalThis.fetch=async()=>{recoveryCalls++;if(recoveryCalls===1)return new Promise(()=>{});return {ok:true,json:async()=>[]}};
 const recovery=new ScorekeeperApi('https://api.example.test/api',async()=>'valid-token',{readAttempts:2});
 const recovered=recovery.list();await nextTurn();mock.timers.tick(30000);await nextTurn();mock.timers.tick(1000);await nextTurn();
 assert.deepEqual(await recovered,[]);assert.equal(recoveryCalls,2);
 recoveryCalls=0;globalThis.fetch=async()=>{recoveryCalls++;return {ok:false,status:401,json:async()=>({error:'Sign in'})}};
 await assert.rejects(()=>recovery.list(),e=>e.status===401);assert.equal(recoveryCalls,1);
 recoveryCalls=0;globalThis.fetch=async()=>{recoveryCalls++;return new Promise(()=>{})};
 const bounded=recovery.list(),boundedFailure=assert.rejects(bounded,e=>e.code==='REQUEST_TIMEOUT');
 await nextTurn();mock.timers.tick(30000);await nextTurn();mock.timers.tick(1000);await nextTurn();mock.timers.tick(30000);await boundedFailure;assert.equal(recoveryCalls,2);
 const cancelRecovery=new AbortController();recoveryCalls=0;
 const cancelled=new ScorekeeperApi('https://api.example.test/api',async()=>'valid-token',{readAttempts:2,signal:cancelRecovery.signal}).list();
 const cancellation=assert.rejects(cancelled,e=>e.code==='REQUEST_CANCELLED');await nextTurn();mock.timers.tick(30000);await nextTurn();cancelRecovery.abort();mock.timers.tick(1000);await cancellation;assert.equal(recoveryCalls,1);
}finally{mock.timers.reset()}
console.log('Cold-start, bounded retry, token timeout and write-safety checks passed.');

globalThis.fetch=async()=>({ok:false,status:503,json:async()=>({error:'Database unavailable',code:'DATABASE_UNAVAILABLE',requestId:'diagnostic-reference',stage:'deletion-state',sqlNumber:208})});
await assert.rejects(api.get('private-game-id'),error=>{
 assert.match(error.message,/GET \/games\/:id/);
 assert.match(error.message,/HTTP 503/);
 assert.match(error.message,/stage=deletion-state/);
 assert.match(error.message,/SQL 208/);
 assert.match(error.message,/diagnostic-reference/);
 assert.ok(!error.message.includes('private-game-id'));
 assert.ok(!error.message.includes('valid-token'));
 return true;
});
console.log('Support references, endpoint/status/stage/SQL diagnostics and ID/token omission passed.');

// Player preferences use a profile assertion, never a client-supplied owner route.
const playerChanges=[{id:'00000000-0000-0000-0000-000000000001',kind:'add',name:'Mike'}];
globalThis.fetch=async(url,options)=>{assert.ok(url.endsWith('/players/sync'));assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),{profileId:'profile-a',changes:playerChanges});return {ok:true,json:async()=>({names:['Mike']})}};
assert.deepEqual(await api.syncFrequentPlayers('profile-a',playerChanges),{names:['Mike']});
console.log('Frequent-player sync request contract passed.');

// Deleting a game is authenticated, version-checked, and never retried.
globalThis.fetch=async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({deleted:true})}};
assert.deepEqual(await api.deleteGame(game),{deleted:true});
assert.equal(calls.at(-1).url,'https://api.example.test/api/games/game/delete');
assert.equal(calls.at(-1).options.method,'POST');
assert.deepEqual(JSON.parse(calls.at(-1).options.body),{expectedVersion:7});
const beforeDelete=calls.length;
globalThis.fetch=async()=>{calls.push({});return{ok:false,status:409,json:async()=>({error:'Changed before deletion'})}};
await assert.rejects(()=>api.deleteGame(game),e=>e instanceof ApiError&&e.status===409);
assert.equal(calls.length,beforeDelete+1);
globalThis.fetch=async()=>({ok:false,status:404,json:async()=>null});
await assert.rejects(()=>api.deleteGame(game),/latest API deployment/);
console.log('Game deletion client: version, authentication, conflicts, no retries and API upgrade guidance passed.');

const editGame={...game,name:'Custom',winner:'high',finished:false,playStyle:'turns',scoreMode:'add',endCondition:'manual'};
const editAction={action:'rules',rules:{name:'Renamed',winner:'low',endCondition:'target',targetScore:100,targetEnd:'immediate'}};
const editRequests=[];
globalThis.fetch=async(url,options)=>{editRequests.push({url,options});return{ok:true,json:async()=>url.endsWith('/account')?{gameEditingEnabled:true}:{game:{...editGame,name:'Renamed',version:8}}}};
await api.act(editGame,editAction);assert.equal(editRequests.length,2);assert.equal(editRequests[0].options.method,'GET');assert.deepEqual(JSON.parse(editRequests[1].options.body),{...editAction,expectedVersion:7});assert.equal(editRequests[1].options.headers.Authorization,'Bearer valid-token');
editRequests.length=0;
globalThis.fetch=async(url,options)=>{editRequests.push({url,options});return{ok:true,json:async()=>({})}};
await assert.rejects(()=>api.act(editGame,editAction),/latest API deployment/);assert.equal(editRequests.length,1,'old API receives no unsupported write');
console.log('Game editing API contract and capability rollout passed.');
