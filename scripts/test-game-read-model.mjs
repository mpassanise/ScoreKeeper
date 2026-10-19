import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {IDBFactory} from '../tests/offline/node_modules/fake-indexeddb/build/esm/index.js';
const root=mkdtempSync(path.join(tmpdir(),'scorekeeper-reads-'));
try{
 execFileSync(process.execPath,['node_modules/typescript/bin/tsc','shared/repository/pilot.ts','shared/repository/indexeddb-confirmed-games.ts','shared/repository/sqlite-confirmed-games.ts','--target','ES2022','--module','commonjs','--moduleResolution','node','--strict','--skipLibCheck','--outDir',root],{stdio:'inherit'});
 writeFileSync(path.join(root,'package.json'),'{"type":"commonjs"}');const require=createRequire(import.meta.url);
 const {createDurableAccountRepository}=require(path.join(root,'repository/durable-account.js'));
 const {createRepositoryPilot}=require(path.join(root,'repository/pilot.js'));
 const {openConfirmedGames}=require(path.join(root,'repository/indexeddb-confirmed-games.js'));
 const {openSQLiteConfirmedGames}=require(path.join(root,'repository/sqlite-confirmed-games.js'));
 const {gameView}=require(path.join(root,'local-games.js'));
 const status=profileId=>({profileId,deletionStatus:null,deletionEnabled:true});
 const cap={version:1,receipts:'retained',atomicGameAndReceipt:true,kinds:['action','create','import','delete'],actions:['score','edit','undo','select','rules','finish','resume']};
 function base(){const players=[{id:randomUUID(),name:'One'},{id:randomUUID(),name:'Two'}];return {id:randomUUID(),name:'Game',players,winner:'high',entries:[],next:players[0].id,finished:false,version:1,updated:'2026-10-19T00:00:00Z',playStyle:'free',scoreMode:'add'}}
 const score=(g,v,points=10)=>({protocolVersion:1,kind:'action',operationId:randomUUID(),gameId:g.id,command:{action:'score',expectedVersion:v,points,playerId:g.next,entryId:randomUUID()}});
 const ack=op=>({operationId:op.operationId,gameId:op.gameId,outcome:'applied',committedVersion:(op.command?.expectedVersion??op.expectedVersion)+1,observedVersion:(op.command?.expectedVersion??op.expectedVersion)||null,errorCode:null});
 const rejects=(fn,code)=>assert.rejects(fn,e=>e.code===code);
 let opens=0;const disabled=createRepositoryPilot({enabled:false,open:async()=>{opens++;throw Error('disabled')},onInvalidated:()=>assert.fail()});
 assert.equal(await disabled.readGame(null,'anything'),null);await disabled.record(null,gameView(base()));assert.equal(opens,0);await disabled.close();
 const factory=new IDBFactory(),file=path.join(root,'native.db');
 function queries(db){return {execAsync:async sql=>db.exec(sql),runAsync:async(sql,...p)=>db.prepare(sql).run(...p),getFirstAsync:async(sql,...p)=>db.prepare(sql).get(...p)||null,getAllAsync:async(sql,...p)=>db.prepare(sql).all(...p)}}
 function sqlite(){const db=new DatabaseSync(file);return {...queries(db),closeAsync:async()=>db.close(),withExclusiveTransactionAsync:async work=>{const tx=new DatabaseSync(file);try{tx.exec('BEGIN');try{await work(queries(tx));tx.exec('COMMIT')}catch(e){tx.exec('ROLLBACK');throw e}}finally{tx.close()}}}}
 for(const [name,open]of [['IndexedDB',()=>openConfirmedGames(factory,'read-model')],['SQLite',()=>openSQLiteConfirmedGames(sqlite())]]){
  let repo=await open(),access=createDurableAccountRepository(repo),lease=await access.verify(await access.beginVerification('selector-A','A'),status('A'));
  const g=base(),original=gameView(g);assert.deepEqual(await access.readGame(lease,g.id),{kind:'missing'});
  await access.observeGame(lease,original);let read=await access.readGame(lease,g.id);assert.equal(read.source,'cache');assert.equal(read.sync,'confirmed');read.view.game.name='Caller mutation';assert.equal((await access.readGame(lease,g.id)).view.game.name,'Game');
  let out=access.outbox(lease);await out.seedConfirmed(g.id);const first=score(g,1),second=score(g,2,0);await out.enqueue(first);await out.enqueue(second);
  const projection=(await out.read()).games[0].projection,server=gameView({...projection.game,updated:'2026-10-19T01:00:00Z'});
  const before=await repo.documents.read('game-outbox:A');read=await access.readGame(lease,g.id);assert.equal(read.source,'queue');assert.equal(read.sync,'pending');assert.equal(read.pendingOperations,2);assert.equal(read.serverVersion,1);assert.deepEqual(read.view,projection);assert.deepEqual(await repo.documents.read('game-outbox:A'),before,'reads never write or settle');read.view.game.name='Queue caller mutation';assert.equal((await access.readGame(lease,g.id)).view.game.name,'Game');
  // Matching server content cannot acknowledge uncertain outcomes or replace the device projection.
  await out.prepareDelivery(g.id,cap);await access.observeGame(lease,server);read=await access.readGame(lease,g.id);assert.equal(read.sync,'pending');assert.deepEqual(read.view,projection);assert.equal((await access.readConfirmed(lease,g.id)).serverVersion,1,'generic cache is not overwritten for tracked games');
  await access.close();repo=await open();access=createDurableAccountRepository(repo);lease=await access.restore('selector-A');out=access.outbox(lease);
  assert.deepEqual((await access.readGame(lease,g.id)).view,projection,'pending projection survives restart');await rejects(()=>access.observeGame(lease,server),'SYNC_UNAVAILABLE');await rejects(()=>out.enqueue(score(g,3)),'SYNC_UNAVAILABLE');
  lease=await access.verify(lease,status('A'));out=access.outbox(lease);await out.acknowledge(first.operationId,ack(first));await out.prepareDelivery(g.id,cap);await out.acknowledge(second.operationId,ack(second));assert.equal((await access.readGame(lease,g.id)).sync,'pending','receipts alone do not become a confirmed snapshot');
  await access.observeGame(lease,server);read=await access.readGame(lease,g.id);assert.equal(read.sync,'confirmed');assert.equal(read.source,'queue');assert.equal(read.serverVersion,3);assert.equal(read.pendingOperations,0);assert.equal(read.view.game.entries.length,2);await access.observeGame(lease,server);assert.equal((await out.read()).archive[0].operations.length,2,'repeat refresh does not duplicate scores or archives');
  // A pending delete and a receipt-backed tombstone both suppress an old live cache row.
  const deleted=base();await access.observeGame(lease,gameView(deleted));await out.seedConfirmed(deleted.id);const deletion={protocolVersion:1,kind:'delete',operationId:randomUUID(),gameId:deleted.id,expectedVersion:1};await out.enqueue(deletion);
  assert.equal((await access.readGame(lease,deleted.id)).kind,'pending-delete');await access.observeGame(lease,gameView(deleted));assert.equal((await access.readGame(lease,deleted.id)).kind,'pending-delete');await out.prepareDelivery(deleted.id,cap);await out.acknowledge(deletion.operationId,ack(deletion));assert.equal((await access.readGame(lease,deleted.id)).kind,'pending-delete');await out.settle(deleted.id);assert.deepEqual(await access.readGame(lease,deleted.id),{kind:'deleted',serverVersion:2});assert.ok(await access.readConfirmed(lease,deleted.id));await rejects(()=>access.observeGame(lease,gameView(deleted)),'NEEDS_REVIEW');
  // Applied-receipt mismatch and terminal rejection both expose review without discarding local work.
  const mismatch=base();await access.observeGame(lease,gameView(mismatch));await out.seedConfirmed(mismatch.id);const m=score(mismatch,1);await out.enqueue(m);await out.prepareDelivery(mismatch.id,cap);await out.acknowledge(m.operationId,ack(m));await rejects(()=>access.observeGame(lease,gameView({...mismatch,version:2})),'NEEDS_REVIEW');assert.equal((await access.readGame(lease,mismatch.id)).sync,'needs-review');
  const conflict=base();await access.observeGame(lease,gameView(conflict));await out.seedConfirmed(conflict.id);const c=score(conflict,1);await out.enqueue(c);await out.prepareDelivery(conflict.id,cap);await out.acknowledge(c.operationId,{...ack(c),outcome:'rejected',committedVersion:null,observedVersion:5,errorCode:'VERSION_CONFLICT'});await access.observeGame(lease,gameView({...conflict,version:5}));assert.equal((await access.readGame(lease,conflict.id)).sync,'needs-review');assert.equal((await access.readGame(lease,conflict.id)).view.game.entries.length,1);
  // Repeated reads reuse validation, without skipping storage, identity or byte checks.
  const cachedDocument=await repo.documents.read('game-outbox:A');await repo.documents.write('game-outbox:A',cachedDocument.revision,cachedDocument.value);
  const parse=JSON.parse;let wireParses=0;
  JSON.parse=function(text,...rest){if(typeof text==='string'&&text.startsWith('{"protocolVersion":1,'))wireParses++;return parse(text,...rest)};
  try{
   const cold=await access.readGame(lease,g.id);assert.ok(wireParses>0,'a new document revision is fully validated');wireParses=0;
   cold.view.game.entries.length=0;assert.equal((await access.readGame(lease,g.id)).view.game.entries.length,2,'cached views remain detached');
   await access.readGame(lease,randomUUID());assert.equal(wireParses,0,'tracked and untracked reads do not replay an unchanged validated archive');
   const readDocument=repo.documents.read;repo.documents.read=async key=>{const value=await readDocument(key);if(key==='game-outbox:A')value.value.games.find(game=>game.gameId===g.id).reservedEntryIds=[];return value};
   try{await rejects(()=>access.readGame(lease,g.id),'STORAGE_CORRUPT')}finally{repo.documents.read=readDocument}
   wireParses=0;await access.readGame(lease,g.id);assert.ok(wireParses>0,'corruption evicts the cached result');
   // Another handle changes the durable revision, even if the payload is identical.
   const writer=await open(),latest=await writer.documents.read('game-outbox:A');await writer.documents.write('game-outbox:A',latest.revision,latest.value);await writer.close();
   wireParses=0;await access.readGame(lease,g.id);assert.ok(wireParses>0,'external revisions invalidate the read cache');
  }finally{JSON.parse=parse}
  // Corrupt queued metadata cannot silently fall back to an older generic cache.
  const document=await repo.documents.read('game-outbox:A');await repo.documents.write('game-outbox:A',document.revision,{...document.value,schemaVersion:99});await rejects(()=>access.readGame(lease,g.id),'STORAGE_CORRUPT');const corrupt=await repo.documents.read('game-outbox:A');await repo.documents.write('game-outbox:A',corrupt.revision,document.value);
  // If tracking starts during an awaited cache read, recheck before returning cache data.
  const race=base();await access.observeGame(lease,gameView(race));const readCache=repo.readConfirmed;let raceOnce=true;repo.readConfirmed=async(profile,id)=>{const value=await readCache(profile,id);if(id===race.id&&raceOnce){raceOnce=false;await out.seedConfirmed(race.id);await out.enqueue(score(race,1))}return value};
  assert.equal((await access.readGame(lease,race.id)).source,'queue');repo.readConfirmed=readCache;
  // An account switch while cache I/O is pending must discard the result.
  const delayed=base();await access.observeGame(lease,gameView(delayed));let entered,release;const waiting=new Promise(r=>entered=r),unblock=new Promise(r=>release=r);
  repo.readConfirmed=async(profile,id)=>{const value=await readCache(profile,id);if(id===delayed.id){entered();await unblock}return value};
  const delayedRead=access.readGame(lease,delayed.id);await waiting;const revoker=createDurableAccountRepository(await open());await revoker.signOut(await revoker.restore('selector-A'));release();await rejects(()=>delayedRead,'STALE_ACCOUNT');repo.readConfirmed=readCache;await revoker.close();
  // The shared pilot used by both app shells routes authenticated observations through the queue.
  await access.close();let invalidations=0;const pilot=createRepositoryPilot({enabled:true,open,onInvalidated:()=>invalidations++});let scope=await pilot.prepare('selector-A');await pilot.verify(scope,status('A'));
  assert.equal((await pilot.readGame(scope,mismatch.id)).sync,'needs-review');await rejects(()=>pilot.record(scope,gameView({...mismatch,version:2})),'NEEDS_REVIEW');
  const staleScope=scope;pilot.select('selector-B');await rejects(()=>pilot.readGame(staleScope,g.id),'STALE_ACCOUNT');scope=await pilot.prepare('selector-B');await pilot.verify(scope,status('B'));assert.deepEqual(await pilot.readGame(scope,g.id),{kind:'missing'});await rejects(()=>pilot.record(staleScope,server),'STALE_ACCOUNT');
  const other=createDurableAccountRepository(await open());await other.signOut(await other.restore('selector-B'));await rejects(()=>pilot.readGame(scope,g.id),'STALE_ACCOUNT');assert.equal(invalidations,1);await pilot.close();await other.close();
  console.log(name+': cache/queue precedence, detached and read-only reads, uncertain outcomes, restart, receipt/snapshot confirmation, deletion barriers, review evidence, corrupt-store denial, concurrent tracking and shared-pilot account isolation passed.');
 }
}finally{rmSync(root,{recursive:true,force:true})}
