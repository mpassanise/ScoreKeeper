// Reproducible diagnostic, not a timing assertion or a physical-iPhone benchmark.
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {DatabaseSync} from 'node:sqlite';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {IDBFactory} from '../tests/offline/node_modules/fake-indexeddb/build/esm/index.js';
const root=mkdtempSync(path.join(tmpdir(),'scorekeeper-read-benchmark-'));
try{
 execFileSync(process.execPath,['node_modules/typescript/bin/tsc','shared/repository/durable-account.ts','shared/repository/indexeddb-confirmed-games.ts','shared/repository/sqlite-confirmed-games.ts','--target','ES2022','--module','commonjs','--moduleResolution','node','--strict','--skipLibCheck','--outDir',root],{stdio:'inherit'});
 writeFileSync(path.join(root,'package.json'),'{"type":"commonjs"}');const require=createRequire(import.meta.url);
 const {createDurableAccountRepository}=require(path.join(root,'repository/durable-account.js'));
 const {openConfirmedGames}=require(path.join(root,'repository/indexeddb-confirmed-games.js'));
 const {openSQLiteConfirmedGames}=require(path.join(root,'repository/sqlite-confirmed-games.js'));
 const {snapshot}=require(path.join(root,'repository/confirmed-games.js'));
 const {gameView}=require(path.join(root,'local-games.js'));
 const gameId=randomUUID(),playerId=randomUUID(),players=[{id:playerId,name:'One'},{id:randomUUID(),name:'Two'}],entries=[],operations=[];
 for(let n=0;n<9000;n++){
  const entryId=randomUUID(),operationId=randomUUID();entries.push({id:entryId,playerId,points:0});
  const wire=JSON.stringify({protocolVersion:1,kind:'action',operationId,gameId,command:{action:'score',expectedVersion:n+1,points:0,playerId,entryId}});
  operations.push({wire,status:'applied',localTime:'2026-10-19T00:00:00Z',acknowledgement:{operationId,gameId,outcome:'applied',committedVersion:n+2,observedVersion:n+1,errorCode:null}});
 }
 const view=gameView({id:gameId,name:'Large',players,winner:'high',entries,next:playerId,finished:false,version:9001,updated:'2026-10-19T00:00:00Z',playStyle:'free',scoreMode:'add'});
 const state={schemaVersion:2,profileId:'A',games:[{gameId,base:snapshot('A',view),projection:view,operations:[],reservedEntryIds:entries.map(e=>e.id)}],archive:Array.from({length:18},(_,i)=>{const batch=operations.slice(i*500,(i+1)*500),last=JSON.parse(batch.at(-1).wire);return {id:last.operationId,gameId,kind:'confirmed',serverVersion:last.command.expectedVersion+1,operations:batch}})};
 const bytes=Buffer.byteLength(JSON.stringify(state)),file=path.join(root,'native.db');
 function queries(db){return {execAsync:async sql=>db.exec(sql),runAsync:async(sql,...p)=>db.prepare(sql).run(...p),getFirstAsync:async(sql,...p)=>db.prepare(sql).get(...p)||null,getAllAsync:async(sql,...p)=>db.prepare(sql).all(...p)}}
 function sqlite(){const db=new DatabaseSync(file);return {...queries(db),closeAsync:async()=>db.close(),withExclusiveTransactionAsync:async work=>{const tx=new DatabaseSync(file);try{tx.exec('BEGIN');try{await work(queries(tx));tx.exec('COMMIT')}catch(e){tx.exec('ROLLBACK');throw e}}finally{tx.close()}}}}
 for(const [adapter,open]of [['IndexedDB',()=>openConfirmedGames(new IDBFactory(),'benchmark')],['SQLite',()=>openSQLiteConfirmedGames(sqlite())]]){
  const repo=await open(),access=createDurableAccountRepository(repo);
  try{
   const lease=await access.verify(await access.beginVerification('A','A'),{profileId:'A',deletionStatus:null});
   await repo.documents.write('game-outbox:A',0,state);const trackedMs=[];
   for(let i=0;i<3;i++){const start=performance.now();await access.readGame(lease,gameId);trackedMs.push(Math.round(performance.now()-start))}
   const start=performance.now();await access.readGame(lease,randomUUID());
   console.log(JSON.stringify({adapter,bytes,archivedOperations:9000,trackedMs,untrackedMs:Math.round(performance.now()-start)}));
  }finally{await access.close()}
 }
}finally{rmSync(root,{recursive:true,force:true})}
