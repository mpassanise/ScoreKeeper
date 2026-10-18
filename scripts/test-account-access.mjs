import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {IDBFactory} from '../tests/offline/node_modules/fake-indexeddb/build/esm/index.js';
const root=mkdtempSync(path.join(tmpdir(),'scorekeeper-account-access-'));
try{
 execFileSync(process.execPath,['node_modules/typescript/bin/tsc','shared/repository/account-access.ts','shared/repository/web-account-repository.ts','shared/repository/native-account-repository.ts','--target','ES2022','--module','commonjs','--moduleResolution','node','--strict','--skipLibCheck','--outDir',root],{stdio:'inherit'});
 writeFileSync(path.join(root,'package.json'),'{"type":"commonjs"}');
 const require=createRequire(import.meta.url),{createAccountAccess}=require(path.join(root,'repository/account-access.js')),{openConfirmedGames}=require(path.join(root,'repository/indexeddb-confirmed-games.js')),{openSQLiteConfirmedGames}=require(path.join(root,'repository/sqlite-confirmed-games.js')),{gameView}=require(path.join(root,'local-games.js'));
 function queries(db){return {execAsync:async sql=>{db.exec(sql)},runAsync:async(sql,...params)=>db.prepare(sql).run(...params),getFirstAsync:async(sql,...params)=>db.prepare(sql).get(...params)||null,getAllAsync:async(sql,...params)=>db.prepare(sql).all(...params)}}
 function sqlite(){const filename=path.join(root,'accounts.db'),db=new DatabaseSync(filename);return {...queries(db),closeAsync:async()=>db.close(),withExclusiveTransactionAsync:async work=>{const tx=new DatabaseSync(filename);try{tx.exec('BEGIN');try{await work(queries(tx));tx.exec('COMMIT')}catch(e){tx.exec('ROLLBACK');throw e}}finally{tx.close()}}}}
 const view=gameView({id:'same-game',name:'Game',players:[{id:'one',name:'One'},{id:'two',name:'Two'}],winner:'high',entries:[{id:'entry',playerId:'one',points:10}],next:'two',finished:false,version:1,updated:'2026-10-18T00:00:00Z'});
 const rejects=(fn,code)=>assert.rejects(async()=>fn(),e=>e.code===code),status=id=>({profileId:id,deletionStatus:null,deletionEnabled:true});
 for(const [name,open]of [['IndexedDB',()=>openConfirmedGames(new IDBFactory(),'accounts')],['SQLite',()=>openSQLiteConfirmedGames(sqlite())]]){
  const repository=await open();
  await repository.saveConfirmed('A',[view]);await repository.saveConfirmed('B',[{...view,game:{...view.game,name:'Other account'}}]);
  const access=createAccountAccess(repository);assert.equal(access.state().localReadable,false);
  let a=access.beginSession('auth-selector-A','A');await rejects(()=>access.readConfirmed(a,'same-game'),'ACCOUNT_UNVERIFIED');await rejects(()=>access.saveConfirmed(a,[view]),'ACCOUNT_UNVERIFIED');
  access.verify(a,status('A'));assert.equal((await access.readConfirmed(a,'same-game')).view.game.name,'Game');
  access.connectionUnavailable(a);assert.equal(access.state().canSync,false);assert.ok(await access.readConfirmed(a,'same-game'),'connection failure retains same-account read access');await rejects(()=>access.saveConfirmed(a,[view]),'SYNC_UNAVAILABLE');
  access.verify(a,status('A'));await access.saveConfirmed(a,[view]);
  await rejects(()=>access.verify(a,{...status('A'),profileId:undefined}),'ACCOUNT_UNVERIFIED');assert.equal(access.state().canSync,false);access.verify(a,status('A'));
  await rejects(()=>access.verify(a,status('B')),'PROFILE_MISMATCH');assert.equal(access.state().localReadable,false);assert.equal(access.state().canSync,false);await rejects(()=>access.readConfirmed(a,'same-game'),'STALE_ACCOUNT');a=access.beginSession('auth-selector-A','A');access.verify(a,status('A'));
  const b=access.beginSession('auth-selector-B','B');await rejects(()=>access.readConfirmed(a,'same-game'),'STALE_ACCOUNT');await rejects(()=>access.verify(a,status('A')),'STALE_ACCOUNT');
  access.verify(b,status('B'));assert.equal((await access.readConfirmed(b,'same-game')).view.game.name,'Other account');
  access.signOut();assert.equal(access.state().localReadable,false);await rejects(()=>access.readConfirmed(b,'same-game'),'STALE_ACCOUNT');assert.ok(await repository.readConfirmed('A','same-game'),'sign-out never purges stored records');
  const again=access.beginSession('auth-selector-A','A');await rejects(()=>access.readConfirmed(again,'same-game'),'ACCOUNT_UNVERIFIED');access.verify(again,status('A'));
  access.beginDeletion(again);assert.equal(access.state().canSync,false);await rejects(()=>access.readConfirmed(again,'same-game'),'STALE_ACCOUNT');const blocked=access.beginSession('auth-selector-A','A');await rejects(()=>access.verify(blocked,status('A')),'ACCOUNT_DELETING');assert.ok(await repository.readConfirmed('A','same-game'),'deletion blocks access; retention/purge remains a separate policy');
  const other=access.beginSession('auth-selector-B','B');access.verify(other,status('B'));assert.ok(await access.readConfirmed(other,'same-game'));await rejects(()=>access.verify(other,{...status('B'),deletionStatus:'pending'}),'ACCOUNT_DELETING');
  // A new process/controller starts closed. Remembered IDs alone never grant access.
  const reopened=createAccountAccess(repository),unverified=reopened.beginSession('auth-selector-A','A');await rejects(()=>reopened.readConfirmed(unverified,'same-game'),'ACCOUNT_UNVERIFIED');
  let finishRead;const delayed=createAccountAccess({...repository,readConfirmed:async(profile,id)=>{const saved=await repository.readConfirmed(profile,id);await new Promise(r=>{finishRead=r});return saved}});
  const before=delayed.beginSession('auth-selector-A','A');delayed.verify(before,status('A'));const read=delayed.readConfirmed(before,'same-game'),failure=assert.rejects(read,e=>e.code==='STALE_ACCOUNT');while(!finishRead)await new Promise(r=>setImmediate(r));delayed.signOut();finishRead();await failure;
  let finishWrite;const writing=createAccountAccess({...repository,saveConfirmed:async(profile,views)=>{await new Promise(r=>{finishWrite=r});await repository.saveConfirmed(profile,views)}});
  const writer=writing.beginSession('auth-selector-A','A');writing.verify(writer,status('A'));const newer={...view,game:{...view.game,version:2}};
  const save=writing.saveConfirmed(writer,[newer]),staleSave=assert.rejects(save,e=>e.code==='STALE_ACCOUNT');while(!finishWrite)await new Promise(r=>setImmediate(r));const next=writing.beginSession('auth-selector-B','B');writing.verify(next,status('B'));finishWrite();await staleSave;
  assert.equal((await repository.readConfirmed('A','same-game')).serverVersion,2,'accepted writes stay in their original partition');assert.equal((await writing.readConfirmed(next,'same-game')).serverVersion,1,'late write cannot land in the new account');
  await repository.close();console.log(name+': verified account binding, expiry/read retention, sign-out, switching, deletion blocking and late-result isolation passed.');
 }
 const {openWebAccountRepository}=require(path.join(root,'repository/web-account-repository.js')),{openNativeAccountRepository}=require(path.join(root,'repository/native-account-repository.js'));
 for(const openAccess of [()=>openWebAccountRepository(new IDBFactory(),'guarded'),()=>openNativeAccountRepository(sqlite())]){
  const access=await openAccess(),lease=access.beginSession('verified-selector','factory-profile');await rejects(()=>access.readConfirmed(lease,'same-game'),'ACCOUNT_UNVERIFIED');access.verify(lease,status('factory-profile'));await access.saveConfirmed(lease,[view]);assert.ok(await access.readConfirmed(lease,'same-game'));await access.close();await rejects(()=>access.readConfirmed(lease,'same-game'),'STALE_ACCOUNT');await rejects(()=>access.beginSession('later'),'STALE_ACCOUNT');
 }
 console.log('Web and native integration factories enforce the same account gate and revoke access on close.');
}finally{rmSync(root,{recursive:true,force:true})}
