/** Controlled browser/storage integration, not production auth or UI acceptance. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {chromium} from '../tests/browser/node_modules/playwright/index.mjs';
const root=mkdtempSync(path.join(tmpdir(),'scorekeeper-browser-'));
let browser,server;
try{
 execFileSync(process.execPath,['node_modules/typescript/bin/tsc','shared/repository/indexeddb-confirmed-games.ts','shared/repository/durable-account.ts','--target','ES2022','--module','commonjs','--moduleResolution','node','--strict','--skipLibCheck','--outDir',root],{stdio:'inherit'});
 writeFileSync(path.join(root,'package.json'),'{"type":"commonjs"}');const require=createRequire(import.meta.url),{LocalGames,gameView}=require(path.join(root,'local-games.js'));
 const modules=[];
 function collect(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())collect(file);else if(file.endsWith('.js'))modules.push(`${JSON.stringify(path.relative(root,file).replaceAll('\\','/').slice(0,-3))}:function(require,module,exports){\n${readFileSync(file,'utf8')}\n}`)}}collect(root);
 const bundle=`(()=>{const modules={${modules.join(',')}},cache={};function load(id){if(cache[id])return cache[id].exports;if(!modules[id])throw Error('Missing module '+id);const module=cache[id]={exports:{}};modules[id](name=>{const parts=(id.slice(0,id.lastIndexOf('/')+1)+name).split('/'),out=[];for(const part of parts){if(part==='..')out.pop();else if(part!=='.')out.push(part)}return load(out.join('/'))},module,module.exports);return module.exports}globalThis.fixtureLoad=load})();`;
 const cap={version:1,receipts:'retained',atomicGameAndReceipt:true,kinds:['action','delete'],actions:['score','select','finish','resume','undo','edit','rules']},status={profileId:'A',deletionStatus:null,deletionEnabled:true,gameOperations:cap};
 const players=[{id:randomUUID(),name:'First'},{id:randomUUID(),name:'Second'}];
 const initial=gameView({id:randomUUID(),name:'Browser fixture',players,winner:'high',entries:[],next:players[0].id,finished:false,version:1,updated:'2026-10-20T00:00:00Z'});
 let remote=initial,tail=Promise.resolve(),requests=0,effects=0,dropReply=true,deleted=false;
 const receipts=new Map(),wires=[],senders=new Set();let releaseFirst;const bothTabs=new Promise(resolve=>releaseFirst=resolve);
 const json=(res,value,code=200)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
 server=createServer((req,res)=>{void(async()=>{
  if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end('<!doctype html><title>Scorekeeper repository fixture</title><script src="/fixture.js"></script>');return}
  if(req.url==='/fixture.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(bundle);return}
  if(!['/account','/game-operations',`/games/${initial.game.id}`].includes(req.url)){json(res,{error:'No fixture route'},404);return}
  requests++;if(!/^Bearer fixture-A:tab[0-9]+$/.test(req.headers.authorization??'')){json(res,{error:'Fixture identity denied'},401);return}
  if(req.url==='/account'){json(res,status);return}
  if(req.url===`/games/${initial.game.id}`){json(res,deleted?{error:'Deleted'}:remote,deleted?404:200);return}
  if(req.url!=='/game-operations'||req.method!=='POST'){json(res,{error:'No fixture route'},404);return}
  let wire='';for await(const chunk of req){wire+=chunk;if(wire.length>2000000)throw Error('Oversized test request')}
  wires.push(wire);const op=JSON.parse(wire);
  if(receipts.size===0){senders.add(req.headers.authorization);if(senders.size>=2)releaseFirst();await bothTabs}
  // Serialize commit+receipt only; dropping a response cannot hold the commit lock.
  const commit=tail.then(async()=>{
   const retained=receipts.get(op.operationId);if(retained){assert.equal(retained.wire,wire);return retained.ack}
   const expected=op.kind==='delete'?op.expectedVersion:op.command.expectedVersion;
   let ack={operationId:op.operationId,gameId:op.gameId,outcome:'rejected',committedVersion:null,observedVersion:remote.game.version,errorCode:deleted?'GAME_DELETED':'VERSION_CONFLICT'};
   if(!deleted&&expected===remote.game.version){
    if(op.kind==='delete'){deleted=true;remote={...remote,game:{...remote.game,version:remote.game.version+1}}}
    else{let raw=JSON.stringify([remote.game]);const local=new LocalGames({read:async()=>raw,write:async value=>{raw=value}},()=>op.command.entryId);const next=await local.act(remote.game,op.command);remote=gameView({...next.game,updated:new Date().toISOString()})}
    effects++;ack={...ack,outcome:'applied',committedVersion:remote.game.version,errorCode:null};
   }
   receipts.set(op.operationId,{wire,ack});return ack;
  });tail=commit.then(()=>{},()=>{});const ack=await commit;
  if(dropReply&&ack.outcome==='applied'){dropReply=false;res.destroy();return}json(res,ack);
 })().catch(error=>{console.error(error);json(res,{error:'Fixture failure'},500)})});
 await new Promise(resolve=>server.listen(0,'localhost',resolve));const origin=`http://localhost:${server.address().port}`;
 browser=await chromium.launch({headless:true});
 const failures=[],contexts=[];let tab=0;
 async function page(context){const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>failures.push(e.message));await page.goto(origin);await page.evaluate(tag=>{
  const {openConfirmedGames}=fixtureLoad('repository/indexeddb-confirmed-games'),{createDurableAccountRepository}=fixtureLoad('repository/durable-account');
  let repository,access,lease,worker;
  globalThis.client={
   async open(status,seed,cold=false){repository=await openConfirmedGames(indexedDB,'browser-acceptance');access=createDurableAccountRepository(repository,{coldWritesEnabled:true,allowPendingWrites:true});lease=await access.restore('A');if(!cold)lease=await access.verify(lease??await access.beginVerification('A','A'),status);if(seed){await access.observeGame(lease,seed);await access.prepareScoring(lease,seed)}return !!lease},
   async verify(status){lease=await access.verify(lease,status)},
   async enqueue(op){return access.enqueueScoring(lease,op)},
   async read(id){return access.readScoringGame(lease,id)},
   async queue(){return access.outbox(lease).read()},
   async recovery(id){return access.readRecovery(lease,id)},
   async choose(id,revision,decision){return access.chooseAccountRecovery(lease,id,revision,decision)},
   async deliver(){worker=access.httpDelivery(lease,location.origin,async()=> 'fixture-A:'+tag,{enabled:true,retryDelayMs:0,stepTimeoutMs:3000,passTimeoutMs:15000});try{return await worker.connect()}finally{worker.close()}},
   async signOut(){await access.signOut(lease)},
   async close(){await access.close()}
  };
 },'tab'+(++tab));return page}
 const call=(p,name,...args)=>p.evaluate(({name,args})=>client[name](...args),{name,args});
 const score=(view,points)=>({protocolVersion:1,kind:'action',operationId:randomUUID(),gameId:view.game.id,command:{action:'score',expectedVersion:view.game.version,points,playerId:view.game.next,entryId:randomUUID()}});
 const a=await browser.newContext(),b=await browser.newContext();contexts.push(a,b);const a1=await page(a),a2=await page(a),b1=await page(b);
 await call(a1,'open',status,initial);await call(a2,'open',status,null);await call(b1,'open',status,initial);
 const first=score(initial,5);await call(a1,'enqueue',first);
 // Separate pages share actual browser IndexedDB; both workers may replay a head.
 await Promise.all([call(a1,'deliver'),call(a2,'deliver')]);
 for(let i=0;i<3&&(await call(a1,'read',initial.game.id)).pendingOperations;i++)await call(a1,'deliver');
 assert.equal(senders.size,2,'both tab workers must send before the first commit');assert.equal(effects,1);assert.equal(remote.game.entries.length,1);assert.equal(remote.game.entries[0].id,first.command.entryId);const replays=wires.filter(w=>JSON.parse(w).operationId===first.operationId);assert.ok(replays.length>=2,'lost reply/concurrent workers replay original request');assert.ok(replays.every(w=>w===replays[0]),'every replay uses identical retained bytes');assert.equal((await call(a1,'read',initial.game.id)).sync,'confirmed');
 console.log('Chromium same-origin tabs: shared real IndexedDB and concurrent HTTP replay produce one effect after a lost reply');
 // Device B still has version 1; keep both histories when its offline intent conflicts.
 const stale=score(initial,11);await call(b1,'enqueue',stale);assert.equal((await call(b1,'deliver')).phase,'needs-review');assert.equal(effects,1);
 const review=await call(b1,'recovery',initial.game.id);assert.ok(review.review.copies.some(c=>c.view?.game.entries.some(e=>e.id===stale.command.entryId)));assert.ok(review.review.copies.some(c=>c.view?.game.entries.some(e=>e.id===first.command.entryId)));assert.equal(review.review.canChooseAccount,true);
 const decision=randomUUID();await call(b1,'choose',initial.game.id,review.revision,decision);await call(b1,'choose',initial.game.id,review.revision,decision);assert.ok((await call(b1,'recovery',initial.game.id)).review.copies.some(c=>c.view?.game.entries.some(e=>e.id===stale.command.entryId)),'choosing account never drops the conflicting device history');
 console.log('Chromium isolated stores: version conflict pauses delivery; explicit repeatable recovery retains both histories');
 // Close/reopen the repository with no auth/network, in an offline browser context.
 await call(a2,'close');await call(a1,'close');await a.setOffline(true);const before=requests;await call(a1,'open',null,null,true);const cold=await call(a1,'read',initial.game.id);assert.equal(cold.canScore,true);const second=score(cold.view,3);await call(a1,'enqueue',second);assert.equal(requests,before,'cold local save cannot require HTTP');assert.equal((await call(a1,'read',initial.game.id)).view.game.entries.at(-1).id,second.command.entryId);
 await a.setOffline(false);await call(a1,'verify',status);assert.equal((await call(a1,'deliver')).phase,'synced');assert.equal(effects,2);assert.deepEqual(remote.game.entries.map(e=>e.id),[first.command.entryId,second.command.entryId]);
 console.log('Chromium offline reopen: retained grant saves locally with original entry ID, then reconnect delivers once');
 // A second tab's durable sign-out revokes a stale writer without clearing history.
 await call(a2,'open',status,null);const next=score((await call(a1,'read',initial.game.id)).view,7);await call(a2,'signOut');await assert.rejects(()=>call(a1,'enqueue',next),/STALE_ACCOUNT|Account access changed|account/i);assert.equal(effects,2);
 await call(a1,'close');await call(a2,'close');await call(a1,'open',status,null);assert.equal((await call(a1,'read',initial.game.id)).view.game.entries.length,2);
 // Confirmed delete retains before-delete evidence across a real page reload.
 const view=(await call(a1,'read',initial.game.id)).view,deletion={protocolVersion:1,kind:'delete',operationId:randomUUID(),gameId:view.game.id,expectedVersion:view.game.version};await call(a1,'enqueue',deletion);assert.equal((await call(a1,'read',initial.game.id)).kind,'pending-delete');await call(a1,'deliver');await call(a1,'close');await a1.close();const reopened=await page(a);await call(reopened,'open',null,null,true);assert.equal((await call(reopened,'read',initial.game.id)).kind,'deleted');assert.ok((await call(reopened,'recovery',initial.game.id)).review.copies.some(c=>c.view?.game.entries.length===2));assert.equal(effects,3);
 console.log('Chromium lifecycle/deletion: cross-tab sign-out rejects stale writes; page reload preserves tombstone and complete before-delete history');
 assert.deepEqual(failures,[]);for(const context of contexts)await context.close();
 console.log('Browser repository/HTTP fixture acceptance passed; real Entra/API/SQL, complete app UI, Safari and physical iPhone remain unverified');
}finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}rmSync(root,{recursive:true,force:true})}
