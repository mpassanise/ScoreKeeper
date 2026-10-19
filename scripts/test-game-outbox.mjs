import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {IDBFactory,IDBObjectStore} from '../tests/offline/node_modules/fake-indexeddb/build/esm/index.js';
const root=mkdtempSync(path.join(tmpdir(),'scorekeeper-outbox-'));
try{
 execFileSync(process.execPath,['node_modules/typescript/bin/tsc','shared/repository/durable-account.ts','shared/repository/indexeddb-confirmed-games.ts','shared/repository/sqlite-confirmed-games.ts','--target','ES2022','--module','commonjs','--moduleResolution','node','--strict','--skipLibCheck','--outDir',root],{stdio:'inherit'});
 writeFileSync(path.join(root,'package.json'),'{"type":"commonjs"}');const require=createRequire(import.meta.url);
 const {createDurableAccountRepository}=require(path.join(root,'repository/durable-account.js')),{openConfirmedGames}=require(path.join(root,'repository/indexeddb-confirmed-games.js')),{openSQLiteConfirmedGames}=require(path.join(root,'repository/sqlite-confirmed-games.js')),{gameView}=require(path.join(root,'local-games.js'));
 const rejects=(fn,code)=>assert.rejects(async()=>fn(),e=>e.code===code),status=profileId=>({profileId,deletionStatus:null,deletionEnabled:true});
 const cap={version:1,receipts:'retained',atomicGameAndReceipt:true,kinds:['action','create','import','delete'],actions:['score','edit','undo','select','rules','finish','resume']};
 const makeGame=()=>({id:randomUUID(),name:'Original',players:[{id:randomUUID(),name:'One'},{id:randomUUID(),name:'Two'}],winner:'high',entries:[],next:'',finished:false,version:1,updated:'2026-10-19T00:00:00Z',playStyle:'free',scoreMode:'add'});
 function base(){const g=makeGame();g.next=g.players[0].id;return g}
 const score=(g,version,points=10,entryId=randomUUID())=>({protocolVersion:1,kind:'action',operationId:randomUUID(),gameId:g.id,command:{action:'score',expectedVersion:version,points,playerId:g.players[0].id,entryId}});
 const ack=op=>({operationId:op.operationId,gameId:op.gameId,outcome:'applied',committedVersion:(op.command?.expectedVersion??op.expectedVersion)+1,observedVersion:(op.command?.expectedVersion??op.expectedVersion)||null,errorCode:null});
 const factory=new IDBFactory(),file=path.join(root,'native.db');let fail=false;
 function queries(db){return {execAsync:async sql=>db.exec(sql),runAsync:async(sql,...p)=>{if(fail&&sql.startsWith('INSERT INTO repository_metadata'))throw Error('disk full');return db.prepare(sql).run(...p)},getFirstAsync:async(sql,...p)=>db.prepare(sql).get(...p)||null,getAllAsync:async(sql,...p)=>db.prepare(sql).all(...p)}}
 function sqlite(){const db=new DatabaseSync(file);return {...queries(db),closeAsync:async()=>db.close(),withExclusiveTransactionAsync:async work=>{const tx=new DatabaseSync(file);try{tx.exec('BEGIN');try{await work(queries(tx));tx.exec('COMMIT')}catch(e){tx.exec('ROLLBACK');throw e}}finally{tx.close()}}}}
 const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(fail&&this.name==='repositoryMetadata')throw new DOMException('full','QuotaExceededError');return put.apply(this,args)};
 try{for(const [name,open]of [['IndexedDB',()=>openConfirmedGames(factory,'queue')],['SQLite',()=>openSQLiteConfirmedGames(sqlite())]]){
  let repo=await open(),access=createDurableAccountRepository(repo),lease;
  async function verify(profile='A'){const ticket=await access.beginVerification('selector-'+profile,profile);lease=await access.verify(ticket,status(profile));return access.outbox(lease)}
  let out=await verify(),g=base();await access.saveConfirmed(lease,[gameView(g)]);await out.seedConfirmed(g.id);await rejects(()=>out.seedConfirmed(randomUUID()),'NEEDS_REVIEW');
  const first=score(g,1),wire=JSON.stringify(first),writing=out.enqueue(first);first.command.points=99;await writing;first.command.points=10;
  assert.equal((await out.read()).games[0].projection.totals[g.next],10,'caller mutation cannot change queued request');
  await out.enqueue(first);assert.equal((await out.read()).games[0].operations.length,1,'identical local retry is idempotent');await rejects(()=>out.enqueue({...first,command:{...first.command,points:8}}),'OPERATION_ID_REUSED');
  const before=await repo.documents.read('game-outbox:A');fail=true;await rejects(()=>out.enqueue(score(g,2)),'STORAGE_UNAVAILABLE');fail=false;assert.deepEqual(await repo.documents.read('game-outbox:A'),before,'queue and projection roll back together');
  const second=score(g,2,0),write=repo.documents.write;let lose=true;
  repo.documents.write=async(...args)=>{const result=await write(...args);if(lose&&args[0].startsWith('game-outbox:')){lose=false;throw Error('lost local commit response')}return result};
  await assert.rejects(()=>out.enqueue(second));repo.documents.write=write;await out.enqueue(second);assert.equal((await out.read()).games[0].operations.length,2,'lost local acknowledgement never duplicates score');
  assert.deepEqual((await repo.readConfirmed('A',g.id)).view,gameView(g),'optimistic score never replaces confirmed base');
  access.connectionUnavailable(lease);await rejects(()=>out.prepareDelivery(g.id,cap),'SYNC_UNAVAILABLE');await out.enqueue(score(g,3,5));
  await access.close();repo=await open();access=createDurableAccountRepository(repo);lease=await access.restore('selector-A');out=access.outbox(lease);assert.equal((await out.read()).games[0].operations.length,3,'reopen retains pending requests and projection');await rejects(()=>out.enqueue(score(g,4)),'SYNC_UNAVAILABLE');await rejects(()=>out.prepareDelivery(g.id,cap),'SYNC_UNAVAILABLE');
  out=await verify();await rejects(()=>out.prepareDelivery(g.id,null),'CAPABILITY_REQUIRED');assert.equal(await out.prepareDelivery(g.id,cap),wire);assert.equal((await out.read()).games[0].operations[0].status,'uncertain');
  // Fake receipt server stands in for the separately SQL-tested HTTP transaction.
  const receipts=new Map();let effects=0;function server(raw){const op=JSON.parse(raw);if(!receipts.has(op.operationId)){receipts.set(op.operationId,ack(op));effects++}return receipts.get(op.operationId)}
  const response=server(wire);await access.close();repo=await open();access=createDurableAccountRepository(repo);out=await verify();const retry=await out.prepareDelivery(g.id,cap);assert.equal(retry,wire);assert.deepEqual(server(retry),response);assert.equal(effects,1,'lost network response recovers identical receipt');
  await rejects(()=>out.acknowledge(first.operationId,{...response,gameId:randomUUID()}),'INVALID_ACKNOWLEDGEMENT');await rejects(()=>out.acknowledge(first.operationId,{...response,committedVersion:99}),'INVALID_ACKNOWLEDGEMENT');
  fail=true;await rejects(()=>out.acknowledge(first.operationId,response),'STORAGE_UNAVAILABLE');fail=false;assert.equal((await out.read()).games[0].operations[0].status,'uncertain');await out.acknowledge(first.operationId,response);await out.acknowledge(first.operationId,response);
  assert.equal(await out.prepareDelivery(g.id,cap),JSON.stringify(second),'only acknowledged head unlocks next operation');await out.acknowledge(second.operationId,server(JSON.stringify(second)));
  const thirdWire=await out.prepareDelivery(g.id,cap),third=JSON.parse(thirdWire);await out.enqueue(score(g,4,3));
  const conflict={...ack(third),outcome:'rejected',committedVersion:null,observedVersion:7,errorCode:'VERSION_CONFLICT'};await out.acknowledge(third.operationId,conflict);await rejects(()=>out.prepareDelivery(g.id,cap),'NEEDS_REVIEW');await rejects(()=>out.enqueue(score(g,5)),'NEEDS_REVIEW');
  assert.equal((await out.read()).games[0].operations[3].status,'queued','dependant is preserved, not discarded/rebased');
  // Stable creation/import/deletion and explicit undo targets use the same queue.
  const created=base(),create={protocolVersion:1,kind:'create',operationId:randomUUID(),gameId:created.id,expectedVersion:0,game:created};await out.enqueue(create);await rejects(()=>out.prepareDelivery(created.id,{...cap,kinds:undefined}),'CAPABILITY_REQUIRED');await out.prepareDelivery(created.id,cap);await out.acknowledge(create.operationId,ack(create));
  const add=score(created,1,12);await out.enqueue(add);const undo={protocolVersion:1,kind:'action',operationId:randomUUID(),gameId:created.id,command:{action:'undo',expectedVersion:2,entryId:add.command.entryId}};await rejects(()=>out.enqueue({...undo,command:{...undo.command,entryId:randomUUID()}}),'INVALID_OPERATION');await out.enqueue(undo);await rejects(()=>out.enqueue(score(created,3,1,add.command.entryId)),'INVALID_OPERATION');
  const imported=base();imported.entries=[{id:randomUUID(),playerId:imported.next,points:15}];imported.version=12;const imp={protocolVersion:1,kind:'import',operationId:randomUUID(),gameId:imported.id,expectedVersion:0,game:imported};await out.enqueue(imp);await out.enqueue({protocolVersion:1,kind:'delete',operationId:randomUUID(),gameId:imported.id,expectedVersion:1});assert.equal((await out.read()).games.find(x=>x.gameId===imported.id).projection,null,'delete projection hides game but retains queue/history');
  const total=base();total.scoreMode='total';await out.enqueue({protocolVersion:1,kind:'create',operationId:randomUUID(),gameId:total.id,expectedVersion:0,game:total});await out.enqueue(score(total,1,30));await out.enqueue(score(total,2,40));assert.equal((await out.read()).games.find(x=>x.gameId===total.id).projection.totals[total.next],40,'total mode remains current-total semantics');
  const parallelRepo=await open(),parallelAccess=createDurableAccountRepository(parallelRepo),parallelTicket=await parallelAccess.beginVerification('selector-A','A'),parallelLease=await parallelAccess.verify(parallelTicket,status('A'));
  // Two independent instances of the same verified session race a different score at the same version.
  const sameSessionOut=parallelAccess.outbox(parallelLease),concurrentA=score(total,3,1),concurrentB=score(total,3,2);
  const collision=await Promise.allSettled([sameSessionOut.enqueue(concurrentA),sameSessionOut.enqueue(concurrentB)]);assert.equal(collision.filter(r=>r.status==='fulfilled').length,1);assert.ok(['STORAGE_CONFLICT','STORAGE_UNAVAILABLE','NEEDS_REVIEW'].includes(collision.find(r=>r.status==='rejected').reason.code));
  const winner=collision[0].status==='fulfilled'?concurrentA:concurrentB;await sameSessionOut.enqueue(winner);assert.equal((await sameSessionOut.read()).games.find(x=>x.gameId===total.id).operations.length,4,'CAS race retains one stable score');await parallelAccess.close();out=await verify();
  await rejects(()=>out.enqueue({...score(total,4),command:{action:'undo',expectedVersion:4}}),'INVALID_OPERATION');
  const badRules={protocolVersion:1,kind:'action',operationId:randomUUID(),gameId:total.id,command:{action:'rules',expectedVersion:4,rules:{name:'Rule edit',winner:'high',endCondition:'manual',roundLimit:'12'}}};await rejects(()=>out.enqueue(badRules),'INVALID_OPERATION');
  const badHistory=base();badHistory.finishReason='unexpected';await rejects(()=>out.enqueue({protocolVersion:1,kind:'import',operationId:randomUUID(),gameId:badHistory.id,expectedVersion:0,game:badHistory}),'INVALID_OPERATION');
  const extraFields=base();extraFields.players[0].account='unexpected';await rejects(()=>out.enqueue({protocolVersion:1,kind:'import',operationId:randomUUID(),gameId:extraFields.id,expectedVersion:0,game:extraFields}),'INVALID_OPERATION');
  // Lifecycle CAS is checked inside the write transaction, not just before it.
  const independentRepo=await open(),independent=createDurableAccountRepository(independentRepo),saved=await repo.documents.read('game-outbox:A');
  const raceRepo=await open(),raceAccess=createDurableAccountRepository(raceRepo),raceLease=await raceAccess.restore('selector-A');const originalRaceWrite=raceRepo.documents.write;
  const raceTicket=await raceAccess.beginVerification('selector-A','A'),activeRace=await raceAccess.verify(raceTicket,status('A')),activeOther=await independent.restore('selector-A');
  raceRepo.documents.write=async(...args)=>{if(args[0].startsWith('game-outbox:'))await independent.signOut(activeOther);return originalRaceWrite(...args)};
  await rejects(()=>raceAccess.outbox(activeRace).enqueue(score(total,4,1)),'STORAGE_CONFLICT');assert.deepEqual(await raceRepo.documents.read('game-outbox:A'),saved,'sign-out race cannot commit queued score or projection');await raceAccess.close();await independent.close();
  await rejects(()=>out.acknowledge(first.operationId,response),'STALE_ACCOUNT');out=await verify('B');assert.equal((await out.read()).games.length,0,'new account never sees former account queue');await access.beginDeletion(lease);await rejects(()=>out.read(),'STALE_ACCOUNT');
  out=await verify('A');const corrupt=await repo.documents.read('game-outbox:A');corrupt.value.games[0].projection.totals[g.next]=999;await repo.documents.write('game-outbox:A',corrupt.revision,corrupt.value);await rejects(()=>out.read(),'STORAGE_CORRUPT');assert.equal((await repo.documents.read('game-outbox:A')).value.games[0].projection.totals[g.next],999,'corruption is retained for recovery');
  await access.close();console.log(name+': atomic queue/projection, stable IDs, rollback, lost local/network acknowledgements, reopen recovery, ordered delivery, terminal conflict/dependants, lifecycle operations, total scoring, lifecycle transaction guard and account isolation passed.');
 }}finally{IDBObjectStore.prototype.put=put;fail=false}
 for(const mode of ['before','after']){
  const crashFile=path.join(root,'crash-'+mode+'.db');
  function connection(filename){const db=new DatabaseSync(filename);return {...queries(db),closeAsync:async()=>db.close(),withExclusiveTransactionAsync:async work=>{const tx=new DatabaseSync(filename);try{tx.exec('BEGIN');try{await work(queries(tx));tx.exec('COMMIT')}catch(e){tx.exec('ROLLBACK');throw e}}finally{tx.close()}}}}
  let repo=await openSQLiteConfirmedGames(connection(crashFile)),access=createDurableAccountRepository(repo);const ticket=await access.beginVerification('selector-A','A'),lease=await access.verify(ticket,status('A')),out=access.outbox(lease),g=base();await access.saveConfirmed(lease,[gameView(g)]);await out.seedConfirmed(g.id);await access.close();const op=score(g,1,7);
  const child=path.join(root,'crash.cjs');writeFileSync(child,`
   const {DatabaseSync}=require('node:sqlite');
   const {openSQLiteConfirmedGames}=require('./repository/sqlite-confirmed-games.js');
   const {createDurableAccountRepository}=require('./repository/durable-account.js');
   const file=process.argv[2],mode=process.argv[3],op=JSON.parse(process.argv[4]);let armed=false;
   function queries(db){return {execAsync:async sql=>db.exec(sql),runAsync:async(sql,...p)=>{const result=db.prepare(sql).run(...p);if(p[0]==='game-outbox:A'){armed=true;if(mode==='before')process.kill(process.pid,'SIGKILL')}return result},getFirstAsync:async(sql,...p)=>db.prepare(sql).get(...p)||null,getAllAsync:async(sql,...p)=>db.prepare(sql).all(...p)}}
   const db=new DatabaseSync(file),connection={...queries(db),closeAsync:async()=>db.close(),withExclusiveTransactionAsync:async work=>{const tx=new DatabaseSync(file);tx.exec('BEGIN');await work(queries(tx));tx.exec('COMMIT');if(armed&&mode==='after')process.kill(process.pid,'SIGKILL');tx.close()}};
   (async()=>{const repo=await openSQLiteConfirmedGames(connection),access=createDurableAccountRepository(repo),ticket=await access.beginVerification('selector-A','A'),lease=await access.verify(ticket,{profileId:'A',deletionStatus:null,deletionEnabled:true});await access.outbox(lease).enqueue(op);process.exit(5)})().catch(e=>{console.error(e);process.exit(6)});
  `);
  const killed=spawnSync(process.execPath,[child,crashFile,mode,JSON.stringify(op)],{encoding:'utf8'});assert.equal(killed.signal,'SIGKILL',killed.stderr);
  repo=await openSQLiteConfirmedGames(connection(crashFile));access=createDurableAccountRepository(repo);const recoveredTicket=await access.beginVerification('selector-A','A'),recoveredLease=await access.verify(recoveredTicket,status('A')),recovered=access.outbox(recoveredLease),stored=(await recovered.read()).games[0];
  assert.equal(stored.operations.length,mode==='before'?0:1);assert.equal(stored.projection.totals[g.next],mode==='before'?0:7);await recovered.enqueue(op);assert.equal((await recovered.read()).games[0].operations.length,1);await access.close();
 }
 console.log('SQLite abrupt process death before/after queue commit: atomic rollback/durability and identical-request retry passed. Physical iPhone acceptance remains open.');
}finally{rmSync(root,{recursive:true,force:true})}
