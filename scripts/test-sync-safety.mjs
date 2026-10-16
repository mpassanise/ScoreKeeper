import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// No production data or services. Each case uses an independent durable image.
const output=mkdtempSync(path.join(tmpdir(),'scorekeeper-safety-'));
try {
 execFileSync(process.execPath,['node_modules/typescript/bin/tsc','shared/local-games.ts','shared/game-import.ts','--target','ES2022','--module','commonjs','--moduleResolution','node','--skipLibCheck','--outDir',output],{stdio:'inherit'});
 writeFileSync(path.join(output,'package.json'),'{"type":"commonjs"}');
 const {LocalGames}=await import(pathToFileURL(path.join(output,'local-games.js')).href);
 const {importPendingGames}=await import(pathToFileURL(path.join(output,'game-import.js')).href);
 const {ApiError}=await import(pathToFileURL(path.join(output,'api.js')).href);
 let sequence=0;
 const uuid=()=>`fixture-${++sequence}`;
 function device(initial=null) {
  let durable=initial, nextFault=null;
  const storage={
   read:async()=>durable,
   write:async value=>{
    const fault=nextFault;nextFault=null;
    if(fault==='before')throw new Error('Injected: before durable write');
    durable=value;
    if(fault==='after')throw new Error('Injected: after durable write');
   }
  };
  return {storage,reopen:()=>new LocalGames(storage,uuid),image:()=>durable,fail:point=>{nextFault=point}};
 }
 async function fixture() {
  const d=device(),local=d.reopen();
  let view=await local.create(uuid(),'Preservation fixture',['A','B'],'low',{playStyle:'free',scoreMode:'add',endCondition:'manual'});
  view=await local.act(view.game,{action:'score',playerId:view.game.players[0].id,points:25});
  view=await local.markDeviceOnly(view.game.id,true);
  return {d,local,view};
 }

 // A rejected pre-commit write cannot remove a saved score or change identity.
 {
  const {d,local,view}=await fixture(),before=d.image();
  d.fail('before');
  await assert.rejects(local.act(view.game,{action:'score',playerId:view.game.players[1].id,points:10}),/before durable/);
  assert.equal(d.image(),before);
  assert.deepEqual((await d.reopen().get(view.game.id)).game,view.game);
  d.fail('before');
  await assert.rejects(local.deleteGame(view.game),/before durable/);
  assert.equal(d.image(),before,'failed deletion preserves the full original');
 }
 // Simulate an ambiguous adapter response: data committed, caller saw failure.
 // Recovery must read durable state; retrying a stale snapshot cannot append twice.
 {
  const {d,local,view}=await fixture();
  d.fail('after');
  const action={action:'score',playerId:view.game.players[1].id,points:10};
  await assert.rejects(local.act(view.game,action),/after durable/);
  const reopened=d.reopen(),saved=await reopened.get(view.game.id);
  assert.equal(saved.game.entries.length,2);
  await assert.rejects(reopened.act(view.game,action),e=>e.status===409);
  assert.deepEqual((await reopened.get(view.game.id)).game,saved.game);
 }
 // Corrupt legacy data is retained byte-for-byte for recovery, never reset.
 for(const raw of ['broken JSON','{}','[{"id":"incomplete"}]']) {
  const d=device(raw);
  await assert.rejects(d.reopen().create(uuid(),'New',['A','B'],'high'),/original data has been kept/);
  assert.equal(d.image(),raw);
 }
 // Cloud commit succeeds but response is lost. Reopen the device, list/get the
 // confirmed same-ID content, then retry import without creating another copy.
 {
  const {d,local,view}=await fixture(),server=new Map();let imports=0;
  const cloud={
   list:async()=>[...server.values()],
   get:async id=>{if(!server.has(id))throw new ApiError(404,'Missing');return {game:structuredClone(server.get(id))}},
   import:async game=>{imports++;server.set(game.id,structuredClone(game));throw new Error('Injected: lost import acknowledgement')}
  };
  await assert.rejects(importPendingGames(local,cloud,true,()=>{}),/lost import/);
  assert.equal((await d.reopen().get(view.game.id)).game.deviceOnly,true);
  assert.deepEqual((await d.reopen().get(view.game.id)).game.entries,view.game.entries);
  const result=await importPendingGames(d.reopen(),cloud,true,()=>{});
  assert.equal(result.imported,0);assert.equal(imports,1);assert.equal(server.size,1);
  assert.equal((await d.reopen().get(view.game.id)).game.deviceOnly,false);
  assert.deepEqual((await d.reopen().get(view.game.id)).game.entries,view.game.entries);
 }
 // Same ID with different scores is a conflict, never a confirmed import.
 {
  const {d,local,view}=await fixture(),before=d.image();
  const changed={...structuredClone(view.game),entries:[]};
  const cloud={
   list:async()=>[changed],get:async()=>({game:changed}),
   import:async()=>{throw new ApiError(409,'Existing game')}
  };
  await assert.rejects(importPendingGames(local,cloud,true,()=>{}),/device copy was kept/);
  assert.equal(d.image(),before);
 }
 // A failed acknowledgement marker retains the original. A later confirmed
 // read can reconcile it without reposting the game.
 {
  const {d,local,view}=await fixture();let imports=0;
  const cloud={list:async()=>[view.game],get:async()=>({game:view.game}),import:async()=>{imports++;throw new Error('Unexpected repost')}};
  d.fail('before');
  await assert.rejects(importPendingGames(local,cloud,true,()=>{}),/before durable/);
  assert.equal((await d.reopen().get(view.game.id)).game.deviceOnly,true);
  await importPendingGames(d.reopen(),cloud,true,()=>{});
  assert.equal(imports,0);
  assert.equal((await d.reopen().get(view.game.id)).game.deviceOnly,false);
 }
 console.log('Sync safety baseline: rejected/ambiguous local commits, relaunch, deletion failure, corrupt legacy data, lost import acknowledgement, conflict preservation and marker recovery passed.');
 console.log('Scope: current LocalGames/import behavior only; does not certify a future outbox, cross-tab transactions or server operation idempotency.');
} finally {
 rmSync(output,{recursive:true,force:true});
}
