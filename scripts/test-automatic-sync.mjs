import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {setImmediate as turn} from 'node:timers/promises';
import {IDBFactory} from '../tests/offline/node_modules/fake-indexeddb/build/esm/index.js';
const root=mkdtempSync(path.join(tmpdir(),'scorekeeper-automatic-'));
try{
 execFileSync(process.execPath,['node_modules/typescript/bin/tsc','shared/repository/automatic-sync.ts','shared/repository/game-creator.ts','shared/repository/pilot.ts','shared/repository/indexeddb-confirmed-games.ts','shared/repository/sqlite-confirmed-games.ts','--target','ES2022','--module','commonjs','--moduleResolution','node','--strict','--skipLibCheck','--outDir',root],{stdio:'inherit'});
 writeFileSync(path.join(root,'package.json'),'{"type":"commonjs"}');const require=createRequire(import.meta.url),ts=require(path.resolve('node_modules/typescript'));
 const {createAutomaticSync,automaticResult}=require(path.join(root,'repository/automatic-sync.js')),{createDurableAccountRepository}=require(path.join(root,'repository/durable-account.js')),{createRepositoryPilot}=require(path.join(root,'repository/pilot.js'));
 const {createAccountGameCreator}=require(path.join(root,'repository/game-creator.js'));
 const {openConfirmedGames}=require(path.join(root,'repository/indexeddb-confirmed-games.js')),{openSQLiteConfirmedGames}=require(path.join(root,'repository/sqlite-confirmed-games.js')),{LocalGames,gameView}=require(path.join(root,'local-games.js'));
 const {LocalRepositoryError}=require(path.join(root,'repository/confirmed-games.js'));
 const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)}};
 function clock(){let now=0,id=0;const timers=new Map();return {now:()=>now,set:(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id},clear:id=>timers.delete(id),size:()=>timers.size,async advance(ms){const end=now+ms;for(let i=0;i<100;i++){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end){now=end;await turn();return}now=next[1].at;timers.delete(next[0]);next[1].fn();await turn()}throw Error('Unbounded timer loop')}}}
 {
  const time=clock(),hold=deferred(),calls=[];const auto=createAutomaticSync({enabled:true,clock:time,run:async(signal,refresh)=>{calls.push({signal,refresh});if(calls.length===2)await hold.promise;return 'done'}});
  auto.setActive(true);await time.advance(749);assert.equal(calls.length,0);await time.advance(1);assert.equal(calls.length,1);assert.equal(calls[0].refresh,true);assert.equal(time.size(),0,'no idle polling');
  for(let i=0;i<20;i++)auto.request();await time.advance(5000);assert.equal(calls.length,2);assert.equal(calls[1].refresh,false);for(let i=0;i<20;i++)auto.request();await time.advance(10000);assert.equal(calls.length,2,'in-flight triggers cannot overlap');hold.resolve();await turn();await time.advance(750);assert.equal(calls.length,3,'one trailing pass');assert.equal(calls[2].refresh,false);auto.close();assert.equal(time.size(),0);
 }
 {
  const time=clock();let calls=0;const auto=createAutomaticSync({enabled:true,clock:time,run:async()=>{calls++;return 'retry'}});auto.setActive(true);await time.advance(100000);assert.equal(calls,3);for(let i=0;i<20;i++)auto.request();await time.advance(100000);assert.equal(calls,3,'scores never reset exhausted budgets');auto.wake();await time.advance(100000);assert.equal(calls,6);auto.close();
 }
 {
  const time=clock();let calls=0;const auto=createAutomaticSync({enabled:true,clock:time,run:async()=>{calls++;return calls===1?'blocked':'done'}});auto.setActive(true);await time.advance(1000);auto.wake();auto.request();await time.advance(1000000);assert.equal(calls,1,'auth/capability block cannot loop on foreground or scores');auto.recovered();auto.request();await time.advance(1000);assert.equal(calls,2);auto.close();
 }
 {
  const time=clock(),hold=deferred(),signals=[];const auto=createAutomaticSync({enabled:true,clock:time,run:async signal=>{signals.push(signal);if(signals.length===1)await hold.promise;return 'done'}});auto.setActive(true);await time.advance(1000);auto.setActive(false);assert.equal(signals[0].aborted,true);auto.request();await time.advance(100000);assert.equal(signals.length,1);auto.setActive(true);hold.resolve();await turn();await time.advance(1000);assert.equal(signals.length,2);auto.close();await time.advance(100000);assert.equal(signals.length,2);
  const disabled=createAutomaticSync({enabled:false,clock:time,run:async()=>{throw Error('disabled')}});disabled.setActive(true);disabled.wake();disabled.request();assert.equal(time.size(),0);disabled.close();
 }
 // Recovery before the exhaustion cooldown expires schedules exactly one wake.
 {
  const time=clock();let calls=0;const auto=createAutomaticSync({enabled:true,clock:time,retryMs:[],run:async()=>{calls++;return calls===1?'retry':'done'}});
  auto.setActive(true);await time.advance(1000);assert.equal(calls,1);auto.setActive(false);auto.setActive(true);
  for(let i=0;i<20;i++)auto.wake();assert.equal(time.size(),1);await time.advance(59749);assert.equal(calls,1);await time.advance(1);assert.equal(calls,2);assert.equal(time.size(),0,'wake is not periodic');auto.close();
 }
 {
  const time=clock();let calls=0;const auto=createAutomaticSync({enabled:true,clock:time,retryMs:[],run:async()=>{calls++;return 'retry'}});
  auto.setActive(true);await time.advance(1000);auto.wake();auto.setActive(false);await time.advance(100000);assert.equal(calls,1,'background cancels delayed recovery');auto.close();assert.equal(time.size(),0);
 }
 // Both platforms opt into foreground refresh: remote reads, transient recovery,
 // single-flight behavior and terminal parking without user coordination.
 {
  const time=clock(),calls=[],hold=deferred();
  const auto=createAutomaticSync({enabled:true,clock:time,refreshIntervalMs:30000,run:async(signal,refresh)=>{calls.push({signal,refresh});if(calls.length===2)await hold.promise;return 'done'}});
  auto.setActive(true);await time.advance(1000);assert.equal(calls.length,1);
  await time.advance(30000);assert.equal(calls.length,2);assert.equal(calls[1].refresh,true);
  await time.advance(90000);assert.equal(calls.length,2,'periodic reads cannot overlap a flight');
  hold.resolve();await turn();await time.advance(1000);assert.equal(calls.length,3,'coalesces missed refreshes');
  auto.setActive(false);assert.equal(time.size(),0);await time.advance(120000);assert.equal(calls.length,3);
  auto.setActive(true);await time.advance(1000);assert.equal(calls.length,4);auto.close();assert.equal(time.size(),0);
 }
 {
  const time=clock();let calls=0;
  const auto=createAutomaticSync({enabled:true,clock:time,refreshIntervalMs:30000,retryMs:[],run:async()=>++calls===1?'retry':'done'});
  auto.setActive(true);await time.advance(60000);assert.equal(calls,1,'refresh respects failure cooldown');await time.advance(2000);assert.equal(calls,2,'transient failure recovers without reconnect');auto.close();
 }
 {
  const time=clock();let calls=0;
  const auto=createAutomaticSync({enabled:true,clock:time,refreshIntervalMs:30000,run:async()=>{calls++;return 'blocked'}});
  auto.setActive(true);await time.advance(180000);assert.equal(calls,1,'periodic refresh cannot loop on sign-in or capability blocks');auto.close();assert.equal(time.size(),0);
 }
 assert.equal(automaticResult(false,{status:'sign-in',lastConnectedAt:null}),'blocked');assert.equal(automaticResult(false,{status:'unavailable',lastConnectedAt:null,diagnostic:{code:'CAPABILITY_REQUIRED'}}),'blocked');assert.equal(automaticResult(true,{status:'connected',lastConnectedAt:1,delivery:{phase:'pending'}}),'retry');assert.equal(automaticResult(true,{status:'connected',lastConnectedAt:1,delivery:{phase:'needs-review'}}),'done');
 // Run both actual platform hooks with effect/ref and surface fakes. A render
 // for a new account cannot redirect an old timer to its new callback.
 for(const [file,native]of [['app/cloud/useAutomaticSync.ts',false],['mobile/useAutomaticSync.ts',true]]){
  let index=0,pendingEffects=[],cleanups=[],refs=[],controllers=[],listeners=new Map(),online=true,visibility='visible',nativeState='active';
  const surface={addEventListener:(name,fn)=>{listeners.set(name,fn);return {remove:()=>listeners.delete(name)}},removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name)},get currentState(){return nativeState}};
  const react={useRef:initial=>refs[index++]??(refs[index-1]={current:initial}),useEffect:fn=>pendingEffects.push(fn)};
  const module={exports:{}},compiled=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const create=options=>{assert.equal(options.refreshIntervalMs,30000,'web/native enable the same foreground refresh');const c={options,active:[],requests:0,closed:false,setActive:v=>c.active.push(v),wake:()=>{},request:()=>c.requests++,recovered:()=>{},close:()=>{c.closed=true}};controllers.push(c);return c};
  const load=name=>name==='react'?react:name==='react-native'?{AppState:surface}:{createAutomaticSync:create};
  new Function('require','module','exports','window','document','navigator',compiled)(load,module,module.exports,surface,{...surface,get visibilityState(){return visibility}},{get onLine(){return online}});
  const render=(key,run)=>{index=0;return module.exports.useAutomaticSync(true,key,run)};
  let callsA=0,callsB=0;const a=render('A',async()=>{callsA++;return 'done'});cleanups=pendingEffects.splice(0).map(fn=>fn());assert.deepEqual(controllers[0].active,[true]);a.request();assert.equal(controllers[0].requests,1);
  render('B',async()=>{callsB++;return 'done'});assert.equal(await controllers[0].options.run(new AbortController().signal,true),'cancelled');assert.equal(callsA+callsB,0);cleanups.forEach(fn=>fn?.());cleanups=pendingEffects.splice(0).map(fn=>fn());assert.equal(controllers[0].closed,true);assert.equal(await controllers[1].options.run(new AbortController().signal,false),'done');assert.equal(callsB,1);
  if(native){nativeState='background';listeners.get('change')('background');assert.equal(controllers[1].active.at(-1),false);nativeState='active';listeners.get('change')('active')}else{online=false;listeners.get('offline')();assert.equal(controllers[1].active.at(-1),false);online=true;listeners.get('online')();visibility='hidden';listeners.get('visibilitychange')();assert.equal(controllers[1].active.at(-1),false)}cleanups.forEach(fn=>fn?.());assert.equal(listeners.size,0);
 }
 // A lost local acknowledgement cannot block a different setup or cross accounts.
 {
  const creator=createAccountGameCreator(randomUUID),scope={selector:'same-login',generation:1},seen=[];let profile='A',fail=true;
  const repository={creationProfile:async()=>profile,enqueueCreation:async(s,op,p)=>{seen.push({op,p});if(fail){fail=false;throw Error('Lost local acknowledgement')}return {kind:'game',view:gameView(op.game)}}};
  await assert.rejects(creator.create(repository,scope,'Retry',['A','B'],'high',{}));
  await creator.create(repository,scope,'Different setup',['A','B'],'low',{});
  assert.notEqual(seen[0].op.gameId,seen[1].op.gameId);
  await creator.create(repository,scope,'Retry',['A','B'],'high',{});assert.deepEqual(seen[0],seen[2],'original uncertain request is retained');
  fail=true;await assert.rejects(creator.create(repository,scope,'Account-bound',['A','B'],'high',{}));
  profile='B';await creator.create(repository,scope,'Account-bound',['A','B'],'high',{});
  assert.equal(seen[4].p,'B');assert.notEqual(seen[3].op.operationId,seen[4].op.operationId,'no request is transferred to another profile');
  profile='A';await creator.create(repository,scope,'Account-bound',['A','B'],'high',{});assert.deepEqual(seen[3],seen[5]);
 }
 const cap={version:1,receipts:'retained',atomicGameAndReceipt:true,kinds:['action','delete'],actions:['score','select','finish','resume','undo','edit','rules']},status={profileId:'A',deletionStatus:null,deletionEnabled:true,gameOperations:cap};
 const factory=new IDBFactory(),file=path.join(root,'native.db');
 function queries(db){return {execAsync:async sql=>db.exec(sql),runAsync:async(sql,...p)=>db.prepare(sql).run(...p),getFirstAsync:async(sql,...p)=>db.prepare(sql).get(...p)||null,getAllAsync:async(sql,...p)=>db.prepare(sql).all(...p)}}
 function sqlite(){const db=new DatabaseSync(file);return {...queries(db),closeAsync:async()=>db.close(),withExclusiveTransactionAsync:async work=>{const tx=new DatabaseSync(file);try{tx.exec('BEGIN');try{await work(queries(tx));tx.exec('COMMIT')}catch(e){tx.exec('ROLLBACK');throw e}}finally{tx.close()}}}}
 const rejects=(fn,code)=>assert.rejects(Promise.resolve().then(fn),e=>e.code===code),make=()=>{const players=[{id:randomUUID(),name:'One'},{id:randomUUID(),name:'Two'}];return gameView({id:randomUUID(),name:'Live scoring',players,winner:'high',entries:[],next:players[0].id,finished:false,version:1,updated:'2026-10-20T00:00:00Z'})};
 const score=(v,points)=>({protocolVersion:1,kind:'action',operationId:randomUUID(),gameId:v.game.id,command:{action:'score',expectedVersion:v.game.version,points,playerId:v.game.next,entryId:randomUUID()}});
 for(const [name,open]of [['IndexedDB',()=>openConfirmedGames(factory,'automatic')],['SQLite',()=>openSQLiteConfirmedGames(sqlite())]]){
  const repo=await open(),access=createDurableAccountRepository(repo,{coldWritesEnabled:true,allowPendingWrites:true}),lease=await access.verify(await access.beginVerification('A','A'),status),initial=make();await access.observeGame(lease,initial);await access.prepareScoring(lease,initial);const first=score(initial,5);await access.enqueueScoring(lease,first);
  const otherRepo=await open(),other=createDurableAccountRepository(otherRepo,{coldWritesEnabled:true,allowPendingWrites:true}),restored=await other.restore('A'),epoch=(await repo.documents.read('account-lifecycle')).revision;const verifiedOther=await other.verify(restored,status);assert.equal((await repo.documents.read('account-lifecycle')).revision,epoch,'unchanged background verification preserves cross-handle local writes');assert.equal((await access.readScoringGame(lease,initial.game.id)).canScore,true);await other.close();
  let remote=initial,sent=[],receipts=new Map(),ackFirst,firstCall=true;const started=deferred(),release=deferred(),out=access.outbox(lease);
  const session={account:async()=>status,get:async()=>remote,operation:async wire=>{sent.push(wire);const op=JSON.parse(wire);if(receipts.has(op.operationId))return receipts.get(op.operationId);assert.equal(op.command.expectedVersion,remote.game.version);let raw=JSON.stringify([remote.game]);const local=new LocalGames({read:async()=>raw,write:async value=>{raw=value}},()=>op.command.entryId);const updated=await local.act(remote.game,op.command);remote=gameView({...updated.game,updated:new Date().toISOString()});const ack={operationId:op.operationId,gameId:op.gameId,outcome:'applied',committedVersion:remote.game.version,observedVersion:op.command.expectedVersion,errorCode:null};receipts.set(op.operationId,ack);if(firstCall){firstCall=false;ackFirst=ack;started.resolve();await release.promise;throw new TypeError('Lost first network acknowledgement')}return ack}};
  const worker=access.delivery(lease,{open:async()=>session},{enabled:true,retryDelayMs:0}),flight=worker.connect();await started.promise;let read=await access.readScoringGame(lease,initial.game.id);assert.equal(read.canScore,true,'score entry remains usable while predecessor is on the wire');const second=score(read.view,3),write=repo.documents.write;let raced=false;
  repo.documents.write=async(...args)=>{if(args[0]==='game-outbox:A'&&!raced&&JSON.stringify(args[2]).includes(second.operationId)){raced=true;await out.acknowledge(first.operationId,ackFirst)}return write(...args)};
  read=await access.enqueueScoring(lease,second);repo.documents.write=write;assert.equal(raced,true);assert.deepEqual(read.view.game.entries.map(e=>e.id),[first.command.entryId,second.command.entryId]);release.resolve();assert.equal((await flight).phase,'synced');worker.close();assert.equal(sent[0],sent[1],'lost reply retries exact original bytes');assert.equal(remote.game.entries.length,2);assert.equal(receipts.size,2);assert.deepEqual((await access.readScoringGame(lease,initial.game.id)).view.game.entries,remote.game.entries);
  const third=score((await access.readScoringGame(lease,initial.game.id)).view,9);read=await access.enqueueScoring(lease,third);await out.prepareDelivery(initial.game.id,cap);const deletion={protocolVersion:1,kind:'delete',operationId:randomUUID(),gameId:initial.game.id,expectedVersion:read.view.game.version};assert.equal((await access.enqueueScoring(lease,deletion)).kind,'pending-delete');const retained=(await out.read()).games.find(g=>g.gameId===initial.game.id);assert.equal(retained.beforeDelete.game.entries.length,3);await out.acknowledge(third.operationId,{operationId:third.operationId,gameId:third.gameId,outcome:'rejected',committedVersion:null,observedVersion:remote.game.version+1,errorCode:'VERSION_CONFLICT'});await rejects(()=>out.prepareDelivery(initial.game.id,cap),'NEEDS_REVIEW');assert.equal((await access.readScoringGame(lease,initial.game.id)).sync,'needs-review');assert.ok((await access.readRecovery(lease,initial.game.id)).review.copies.some(c=>c.view?.game.entries.length===3));await access.close();
  let notices=0;const pilot=createRepositoryPilot({enabled:true,recoveryEnabled:true,scoringEnabled:true,coldWritesEnabled:true,automaticSyncEnabled:true,open,onInvalidated:()=>{},onQueued:()=>{notices++;throw Error('Scheduler cannot break saves')}}),scope=await pilot.prepare('A');await pilot.verify(scope,status);const game=make();await pilot.record(scope,game);await pilot.prepareScoring(scope,game,'A');assert.equal(notices,0,'verification/preparation never schedule a feedback loop');await pilot.prepare('A',true);await pilot.verify(scope,status);await pilot.enqueueScoring(scope,score(game,1),'A');assert.equal(notices,1);const previous=await pilot.capture();await rejects(()=>pilot.verify(previous,{...status,deletionStatus:'pending'}),'ACCOUNT_DELETING');await pilot.close();
  // New signed-in games enter the durable queue directly; no guest adoption.
  let creationStorage;const creationPilot=createRepositoryPilot({enabled:true,scoringEnabled:true,coldWritesEnabled:true,automaticSyncEnabled:true,deliveryEnabled:true,open:async()=>creationStorage=await open(),onQueued:()=>notices++,onInvalidated:()=>{}});
  const creationScope=await creationPilot.prepare('creator-C');
  const creationStatus={...status,profileId:'C',gameOperations:{...cap,kinds:['action','delete','create']}};
  await creationPilot.verify(creationScope,creationStatus);
  const createWrite=creationStorage.documents.write;let lostLocalReply=false;
  creationStorage.documents.write=async(...args)=>{const saved=await createWrite(...args);if(args[0]==='game-outbox:C'&&!lostLocalReply){lostLocalReply=true;throw new LocalRepositoryError('STORAGE_UNAVAILABLE','Lost creation commit acknowledgement')}return saved};
  const creator=createAccountGameCreator(randomUUID),created=await creator.create(creationPilot,creationScope,'Automatic new game',['Alice','Bob'],'high',{});
  creationStorage.documents.write=createWrite;assert.equal(lostLocalReply,true);
  assert.equal(created.kind,'game');assert.equal(created.sync,'pending');assert.equal(created.canScore,true);assert.equal(created.view.game.deviceOnly,undefined);
  const createdId=created.view.game.id;
  // Cold launch/offline admission uses previously verified creation rights.
  await creationPilot.close();
  const reopened=createRepositoryPilot({enabled:true,scoringEnabled:true,coldWritesEnabled:true,automaticSyncEnabled:true,deliveryEnabled:true,open,onInvalidated:()=>{}}),coldScope=await reopened.prepare('creator-C');
  const coldCreated=await createAccountGameCreator(randomUUID).create(reopened,coldScope,'Offline new game',['Alice','Bob'],'low',{});
  assert.equal(coldCreated.kind,'game');assert.equal(coldCreated.canScore,true);
  const newRepo=await open(),newAccess=createDurableAccountRepository(newRepo,{coldWritesEnabled:true,allowPendingWrites:true});let newLease=await newAccess.restore('creator-C');
  const newOut=newAccess.outbox(newLease),creationQueue=await newOut.read(),creation=creationQueue.games.find(g=>g.gameId===createdId).operations[0],creationOp=JSON.parse(creation.wire);
  assert.equal(creationOp.kind,'create');assert.equal(creationOp.game.entries.length,0);
  await newAccess.enqueueCreation(newLease,creationOp);assert.equal((await newOut.read()).games.find(g=>g.gameId===createdId).operations.length,1,'same creation operation never duplicates');
  await newAccess.enqueueScoring(newLease,score(created.view,7));assert.equal((await newOut.read()).games.find(g=>g.gameId===createdId).projection.game.entries.length,1,'score while creation awaits delivery');
  const wires=[],effects=new Map(),acks=new Map();let loseReply=true;
  newLease=await newAccess.verify(newLease,creationStatus);
  const createWorker=newAccess.delivery(newLease,{open:async()=>({account:async()=>creationStatus,get:async id=>effects.get(id),operation:async wire=>{
   wires.push(wire);const op=JSON.parse(wire);if(acks.has(op.operationId))return acks.get(op.operationId);
   let view;
   if(op.kind==='create'){assert.equal(effects.has(op.gameId),false);view=gameView(op.game)}else{
    let raw=JSON.stringify([effects.get(op.gameId).game]);const local=new LocalGames({read:async()=>raw,write:async value=>{raw=value}},()=>op.command.entryId);
    view=await local.act(effects.get(op.gameId).game,op.command);
   }
   effects.set(op.gameId,view);const ack={operationId:op.operationId,gameId:op.gameId,outcome:'applied',committedVersion:view.game.version,observedVersion:op.kind==='create'?null:op.command.expectedVersion,errorCode:null};acks.set(op.operationId,ack);
   if(loseReply){loseReply=false;throw new TypeError('Lost creation reply')}return ack;
  }})},{enabled:true,retryDelayMs:0});
  const deliveredCreation=await createWorker.connect();assert.equal(deliveredCreation.phase,'synced',JSON.stringify(deliveredCreation));assert.equal(wires[0],wires[1]);assert.equal(effects.size,2);assert.equal(effects.get(createdId).game.entries.length,1);createWorker.close();
  newLease=await newAccess.verify(newLease,{...creationStatus,gameOperations:cap});await rejects(()=>newAccess.enqueueCreation(newLease,creationOp),'CAPABILITY_REQUIRED');
  await newAccess.beginDeletion(newLease);await rejects(()=>newAccess.enqueueCreation(newLease,creationOp),'STALE_ACCOUNT');
  await newAccess.close();await reopened.close();
  console.log(name+': live writes during delivery, exact replay after lost reply, same-request CAS retry, rejection/deletion recovery and nonblocking save notification pass');
 }
 console.log('New account games: IndexedDB/SQLite direct creation, cold launch, local/server lost replies, one-effect replay, pending scores, capability/deletion and profile binding pass');
 console.log('Automatic scheduler: bounded/coalesced triggers, cooldown/terminal parking, no idle polling, lifecycle cancellation, account-key isolation and actual web/native surface hooks pass');
}finally{rmSync(root,{recursive:true,force:true})}
