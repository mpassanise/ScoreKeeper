import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {IDBFactory} from '../tests/offline/node_modules/fake-indexeddb/build/esm/index.js';
const root=mkdtempSync(path.join(tmpdir(),'scorekeeper-home-'));
try{
 execFileSync(process.execPath,['node_modules/typescript/bin/tsc','shared/repository/pilot.ts','shared/repository/indexeddb-confirmed-games.ts','shared/repository/sqlite-confirmed-games.ts','--target','ES2022','--module','commonjs','--moduleResolution','node','--strict','--skipLibCheck','--outDir',root],{stdio:'inherit'});
 writeFileSync(path.join(root,'package.json'),'{"type":"commonjs"}');const require=createRequire(import.meta.url),ts=require(path.resolve('node_modules/typescript'));
 const {createDurableAccountRepository}=require(path.join(root,'repository/durable-account.js')),{createRepositoryPilot}=require(path.join(root,'repository/pilot.js'));
 const {openConfirmedGames}=require(path.join(root,'repository/indexeddb-confirmed-games.js')),{openSQLiteConfirmedGames}=require(path.join(root,'repository/sqlite-confirmed-games.js'));
 const {gameSummary,homeStatus}=require(path.join(root,'repository/game-home.js'));
 const {gameView}=require(path.join(root,'local-games.js'));
 const status={profileId:'A',deletionStatus:null,deletionEnabled:true},cap={version:1,receipts:'retained',atomicGameAndReceipt:true,kinds:['action','delete'],actions:['score']};
 const factory=new IDBFactory(),file=path.join(root,'native.db');
 function queries(db){return {execAsync:async sql=>db.exec(sql),runAsync:async(sql,...p)=>db.prepare(sql).run(...p),getFirstAsync:async(sql,...p)=>db.prepare(sql).get(...p)||null,getAllAsync:async(sql,...p)=>db.prepare(sql).all(...p)}}
 function sqlite(){const db=new DatabaseSync(file);return {...queries(db),closeAsync:async()=>db.close(),withExclusiveTransactionAsync:async work=>{const tx=new DatabaseSync(file);try{tx.exec('BEGIN');try{await work(queries(tx));tx.exec('COMMIT')}catch(e){tx.exec('ROLLBACK');throw e}}finally{tx.close()}}}}
 const rejects=(fn,code)=>assert.rejects(fn,e=>e.code===code);
 let opens=0;const disabled=createRepositoryPilot({enabled:true,open:async()=>{opens++;throw Error()},onInvalidated:()=>{}});assert.equal(await disabled.readHome(null,[]),null);assert.equal(opens,0);await disabled.close();
 for(const [name,open]of [['IndexedDB',()=>openConfirmedGames(factory,'home')],['SQLite',()=>openSQLiteConfirmedGames(sqlite())]]){
  const repo=await open(),access=createDurableAccountRepository(repo),lease=await access.verify(await access.beginVerification('selector-A','A'),status),out=access.outbox(lease);
  function view(label){const players=[{id:randomUUID(),name:'One'},{id:randomUUID(),name:'Two'}];return gameView({id:randomUUID(),name:label,players,winner:'high',entries:[],next:players[0].id,finished:false,version:1,updated:'2026-10-20T00:00:00Z'})}
  const live=view('Pending score'),removed=view('Pending deletion'),collision=view('Collision'),omitted=view('Omitted from later list'),untracked=view('Untracked collision');
  await access.observeGame(lease,untracked);await rejects(()=>access.observeGame(lease,gameView({...untracked.game,name:'Other account copy'})),'VERSION_COLLISION');
  for(const v of [live,removed,collision]){await access.observeGame(lease,v);await out.seedConfirmed(v.game.id)}
  const score={protocolVersion:1,kind:'action',operationId:randomUUID(),gameId:live.game.id,command:{action:'score',expectedVersion:1,points:9,playerId:live.game.next,entryId:randomUUID()}};
  await out.enqueue(score);const del={protocolVersion:1,kind:'delete',operationId:randomUUID(),gameId:removed.game.id,expectedVersion:1};await out.enqueue(del);
  await rejects(()=>access.observeGame(lease,gameView({...collision.game,name:'Conflicting name'})),'VERSION_COLLISION');
  const before=await repo.documents.read('game-outbox:A'),seeds=[live,removed,collision,omitted,untracked].map(gameSummary),local={...seeds[0],deviceOnly:true,name:'Local copy'};
  let home=await access.readHome(lease,[...seeds,local]);assert.equal(home.games.length,4);assert.equal(home.games.find(g=>g.id===live.game.id).turnCount,1);assert.equal(homeStatus(home.states[live.game.id]),'Changes waiting to sync');assert.equal(home.states[removed.game.id].hidden,'pending-delete');assert.equal(home.states[collision.game.id].sync,'needs-review');assert.equal(home.savedCopies.length,3);assert.ok(!JSON.stringify(home).includes('operationId'));assert.ok(!JSON.stringify(home).includes('entries'));assert.equal(home.states[untracked.game.id].sync,'needs-review');
  home.games[0].players[0].name='MUTATED';home=await access.readHome(lease,[]);assert.equal(home.games.length,4,'list omission preserves indexed games and queue projection');assert.ok(home.games.every(g=>g.players[0].name==='One'));assert.deepEqual(await repo.documents.read('game-outbox:A'),before,'home reads cannot change operations or receipts');
  await out.prepareDelivery(removed.game.id,cap);await out.acknowledge(del.operationId,{operationId:del.operationId,gameId:del.gameId,outcome:'applied',committedVersion:2,observedVersion:1,errorCode:null});await out.settle(removed.game.id);
  home=await access.readHome(lease,seeds);assert.equal(home.states[removed.game.id].hidden,'deleted');assert.ok(!home.games.some(g=>g.id===removed.game.id));
  const review=(await access.readRecovery(lease,removed.game.id)).review;assert.equal(review.read.kind,'deleted');assert.equal(review.canChooseAccount,false);
  // Actual shell navigation: no selected view required; account/activity switches
  // discard late review results, never restoring hidden tiles or uploading.
  for(const [file,native]of [['app/cloud/CloudHome.tsx',false],['mobile/App.tsx',true]]){
   const source=readFileSync(file,'utf8'),start=source.indexOf(' async function reviewHomeCopy('),end=source.indexOf('\n async function ',start+10);assert.ok(start>=0&&end>start);
   const handler=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
   for(const race of ['none','account','activity']){
    const owner={current:native?3:'selector-A'},epoch={current:0};let writes=0,selected;
    const deps={gameRecoveryPilot:true,pilot:{ref:{current:{capture:()=>({selector:native?'native-profile:A':'selector-A'}),readRecovery:async()=>{if(race==='account')owner.current=native?4:'B';if(race==='activity')epoch.current++;return review}}}},identity:owner,identityRevision:owner,current:{current:{profileId:'A'}},activity:epoch,activityRevision:epoch,canUseAccount:o=>o===owner.current,run:async work=>work(),crypto:{randomUUID},Crypto:{randomUUID},setAccountRead:()=>writes++,setView:v=>{writes++;assert.equal(v,null)},setCreating:()=>writes++,setRecovery:v=>{writes++;selected=v}};
    await new Function(...Object.keys(deps),handler+';return reviewHomeCopy')(...Object.values(deps))(removed.game.id);
    assert.equal(writes,race==='none'?4:0,file+' '+race);if(selected)assert.equal(selected.review,review);
   }
   assert.ok(source.includes('homeGames.filter(g=>!g.finished).map(savedGame)'));assert.ok(source.includes('homeGames.filter(g=>g.finished).map(savedGame)'));assert.ok(source.includes('home.seeds===games&&canUseAccount(home.owner)'));
  }
  // A terminal rejection can explicitly select account state; archive navigation
  // remains in the home index after the active queue becomes confirmed.
  await out.prepareDelivery(live.game.id,cap);await out.acknowledge(score.operationId,{operationId:score.operationId,gameId:score.gameId,outcome:'rejected',committedVersion:null,observedVersion:3,errorCode:'VERSION_CONFLICT'});
  await access.observeGame(lease,gameView({...live.game,version:3}));const saved=await access.readRecovery(lease,live.game.id);assert.equal(saved.review.canChooseAccount,true);await access.chooseAccountRecovery(lease,live.game.id,saved.revision,randomUUID());home=await access.readHome(lease,[]);assert.ok(home.savedCopies.find(row=>row.gameId===live.game.id&&row.retained));
  const readDocument=repo.documents.read;let queueReads=0;repo.documents.read=async key=>{if(key==='game-outbox:A')queueReads++;return readDocument(key)};await access.readHome(lease,seeds);assert.equal(queueReads,2,'one queue snapshot plus one revision check, independent of tile count');repo.documents.read=readDocument;
  let raced=false;repo.documents.read=async key=>{if(!raced&&key.startsWith('game-collision:')){raced=true;await out.enqueue({protocolVersion:1,kind:'action',operationId:randomUUID(),gameId:live.game.id,command:{action:'score',expectedVersion:3,points:5,playerId:live.game.next,entryId:randomUUID()}})}return readDocument(key)};await rejects(()=>access.readHome(lease,seeds),'STORAGE_CONFLICT');repo.documents.read=readDocument;assert.equal((await access.readHome(lease,[])).states[live.game.id].sync,'pending');
  const index=await repo.documents.read('game-home:A'),bad=await repo.documents.write('game-home:A',index.revision,null);await rejects(()=>access.readHome(lease,[]),'STORAGE_CORRUPT');assert.deepEqual(await repo.documents.read('game-home:A'),bad,'corrupt index is retained, never reset');await repo.documents.write('game-home:A',bad.revision,index.value);
  await access.close();const again=await open(),cold=createDurableAccountRepository(again),restored=await cold.restore('selector-A');home=await cold.readHome(restored,[]);assert.equal(home.states[removed.game.id].hidden,'deleted');assert.ok(home.games.some(g=>g.id===omitted.game.id));
  const leaseB=await cold.verify(await cold.beginVerification('selector-B','B'),{...status,profileId:'B'});assert.deepEqual((await cold.readHome(leaseB,[])).games,[]);await rejects(()=>cold.readHome(restored,seeds),'STALE_ACCOUNT');await cold.beginDeletion(leaseB);await rejects(()=>cold.readHome(leaseB,[]),'STALE_ACCOUNT');const c=await cold.verify(await cold.beginVerification('selector-C','C'),{...status,profileId:'C'});const originalWrite=again.documents.write;again.documents.write=async(key,...args)=>{if(key==='game-home:C')await cold.beginDeletion(c);return originalWrite(key,...args)};await rejects(()=>cold.readHome(c,[gameSummary(omitted)]),'STORAGE_CONFLICT');assert.equal(await again.documents.read('game-home:C'),null,'lifecycle transaction guard rolls back index');again.documents.write=originalWrite;await cold.close();
  console.log(name+': queue-aware home, deletion suppression, retained recovery navigation, restart, isolation and shell races pass');
 }
}finally{rmSync(root,{recursive:true,force:true})}
