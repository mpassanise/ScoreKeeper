import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=mkdtempSync(path.join(tmpdir(),'scorekeeper-sqlite-'));
try{
 execFileSync(process.execPath,['node_modules/typescript/bin/tsc','shared/repository/sqlite-confirmed-games.ts','--target','ES2022','--module','commonjs','--moduleResolution','node','--strict','--skipLibCheck','--outDir',root],{stdio:'inherit'});
 writeFileSync(path.join(root,'package.json'),'{"type":"commonjs"}');
 const require=createRequire(import.meta.url),{openSQLiteConfirmedGames}=require(path.join(root,'repository/sqlite-confirmed-games.js')),{gameView}=require(path.join(root,'local-games.js'));
 const file=path.join(root,'account.db'),rejects=(fn,code)=>assert.rejects(async()=>fn(),e=>e.code===code);
 const game=(id='game',version=1,points=5)=>gameView({id,name:'Phase 10',players:[{id:'p1',name:'One'},{id:'p2',name:'Two'}],winner:'low',playStyle:'free',scoreMode:'add',endCondition:'manual',entries:[{id:'entry',playerId:'p1',points}],next:'p1',finished:false,version,updated:'2026-10-16T00:00:00Z'});
 let failPut=0,puts=0,pause=null,relaxed=false;
 function queries(db){return {
  async execAsync(sql){db.exec(sql)},
  async runAsync(sql,...params){if(sql.startsWith('INSERT INTO confirmed_games')){puts++;if(failPut&&puts===failPut)throw Error('disk full');if(pause){const hold=pause;pause=null;await hold()}}return db.prepare(sql).run(...params)},
  async getFirstAsync(sql,...params){return db.prepare(sql).get(...params)||null},
  async getAllAsync(sql,...params){return db.prepare(sql).all(...params)}
 }}
 // Expo's exclusive callback gets a separate connection. This test port models
 // that boundary with actual file-backed SQLite, not an in-memory map.
 function connect(filename=file){const db=new DatabaseSync(filename);return {...queries(db),async closeAsync(){db.close()},async withExclusiveTransactionAsync(work){const tx=new DatabaseSync(filename);try{if(relaxed)tx.exec('PRAGMA synchronous = NORMAL');tx.exec('BEGIN');try{await work(queries(tx));tx.exec('COMMIT')}catch(e){tx.exec('ROLLBACK');throw e}}finally{tx.close()}}}}
 let a=await openSQLiteConfirmedGames(connect());const b=await openSQLiteConfirmedGames(connect());
 const input=game();const saving=a.saveConfirmed('A',[input]);input.game.entries[0].points=99;await saving;
 assert.equal((await a.readConfirmed('A','game')).view.totals.p1,5);
 assert.equal(await b.readConfirmed('B','game'),null);
 await rejects(()=>a.readConfirmed('','game'),'INVALID_SNAPSHOT');
 await rejects(()=>a.saveConfirmed('A',[{game:game().game}]),'INVALID_SNAPSHOT');
 await rejects(()=>a.saveConfirmed('A',[game(),game()]),'INVALID_SNAPSHOT');
 await a.close();a=await openSQLiteConfirmedGames(connect());assert.deepEqual((await a.readConfirmed('A','game')).view,game());
 await a.saveConfirmed('A',[game('game',3,15)]);await b.saveConfirmed('A',[game('game',2,10)]);
 assert.equal((await b.readConfirmed('A','game')).serverVersion,3);
 await rejects(()=>b.saveConfirmed('A',[game('new'),game('game',3,99)]),'VERSION_COLLISION');assert.equal(await a.readConfirmed('A','new'),null);
 await a.saveConfirmed('A',[game('other')]);puts=0;failPut=2;
 await rejects(()=>a.saveConfirmed('A',[game('game',4,20),game('other',2,25)]),'STORAGE_UNAVAILABLE');failPut=0;
 assert.equal((await b.readConfirmed('A','game')).serverVersion,3);assert.equal((await b.readConfirmed('A','other')).serverVersion,1);
 await a.saveConfirmed('A',[game('game',4,20)]);
 // A separate handle holds the database write lock. Failure must surface, and
 // the same confirmed batch remains retryable after releasing the lock.
 const lock=new DatabaseSync(file);lock.exec('BEGIN IMMEDIATE');
 await rejects(()=>b.saveConfirmed('A',[game('game',5,30)]),'STORAGE_UNAVAILABLE');lock.exec('ROLLBACK');lock.close();
 await b.saveConfirmed('A',[game('game',5,30)]);assert.equal((await a.readConfirmed('A','game')).serverVersion,5);
 const injected="A'); DROP TABLE confirmed_games; --";await a.saveConfirmed(injected,[game('same')]);assert.ok(await a.readConfirmed(injected,'same'));assert.equal(await a.readConfirmed('A','same'),null);
 await a.saveConfirmed('B',[game('game',1,40)]);assert.equal((await a.readConfirmed('B','game')).view.totals.p1,40);
 const total=game('total');total.game.scoreMode='total';total.game.entries.push({id:'entry2',playerId:'p1',points:-2});total.totals.p1=-2;await a.saveConfirmed('A',[total]);assert.deepEqual((await b.readConfirmed('A','total')).view,total);
 relaxed=true;await rejects(()=>a.saveConfirmed('A',[game('game',6,35)]),'STORAGE_UNAVAILABLE');relaxed=false;assert.equal((await a.readConfirmed('A','game')).serverVersion,5);
 // Abrupt process exit before COMMIT leaves prior content intact after reopen.
 await a.close();await b.close();
 const crash=spawnSync(process.execPath,['--input-type=commonjs','-e',`const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.exec("BEGIN IMMEDIATE");d.prepare("UPDATE confirmed_games SET snapshot = ? WHERE profile_id = ? AND game_id = ?").run('partial','A','game');process.exit(23)`,file],{encoding:'utf8'});assert.equal(crash.status,23,crash.stderr);
 a=await openSQLiteConfirmedGames(connect());assert.equal((await a.readConfirmed('A','game')).serverVersion,5,'uncommitted process termination cannot replace snapshot');
 // Close waits behind an outstanding transaction; new calls are rejected.
 let resume,entered;const held=new Promise(r=>{entered=r});pause=async()=>{entered();await new Promise(r=>{resume=r})};
 const write=a.saveConfirmed('A',[game('game',6,35)]);await held;const close=a.close();await rejects(()=>a.readConfirmed('A','game'),'STORAGE_UNAVAILABLE');resume();await write;await close;
 a=await openSQLiteConfirmedGames(connect());assert.equal((await a.readConfirmed('A','game')).serverVersion,6);
 await a.close();
 const committedView=game('game',7,45),committedRecord={schemaVersion:1,profileId:'A',gameId:'game',serverVersion:7,view:committedView};
 const committed=spawnSync(process.execPath,['--input-type=commonjs','-e',`const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.exec("PRAGMA synchronous = FULL; BEGIN IMMEDIATE");d.prepare("UPDATE confirmed_games SET server_version = ?, snapshot = ? WHERE profile_id = ? AND game_id = ?").run(7,process.argv[2],'A','game');d.exec('COMMIT');process.exit(24)`,file,JSON.stringify(committedRecord)],{encoding:'utf8'});assert.equal(committed.status,24,committed.stderr);
 a=await openSQLiteConfirmedGames(connect());assert.deepEqual((await a.readConfirmed('A','game')).view,committedView,'committed snapshot survives process exit without normal close');await a.saveConfirmed('A',[committedView]);assert.equal((await a.readConfirmed('A','game')).serverVersion,7,'repeating confirmed content does not create another game');
 const raw=new DatabaseSync(file);raw.prepare('UPDATE confirmed_games SET snapshot = ? WHERE profile_id = ? AND game_id = ?').run('invalid','A','other');
 await rejects(()=>a.readConfirmed('A','other'),'STORAGE_CORRUPT');await rejects(()=>a.saveConfirmed('A',[game('other',3)]),'STORAGE_CORRUPT');raw.close();await a.close();
 const futureFile=path.join(root,'future.db'),future=new DatabaseSync(futureFile);future.exec('CREATE TABLE keep (value TEXT); INSERT INTO keep VALUES (\'original\'); PRAGMA user_version = 2');future.close();
 await rejects(()=>openSQLiteConfirmedGames(connect(futureFile)),'STORAGE_CORRUPT');const kept=new DatabaseSync(futureFile);assert.equal(kept.prepare('SELECT value FROM keep').get().value,'original');assert.equal(kept.prepare('PRAGMA user_version').get().user_version,2);kept.close();
 const legacyFile=path.join(root,'legacy.db'),legacy=new DatabaseSync(legacyFile);legacy.exec('CREATE TABLE original (value TEXT)');legacy.close();await rejects(()=>openSQLiteConfirmedGames(connect(legacyFile)),'STORAGE_CORRUPT');
 const interruptedFile=path.join(root,'interrupted.db'),interrupted=connect(interruptedFile),exclusive=interrupted.withExclusiveTransactionAsync;
 interrupted.withExclusiveTransactionAsync=work=>exclusive(async tx=>{await work(tx);throw Error('initialization interrupted')});
 await rejects(()=>openSQLiteConfirmedGames(interrupted),'STORAGE_UNAVAILABLE');const retried=await openSQLiteConfirmedGames(connect(interruptedFile));await retried.saveConfirmed('A',[game()]);await retried.close();
 console.log('SQLite repository: real-file reopen, isolation, bound SQL, version ordering/collision, atomic rollback, lock contention/retry, durability check, process exit before commit, close ordering, schema retention and interrupted initialization passed.');
}finally{rmSync(root,{recursive:true,force:true})}
