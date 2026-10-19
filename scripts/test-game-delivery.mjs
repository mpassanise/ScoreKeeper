import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {IDBFactory} from '../tests/offline/node_modules/fake-indexeddb/build/esm/index.js';
const root=mkdtempSync(path.join(tmpdir(),'scorekeeper-delivery-'));
try{
 execFileSync(process.execPath,['node_modules/typescript/bin/tsc','shared/repository/durable-account.ts','shared/repository/indexeddb-confirmed-games.ts','shared/repository/sqlite-confirmed-games.ts','shared/repository/operation-transport.ts','--target','ES2022','--module','commonjs','--moduleResolution','node','--strict','--skipLibCheck','--outDir',root],{stdio:'inherit'});
 writeFileSync(path.join(root,'package.json'),'{"type":"commonjs"}');const require=createRequire(import.meta.url);
 const {createDurableAccountRepository}=require(path.join(root,'repository/durable-account.js')),{openConfirmedGames}=require(path.join(root,'repository/indexeddb-confirmed-games.js')),{openSQLiteConfirmedGames}=require(path.join(root,'repository/sqlite-confirmed-games.js')),{createOperationTransport}=require(path.join(root,'repository/operation-transport.js')),{gameView}=require(path.join(root,'local-games.js')),{ApiError}=require(path.join(root,'api.js'));
 const cap={version:1,receipts:'retained',atomicGameAndReceipt:true,kinds:['action','create','import','delete'],actions:['score','edit','undo','select','rules','finish','resume']};
 const status=(profileId='A')=>({profileId,deletionStatus:null,deletionEnabled:true,gameOperations:cap});
 function base(){const players=[{id:randomUUID(),name:'One'},{id:randomUUID(),name:'Two'}];return {id:randomUUID(),name:'Game',players,winner:'high',entries:[],next:players[0].id,finished:false,version:1,updated:'2026-10-19T00:00:00Z',playStyle:'free',scoreMode:'add'}}
 const score=(g,v,points=10)=>({protocolVersion:1,kind:'action',operationId:randomUUID(),gameId:g.id,command:{action:'score',expectedVersion:v,points,playerId:g.next,entryId:randomUUID()}});
 const ack=op=>({operationId:op.operationId,gameId:op.gameId,outcome:'applied',committedVersion:(op.command?.expectedVersion??op.expectedVersion)+1,observedVersion:(op.command?.expectedVersion??op.expectedVersion)||null,errorCode:null});
 const settings={enabled:true,maxAttempts:3,retryDelayMs:0,stepTimeoutMs:1000,passTimeoutMs:5000,pollMs:5};
 const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
 const factory=new IDBFactory(),file=path.join(root,'native.db');
 function queries(db){return {execAsync:async sql=>db.exec(sql),runAsync:async(sql,...p)=>db.prepare(sql).run(...p),getFirstAsync:async(sql,...p)=>db.prepare(sql).get(...p)||null,getAllAsync:async(sql,...p)=>db.prepare(sql).all(...p)}}
 function sqlite(){const db=new DatabaseSync(file);return {...queries(db),closeAsync:async()=>db.close(),withExclusiveTransactionAsync:async work=>{const tx=new DatabaseSync(file);try{tx.exec('BEGIN');try{await work(queries(tx));tx.exec('COMMIT')}catch(e){tx.exec('ROLLBACK');throw e}}finally{tx.close()}}}}
 for(const [name,open]of [['IndexedDB',()=>openConfirmedGames(factory,'delivery')],['SQLite',()=>openSQLiteConfirmedGames(sqlite())]]){
  let repo=await open(),access=createDurableAccountRepository(repo),lease,out;
  async function verify(profile='A'){const ticket=await access.beginVerification('selector-'+profile,profile);lease=await access.verify(ticket,status(profile));out=access.outbox(lease)}
  await verify();async function seed(){const g=base();await access.saveConfirmed(lease,[gameView(g)]);await out.seedConfirmed(g.id);return g}
  const g=await seed(),first=score(g,1),second=score(g,2,0);await out.enqueue(first);await out.enqueue(second);
  const receipts=new Map(),serverGames=new Map([[g.id,structuredClone(g)]]),calls=[],events=[];let effects=0,loseFirst=true,failSnapshot=false;
  const session={account:async()=>{calls.push('account');return status()},operation:async(wire,signal)=>{calls.push(wire);const op=JSON.parse(wire);if(!receipts.has(op.operationId)){
   let game=serverGames.get(op.gameId);if(op.kind==='delete'){serverGames.delete(op.gameId)}else if(op.kind==='create'||op.kind==='import'){game={...op.game,version:1};serverGames.set(op.gameId,game)}else{game={...game,entries:[...game.entries,{id:op.command.entryId,playerId:op.command.playerId,points:op.command.points}],next:op.command.playerId,version:game.version+1,updated:'2026-10-19T01:00:00Z'};serverGames.set(op.gameId,game)}receipts.set(op.operationId,ack(op));effects++}
   if(loseFirst){loseFirst=false;throw new ApiError(408,'lost response','REQUEST_TIMEOUT')}return receipts.get(op.operationId)},get:async id=>{calls.push('snapshot');if(failSnapshot)throw new ApiError(503,'unavailable');const game=serverGames.get(id);if(!game)throw new ApiError(404,'not found');return gameView(game)}};
  const transport={open:async()=>{calls.push('open');return session}};
  const disabled=access.delivery(lease,transport);assert.equal((await disabled.connect()).phase,'disabled');assert.equal(calls.length,0,'default-disabled worker has no network or queue side effects');disabled.close();
  const disabledHttp=access.httpDelivery(lease,'https://api.example.test/api',async()=>{throw Error('disabled must not acquire credentials')});assert.equal((await disabledHttp.connect()).phase,'disabled');disabledHttp.close();
  let worker=access.delivery(lease,transport,{...settings,onState:s=>events.push(s)});const pass=worker.connect();assert.equal(worker.connect(),pass,'overlapping reconnect calls share one pass');assert.equal((await pass).phase,'synced');assert.equal(effects,2);assert.equal(calls.filter(c=>c===JSON.stringify(first)).length,2,'uncertain write retries identical bytes');assert.equal(calls.filter(c=>c==='snapshot').length,1,'drain first, then reconcile a complete snapshot');assert.equal((await out.read()).archive.length,1);assert.ok(events.some(e=>e.phase==='retrying'));assert.ok(events.every(e=>!JSON.stringify(e).includes(g.players[0].name)),'status omits names and payloads');worker.close();
  const third=score(g,3,4);await out.enqueue(third);failSnapshot=true;worker=access.delivery(lease,transport,settings);assert.equal((await worker.connect()).phase,'unavailable');assert.equal(effects,3);const postCount=calls.filter(c=>c===JSON.stringify(third)).length;failSnapshot=false;assert.equal((await worker.connect()).phase,'synced');assert.equal(calls.filter(c=>c===JSON.stringify(third)).length,postCount,'refresh recovery never reposts an acknowledged save');worker.close();
  // A terminal rejection does not retry or rebase its dependants; snapshot supplies review evidence.
  const conflict=await seed(),rejected=score(conflict,1),dependent=score(conflict,2);serverGames.set(conflict.id,{...conflict,version:5});await out.enqueue(rejected);await out.enqueue(dependent);let rejects=0;
  const rejecting={...session,operation:async wire=>{rejects++;const op=JSON.parse(wire);return {...ack(op),outcome:'rejected',committedVersion:null,observedVersion:5,errorCode:'VERSION_CONFLICT'}}};worker=access.delivery(lease,{open:async()=>rejecting},settings);assert.equal((await worker.connect()).phase,'needs-review');assert.equal(rejects,1);assert.ok(await out.review(conflict.id));assert.equal((await out.read()).games.find(x=>x.gameId===conflict.id).operations[1].status,'queued');worker.close();
  // Tests below use another account so the unresolved conflict stays intact but does not affect statuses.
  await verify('B');const b=await seed(),bop=score(b,1);await out.enqueue(bop);let sent=0;
  const noCap={...session,account:async()=>({...status('B'),gameOperations:null}),operation:async()=>{sent++;return ack(bop)}};
  worker=access.delivery(lease,{open:async()=>noCap},settings);assert.equal((await worker.connect()).phase,'unavailable');assert.equal(sent,0);worker.close();
  worker=access.delivery(lease,{open:async()=>({...noCap,account:async()=>status('A')})},settings);assert.equal((await worker.connect()).phase,'sign-in-required');assert.equal(sent,0);worker.close();
  // Abort-ignoring timeout result is discarded; only the same original request is retried.
  let tries=0,late=deferred();const timed={...session,account:async()=>status('B'),operation:async()=>{tries++;return late.promise}};
  worker=access.delivery(lease,{open:async()=>timed},{...settings,maxAttempts:2,stepTimeoutMs:10});assert.equal((await worker.connect()).phase,'unavailable');assert.equal(tries,2);late.resolve(ack(bop));await new Promise(r=>setTimeout(r,0));assert.equal((await out.read()).games[0].operations[0].status,'uncertain');worker.close();
  // Token rejection pauses without a retry or a fabricated receipt.
  tries=0;worker=access.delivery(lease,{open:async()=>({...timed,operation:async()=>{tries++;throw new ApiError(401,'expired')}})},settings);assert.equal((await worker.connect()).phase,'sign-in-required');assert.equal(tries,1);worker.close();
  // Same-instance account changes synchronously cancel the pass; a late success cannot acknowledge it.
  let started=deferred(),response=deferred();worker=access.delivery(lease,{open:async()=>({...timed,operation:async()=>{started.resolve();return response.promise}})},settings);const running=worker.connect();await started.promise;await access.signOut(lease);assert.equal((await running).phase,'cancelled');response.resolve(ack(bop));await verify('B');assert.equal((await out.read()).games[0].operations[0].status,'uncertain');worker.close();
  // Independent-handle revocation is observed while a transport is still pending.
  started=deferred();response=deferred();worker=access.delivery(lease,{open:async()=>({...timed,operation:async()=>{started.resolve();return response.promise}})},settings);const remoteRunning=worker.connect();await started.promise;const otherRepo=await open(),other=createDurableAccountRepository(otherRepo),otherLease=await other.restore('selector-B');await other.signOut(otherLease);assert.equal((await remoteRunning).phase,'cancelled');response.resolve(ack(bop));await other.close();await verify('B');assert.equal((await out.read()).games[0].operations[0].status,'uncertain');worker.close();
  // A generic missing game is not a deletion signal; accepted writes remain recoverable.
  const missing={...session,account:async()=>status('B'),operation:async()=>ack(bop),get:async()=>{throw new ApiError(404,'missing')}};worker=access.delivery(lease,{open:async()=>missing},settings);assert.equal((await worker.connect()).code,'SNAPSHOT_UNAVAILABLE');assert.equal((await out.read()).games[0].tombstone,undefined);worker.close();
  // Deletion receipts settle without trying to read a deleted game.
  await verify('C');const removed=await seed(),deletion={protocolVersion:1,kind:'delete',operationId:randomUUID(),gameId:removed.id,expectedVersion:1};await out.enqueue(deletion);let reads=0;worker=access.delivery(lease,{open:async()=>({account:async()=>status('C'),operation:async()=>ack(deletion),get:async()=>{reads++;throw Error('must not read deleted game')}})},settings);assert.equal((await worker.connect()).phase,'synced');assert.equal(reads,0);assert.ok((await out.read()).games[0].tombstone);worker.close();
  // Bounded passes preserve the original dependent versions and can continue explicitly.
  await verify('E');const limited=await seed(),e1=score(limited,1),e2=score(limited,2,0);serverGames.set(limited.id,structuredClone(limited));await out.enqueue(e1);await out.enqueue(e2);const eSession={...session,account:async()=>status('E')};worker=access.delivery(lease,{open:async()=>eSession},{...settings,operationBudget:1});assert.equal((await worker.connect()).phase,'pending');assert.equal((await worker.connect()).phase,'synced');assert.equal(calls.filter(c=>c===JSON.stringify(e1)).length,1);assert.equal(calls.filter(c=>c===JSON.stringify(e2)).length,1);worker.close();
  // A lost local receipt commit response is recovered without another POST.
  const lostLocal=await seed(),localOp=score(lostLocal,1);serverGames.set(lostLocal.id,structuredClone(lostLocal));await out.enqueue(localOp);const write=repo.documents.write;let loseLocal=true;repo.documents.write=async(...args)=>{const result=await write(...args);if(loseLocal&&args[0]==='game-outbox:E'&&args[2].games.some(g=>g.gameId===lostLocal.id&&g.operations.some(i=>i.status==='applied'))){loseLocal=false;throw Error('lost local receipt response')}return result};worker=access.delivery(lease,{open:async()=>eSession},settings);assert.equal((await worker.connect()).phase,'unavailable');repo.documents.write=write;const posted=calls.filter(c=>c===JSON.stringify(localOp)).length;assert.equal((await worker.connect()).phase,'synced');assert.equal(calls.filter(c=>c===JSON.stringify(localOp)).length,posted);worker.close();
  // A hanging token provider/pass remains bounded, even if it ignores abort.
  worker=access.delivery(lease,{open:()=>new Promise(()=>{})},{...settings,passTimeoutMs:15,stepTimeoutMs:1000});assert.equal((await worker.connect()).code,'PASS_LIMIT');worker.close();
  const paused=await seed(),pauseOp=score(paused,1);await out.enqueue(pauseOp);let unavailablePosts=0;worker=access.delivery(lease,{open:async()=>({...eSession,operation:async()=>{unavailablePosts++;throw new ApiError(503,'disabled','OPERATIONS_UNAVAILABLE')}})},settings);assert.equal((await worker.connect()).phase,'unavailable');assert.equal(unavailablePosts,1,'disabled backend is not retried or replaced with legacy mutation');worker.close();
  // Late lifecycle callbacks from an old lease cannot close the new account's worker.
  await verify('old');const oldLease=lease;await verify('current');const currentLease=lease;
  started=deferred();response=deferred();let currentCalls=0;
  const currentSession={...session,account:async()=>{currentCalls++;started.resolve();return response.promise}};
  worker=access.delivery(currentLease,{open:async()=>currentSession},settings);const currentPass=worker.connect();await started.promise;
  access.connectionUnavailable(oldLease);
  for(const stale of [()=>access.signOut(oldLease),()=>access.beginDeletion(oldLease),()=>access.verify(oldLease,status('old'))])await assert.rejects(stale,e=>e.code==='STALE_ACCOUNT');
  response.resolve(status('current'));assert.equal((await currentPass).phase,'synced');assert.equal((await worker.connect()).phase,'synced');assert.equal(currentCalls,2,'stale callbacks leave the current worker reusable');worker.close();
  // Equivalent restored proofs refer to the same durable lease and must still cancel its workers synchronously.
  const equivalent=await access.restore('selector-current');started=deferred();response=deferred();
  worker=access.delivery(currentLease,{open:async()=>currentSession},settings);const equivalentPass=worker.connect();await started.promise;
  access.connectionUnavailable(equivalent);assert.equal((await equivalentPass).phase,'cancelled');response.resolve(status('current'));worker.close();await verify('current');
  // Status callbacks may reenter connect. Both callers must receive the registered pass.
  let nested,reentered=false,opens=0;
  worker=access.delivery(lease,{open:async()=>{opens++;return {...session,account:async()=>status('current')}}},{...settings,onState:s=>{if(s.phase==='connecting'&&!reentered){reentered=true;nested=worker.connect()}}});
  const outer=worker.connect();assert.equal((await outer).phase,'synced');assert.equal(nested,outer);assert.equal(opens,1);worker.close();
  // A game-specific content mismatch must preserve its evidence without starving another game.
  for(const collision of [false,true]){
   const profile=collision?'collision':'mismatch';await verify(profile);const blocked=await seed(),healthy=await seed(),blockedOp=score(blocked,1),healthyOp=score(healthy,1);
   await out.enqueue(blockedOp);await out.enqueue(healthyOp);await out.prepareDelivery(blocked.id,cap);await out.acknowledge(blockedOp.operationId,ack(blockedOp));
   serverGames.set(healthy.id,structuredClone(healthy));const before=(await out.read()).games.find(g=>g.gameId===blocked.id);let healthyPosts=0;
   const isolated={...session,account:async()=>status(profile),get:async id=>id===blocked.id?gameView({...blocked,name:collision?'Conflicting name':blocked.name,version:collision?1:2}):session.get(id),operation:async(wire,signal)=>{assert.equal(JSON.parse(wire).gameId,healthy.id);healthyPosts++;return session.operation(wire,signal)}};
   worker=access.delivery(lease,{open:async()=>isolated},settings);
   for(let pass=0;pass<2;pass++){const result=await worker.connect();assert.equal(result.phase,'needs-review');assert.equal(result.code,collision?'VERSION_COLLISION':'NEEDS_REVIEW')}
   assert.equal(healthyPosts,1,'healthy changes drain exactly once despite another game requiring review');const after=await out.read(),retained=after.games.find(g=>g.gameId===blocked.id);
   assert.deepEqual(retained.operations,before.operations);assert.deepEqual(retained.projection,before.projection);assert.equal(retained.base.serverVersion,1);if(!collision)assert.equal(retained.candidate.serverVersion,2);
   assert.equal(after.games.find(g=>g.gameId===healthy.id).operations.length,0);worker.close();
  }
  // Storage failures still stop the pass rather than being mistaken for a game conflict.
  await verify('storage');const broken=await seed(),later=await seed();await out.enqueue(score(broken,1));await out.enqueue(score(later,1));let storagePosts=0;
  const saveDocument=repo.documents.write;repo.documents.write=async(key,...args)=>{if(key==='game-outbox:storage')throw new (require(path.join(root,'repository/confirmed-games.js')).LocalRepositoryError)('STORAGE_UNAVAILABLE','test storage failure');return saveDocument(key,...args)};
  try{worker=access.delivery(lease,{open:async()=>({...session,account:async()=>status('storage'),operation:async()=>{storagePosts++;throw Error('must not post')}})},settings);assert.equal((await worker.connect()).phase,'unavailable');assert.equal(storagePosts,0);worker.close()}finally{repo.documents.write=saveDocument}
  // The per-game catch must not continue past authentication or invalid receipt failures.
  for(const unauthorized of [false,true]){
   const profile=unauthorized?'unauthorized':'protocol';await verify(profile);const firstGame=await seed(),nextGame=await seed();await out.enqueue(score(firstGame,1));await out.enqueue(score(nextGame,1));let attempted=0;
   worker=access.delivery(lease,{open:async()=>({...session,account:async()=>status(profile),operation:async wire=>{attempted++;if(unauthorized)throw new ApiError(401,'expired');return {...ack(JSON.parse(wire)),operationId:randomUUID()}}})},settings);
   const result=await worker.connect();assert.equal(result.phase,unauthorized?'sign-in-required':'unavailable');if(!unauthorized)assert.equal(result.code,'INVALID_ACKNOWLEDGEMENT');assert.equal(attempted,1);
   const pending=await out.read();assert.equal(pending.games[0].operations[0].status,'uncertain');assert.equal(pending.games[1].operations[0].status,'queued');worker.close();
  }
  // Deleting account status persists a durable block before a new worker can run.
  await verify('D');worker=access.delivery(lease,{open:async()=>({...session,account:async()=>({...status('D'),deletionStatus:'pending'})})},settings);assert.equal((await worker.connect()).phase,'account-blocked');assert.equal(await access.restore('selector-D'),null);assert.ok(await access.isDeletionBlocked('D'));worker.close();
  await access.close();console.log(name+': disabled/no side effects, reconnect coalescing, immutable retries, post-ack refresh recovery, conflict preservation, capability/token/identity gates, timeouts and late results, same/independent-handle cancellation, 404 preservation, deletion receipts/blocking, stale-lease isolation, reentrant coalescing, independent-game reconciliation and fail-closed error handling passed.');
 }
 // HTTP adapter pins one token for the pass, uses raw bytes, and never retries a POST internally.
 const realFetch=globalThis.fetch;try{
  const sent=[],scope={profileId:'captured',assert:async()=>{}},tokens=[];let token='first-token';
  const transport=createOperationTransport('https://api.example.test/api/',async(profile,signal)=>{tokens.push(profile);return token},scope),controller=new AbortController(),session=await transport.open(controller.signal);
  globalThis.fetch=async(url,opts)=>{sent.push({url,opts});return {ok:true,json:async()=>url.endsWith('/account')?status('captured'):ack(JSON.parse(opts.body))}};
  await session.account(controller.signal);token='other-account-token';const op=score(base(),1),wire=JSON.stringify(op);await session.operation(wire,controller.signal);assert.equal(tokens.length,1);assert.equal(tokens[0],'captured');assert.equal(sent[1].opts.headers.Authorization,'Bearer first-token');assert.equal(sent[1].opts.body,wire);assert.equal(sent[1].url,'https://api.example.test/api/game-operations');
  let attempts=0;globalThis.fetch=async()=>{attempts++;return {ok:false,status:503,json:async()=>({code:'API_UNAVAILABLE'})}};await assert.rejects(()=>session.operation(wire,controller.signal));assert.equal(attempts,1);controller.abort();await assert.rejects(()=>session.operation(wire,controller.signal));assert.equal(attempts,1);
 }finally{globalThis.fetch=realFetch}
 console.log('Authenticated HTTP transport: captured profile/token, exact raw POST bytes, no internal mutation retry and preflight cancellation passed. No production requests were made.');
}finally{rmSync(root,{recursive:true,force:true})}
