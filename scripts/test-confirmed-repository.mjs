import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {IDBFactory,IDBObjectStore} from '../tests/offline/node_modules/fake-indexeddb/build/esm/index.js';
const output=mkdtempSync(path.join(tmpdir(),'scorekeeper-repository-'));
try{
 execFileSync(process.execPath,['node_modules/typescript/bin/tsc','shared/repository/indexeddb-confirmed-games.ts','--target','ES2022','--module','commonjs','--moduleResolution','node','--strict','--skipLibCheck','--outDir',output],{stdio:'inherit'});
 writeFileSync(path.join(output,'package.json'),'{"type":"commonjs"}');
 const require=createRequire(import.meta.url),{openConfirmedGames}=require(path.join(output,'repository/indexeddb-confirmed-games.js'));
 const {gameView}=require(path.join(output,'local-games.js'));
 const game=(id='game',version=1,points=5)=>gameView({id,name:'Phase 10',players:[{id:'p1',name:'One'},{id:'p2',name:'Two'}],winner:'low',playStyle:'free',scoreMode:'add',presetId:'phase-10',presetVersion:1,endCondition:'manual',entries:[{id:'e1',playerId:'p1',points}],next:'p1',finished:false,startedAt:'2026-10-16T00:00:00Z',endedAt:null,version,updated:'2026-10-16T00:01:00Z'});
 const factory=new IDBFactory();let a=await openConfirmedGames(factory,'test');const b=await openConfirmedGames(factory,'test');
 const rejects=(fn,code)=>assert.rejects(async()=>fn(),e=>e.code===code);
 const original=game();await a.saveConfirmed('A',[original]);original.game.entries[0].points=999;
 assert.equal((await a.readConfirmed('A','game')).view.totals.p1,5,'caller mutation cannot alter saved data');
 assert.equal(await b.readConfirmed('B','game'),null,'same game ID is isolated across accounts');
 await rejects(()=>a.readConfirmed('','game'),'INVALID_SNAPSHOT');
 await rejects(()=>a.saveConfirmed('A',[{game:game().game}]),'INVALID_SNAPSHOT');
 await rejects(()=>a.saveConfirmed('A',[{...game(),game:{...game().game,deviceOnly:true}}]),'INVALID_SNAPSHOT');
 await rejects(()=>a.saveConfirmed('A',[game(),game()]),'INVALID_SNAPSHOT');
 const bad=game();bad.game.entries.push({...bad.game.entries[0]});await rejects(()=>a.saveConfirmed('A',[bad]),'INVALID_SNAPSHOT');
 a.close();a=await openConfirmedGames(factory,'test');assert.deepEqual((await a.readConfirmed('A','game')).view,game(),'complete rules, entries and metadata survive reopening');
 await Promise.all([a.saveConfirmed('A',[game('game',3,15)]),b.saveConfirmed('A',[game('game',2,10)])]);
 assert.equal((await b.readConfirmed('A','game')).serverVersion,3,'separate connections cannot overwrite newer version with older response');
 await a.saveConfirmed('A',[game('game',3,15)]);
 await rejects(()=>b.saveConfirmed('A',[game('new'),game('game',3,99)]),'VERSION_COLLISION');
 assert.equal(await a.readConfirmed('A','new'),null,'collision rolls back entire multi-game transaction');
 assert.equal((await a.readConfirmed('A','game')).view.totals.p1,15);
 await b.saveConfirmed('B',[game('game',1,25)]);assert.equal((await a.readConfirmed('B','game')).view.totals.p1,25);
 await a.saveConfirmed('A',[game('other')]);await a.saveConfirmed('A',[game('game',4,20)]);
 assert.ok(await b.readConfirmed('A','other'),'absence from a later batch never deletes another game');
 // Inject failure after the first put request was accepted, before commit.
 const put=IDBObjectStore.prototype.put;let calls=0;
 IDBObjectStore.prototype.put=function(...args){if(++calls===2)throw new DOMException('disk full','QuotaExceededError');return put.apply(this,args)};
 try{await rejects(()=>a.saveConfirmed('A',[game('game',5,30),game('other',2,35)]),'STORAGE_UNAVAILABLE')}
 finally{IDBObjectStore.prototype.put=put}
 assert.equal((await a.readConfirmed('A','game')).serverVersion,4,'earlier request success is not transaction success');
 assert.equal((await a.readConfirmed('A','other')).serverVersion,1);
 await a.saveConfirmed('A',[game('game',5,30)]);assert.equal((await a.readConfirmed('A','game')).serverVersion,5,'storage recovers after aborted write');
 const total=game('total');total.game.scoreMode='total';total.game.entries.push({id:'e2',playerId:'p1',points:9});total.totals.p1=9;
 await a.saveConfirmed('A',[total]);assert.deepEqual((await a.readConfirmed('A','total')).view,total);
 const completed=game('done');completed.game.finished=true;completed.winnerIds=['p2'];await a.saveConfirmed('A',[completed]);
 // Read corruption is surfaced, never silently converted to an empty account.
 const db=await new Promise((resolve,reject)=>{const r=factory.open('test',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 await new Promise((resolve,reject)=>{const tx=db.transaction('confirmedGames','readwrite');tx.objectStore('confirmedGames').put({profileId:'A',gameId:'corrupt',schemaVersion:99});tx.oncomplete=resolve;tx.onabort=reject});
 await rejects(()=>a.readConfirmed('A','corrupt'),'STORAGE_CORRUPT');
 await rejects(()=>a.saveConfirmed('A',[game('corrupt')]),'STORAGE_CORRUPT');
 assert.equal(await a.readConfirmed('B','corrupt'),null);
 a.close();b.close();db.close();
 await rejects(()=>a.saveConfirmed('A',[game()]),'STORAGE_UNAVAILABLE');
 // Unknown future schema is retained, never deleted/downgraded to v1.
 const future=await new Promise(resolve=>{const r=factory.open('future',3);r.onupgradeneeded=()=>r.result.createObjectStore('keep');r.onsuccess=()=>resolve(r.result)});future.close();
 await rejects(()=>openConfirmedGames(factory,'future'),'STORAGE_UNAVAILABLE');
 const kept=await new Promise(resolve=>{const r=factory.open('future',3);r.onsuccess=()=>resolve(r.result)});assert.ok(kept.objectStoreNames.contains('keep'));kept.close();
 // An interrupted first upgrade rolls back schema and can be retried.
 const interrupted=await new Promise(resolve=>{const r=factory.open('interrupted',1);r.onupgradeneeded=()=>{r.result.createObjectStore('partial');r.transaction.abort()};r.onerror=()=>resolve(true)});
 assert.equal(interrupted,true);const recovered=await openConfirmedGames(factory,'interrupted');await recovered.saveConfirmed('A',[game()]);recovered.close();
 // A v1 database with an incompatible store is retained, never recreated.
 const blocker=await new Promise(resolve=>{const r=factory.open('blocked',1);r.onupgradeneeded=()=>r.result.createObjectStore('legacy');r.onsuccess=()=>resolve(r.result)});
 blocker.close();await rejects(()=>openConfirmedGames(factory,'blocked'),'STORAGE_CORRUPT');
 await rejects(()=>openConfirmedGames({open(){throw new DOMException('denied','SecurityError')}},'denied'),'STORAGE_UNAVAILABLE');
 console.log('Confirmed repository: full snapshots, reopen, account isolation, cross-connection ordering, atomic rollback, quota injection, version collisions, corruption, total scores and future-schema retention passed.');
}finally{rmSync(output,{recursive:true,force:true})}
