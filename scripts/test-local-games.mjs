import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const output=path.resolve('.sites-runtime/local-tests');mkdirSync(output,{recursive:true});
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','shared/api.ts','shared/local-games.ts','shared/presets.ts','shared/game-import.ts','shared/game-time.ts','shared/game-start.ts','--target','ES2022','--module','commonjs','--moduleResolution','node','--skipLibCheck','--outDir',output],{stdio:'inherit'});
writeFileSync(path.join(output,'package.json'),'{"type":"commonjs"}');
const {LocalGames}=await import(pathToFileURL(path.join(output,'local-games.js')).href);
let raw=null;const storage={read:async()=>raw,write:async value=>{raw=value}};
let api=new LocalGames(storage,randomUUID);
let v=await api.create(randomUUID(),'Target',['A','B'],'high',{endCondition:'target',targetScore:20});
v=await api.act(v.game,{action:'score',points:25});assert.equal(v.game.finished,true);assert.equal(v.game.entries.length,1);assert.deepEqual(v.winnerIds,[v.game.players[0].id]);
api=new LocalGames(storage,randomUUID);v=await api.get(v.game.id);assert.equal(v.totals[v.game.players[0].id],25,'relaunch restores saved scores');
await assert.rejects(()=>api.act(v.game,{action:'resume'}),/Undo or edit/);
v=await api.act(v.game,{action:'edit',entryId:v.game.entries[0].id,points:10});assert.equal(v.game.finished,false);
v=await api.act(v.game,{action:'edit',entryId:v.game.entries[0].id,points:20});assert.equal(v.game.finished,true);
v=await api.act(v.game,{action:'undo'});assert.equal(v.game.finished,false);assert.equal(v.game.entries.length,0);
let r=await api.create(randomUUID(),'Rounds',['A','B'],'high',{endCondition:'rounds',roundLimit:1});
r=await api.act(r.game,{action:'score',points:5});assert.equal(r.game.finished,false);
r=await api.act(r.game,{action:'select',playerId:r.game.players[0].id});r=await api.act(r.game,{action:'score',points:5});assert.equal(r.game.finished,false,'repeated player cannot complete a round');
r=await api.act(r.game,{action:'score',points:10});assert.equal(r.game.finished,true);assert.equal(r.winnerIds.length,2);
r=await api.act(r.game,{action:'undo'});assert.equal(r.game.finished,false);
const stale=r.game;r=await api.act(r.game,{action:'score',points:-3});await assert.rejects(()=>api.act(stale,{action:'score',points:1}),e=>e.status===409);
const original=raw;api=new LocalGames({read:async()=>raw,write:async()=>{throw new Error('Storage full')}},randomUUID);await assert.rejects(()=>api.act(r.game,{action:'undo'}),/Storage full/);assert.equal(raw,original,'failed save retains original');
api=new LocalGames(storage,randomUUID);raw='broken JSON';await assert.rejects(()=>api.create(randomUUID(),'New',['A','B'],'high'),/original data has been kept/);assert.equal(raw,'broken JSON');
raw=original;await assert.rejects(()=>api.create(randomUUID(),'Bad',['A','B'],'high',{endCondition:'rounds',roundLimit:0}));await assert.rejects(()=>api.create(randomUUID(),'Bad',['A','B'],'high',{playStyle:'free',endCondition:'rounds',roundLimit:2}));
const legacy=JSON.parse(raw)[0];delete legacy.version;delete legacy.endCondition;legacy.updated=Date.now();raw=JSON.stringify([legacy]);assert.equal((await api.read())[0].version,1);assert.equal(typeof (await api.read())[0].updated,'string');
const {presets,presetRules}=await import(pathToFileURL(path.join(output,'presets.js')).href);
assert.equal(new Set(presets.map(p=>p.id)).size,presets.length);
for(const preset of presets){const settings=presetRules(preset);const created=await api.create(randomUUID(),preset.name,['A','B'],preset.winner,settings);settings.scoreMode='total';assert.equal(created.game.scoreMode,preset.rules.scoreMode,'preset rule snapshot remains independent');}
let free=await api.create(randomUUID(),'Free',['A','B'],'high',{playStyle:'free'});const b=free.game.players[1].id;
await assert.rejects(()=>api.act(free.game,{action:'score',points:4}),/Choose the player/);
await assert.rejects(()=>api.act(free.game,{action:'score',points:4,playerId:randomUUID()}),/Choose the player/);
free=await api.act(free.game,{action:'score',points:4,playerId:b});free=await api.act(free.game,{action:'score',points:6,playerId:b});assert.equal(free.totals[b],10);assert.equal(free.game.next,b,'free scoring retains chosen player');assert.equal(free.totals[free.game.players[0].id],0);
let snapshot=await api.create(randomUUID(),'Totals',['A','B'],'high',{playStyle:'free',scoreMode:'total',endCondition:'target',targetScore:50});const a=snapshot.game.players[0].id;
snapshot=await api.act(snapshot.game,{action:'score',points:30,playerId:a});snapshot=await api.act(snapshot.game,{action:'score',points:40,playerId:a});assert.equal(snapshot.totals[a],40);assert.equal(snapshot.game.finished,false,'totals are not summed');
snapshot=await api.act(snapshot.game,{action:'edit',entryId:snapshot.game.entries[0].id,points:80});assert.equal(snapshot.totals[a],40);assert.equal(snapshot.game.finished,false,'editing an older snapshot does not replace the newest total');
snapshot=await api.act(snapshot.game,{action:'undo'});assert.equal(snapshot.totals[a],80);assert.equal(snapshot.game.finished,true,'undo recalculates from restored total');
snapshot=await api.act(snapshot.game,{action:'edit',entryId:snapshot.game.entries[0].id,points:20});assert.equal(snapshot.game.finished,false);
let penalties=await api.create(randomUUID(),'Penalties',['A','B'],'low',{playStyle:'free',endCondition:'target',targetScore:20});penalties=await api.act(penalties.game,{action:'score',points:20,playerId:penalties.game.players[0].id});assert.equal(penalties.game.finished,true);assert.deepEqual(penalties.winnerIds,[penalties.game.players[1].id]);
await assert.rejects(()=>api.create(randomUUID(),'Impossible',['A','B'],'high',{scoreMode:'total',endCondition:'target',targetScore:10000}),/9,999/);
console.log('Free scoring, total snapshots, preset validation and low-score thresholds passed.');
console.log('Local persistence, relaunch, rules, ties, corrections, stale versions, legacy saves and storage failures passed.');

const {pendingImports,importPendingGames}=await import(pathToFileURL(path.join(output,'game-import.js')).href);
const {ApiError}=await import(pathToFileURL(path.join(output,'api.js')).href);
const localCopies=(await api.read()).slice(0,2);const originals=JSON.stringify(localCopies);const localSource={read:async()=>localCopies};
let accountGames=new Map([[localCopies[0].id,localCopies[0]]]);let importCalls=[];
const cloudSource={list:async()=>[...accountGames.values()],get:async id=>{if(!accountGames.has(id))throw new ApiError(404,'Missing');return {game:accountGames.get(id)}},import:async game=>{importCalls.push(game.id);accountGames.set(game.id,game);return {game}}};
assert.equal((await pendingImports(localSource,cloudSource)).length,1,'existing imports are excluded before click');
let remaining=-1;await importPendingGames(localSource,cloudSource,true,n=>remaining=n);assert.equal(remaining,0);assert.deepEqual(importCalls,[localCopies[1].id]);assert.equal((await pendingImports(localSource,cloudSource)).length,0,'import stays hidden after reload');assert.equal(JSON.stringify(localCopies),originals,'local copies untouched');
accountGames=new Map();assert.equal((await pendingImports(localSource,cloudSource)).length,2,'another account has its own pending imports');
importCalls=[];let fail=true;const partialCloud={...cloudSource,import:async game=>{if(game.id===localCopies[1].id&&fail)throw new ApiError(503,'Unavailable');return cloudSource.import(game)}};
await assert.rejects(()=>importPendingGames(localSource,partialCloud,true,n=>remaining=n),e=>e.status===503);assert.equal(remaining,1,'failed game remains offered');fail=false;await importPendingGames(localSource,partialCloud,true,n=>remaining=n);assert.equal(remaining,0);assert.equal(importCalls.filter(id=>id===localCopies[0].id).length,1,'retry skips already-saved game');
const page=Array.from({length:200},(_,i)=>({id:'other-'+i}));assert.equal((await pendingImports(localSource,cloudSource,page)).length,0,'older imports outside list page are confirmed by ID');
const checkFailure={...cloudSource,get:async()=>{throw new ApiError(503,'Unavailable')}};await assert.rejects(()=>pendingImports(localSource,checkFailure,page),e=>e.status===503,'server failures are not treated as missing games');
const fresh={...localCopies[0],id:randomUUID()};assert.equal((await pendingImports({read:async()=>[...localCopies,fresh]},cloudSource)).length,1,'new local games re-enable import');
const conflictCloud={list:async()=>[],get:cloudSource.get,import:async()=>{throw new ApiError(409,'Already imported')}};await importPendingGames({read:async()=>[fresh]},conflictCloud,true,n=>remaining=n);assert.equal(remaining,0,'confirmed existing game hides import');
console.log('Import visibility, account scope, partial failure/retry, capped lists, new games and retained originals passed.');

const {formatGameTime}=await import(pathToFileURL(path.join(output,'game-time.js')).href);
let timed=await api.create(randomUUID(),'Timed',['A','B'],'high',{endCondition:'target',targetScore:10});const started=timed.game.startedAt;assert.ok(started);assert.equal(timed.game.endedAt,null);assert.equal(started,timed.game.updated);
timed=await api.act(timed.game,{action:'score',points:10});const ended=timed.game.endedAt;assert.ok(ended);assert.equal(timed.game.startedAt,started);
timed=await api.act(timed.game,{action:'edit',entryId:timed.game.entries[0].id,points:11});assert.equal(timed.game.endedAt,ended,'edit after finish preserves end');
timed=await api.act(timed.game,{action:'undo'});assert.equal(timed.game.endedAt,null,'undo completion clears end');assert.equal(timed.game.startedAt,started);
timed=await api.act(timed.game,{action:'finish'});assert.ok(timed.game.endedAt);timed=await api.act(timed.game,{action:'resume'});assert.equal(timed.game.endedAt,null);assert.equal((await api.get(timed.game.id)).game.startedAt,started,'timestamps persist across reopening');
const unknown={...timed.game};delete unknown.startedAt;delete unknown.endedAt;await api.put(unknown);assert.equal((await api.get(timed.game.id)).game.startedAt,undefined,'legacy start is not inferred from updated');assert.equal(formatGameTime(undefined),null);assert.equal(formatGameTime('broken'),null);assert.ok(formatGameTime(started));
console.log('Game start/end lifecycle, immutable start, completion corrections, legacy timestamps and date formatting passed.');

// Score-cap boundaries and failed-save preservation.
for(const scoreMode of ['add','total']){
 let capped=await api.create(randomUUID(),'Cap '+scoreMode,['A','B'],'high',{playStyle:'free',scoreMode});const playerId=capped.game.players[0].id;
 capped=await api.act(capped.game,{action:'score',playerId,points:9999});assert.equal(capped.totals[playerId],9999);
 const before=raw;await assert.rejects(()=>api.act(capped.game,{action:'score',playerId,points:scoreMode==='add'?1:10000}),/cannot exceed 9,999/);assert.equal(raw,before,'rejected overflow leaves persisted game untouched');
 await assert.rejects(()=>api.act(capped.game,{action:'edit',entryId:capped.game.entries[0].id,points:10000}),/cannot exceed 9,999/);
 capped=await api.act(capped.game,{action:'score',playerId,points:-5});assert.equal(capped.totals[playerId],scoreMode==='add'?9994:-5,'negative adjustments remain supported');
}
const boundary=await api.create(randomUUID(),'Boundary',['A','B'],'high',{endCondition:'target',targetScore:9999});assert.equal(boundary.game.targetScore,9999);
await assert.rejects(()=>api.create(randomUUID(),'Too high',['A','B'],'high',{endCondition:'target',targetScore:10000}),/9,999/);
console.log('9,999 target and total boundaries, overflow rejection, corrections and negative adjustments passed.');

// Unsupported games must not block compatible imports or alter local originals.
const compatible={...boundary.game,id:randomUUID(),endCondition:'manual',targetScore:undefined};
const advanced={...compatible,id:randomUUID(),playStyle:'free'};
const mixedGames=[compatible,advanced],mixedOriginal=JSON.stringify(mixedGames),savedImports=new Map();let attempted=[];
const mixedLocal={read:async()=>mixedGames};
const mixedCloud={list:async()=>[...savedImports.values()],get:async id=>{if(!savedImports.has(id))throw new ApiError(404,'Missing');return {game:savedImports.get(id)}},import:async game=>{attempted.push(game.id);savedImports.set(game.id,game);return {game}}};
let pendingCount=-1;const firstImport=await importPendingGames(mixedLocal,mixedCloud,false,n=>pendingCount=n);
assert.deepEqual(firstImport,{imported:1,existing:0,blocked:1});assert.deepEqual(attempted,[compatible.id]);assert.equal(pendingCount,1);assert.equal(JSON.stringify(mixedGames),mixedOriginal);
const blockedOnly=await importPendingGames(mixedLocal,mixedCloud,false,n=>pendingCount=n);assert.deepEqual(blockedOnly,{imported:0,existing:0,blocked:1});assert.equal(attempted.length,1,'unsupported games never go to an older API');
const retrySupported=await importPendingGames(mixedLocal,mixedCloud,true,n=>pendingCount=n);assert.deepEqual(retrySupported,{imported:1,existing:0,blocked:0});assert.equal(pendingCount,0);assert.deepEqual(attempted,[compatible.id,advanced.id]);assert.equal(JSON.stringify(mixedGames),mixedOriginal);
console.log('Compatible imports proceed, unsupported games stay local, and refreshed support enables retry without duplicates.');
{
// Score-limit end-of-round fairness, corrections, persistence, and cloud rollout.
let roundRaw=null;
const roundApi=new LocalGames({read:async()=>roundRaw,write:async value=>{roundRaw=value}},randomUUID);
let final=await roundApi.create(randomUUID(),'Final round',['A','B','C'],'high',{endCondition:'target',targetScore:20,targetEnd:'round'});
final=await roundApi.act(final.game,{action:'score',points:20});assert.equal(final.game.finished,false);
await assert.rejects(()=>roundApi.act(final.game,{action:'select',playerId:final.game.players[0].id}),/completed the final round/);
final=await roundApi.get(final.game.id);assert.equal(final.game.targetEnd,'round','saved ending survives reload');
final=await roundApi.act(final.game,{action:'score',points:25});assert.equal(final.game.finished,false,'another threshold does not extend final round');
final=await roundApi.act(final.game,{action:'score',points:0});assert.equal(final.game.finished,true);assert.deepEqual(final.winnerIds,[final.game.players[1].id],'remaining player can win');
final=await roundApi.act(final.game,{action:'undo'});assert.equal(final.game.finished,false);assert.equal(final.game.next,final.game.players[2].id);
final=await roundApi.act(final.game,{action:'edit',entryId:final.game.entries[0].id,points:5});
final=await roundApi.act(final.game,{action:'edit',entryId:final.game.entries[1].id,points:5});
final=await roundApi.act(final.game,{action:'score',points:0});assert.equal(final.game.finished,false,'correcting all crossings cancels ending');
final=await roundApi.act(final.game,{action:'score',points:15});final=await roundApi.act(final.game,{action:'score',points:15});final=await roundApi.act(final.game,{action:'score',points:20});assert.equal(final.game.finished,true);assert.equal(final.winnerIds.length,3);
let snapshot=await roundApi.create(randomUUID(),'Snapshot',['A','B'],'low',{endCondition:'target',targetScore:20,targetEnd:'round',scoreMode:'total'});
snapshot=await roundApi.act(snapshot.game,{action:'score',points:20});snapshot=await roundApi.act(snapshot.game,{action:'score',points:10});assert.equal(snapshot.game.finished,true);assert.deepEqual(snapshot.winnerIds,[snapshot.game.players[1].id]);
let last=await roundApi.create(randomUUID(),'Last player',['A','B'],'high',{endCondition:'target',targetScore:20,targetEnd:'round'});last=await roundApi.act(last.game,{action:'score',points:0});last=await roundApi.act(last.game,{action:'score',points:20});assert.equal(last.game.finished,true);
await assert.rejects(()=>roundApi.create(randomUUID(),'Bad',['A','B'],'high',{endCondition:'target',targetScore:20,targetEnd:'round',playStyle:'free'}),/turn-based/);
await assert.rejects(()=>roundApi.create(randomUUID(),'Bad',['A','B'],'high',{targetEnd:'round'}),/score limit/);
const {ScorekeeperApi}=await import(pathToFileURL(path.join(output,'api.js')).href);
const savedFetch=globalThis.fetch;let scoringVersion=2,roundPosts=0;
try{
 globalThis.fetch=async(url,options)=>{if(String(url).endsWith('/account'))return {ok:true,json:async()=>({scoringRulesVersion:scoringVersion})};roundPosts++;return {ok:true,json:async()=>final}};
 const cloudRound=new ScorekeeperApi('https://example.com/api',async()=>'test-token');
 await assert.rejects(()=>cloudRound.create(randomUUID(),'Round',['A','B'],'high',{endCondition:'target',targetScore:20,targetEnd:'round'}),/not available/);
 await assert.rejects(()=>cloudRound.import(final.game),/not available/);assert.equal(roundPosts,0,'old API never receives unsupported ending');
 scoringVersion=3;await cloudRound.create(randomUUID(),'Round',['A','B'],'high',{endCondition:'target',targetScore:20,targetEnd:'round'});assert.equal(roundPosts,1);
}finally{globalThis.fetch=savedFetch}
console.log('Target round endings: remaining turns, final winners, ties, corrections, undo, reload and API rollout passed.');

}
{
 const {startGame,mergeDeviceGames}=await import(pathToFileURL(path.join(output,'game-start.js')).href);
 let deviceData=null,cloudCalls=0;
 const local=new LocalGames({read:async()=>deviceData,write:async data=>{deviceData=data}},randomUUID);
 const base={local,signedIn:true,name:'Reliable game',players:['A','B'],winner:'high',rules:{endCondition:'manual'},uuid:randomUUID,timeoutMs:20};
 const offline={account:async()=>{throw new Error('Offline')},create:async()=>{cloudCalls++;throw new Error('Should not post')}};
 let result=await startGame({...base,cloud:offline});assert.equal(result.view.game.deviceOnly,true);assert.equal(cloudCalls,0);
 let play=await local.act(result.view.game,{action:'score',points:12});assert.equal(play.totals[play.game.players[0].id],12,'fallback game stays scoreable');
 play=await new LocalGames({read:async()=>deviceData,write:async data=>{deviceData=data}},randomUUID).get(play.game.id);assert.equal(play.game.deviceOnly,true,'fallback origin persists after relaunch');
 const merged=mergeDeviceGames([],await local.list());assert.equal(merged[0].id,play.game.id,'fallback is visible while signed in');
 const unsupported={account:async()=>({scoringRulesVersion:2}),create:async()=>{cloudCalls++;throw new Error('Should not post')}};
 result=await startGame({...base,cloud:unsupported,rules:{endCondition:'target',targetScore:20,targetEnd:'round'}});assert.equal(result.view.game.deviceOnly,true);assert.equal(cloudCalls,0,'unsupported account rules start locally');
 const expired={account:async()=>({scoringRulesVersion:3}),create:async()=>{throw new Error('Session expired')}};
 result=await startGame({...base,cloud:expired});assert.equal(result.view.game.deviceOnly,true,'create failure falls back');
 const hanging={account:async()=>new Promise(()=>{}),create:async()=>{throw new Error('Should not post')}};
 result=await startGame({...base,cloud:hanging});assert.equal(result.view.game.deviceOnly,true,'hanging account check does not prevent starting');
 const late={account:async()=>({scoringRulesVersion:3}),create:async id=>{cloudCalls++;return new Promise(resolve=>setTimeout(()=>resolve({game:{id}}),50))}};
 const attempted=[];result=await startGame({...base,cloud:late,uuid:()=>{const id=randomUUID();attempted.push(id);return id}});assert.equal(result.view.game.deviceOnly,true);assert.notEqual(result.view.game.id,attempted[0],'ambiguous remote save has a separate ID from playable device game');
 const healthy={account:async()=>({scoringRulesVersion:3}),create:async(id,name,players,winner,rules)=>({game:{id,name,players:players.map((name,i)=>({id:String(i),name})),winner,...rules,entries:[],next:'0',finished:false,version:1,updated:new Date().toISOString()},totals:{0:0,1:0},winnerIds:[]})};
 result=await startGame({...base,cloud:healthy});assert.equal(result.deviceOnly,false,'healthy account still saves to account');
 const before=deviceData;await assert.rejects(()=>startGame({...base,cloud:offline,players:['A','A']}),/different player names/);assert.equal(deviceData,before,'invalid setup never creates a fallback');
 const failedLocal=new LocalGames({read:async()=>null,write:async()=>{throw new Error('Storage full')}},randomUUID);await assert.rejects(()=>startGame({...base,local:failedLocal,cloud:offline}),/Storage full/);
 console.log('Reliable signed-in starts: offline, expired session, unsupported rules, timeout, scoring/reload, dashboard visibility, healthy cloud, invalid setup and storage errors passed.');
}
{
 const {startGame}=await import(pathToFileURL(path.join(output,'game-start.js')).href);
 const {importPendingGames,pendingImports}=await import(pathToFileURL(path.join(output,'game-import.js')).href);
 let rawDevice=null;const local=new LocalGames({read:async()=>rawDevice,write:async data=>{rawDevice=data}},randomUUID);
 const unavailable={account:async()=>{throw new Error('offline')},create:async()=>{throw new Error('offline')}};
 const result=await startGame({local,cloud:unavailable,signedIn:true,name:'Backup test',players:['A','B'],winner:'high',rules:{},uuid:randomUUID});
 let play=await local.act(result.view.game,{action:'score',points:10});let accountGame=null;
 const cloud={list:async()=>accountGame?[{...accountGame,turnCount:accountGame.entries.length}]:[],get:async()=>({game:accountGame}),import:async game=>{accountGame={...game,deviceOnly:undefined};return {game:accountGame}}};
 await importPendingGames(local,cloud,true,()=>{},true);assert.equal((await local.get(play.game.id)).game.deviceOnly,false,'confirmed backup switches dashboard to cloud without deleting original');assert.equal((await local.get(play.game.id)).totals[play.game.players[0].id],10);
 await local.markDeviceOnly(play.game.id,true);await pendingImports(local,cloud);assert.equal((await local.get(play.game.id)).game.deviceOnly,false,'lost local cleanup recovers only after verifying identical account copy');
 await local.markDeviceOnly(play.game.id,true);play=await local.act((await local.get(play.game.id)).game,{action:'score',points:7});
 const conflictCloud={...cloud,import:async()=>{const {ApiError}=await import(pathToFileURL(path.join(output,'api.js')).href);throw new ApiError(409,'Already imported')}};
 const pending=await pendingImports(local,conflictCloud);assert.equal(pending.length,1,'different device scores remain visible and pending');await assert.rejects(()=>importPendingGames(local,conflictCloud,true,()=>{},true),/device copy was kept/);assert.equal((await local.get(play.game.id)).game.deviceOnly,true);
 console.log('Fallback account backup, retained originals, lost acknowledgement recovery and differing-copy protection passed.');
}
