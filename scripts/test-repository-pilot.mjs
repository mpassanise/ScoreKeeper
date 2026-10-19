import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {IDBFactory} from '../tests/offline/node_modules/fake-indexeddb/build/esm/index.js';
const root=mkdtempSync(path.join(tmpdir(),'scorekeeper-pilot-'));
try{
 execFileSync(process.execPath,['node_modules/typescript/bin/tsc','shared/repository/pilot.ts','shared/repository/indexeddb-confirmed-games.ts','shared/repository/sqlite-confirmed-games.ts','--target','ES2022','--module','commonjs','--moduleResolution','node','--strict','--skipLibCheck','--outDir',root],{stdio:'inherit'});
 writeFileSync(path.join(root,'package.json'),'{"type":"commonjs"}');const require=createRequire(import.meta.url);
 const {createRepositoryPilot}=require(path.join(root,'repository/pilot.js')),{createDurableAccountRepository}=require(path.join(root,'repository/durable-account.js')),{openConfirmedGames}=require(path.join(root,'repository/indexeddb-confirmed-games.js')),{openSQLiteConfirmedGames}=require(path.join(root,'repository/sqlite-confirmed-games.js')),{gameView}=require(path.join(root,'local-games.js'));
 const status=profileId=>({profileId,deletionEnabled:true,deletionStatus:null});
 const view=gameView({id:'saved',name:'Original',players:[{id:'p1',name:'One'},{id:'p2',name:'Two'}],winner:'high',entries:[{id:'e1',playerId:'p1',points:5}],next:'p2',finished:false,version:1,updated:'2026-10-18T00:00:00Z'});
 const rejects=(fn,code)=>assert.rejects(fn,e=>e.code===code);
 let opens=0,published=0;const disabled=createRepositoryPilot({enabled:false,open:async()=>{opens++;throw Error('must not open')},publish:()=>published++,onInvalidated:()=>assert.fail()});disabled.select('A');await disabled.prepare('A');await disabled.verify(null,status('A'));await disabled.record(null,view);await disabled.signOut();await disabled.recheck();await disabled.close();assert.equal(opens,0);assert.equal(published,0);
 function queries(db){return {execAsync:async sql=>{db.exec(sql)},runAsync:async(sql,...params)=>db.prepare(sql).run(...params),getFirstAsync:async(sql,...params)=>db.prepare(sql).get(...params)||null,getAllAsync:async(sql,...params)=>db.prepare(sql).all(...params)}}
 const factory=new IDBFactory();
 function sqlite(){const file=path.join(root,'pilot.db'),db=new DatabaseSync(file);return {...queries(db),closeAsync:async()=>db.close(),withExclusiveTransactionAsync:async work=>{const tx=new DatabaseSync(file);try{tx.exec('BEGIN');try{await work(queries(tx));tx.exec('COMMIT')}catch(e){tx.exec('ROLLBACK');throw e}}finally{tx.close()}}}}
 for(const [name,open]of [['IndexedDB',()=>openConfirmedGames(factory,'pilot')],['SQLite',()=>openSQLiteConfirmedGames(sqlite())]]){
  let invalidated=0,notifications=0;const pilot=createRepositoryPilot({enabled:true,open,publish:()=>notifications++,onInvalidated:()=>invalidated++});
  let scope=await pilot.prepare('selector-A');await pilot.verify(scope,status('A'));await pilot.record(scope,view);
  const other=await open();assert.deepEqual((await other.readConfirmed('A','saved')).view,view);
  // Late GET results remain scoped to the account selected when dispatching.
  const a=pilot.capture();pilot.select('selector-B');await rejects(()=>pilot.record(a,view),'STALE_ACCOUNT');scope=await pilot.prepare('selector-B');await pilot.verify(scope,status('B'));assert.equal(await other.readConfirmed('B','saved'),null);
  const detached={...view,game:{...view.game,name:'Detached'}};const saving=pilot.record(scope,detached);detached.game.name='Mutated';await saving;assert.equal((await other.readConfirmed('B','saved')).view.game.name,'Detached');
  // Focus/resume recheck consults durable metadata, never the notification payload.
  const guard=createDurableAccountRepository(other);await guard.signOut(await guard.restore('selector-B'));await pilot.recheck();assert.equal(invalidated,1);await rejects(()=>pilot.record(scope,view),'STALE_ACCOUNT');
  scope=await pilot.prepare('selector-A');await pilot.verify(scope,status('A'));
  const late=await pilot.prepare('selector-A');await guard.signOut(await guard.restore('selector-A'));
  await rejects(()=>pilot.verify(late,status('A')),'STALE_ACCOUNT');assert.equal(await guard.restore('selector-A'),null,'late API result cannot undo external sign-out');
  scope=await pilot.prepare('selector-A');await pilot.verify(scope,status('A'));await pilot.beginDeletion('A');await pilot.beginDeletion(); // retry server deletion without clearing the marker
  await rejects(()=>pilot.record(scope,view),'STALE_ACCOUNT');scope=await pilot.prepare('selector-A');await rejects(()=>pilot.verify(scope,status('A')),'ACCOUNT_DELETING');
  const retry=createRepositoryPilot({enabled:true,open,onInvalidated:()=>{}});retry.select('selector-A');await retry.beginDeletion('A');await retry.close();assert.equal(await guard.restore('selector-A'),null,'deletion retry after restart keeps the durable block');
  const source=JSON.stringify([{...view.game,deviceOnly:true}]);const first=await pilot.stage(source),again=await pilot.stage(source);assert.deepEqual(first,again);assert.equal(first.versions.length,1);assert.equal(first.versions[0].raw,source);assert.equal(await other.readConfirmed('B','saved').then(v=>v.view.game.name),'Detached','staging never adopts games into the selected account');
  scope=await pilot.prepare('selector-C');await pilot.verify(scope,status('C'));await pilot.signOut();assert.equal(await guard.restore('selector-C'),null);assert.ok(await other.readConfirmed('A','saved'),'sign-out/deletion preserve physical snapshots');assert.ok(notifications>0);
  await pilot.close();await guard.close();console.log(name+': disabled rollout, account-scoped GETs, detached inputs, focus/resume invalidation, late verification, deletion retry and source-only staging passed.');
 }
 // Unmount during an asynchronous open closes the late handle instead of leaking it.
 let finish,closes=0;const late=createRepositoryPilot({enabled:true,open:()=>new Promise(resolve=>finish=resolve),onInvalidated:()=>{}});const preparing=late.prepare('A');await new Promise(r=>setImmediate(r));const closing=late.close();finish({close:async()=>closes++});await rejects(()=>preparing,'STALE_ACCOUNT');await closing;assert.equal(closes,1);
}finally{rmSync(root,{recursive:true,force:true})}
