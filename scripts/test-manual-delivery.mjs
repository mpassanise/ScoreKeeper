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
const root=mkdtempSync(path.join(tmpdir(),'scorekeeper-manual-')),originalFetch=globalThis.fetch;
try{
 execFileSync(process.execPath,['node_modules/typescript/bin/tsc','shared/repository/pilot.ts','shared/repository/game-screen.ts','shared/repository/manual-delivery.ts','shared/repository/indexeddb-confirmed-games.ts','shared/repository/sqlite-confirmed-games.ts','shared/connection-status.ts','shared/account-refresh.ts','--target','ES2022','--module','commonjs','--moduleResolution','node','--strict','--skipLibCheck','--outDir',root],{stdio:'inherit'});
 writeFileSync(path.join(root,'package.json'),'{"type":"commonjs"}');const require=createRequire(import.meta.url);
 const {createDurableAccountRepository}=require(path.join(root,'repository/durable-account.js')),{createRepositoryPilot}=require(path.join(root,'repository/pilot.js'));
 const {runManualDelivery,manualDeliveryText,createManualSync}=require(path.join(root,'repository/manual-delivery.js')),{createConnectionStatus,connectionText}=require(path.join(root,'connection-status.js'));
 const {openConfirmedGames}=require(path.join(root,'repository/indexeddb-confirmed-games.js')),{openSQLiteConfirmedGames}=require(path.join(root,'repository/sqlite-confirmed-games.js'));
 const {gameView}=require(path.join(root,'local-games.js')),{snapshot}=require(path.join(root,'repository/confirmed-games.js')),{keepGameCollision,gameCollisionKey}=require(path.join(root,'repository/game-collisions.js'));
 const cap={version:1,receipts:'retained',atomicGameAndReceipt:true,kinds:['action','create','import','delete'],actions:['score','edit','undo','select','rules','finish','resume']};
 const status=profileId=>({profileId,deletionStatus:null,deletionEnabled:true,gameOperations:cap}),settings={retryDelayMs:0,stepTimeoutMs:1000,passTimeoutMs:5000,pollMs:5};
 const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}},rejects=(fn,code)=>assert.rejects(fn,e=>e.code===code);
 const factory=new IDBFactory(),file=path.join(root,'native.db');let sequence=0;
 function queries(db){return {execAsync:async sql=>db.exec(sql),runAsync:async(sql,...p)=>db.prepare(sql).run(...p),getFirstAsync:async(sql,...p)=>db.prepare(sql).get(...p)||null,getAllAsync:async(sql,...p)=>db.prepare(sql).all(...p)}}
 function sqlite(){const db=new DatabaseSync(file);return {...queries(db),closeAsync:async()=>db.close(),withExclusiveTransactionAsync:async work=>{const tx=new DatabaseSync(file);try{tx.exec('BEGIN');try{await work(queries(tx));tx.exec('COMMIT')}catch(e){tx.exec('ROLLBACK');throw e}}finally{tx.close()}}}}
 const response=(data,code=200)=>({ok:code>=200&&code<300,status:code,json:async()=>structuredClone(data)});
 for(const [name,open]of [['IndexedDB',()=>openConfirmedGames(factory,'manual')],['SQLite',()=>openSQLiteConfirmedGames(sqlite())]]){
  async function fixture(count=1){
   const profile='profile-'+(++sequence),selector='selector-'+profile,repo=await open(),access=createDurableAccountRepository(repo),lease=await access.verify(await access.beginVerification(selector,profile),status(profile)),out=access.outbox(lease),games=[],ops=[];
   for(let n=0;n<count;n++){const players=[{id:randomUUID(),name:'One'},{id:randomUUID(),name:'Two'}],g={id:randomUUID(),name:'Saved game',players,winner:'high',entries:[],next:players[0].id,finished:false,version:1,updated:'2026-10-19T00:00:00Z',playStyle:'free',scoreMode:'add'};await access.observeGame(lease,gameView(g));await out.seedConfirmed(g.id);const op={protocolVersion:1,kind:'action',operationId:randomUUID(),gameId:g.id,command:{action:'score',expectedVersion:1,points:12,playerId:g.next,entryId:randomUUID()}};await out.enqueue(op);games.push(g);ops.push(op)}
   await access.close();return {profile,selector,games,ops};
  }
  async function pilotFor(f,enabled=true){let raw;const pilot=createRepositoryPilot({enabled:true,deliveryEnabled:enabled,recoveryEnabled:true,open:async()=>{raw=await open();return raw},onInvalidated:()=>{}}),scope=await pilot.prepare(f.selector);await pilot.verify(scope,status(f.profile));return {pilot,scope,get raw(){return raw}}}
  function http(f){
   const games=new Map(f.games.map(g=>[g.id,structuredClone(g)])),receipts=new Map(),calls=[],events=[];let effects=0,tokens=0;
   const request={base:'https://manual.example.test/api',options:settings,onState:s=>events.push(s),getToken:async binding=>{tokens++;assert.equal(binding.profileId,f.profile);assert.equal(binding.selector,f.selector);return 'captured-token'}};
   const server={games,receipts,calls,events,request,account:status(f.profile),post:null,get:null,get effects(){return effects},get tokens(){return tokens},fetch:async(url,opts)=>{
    calls.push({url,method:opts.method,wire:opts.body,authorization:opts.headers.Authorization});assert.equal(opts.headers.Authorization,'Bearer captured-token');
    if(url.endsWith('/account'))return response(server.account);
    if(url.endsWith('/game-operations')){
     const op=JSON.parse(opts.body);if(!receipts.has(op.operationId)){const g=games.get(op.gameId);g.entries.push({id:op.command.entryId,playerId:op.command.playerId,points:op.command.points});g.next=op.command.playerId;g.version++;g.updated='2026-10-19T01:00:00Z';effects++;receipts.set(op.operationId,{operationId:op.operationId,gameId:op.gameId,outcome:'applied',committedVersion:g.version,observedVersion:g.version-1,errorCode:null})}
     return server.post?server.post(opts.body,receipts.get(op.operationId),opts.signal):response(receipts.get(op.operationId));
    }
    const id=url.split('/').at(-1);return server.get?server.get(id):response(gameView(games.get(id)));
   }};return server;
  }
  async function collide(raw,f,index=0){const record=await raw.documents.read('account-lifecycle'),original=snapshot(f.profile,gameView(f.games[index])),different=snapshot(f.profile,gameView({...f.games[index],name:'Contradictory account copy'}));await keepGameCollision(raw.documents,{key:'account-lifecycle',revision:record.revision},original,different)}
  // Default inactivity includes storage, token and HTTP work.
  let opens=0;const disabled=createRepositoryPilot({enabled:true,open:async()=>{opens++;throw Error()},onInvalidated:()=>{}});assert.equal((await disabled.manualDeliver(null,{base:'https://example.test',getToken:async()=>assert.fail()})).phase,'disabled');assert.equal(opens,0);await disabled.close();
  // One explicit pass pins one token and retries exactly the original request.
  const f=await fixture(),p=await pilotFor(f),server=http(f);let lose=true;server.post=async(_wire,ack)=>{if(lose){lose=false;throw TypeError('Lost response')}return response(ack)};globalThis.fetch=server.fetch;
  const pass=p.pilot.manualDeliver(p.scope,server.request);assert.equal(p.pilot.manualDeliver(p.scope,server.request),pass);assert.equal((await pass).phase,'synced');assert.equal(server.tokens,1);assert.equal(server.effects,1);assert.deepEqual(server.calls.filter(c=>c.method==='POST').map(c=>c.wire),[JSON.stringify(f.ops[0]),JSON.stringify(f.ops[0])]);assert.equal((await p.pilot.readGame(p.scope,f.games[0].id)).view.game.entries.length,1);assert.ok(server.events.every(e=>![f.games[0].id,f.ops[0].operationId,'captured-token'].some(x=>JSON.stringify(e).includes(x))));await p.pilot.close();
  // Token acquisition does not hold the pilot lock; reads and sign-out finish
  // while an abort-ignoring provider is still pending. Late tokens are discarded.
  const waiting=await fixture(),q=await pilotFor(waiting),started=defer(),token=defer();let fetches=0;globalThis.fetch=async()=>{fetches++;assert.fail('late token must not start HTTP')};
  const blocked=q.pilot.manualDeliver(q.scope,{base:'https://manual.example.test',options:settings,getToken:async()=>{started.resolve();return token.promise}});await started.promise;
  assert.equal((await Promise.race([q.pilot.readGame(q.scope,waiting.games[0].id),new Promise((_,reject)=>setTimeout(()=>reject(Error('cached reads blocked')),1000))])).kind,'game');await q.pilot.signOut();assert.equal((await blocked).phase,'cancelled');token.resolve('late-token');await turn();assert.equal(fetches,0);await q.pilot.close();
  // Caller cancellation after dispatch preserves uncertain bytes. A later pass
  // can recover the server receipt without applying the score twice.
  const aborted=await fixture(),r=await pilotFor(aborted),abortServer=http(aborted),sent=defer(),late=defer(),controller=new AbortController();abortServer.post=async()=>{sent.resolve();return late.promise};globalThis.fetch=abortServer.fetch;
  const running=r.pilot.manualDeliver(r.scope,{...abortServer.request,signal:controller.signal});await sent.promise;controller.abort();assert.equal((await running).phase,'cancelled');late.resolve(response(abortServer.receipts.get(aborted.ops[0].operationId)));await turn();
  let queued=await r.raw.documents.read('game-outbox:'+aborted.profile);assert.equal(queued.value.games[0].operations[0].status,'uncertain');abortServer.post=null;assert.equal((await r.pilot.manualDeliver(r.scope,abortServer.request)).phase,'synced');assert.equal(abortServer.effects,1);await r.pilot.close();
  // Capability/profile failures never dispatch a mutation or use legacy routes.
  for(const mismatch of [false,true]){const data=await fixture(),a=await pilotFor(data),s=http(data);s.account=mismatch?status('another-profile'):{...status(data.profile),gameOperations:null};globalThis.fetch=s.fetch;const result=await a.pilot.manualDeliver(a.scope,s.request);assert.equal(result.phase,mismatch?'sign-in-required':'unavailable');assert.equal(s.calls.filter(c=>c.method==='POST').length,0);assert.ok(s.calls.every(c=>c.url.endsWith('/account')));await a.pilot.close()}
  // Cold restored read access cannot acquire a delivery token or mutate a queue.
  const cold=await fixture(),offline=createRepositoryPilot({enabled:true,deliveryEnabled:true,open,onInvalidated:()=>{}});offline.select(cold.selector);const coldScope=offline.capture();await offline.readGame(coldScope,cold.games[0].id);assert.equal((await offline.manualDeliver(coldScope,{base:'https://manual.example.test',getToken:async()=>assert.fail()})).phase,'sign-in-required');await offline.close();
  // The write-side guard is transactional: a collision inserted after enqueue
  // validation must roll back its projection/operation; all later work pauses.
  const raceData=await fixture(),raceRepo=await open(),raceAccess=createDurableAccountRepository(raceRepo),raceLease=await raceAccess.verify(await raceAccess.restore(raceData.selector),status(raceData.profile)),raceOut=raceAccess.outbox(raceLease),raceBefore=await raceRepo.documents.read('game-outbox:'+raceData.profile),write=raceRepo.documents.write;let inject=true;
  raceRepo.documents.write=async(key,...args)=>{if(key==='game-outbox:'+raceData.profile&&inject){inject=false;await collide(raceRepo,raceData)}return write(key,...args)};
  await rejects(()=>raceOut.enqueue({...raceData.ops[0],operationId:randomUUID(),command:{...raceData.ops[0].command,expectedVersion:2,entryId:randomUUID()}}),'STORAGE_CONFLICT');assert.deepEqual(await raceRepo.documents.read('game-outbox:'+raceData.profile),raceBefore);await rejects(()=>raceOut.prepareDelivery(raceData.games[0].id,cap),'NEEDS_REVIEW');await rejects(()=>raceOut.settle(raceData.games[0].id),'NEEDS_REVIEW');await rejects(()=>raceOut.seedConfirmed(raceData.games[0].id),'NEEDS_REVIEW');await raceAccess.close();
  // Known collision pauses only that game, and protects new scoring/compaction.
  const mixed=await fixture(2),m=await pilotFor(mixed),mixedServer=http(mixed);await collide(m.raw,mixed);globalThis.fetch=mixedServer.fetch;assert.equal((await m.pilot.manualDeliver(m.scope,mixedServer.request)).phase,'needs-review');assert.equal(mixedServer.calls.filter(c=>c.method==='POST').length,1);assert.equal(JSON.parse(mixedServer.calls.find(c=>c.method==='POST').wire).gameId,mixed.games[1].id);assert.equal((await m.pilot.readGame(m.scope,mixed.games[0].id)).sync,'needs-review');await m.pilot.close();
  // If a collision appears during an in-flight POST, retain a received receipt;
  // if its response is lost, stop retries. Neither path compacts review evidence.
  for(const lost of [false,true]){const data=await fixture(),a=await pilotFor(data),s=http(data);s.post=async(_wire,ack)=>{await collide(a.raw,data);if(lost)throw TypeError('response lost');return response(ack)};globalThis.fetch=s.fetch;const result=await a.pilot.manualDeliver(a.scope,s.request);assert.equal(result.phase,'needs-review');assert.equal(s.calls.filter(c=>c.method==='POST').length,1);const stored=await a.raw.documents.read('game-outbox:'+data.profile);assert.equal(stored.value.games[0].operations[0].status,lost?'uncertain':'applied');assert.equal(stored.value.games[0].projection.game.entries.length,1);assert.equal(stored.value.archive.length,0);assert.ok(await a.raw.documents.read(gameCollisionKey(data.profile,data.games[0].id)));await a.pilot.close()}
  // The direct coordinator snapshot path persists same-version evidence too.
  const contradictory=await fixture(),c=await pilotFor(contradictory),cs=http(contradictory);cs.get=async()=>response(gameView({...contradictory.games[0],name:'Conflicting snapshot'}));globalThis.fetch=cs.fetch;assert.equal((await c.pilot.manualDeliver(c.scope,cs.request)).phase,'needs-review');const marker=await c.raw.documents.read(gameCollisionKey(contradictory.profile,contradictory.games[0].id));assert.ok(marker);assert.equal((await c.pilot.manualDeliver(c.scope,cs.request)).phase,'needs-review');assert.equal(cs.calls.filter(x=>x.method==='POST').length,1);await c.pilot.close();
  console.log(name+': default inactivity, pinned-token manual HTTP, coalescing, immutable retry, nonblocking reads/sign-out, abort/late-result recovery, profile/capability/cold-restore gates and collision receipt preservation passed.');
 }
 // Exercise the actual web/mobile connection functions: automatic refreshes
 // remain read-only, explicit requests invoke the bridge, and known tombstones
 // suppress a stale game GET rather than resurrecting the selected screen.
 const ts=require(path.join(process.cwd(),'node_modules/typescript')),{ScorekeeperApi}=require(path.join(root,'api.js')),{readAccountSnapshot}=require(path.join(root,'account-refresh.js')),{observeGameScreen,gameScreenMessage}=require(path.join(root,'repository/game-screen.js'));
 for(const [file,native]of [['app/cloud/CloudHome.tsx',false],['mobile/App.tsx',true]])for(const manual of [false,true])for(const deleted of [false,true]){
  const players=[{id:randomUUID(),name:'One'},{id:randomUUID(),name:'Two'}],g={id:randomUUID(),name:'Shell fixture',players,winner:'high',entries:[],next:players[0].id,finished:false,version:1,updated:'2026-10-19T00:00:00Z'},view=gameView(g),retained=deleted?{kind:'deleted',serverVersion:2}:{kind:'game',source:'cache',sync:'confirmed',view,pendingOperations:0,serverVersion:1};
  const connection=createConnectionStatus(),owner={current:native?1:'A'},scope={selector:native?'native-profile:A':'A',generation:1},context={current:{view,creating:false,points:'',edit:null,editingGame:null,reordering:false}};let delivered=0,pinned=0,selected=view,games=[],accountRead=null;const calls=[];
  const user={homeAccountId:'A'},authClient={getActiveAccount:()=>user,acquireTokenSilent:async args=>{assert.equal(args.account,user);pinned++;return {accessToken:'captured-token'}}};
  globalThis.fetch=async(url,opts)=>{calls.push({url,method:opts.method});assert.equal(opts.method,'GET');return response(url.endsWith('/account')?{...status('A'),scoringRulesVersion:3}:url.endsWith('/games')?[{...g,turnCount:0}]:view)};
  const pilot={ref:{current:{prepare:async()=>scope,verify:async()=>{},readGame:async()=>retained,record:async()=>{},capture:()=>scope,manualDeliver:async(_scope,request)=>{delivered++;assert.equal(_scope,scope);assert.equal(await request.getToken({selector:scope.selector,profileId:'A'},new AbortController().signal),'captured-token');request.onState({phase:'synced'});return {phase:'synced'}}}}};
  const session={current:{profileId:'A'}},nop=()=>{},deps={canUseAccount:()=>true,manualSync:createManualSync(),gameDeliveryPilot:true,gameScreenPilot:true,identity:owner,identityRevision:owner,current:session,locked:{current:false},accountBarrier:{current:false},mounted:{current:true},activity:{current:0},activityRevision:{current:0},context,foregroundContext:context,foregroundFlight:{current:false},connection,pilot,cloudConfig:{api:'https://shell.example.test/api',scope:'scope'},apiUrl:'https://shell.example.test/api',preparePilot:async()=>scope,auth:async()=>authClient,token:async()=>'captured-token',latestToken:{current:async()=>'captured-token'},restoreGame:{current:null},recoveryDraft:{current:null},restoringScoreDraft:{current:false},AsyncStorage:{removeItem:async()=>{}},sessionStorage:{removeItem:nop},localStorage:{setItem:nop},cloudApi:{},localApi:{list:async()=>[]},listCache:{write:async()=>{}},gameListCache:{write:async()=>{}},ScorekeeperApi,readAccountSnapshot,observeGameScreen,gameScreenMessage,runManualDelivery,mergeDeviceGames:(saved,locals)=>[...saved,...locals],setRulesEnabled:nop,setPullRefreshing:nop,setForegroundSyncing:nop,setNotice:nop,setLocalCount:nop,setBlockedLocalCount:nop,needsAdvancedRules:()=>false,pendingImports:async()=>[],setFrequentPlayersAccount:async()=>{},syncFrequentPlayers:async()=>{},persist:async s=>{session.current=s},setGames:value=>games=typeof value==='function'?value(games):value,setView:value=>{selected=value;context.current.view=value},setAccountRead:value=>accountRead=value};
  connection.reset(native?'1':'A');const name=native?'refresh':'syncGames',source=readFileSync(file,'utf8'),start=source.indexOf(' async function '+name+'('),end=source.indexOf('\n async function ',start+10);assert.ok(start>=0&&end>start);const compiled=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,work=new Function(...Object.keys(deps),compiled+';return '+name)(...Object.values(deps));
  assert.equal(await (native?work(false,manual):work(manual)),true);assert.equal(delivered,manual?1:0,file+' automatic refresh must not deliver');if(!native)assert.equal(pinned,manual?1:0);
  assert.equal(calls.filter(c=>c.url.endsWith('/games/'+g.id)).length,deleted?0:1);if(deleted){assert.equal(selected,null);assert.equal(accountRead.kind,'deleted');assert.equal(games.length,0)}else assert.equal(selected.game.id,g.id);
 }
 console.log('Web/iPhone shell integration: automatic reads, explicit manual bridge, captured tokens, known-deletion GET suppression and screen/list adoption passed.');
 // Explicit intents are not swallowed by an existing read-only refresh; repeated
 // gestures share a pass, and an account switch discards a waiting intention.
 const connection=createConnectionStatus(),intent=createManualSync(),reading=defer();connection.reset('A');let manualPasses=0;
 const read=connection.connect(async()=>reading.promise),work=()=>connection.connect(async(_valid,_signal,_step,report)=>{manualPasses++;report({phase:'needs-review',pending:1})});
 const manual=intent.run('A',()=>true,connection.whenIdle,work);assert.equal(intent.run('A',()=>true,connection.whenIdle,work),manual);await turn();assert.equal(manualPasses,0);reading.resolve();await read;assert.equal(await manual,true);assert.equal(manualPasses,1);assert.ok(connectionText(connection.getSnapshot()).includes('review'));
 const waiting=defer();let current=true;const skipped=intent.run('A',()=>current,()=>waiting.promise,async()=>{assert.fail()});current=false;waiting.resolve();assert.equal(await skipped,false);
 let lateReport;await connection.connect(async(_v,_s,_st,report)=>{lateReport=report});connection.reset('B');lateReport({phase:'synced'});assert.equal(connection.getSnapshot().delivery,undefined);
 assert.ok(manualDeliveryText({phase:'pending'}).includes('waiting'));await rejects(()=>runManualDelivery({manualDeliver:async()=>({phase:'sign-in-required'})},null,{}),'SIGN_IN_REQUIRED');
 console.log('Manual intent/status: waits for read-only refresh, coalesces repeated gestures, drops stale accounts, scopes progress and distinguishes pending/review from confirmation.');
}finally{globalThis.fetch=originalFetch;rmSync(root,{recursive:true,force:true})}
