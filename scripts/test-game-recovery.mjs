import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {IDBFactory} from '../tests/offline/node_modules/fake-indexeddb/build/esm/index.js';
const root=mkdtempSync(path.join(tmpdir(),'scorekeeper-recovery-'));
try{
 execFileSync(process.execPath,['node_modules/typescript/bin/tsc','shared/repository/pilot.ts','shared/repository/game-screen.ts','shared/repository/indexeddb-confirmed-games.ts','shared/repository/sqlite-confirmed-games.ts','--target','ES2022','--module','commonjs','--moduleResolution','node','--strict','--skipLibCheck','--outDir',root],{stdio:'inherit'});
 writeFileSync(path.join(root,'package.json'),'{"type":"commonjs"}');const require=createRequire(import.meta.url);
 const {createDurableAccountRepository}=require(path.join(root,'repository/durable-account.js')),{createRepositoryPilot}=require(path.join(root,'repository/pilot.js'));
 const {openConfirmedGames}=require(path.join(root,'repository/indexeddb-confirmed-games.js')),{openSQLiteConfirmedGames}=require(path.join(root,'repository/sqlite-confirmed-games.js'));
 const {keepRecoveryReview}=require(path.join(root,'repository/game-recovery.js'));
 const {gameScreenMessage}=require(path.join(root,'repository/game-screen.js'));
 const {gameView}=require(path.join(root,'local-games.js')),{snapshot}=require(path.join(root,'repository/confirmed-games.js')),{keepGameCollision}=require(path.join(root,'repository/game-collisions.js'));
 const status={profileId:'A',deletionStatus:null,deletionEnabled:true},cap={version:1,receipts:'retained',atomicGameAndReceipt:true,kinds:['action'],actions:['score']};
 const rejects=(fn,code)=>assert.rejects(fn,e=>e.code===code);
 const factory=new IDBFactory(),file=path.join(root,'native.db');
 function queries(db){return {execAsync:async sql=>db.exec(sql),runAsync:async(sql,...p)=>db.prepare(sql).run(...p),getFirstAsync:async(sql,...p)=>db.prepare(sql).get(...p)||null,getAllAsync:async(sql,...p)=>db.prepare(sql).all(...p)}}
 function sqlite(){const db=new DatabaseSync(file);return {...queries(db),closeAsync:async()=>db.close(),withExclusiveTransactionAsync:async work=>{const tx=new DatabaseSync(file);try{tx.exec('BEGIN');try{await work(queries(tx));tx.exec('COMMIT')}catch(e){tx.exec('ROLLBACK');throw e}}finally{tx.close()}}}}
 let disabledOpens=0;const disabled=createRepositoryPilot({enabled:true,open:async()=>{disabledOpens++;throw Error()},onInvalidated:()=>assert.fail()});assert.equal(await disabled.readRecovery(null,'x',randomUUID()),null);await rejects(()=>disabled.chooseAccountRecovery(null,{}),'STALE_ACCOUNT');assert.equal(disabledOpens,0);await disabled.close();
 for(const [name,open]of [['IndexedDB',()=>openConfirmedGames(factory,'recovery')],['SQLite',()=>openSQLiteConfirmedGames(sqlite())]]){
  async function fixture(){
   const repo=await open(),access=createDurableAccountRepository(repo),lease=await access.verify(await access.beginVerification('selector-A','A'),status),out=access.outbox(lease);
   const players=[{id:randomUUID(),name:'One'},{id:randomUUID(),name:'Two'}],game={id:randomUUID(),name:'Recovery fixture',players,winner:'high',entries:[],next:players[0].id,finished:false,version:1,updated:'2026-10-19T00:00:00Z'};
   await access.observeGame(lease,gameView(game));await out.seedConfirmed(game.id);
   const op={protocolVersion:1,kind:'action',operationId:randomUUID(),gameId:game.id,command:{action:'score',expectedVersion:1,points:12,playerId:game.next,entryId:randomUUID()}},dependent={...op,operationId:randomUUID(),command:{...op.command,expectedVersion:2,points:4,playerId:players[1].id,entryId:randomUUID()}};
   await out.enqueue(op);await out.enqueue(dependent);await out.prepareDelivery(game.id,cap);
   await out.acknowledge(op.operationId,{operationId:op.operationId,gameId:game.id,outcome:'rejected',committedVersion:null,observedVersion:5,errorCode:'VERSION_CONFLICT'});
   const account=gameView({...game,version:5,entries:[{id:randomUUID(),playerId:game.next,points:33}]});await access.observeGame(lease,account);
   const before=await repo.documents.read('game-outbox:A');await access.close();return {game,account,before,op};
  }
  async function pilotFor(f){let raw;const pilot=createRepositoryPilot({enabled:true,recoveryEnabled:true,open:async()=>{raw=await open();return raw},onInvalidated:()=>{}});const scope=await pilot.prepare('selector-A');await pilot.verify(scope,status);return {pilot,scope,get raw(){return raw}}}
  // Exercise the actual shell handlers with real persisted read models. This
  // catches UI adoption regressions that repository-only tests cannot observe.
  for(const kind of ['game','pending-delete','deleted','missing']){
   const repo=await open(),access=createDurableAccountRepository(repo),lease=await access.verify(await access.beginVerification('selector-A','A'),status),out=access.outbox(lease);
   const players=[{id:randomUUID(),name:'One'},{id:randomUUID(),name:'Two'}],game={id:randomUUID(),name:'Selected account game',players,winner:'high',entries:[],next:players[0].id,finished:false,version:1,updated:'2026-10-19T00:00:00Z'},old=gameView(game);
   if(kind!=='missing')await access.observeGame(lease,old);
   if(kind==='pending-delete'||kind==='deleted'){
    await out.seedConfirmed(game.id);const op={protocolVersion:1,kind:'delete',operationId:randomUUID(),gameId:game.id,expectedVersion:1};await out.enqueue(op);
    if(kind==='deleted'){await out.prepareDelivery(game.id,{...cap,kinds:['delete']});await out.acknowledge(op.operationId,{operationId:op.operationId,gameId:game.id,outcome:'applied',committedVersion:2,observedVersion:1,errorCode:null});await out.settle(game.id)}
   }
   const model=(await access.readRecovery(lease,game.id)).review;assert.equal(model.read.kind,kind);
   const durableBefore=await repo.documents.read('game-outbox:A'),cacheBefore=await access.readConfirmed(lease,game.id);
   for(const [file,native]of [['app/cloud/CloudHome.tsx',false],['mobile/App.tsx',true]]){
    const source=readFileSync(file,'utf8'),start=source.indexOf(' async function reviewSavedCopies()'),end=source.indexOf(' async function chooseRecoveryCopy()',start);assert.ok(start>=0&&end>start);const handler=source.slice(start,end).trim();
    for(const race of ['none','account','selection']){
     let selected=old,read=null,recovery=null,notice='',writes=0;const local={...game,deviceOnly:true,turnCount:0},unrelated={...game,id:randomUUID(),turnCount:0},initial=[{...game,turnCount:0},local,unrelated];let games=initial;
     const context={current:{view:old}},owner={current:native?3:'selector-A'},other={...old,game:{...game,id:randomUUID()}};
     const deps={gameRecoveryPilot:true,view:old,pilot:{ref:{current:{capture:()=>({selector:'selector-A',generation:1}),readRecovery:async()=>{if(race==='account')owner.current=native?4:'selector-B';if(race==='selection')context.current.view=other;return model}}}},identity:owner,identityRevision:owner,canUseAccount:value=>value===owner.current,context,foregroundContext:context,run:async work=>work(),setAccountRead:value=>{writes++;read=value},setView:value=>{writes++;selected=value},setGames:update=>{writes++;games=update(games)},setNotice:value=>{writes++;notice=value},setRecovery:value=>{writes++;recovery=value},Crypto:{randomUUID},crypto:{randomUUID},gameScreenMessage};
     await new Function(...Object.keys(deps),'return ('+handler+')')(...Object.values(deps))();
     if(race!=='none'){assert.equal(writes,0,file+' must ignore a late review after '+race+' change');continue}
     assert.equal(read.kind,kind);assert.equal(recovery.review,model,'evidence remains available');assert.equal(keepRecoveryReview(model,selected),true,'selection effect must preserve the newly opened review');assert.equal(keepRecoveryReview(model,other),false,'switching to a different game closes the old review');
     if(kind==='game'){assert.deepEqual(selected,old);assert.equal(games,initial);assert.equal(keepRecoveryReview(model,null),false,'Home closes a live-game review')}
     else{assert.equal(selected,null,file+' must clear the stale live view');assert.ok(notice);assert.equal(keepRecoveryReview(model,null),true,'non-live evidence stays inspectable');assert.deepEqual(games,kind==='missing'?initial:[local,unrelated]);}
    }
   }
   assert.deepEqual(await repo.documents.read('game-outbox:A'),durableBefore);assert.deepEqual(await access.readConfirmed(lease,game.id),cacheBefore,'UI suppression must not erase a saved source');await access.close();
  }
  // Suppressing a rejected deletion must not disable its eligible account-copy
  // choice. Exercise both actual handlers through the real recovery transaction.
  for(const [file,native]of [['app/cloud/CloudHome.tsx',false],['mobile/App.tsx',true]]){
   const repo=await open(),access=createDurableAccountRepository(repo),lease=await access.verify(await access.beginVerification('selector-A','A'),status),out=access.outbox(lease),players=[{id:randomUUID(),name:'One'},{id:randomUUID(),name:'Two'}];
   const game={id:randomUUID(),name:'Rejected deletion',players,winner:'high',entries:[],next:players[0].id,finished:false,version:1,updated:'2026-10-19T00:00:00Z'},old=gameView(game),remote=gameView({...game,version:2});await access.observeGame(lease,old);await out.seedConfirmed(game.id);
   const op={protocolVersion:1,kind:'delete',operationId:randomUUID(),gameId:game.id,expectedVersion:1};await out.enqueue(op);await out.prepareDelivery(game.id,{...cap,kinds:['delete']});await out.acknowledge(op.operationId,{operationId:op.operationId,gameId:game.id,outcome:'rejected',committedVersion:null,observedVersion:2,errorCode:'VERSION_CONFLICT'});await access.observeGame(lease,remote);
   const saved=await access.readRecovery(lease,game.id),review=saved.review;assert.equal(review.read.kind,'pending-delete');assert.equal(review.canChooseAccount,true);
   let selected=old,recovery=null,read=null,notice='',calls=0;const originalOwner=native?3:'selector-A',owner={current:originalOwner},context={current:{view:old}},other={...game,id:randomUUID(),turnCount:0};let games=[{...game,turnCount:0},other];const decisionId=randomUUID();
   const deps={gameRecoveryPilot:true,view:old,recovery:null,pilot:{ref:{current:{capture:()=>({selector:'selector-A',generation:1}),readRecovery:async()=>review,chooseAccountRecovery:async(_scope,selectedReview)=>{calls++;assert.equal(selectedReview,review);return access.chooseAccountRecovery(lease,game.id,saved.revision,decisionId)}}}},identity:owner,identityRevision:owner,canUseAccount:value=>value===owner.current,context,foregroundContext:context,run:async work=>work(),setAccountRead:value=>read=value,setView:value=>{selected=value;context.current.view=value},setGames:update=>games=update(games),setNotice:value=>notice=value,setRecovery:value=>recovery=value,setBusy:()=>{},setError:()=>{},locked:{current:false},activity:{current:0},activityRevision:{current:0},Crypto:{randomUUID},crypto:{randomUUID},gameScreenMessage,keepRecoveryReview};
   const source=readFileSync(file,'utf8');function handler(name){const start=source.indexOf(' async function '+name+'()'),end=source.indexOf('\n async function ',start+10);assert.ok(start>=0&&end>start);return new Function(...Object.keys(deps),'return ('+source.slice(start,end).trim()+')')(...Object.values(deps))}
   await handler('reviewSavedCopies')();assert.equal(selected,null);assert.deepEqual(games,[other]);deps.recovery=recovery;assert.ok(keepRecoveryReview(review,null));
   owner.current=native?4:'selector-B';await assert.rejects(()=>handler('chooseRecoveryCopy')(),/Game or account access changed/);assert.equal(calls,0);owner.current=originalOwner;
   context.current.view=gameView(other);await assert.rejects(()=>handler('chooseRecoveryCopy')(),/Game or account access changed/);assert.equal(calls,0);context.current.view=null;
   await handler('chooseRecoveryCopy')();assert.deepEqual(selected,remote);assert.equal(read.kind,'game');assert.equal(recovery,null);assert.equal(calls,1);assert.equal(games.filter(g=>g.id===game.id).length,1);assert.ok(games.some(g=>g.id===other.id));assert.ok(notice.includes('kept'));
   const state=await out.read(),batch=state.archive.find(b=>b.id===decisionId);assert.deepEqual(batch.recovery.base.view,old);assert.equal(batch.operations[0].wire,JSON.stringify(op));assert.equal((await access.readRecovery(lease,game.id)).review.copies.find(c=>c.label==='Before device deletion').view.game.id,game.id);await access.close();
  }
  // Preview is read-only; choosing retains original projection, exact wires,
  // receipts and dependants and installs only the reviewed account snapshot.
  const f=await fixture(),p=await pilotFor(f),review=await p.pilot.readRecovery(p.scope,f.game.id,randomUUID());
  assert.equal(review.canChooseAccount,true);assert.equal(review.dependentCount,1);assert.equal(review.copies[0].view.totals[f.game.next],12);assert.deepEqual(review.copies[1].view,f.account);
  assert.deepEqual(await p.raw.documents.read('game-outbox:A'),f.before,'preview never writes the queue');
  await rejects(()=>p.pilot.chooseAccountRecovery(p.scope,structuredClone(review)),'STALE_ACCOUNT','forged DTO cannot authorize a choice');
  const selected=await p.pilot.chooseAccountRecovery(p.scope,review);assert.equal(selected.sync,'confirmed');assert.deepEqual(selected.view,f.account);
  const after=await p.raw.documents.read('game-outbox:A'),batch=after.value.archive.at(-1),original=f.before.value.games.find(g=>g.gameId===f.game.id);
  assert.deepEqual(batch.recovery.base,original.base);assert.deepEqual(batch.recovery.projection,original.projection);assert.deepEqual(batch.operations,original.operations);assert.deepEqual(batch.recovery.reservedEntryIds,original.reservedEntryIds);assert.equal(after.value.games.find(g=>g.gameId===f.game.id).operations.length,0);
  await p.pilot.chooseAccountRecovery(p.scope,review);assert.deepEqual(await p.raw.documents.read('game-outbox:A'),after,'retrying the same decision cannot archive or apply twice');await p.pilot.close();
  // A cold-start preview can inspect the recovery archive without granting sync.
  const offline=createRepositoryPilot({enabled:true,recoveryEnabled:true,open,onInvalidated:()=>{}});offline.select('selector-A');const archived=await offline.readRecovery(offline.capture(),f.game.id,randomUUID());assert.equal(archived.canChooseAccount,false);assert.deepEqual(archived.copies.find(c=>c.label==='Retained device copy').view,original.projection);await offline.close();
  // Every subsequent queue revision invalidates the choice, including changes
  // to another game. No unseen snapshot or dependants can be selected.
  const stale=await fixture(),q=await pilotFor(stale),staleReview=await q.pilot.readRecovery(q.scope,stale.game.id,randomUUID()),document=await q.raw.documents.read('game-outbox:A');await q.raw.documents.write('game-outbox:A',document.revision,document.value);
  await rejects(()=>q.pilot.chooseAccountRecovery(q.scope,staleReview),'STORAGE_CONFLICT');assert.equal((await q.pilot.readGame(q.scope,stale.game.id)).sync,'needs-review');await q.pilot.close();
  // Even same-account re-verification revokes the preview's captured lease.
  const reverified=await fixture(),verified=await pilotFor(reverified),oldReview=await verified.pilot.readRecovery(verified.scope,reverified.game.id,randomUUID());await verified.pilot.verify(verified.scope,status);await rejects(()=>verified.pilot.chooseAccountRecovery(verified.scope,oldReview),'STALE_ACCOUNT');await verified.pilot.close();
  // Failed commits preserve originals; ambiguous successful commits are recovered
  // by retrying the SAME private decision identity, without duplicate archives.
  for(const ambiguous of [false,true]){
   const data=await fixture(),r=await pilotFor(data),choice=await r.pilot.readRecovery(r.scope,data.game.id,randomUUID()),write=r.raw.documents.write;let once=true;
   r.raw.documents.write=async(key,...args)=>{if(key==='game-outbox:A'&&once){once=false;if(ambiguous)await write(key,...args);throw Error('Injected evidence write response failure')}return write(key,...args)};
   await assert.rejects(()=>r.pilot.chooseAccountRecovery(r.scope,choice),/Injected/);
   if(!ambiguous)assert.deepEqual(await r.raw.documents.read('game-outbox:A'),data.before);
   await r.pilot.chooseAccountRecovery(r.scope,choice);const saved=await r.raw.documents.read('game-outbox:A');assert.equal(saved.value.archive.filter(b=>b.gameId===data.game.id&&b.kind==='account-selected').length,1);await r.pilot.close();
  }
  // Collision arriving during confirmation is excluded by a transaction guard.
  const collided=await fixture(),c=await pilotFor(collided),collisionReview=await c.pilot.readRecovery(c.scope,collided.game.id,randomUUID()),write=c.raw.documents.write;let collide=true;
  c.raw.documents.write=async(key,...args)=>{if(key==='game-outbox:A'&&collide){collide=false;const lifecycle=await c.raw.documents.read('account-lifecycle');const different=gameView({...collided.account.game,name:'Contradictory account name'});await keepGameCollision(c.raw.documents,{key:'account-lifecycle',revision:lifecycle.revision},snapshot('A',collided.account),snapshot('A',different))}return write(key,...args)};
  await rejects(()=>c.pilot.chooseAccountRecovery(c.scope,collisionReview),'STORAGE_CONFLICT');assert.deepEqual(await c.raw.documents.read('game-outbox:A'),collided.before);
  const collision=await c.pilot.readRecovery(c.scope,collided.game.id,randomUUID());assert.equal(collision.canChooseAccount,false);assert.equal(collision.copies.length,3);assert.ok(collision.message.includes('disagree'));await c.pilot.close();
  // An unresolved request cannot expose a choice or be converted into a new
  // operation. Its exact wire and local projection remain unchanged.
  const unresolved=await fixture(),u=await pilotFor(unresolved),unknown=await u.raw.documents.read('game-outbox:A'),unknownGame=unknown.value.games.find(g=>g.gameId===unresolved.game.id);unknownGame.operations[0].status='uncertain';delete unknownGame.operations[0].acknowledgement;await u.raw.documents.write('game-outbox:A',unknown.revision,unknown.value);
  const unknownBefore=await u.raw.documents.read('game-outbox:A'),unknownReview=await u.pilot.readRecovery(u.scope,unresolved.game.id,randomUUID());assert.equal(unknownReview.canChooseAccount,false);assert.ok(unknownReview.message.includes('unknown outcome'));await rejects(()=>u.pilot.chooseAccountRecovery(u.scope,unknownReview),'STALE_ACCOUNT');assert.deepEqual(await u.raw.documents.read('game-outbox:A'),unknownBefore);await u.pilot.close();
  // Independent-handle sign-out during the decision transaction prevents its
  // archive/projection write as well as presentation of a successful choice.
  const revoked=await fixture(),v=await pilotFor(revoked),revokedReview=await v.pilot.readRecovery(v.scope,revoked.game.id,randomUUID()),writeRevoked=v.raw.documents.write;let revoke=true;
  v.raw.documents.write=async(key,...args)=>{if(key==='game-outbox:A'&&revoke){revoke=false;const other=createDurableAccountRepository(await open());await other.signOut(await other.restore('selector-A'));await other.close()}return writeRevoked(key,...args)};
  await rejects(()=>v.pilot.chooseAccountRecovery(v.scope,revokedReview),'STORAGE_CONFLICT');assert.deepEqual(await v.raw.documents.read('game-outbox:A'),revoked.before);await v.pilot.close();
  // Read-only restore can show saved evidence, but cannot choose until fresh
  // account verification. Switching identity invalidates all issued previews.
  const cold=await fixture(),coldPilot=createRepositoryPilot({enabled:true,recoveryEnabled:true,open,onInvalidated:()=>{}});coldPilot.select('selector-A');const coldScope=coldPilot.capture(),coldReview=await coldPilot.readRecovery(coldScope,cold.game.id,randomUUID());
  assert.equal(coldReview.canChooseAccount,false);assert.ok(coldReview.message.includes('Reconnect'));await rejects(()=>coldPilot.chooseAccountRecovery(coldScope,coldReview),'STALE_ACCOUNT');coldPilot.select('selector-B');await rejects(()=>coldPilot.chooseAccountRecovery(coldScope,coldReview),'STALE_ACCOUNT');const otherScope=await coldPilot.prepare('selector-B');await coldPilot.verify(otherScope,{...status,profileId:'B'});const other=await coldPilot.readRecovery(otherScope,cold.game.id,randomUUID());assert.equal(other.copies.length,0);assert.equal(other.canChooseAccount,false);await coldPilot.close();
  console.log(name+': recovery previews, archived source preservation/restart, explicit choices, stale/forged previews, failed/ambiguous commits, collision CAS, cold read-only permissions and account isolation passed.');
 }
}finally{rmSync(root,{recursive:true,force:true})}
