import type {Game,GameView} from '../api';
import type {GameOperation,OperationAcknowledgement,OperationError} from '../game-operation-contract';
import {LocalGames,gameView} from '../local-games';
import {canonical,checkStored,LocalRepositoryError,snapshot,type ConfirmedSnapshot} from './confirmed-games';
import type {AtomicDocuments,DocumentGuard} from './documents';
import type {AccountGameRead} from './game-read-model';
import {readCollisionFile,readGameCollision,keepGameCollision,gameCollisionKey} from './game-collisions';

// One bounded read-model cache per open repository. Mutable queue/write paths
// always decode independently; callers never receive references to this cache.
type ReadCache={profileId:string;guard:DocumentGuard;revision:number;serialized:string;games:Map<string,AccountGameRead>};
const readCaches=new WeakMap<AtomicDocuments,ReadCache>();
export function clearGameReadCache(documents:AtomicDocuments,guard?:DocumentGuard){
 const cached=readCaches.get(documents);
 if(!guard||cached&&cached.guard.key===guard.key&&cached.guard.revision===guard.revision)readCaches.delete(documents);
}

export class OutboxError extends Error{
 constructor(readonly code:'INVALID_OPERATION'|'OPERATION_ID_REUSED'|'QUEUE_FULL'|'NEEDS_REVIEW'|'INVALID_ACKNOWLEDGEMENT'|'CAPABILITY_REQUIRED',message:string){super(message);this.name='OutboxError'}
}
export type QueuedOperation={wire:string;status:'queued'|'uncertain'|'applied'|'rejected';localTime:string;acknowledgement?:OperationAcknowledgement};
export type QueuedGame={gameId:string;base:ConfirmedSnapshot|null;projection:GameView|null;operations:QueuedOperation[];reservedEntryIds:string[];candidate?:ConfirmedSnapshot;tombstone?:{version:number}};
export type ArchivedBatch={id:string;gameId:string;kind:'confirmed'|'account-selected';serverVersion:number;operations:QueuedOperation[];recovery?:{base:ConfirmedSnapshot|null;projection:GameView|null;reservedEntryIds:string[]};selected?:ConfirmedSnapshot|{deleted:true;version:number}};
export type GameOutbox={schemaVersion:2;profileId:string;games:QueuedGame[];archive:ArchivedBatch[]};
export type ConflictReview={revision:number;gameId:string;rejected:OperationAcknowledgement;device:GameView|null;account:ConfirmedSnapshot|{deleted:true;version:number};dependentCount:number};
export type OutboxAccess={readConfirmed:(gameId:string)=>Promise<ConfirmedSnapshot|null>;authorize:(mode:'read'|'write'|'sync')=>Promise<{profileId:string;guard:DocumentGuard}>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function utf8Size(value:string){let bytes=0;for(const char of value){const cp=char.codePointAt(0)!;bytes+=cp<128?1:cp<2048?2:cp<65536?3:4}return bytes}
const invalid=()=>new OutboxError('INVALID_OPERATION','Use a valid immutable operation with stable IDs.');
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();return value as Record<string,unknown>}
function fields(value:Record<string,unknown>,allowed:string[]){if(Object.keys(value).some(k=>!allowed.includes(k)))throw invalid()}
function id(value:unknown){if(typeof value!=='string'||!uuid.test(value)||value==='00000000-0000-0000-0000-000000000000')throw invalid()}
function version(value:unknown,min:number){if(!Number.isSafeInteger(value)||(value as number)<min||(value as number)>=Number.MAX_SAFE_INTEGER)throw invalid()}
function wireRules(r:Record<string,unknown>){
 for(const [key,options]of Object.entries({playStyle:['turns','free'],scoreMode:['add','total'],endCondition:['manual','rounds','target'],targetEnd:['immediate','round']}))if(r[key]!==undefined&&!options.includes(r[key] as string))throw invalid();
 for(const [key,max]of Object.entries({roundLimit:2147483647,targetScore:Number.MAX_SAFE_INTEGER,presetVersion:2147483647}))if(r[key]!=null&&(!Number.isSafeInteger(r[key])||(r[key] as number)<1||(r[key] as number)>max))throw invalid();
}
function date(value:unknown){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw invalid()}
const gameFields=['id','name','players','winner','entries','next','finished','version','updated','playStyle','scoreMode','presetId','presetVersion','endCondition','roundLimit','targetScore','targetEnd','finishReason','startedAt','endedAt'];
/** Deliberately strict subset: canonical lowercase IDs and no device/cache-only fields. */
export function operationFromWire(wire:string):GameOperation{
 try{
  if(typeof wire!=='string'||utf8Size(wire)>2_000_000)throw invalid();
  const parsed=JSON.parse(wire);if(JSON.stringify(parsed)!==wire)throw invalid();const op=object(parsed);id(op.operationId);id(op.gameId);if(op.protocolVersion!==1)throw invalid();
  if(op.kind==='action'){
   fields(op,['protocolVersion','kind','operationId','gameId','command']);const c=object(op.command);version(c.expectedVersion,1);
   const allowed:Record<string,string[]>={score:['points','playerId','entryId'],edit:['points','entryId'],undo:['entryId'],select:['playerId'],rules:['rules'],finish:[],resume:[]};
   if(typeof c.action!=='string'||!Object.hasOwn(allowed,c.action))throw invalid();fields(c,['action','expectedVersion',...allowed[c.action]]);
   for(const key of allowed[c.action]){if(key==='points'){if(!Number.isInteger(c.points)||Math.abs(c.points as number)>100000)throw invalid()}else if(key==='rules'){const r=object(c.rules);fields(r,['name','winner','endCondition','roundLimit','targetScore','targetEnd']);wireRules(r);if(typeof r.name!=='string'||!r.name.trim()||r.name.length>60||!['high','low'].includes(r.winner as string)||!['manual','rounds','target'].includes(r.endCondition as string))throw invalid()}else id(c[key])}
  }else if(op.kind==='create'||op.kind==='import'){
   fields(op,['protocolVersion','kind','operationId','gameId','expectedVersion','game']);if(op.expectedVersion!==0)throw invalid();const g=object(op.game);fields(g,gameFields);wireRules(g);date(g.updated);for(const key of ['startedAt','endedAt'])if(g[key]!=null)date(g[key]);if(g.finishReason!=null&&!['manual','rounds','target'].includes(g.finishReason as string)||g.endedAt!=null&&g.finished!==true)throw invalid();
   const checked=snapshot('validation',gameView(g as Game)).view.game;id(checked.id);if(checked.id!==op.gameId)throw invalid();for(const p of checked.players){fields(object(p),['id','name']);id(p.id)}for(const e of checked.entries){fields(object(e),['id','playerId','points']);id(e.id)}version(checked.version,1);
   if(!checked.name.trim()||checked.name.length>60||checked.players.some(p=>!p.name.trim()||p.name.length>30)||new Set(checked.players.map(p=>p.name.trim().toLowerCase())).size!==checked.players.length||checked.endCondition==='rounds'&&checked.roundLimit!*checked.players.length>10000)throw invalid();
   if(op.kind==='create'&&(checked.version!==1||checked.entries.length||checked.finished||checked.endedAt!=null||checked.finishReason!=null||checked.next!==checked.players[0].id))throw invalid();
  }else if(op.kind==='delete'){
   fields(op,['protocolVersion','kind','operationId','gameId','expectedVersion','game']);version(op.expectedVersion,0);if(op.game!=null)throw invalid();
  }else throw invalid();
  return op as GameOperation;
 }catch{throw invalid()}
}
function expected(op:GameOperation){return op.kind==='action'?op.command.expectedVersion:op.expectedVersion}
function acknowledgementErrors(op:GameOperation):OperationError[]{return op.kind==='action'?['GAME_NOT_FOUND','GAME_DELETED','VERSION_CONFLICT','UNDO_TARGET_CHANGED','ENTRY_ID_REUSED','INVALID_GAME_COMMAND']:['GAME_NOT_FOUND','GAME_DELETED','GAME_ALREADY_EXISTS','VERSION_CONFLICT','GAME_FINISHED']}
function transitionReserve(item:QueuedOperation){
 if(item.status==='applied'||item.status==='rejected')return 0;
 const op=operationFromWire(item.wire),acknowledgements:OperationAcknowledgement[]=[
  {operationId:op.operationId,gameId:op.gameId,outcome:'applied',committedVersion:Number.MAX_SAFE_INTEGER,observedVersion:Number.MAX_SAFE_INTEGER,errorCode:null},
  ...acknowledgementErrors(op).map(errorCode=>({operationId:op.operationId,gameId:op.gameId,outcome:'rejected' as const,committedVersion:null,observedVersion:Number.MAX_SAFE_INTEGER,errorCode}))
 ];
 const currentSize=utf8Size(JSON.stringify(item));
 return Math.max(...acknowledgements.map(ack=>utf8Size(JSON.stringify({...item,status:ack.outcome,acknowledgement:ack}))))-currentSize;
}
function validateAck(op:GameOperation,input:unknown):OperationAcknowledgement{
 const ack=object(input);fields(ack,['operationId','gameId','outcome','committedVersion','observedVersion','errorCode']);
 const errors=acknowledgementErrors(op);
 if(ack.operationId!==op.operationId||ack.gameId!==op.gameId||(ack.observedVersion!==null&&(!Number.isSafeInteger(ack.observedVersion)||(ack.observedVersion as number)<1||(ack.observedVersion as number)>Number.MAX_SAFE_INTEGER))||
  (ack.outcome==='applied'?(ack.committedVersion!==expected(op)+1||ack.observedVersion!==(expected(op)===0?null:expected(op))||ack.errorCode!==null):ack.outcome!=='rejected'||ack.committedVersion!==null||!errors.includes(ack.errorCode as OperationError)))throw new OutboxError('INVALID_ACKNOWLEDGEMENT','The server response did not confirm this operation. It remains pending.');
 return ack as OperationAcknowledgement;
}
async function project(op:GameOperation,prior:GameView|null,at:string):Promise<GameView|null>{
 if(!Number.isFinite(Date.parse(at)))throw invalid();
 if(op.kind==='create'||op.kind==='import'){if(prior)throw invalid();return gameView({...op.game,version:1})}
 if(op.kind==='delete'){if(prior?.game.finished)throw invalid();return null}
 if(op.kind!=='action'||!prior)throw invalid();const current=prior.game;
 if(op.command.action==='undo'&&current.entries.at(-1)?.id!==op.command.entryId)throw invalid();
 if(op.command.action==='score'){const entryId=op.command.entryId;if(current.entries.some(e=>e.id===entryId))throw invalid();}
 let raw=JSON.stringify([current]);const local=new LocalGames({read:async()=>raw,write:async value=>{raw=value}},()=>op.command.action==='score'?op.command.entryId:'');
 const changed=await local.act(current,op.command);
 return gameView({...changed.game,updated:at,endedAt:changed.game.finished?(current.finished?current.endedAt||null:at):null});
}
function serverVersion(value:number){if(!Number.isSafeInteger(value)||value<1||value>Number.MAX_SAFE_INTEGER)throw Error()}
async function validateGame(g:QueuedGame,profileId:string,ids:Set<string>){
 id(g.gameId);if(!Array.isArray(g.reservedEntryIds))throw Error();const reserved=new Set(g.reservedEntryIds);if(reserved.size!==g.reservedEntryIds.length)throw Error();for(const entry of reserved)id(entry);for(const entry of [...(g.base?.view.game.entries??[]),...(g.projection?.game.entries??[]),...(g.candidate?.view.game.entries??[])])if(!reserved.has(entry.id))throw Error();if(g.base!==null)checkStored(g.base,profileId,g.gameId);
 if(g.candidate!==undefined)checkStored(g.candidate,profileId,g.gameId);
 if(g.tombstone!==undefined){serverVersion(g.tombstone.version);if(g.base!==null||g.projection!==null||g.operations.length||g.candidate!==undefined)throw Error()}
 if(g.projection!==null&&snapshot(profileId,g.projection).gameId!==g.gameId)throw Error();if(!Array.isArray(g.operations))throw Error();
 let v=g.base?.serverVersion??0,stopped=false;let projection=g.base?.view??null;
 for(const item of g.operations){const op=operationFromWire(item.wire);if(op.kind==='action'&&op.command.action==='score'&&!reserved.has(op.command.entryId)||op.kind==='import'&&op.game.entries.some(e=>!reserved.has(e.id)))throw Error();if(op.gameId!==g.gameId||expected(op)!==v||ids.has(op.operationId)||!['queued','uncertain','applied','rejected'].includes(item.status))throw Error();ids.add(op.operationId);
  if(item.status==='applied'||item.status==='rejected'){if(stopped)throw Error();const ack=validateAck(op,item.acknowledgement);if(ack.outcome!==item.status)throw Error();if(item.status==='rejected')stopped=true}
  else {if(item.acknowledgement!==undefined||item.status==='uncertain'&&stopped)throw Error();stopped=true}
  projection=await project(op,projection,item.localTime);v++;
 }
 if(canonical(projection)!==canonical(g.projection))throw Error();
 if(!g.operations.length&&!g.tombstone&&(!g.base||canonical(g.projection)!==canonical(g.base.view)))throw Error();
 const last=g.operations.at(-1);if(last){const op=operationFromWire(last.wire);if(op.kind==='delete'?g.projection!==null:!g.projection||g.projection.game.version!==v)throw Error()}
}
async function decode(value:unknown,profileId:string,serialized?:string):Promise<GameOutbox>{
 try{
  const raw=value as Omit<GameOutbox,'schemaVersion'>&{schemaVersion:number};
  if(!raw||![1,2].includes(raw.schemaVersion)||raw.profileId!==profileId||!Array.isArray(raw.games)||raw.games.length>50||new Set(raw.games.map(g=>g.gameId)).size!==raw.games.length)throw Error();
  if(raw.schemaVersion===1)fields(object(raw),['schemaVersion','profileId','games']);
  // v1 is copied into v2 in memory; the first successful CAS writes the upgrade. Reads never mutate storage.
  const state:GameOutbox=raw.schemaVersion===1?{schemaVersion:2,profileId,games:raw.games.map(g=>{fields(object(g),['gameId','base','projection','operations']);return {...g,reservedEntryIds:[...new Set([...(g.base?.view.game.entries??[]).map(e=>e.id),...(g.projection?.game.entries??[]).map(e=>e.id),...g.operations.flatMap(i=>{const op=operationFromWire(i.wire);return op.kind==='action'&&op.command.action==='score'?[op.command.entryId]:op.kind==='import'?op.game.entries.map(e=>e.id):[]})])]}}),archive:[]}:raw as GameOutbox;
  if(!Array.isArray(state.archive)||state.archive.length>10000||new Set(state.archive.map(b=>b.id)).size!==state.archive.length)throw Error();
  const ids=new Set<string>();let retained=0;
  for(const batch of state.archive){id(batch.id);id(batch.gameId);serverVersion(batch.serverVersion);if(!Array.isArray(batch.operations)||!batch.operations.length)throw Error();retained+=batch.operations.length;
   if(batch.kind==='account-selected'){
    if(!batch.recovery||!batch.selected||batch.operations.some(i=>i.status==='uncertain')||!batch.operations.some(i=>i.status==='rejected'))throw Error();
    const selected=batch.selected;if('deleted'in selected){if(selected.deleted!==true||selected.version!==batch.serverVersion)throw Error()}else if(checkStored(selected,profileId,batch.gameId).serverVersion!==batch.serverVersion)throw Error();
    await validateGame({gameId:batch.gameId,...batch.recovery,operations:batch.operations},profileId,ids);
    const review=reviewOf({gameId:batch.gameId,...batch.recovery,operations:batch.operations,...('deleted'in batch.selected?{}:{candidate:batch.selected})},0);if(!review||canonical(review.account)!==canonical(batch.selected))throw Error();
   }else if(batch.kind==='confirmed'){
    if(batch.recovery!==undefined||batch.selected!==undefined)throw Error();let v=expected(operationFromWire(batch.operations[0].wire));
    for(const item of batch.operations){const op=operationFromWire(item.wire);if(op.gameId!==batch.gameId||expected(op)!==v||item.status!=='applied'||ids.has(op.operationId))throw Error();ids.add(op.operationId);if(validateAck(op,item.acknowledgement).outcome!=='applied')throw Error();date(item.localTime);v++}
    if(batch.serverVersion<v)throw Error();
   }else throw Error();
  }
  let active=0;for(const game of state.games){await validateGame(game,profileId,ids);if(game.tombstone&&!state.archive.some(b=>b.gameId===game.gameId&&b.serverVersion===game.tombstone!.version&&(b.kind==='confirmed'&&operationFromWire(b.operations.at(-1)!.wire).kind==='delete'||b.kind==='account-selected'&&b.selected&&'deleted'in b.selected)))throw Error();active+=game.operations.length}
  if(active>500||retained>10000||utf8Size(raw.schemaVersion===2&&serialized!==undefined?serialized:JSON.stringify(state))>8_000_000)throw Error();return state;
 }catch{throw new LocalRepositoryError('STORAGE_CORRUPT','Pending game changes could not be validated. They have been kept for recovery.')}
}
/** Compare scoring state without server-assigned timestamps or optional wire defaults. */
function scoringContent(view:GameView){
 const g=view.game;return canonical({id:g.id,name:g.name,players:g.players,winner:g.winner,entries:g.entries,next:g.next,finished:g.finished,
  playStyle:g.playStyle??'turns',scoreMode:g.scoreMode??'add',endCondition:g.endCondition??'manual',targetEnd:g.targetEnd??'immediate',
  roundLimit:g.roundLimit??null,targetScore:g.targetScore??null,presetId:g.presetId??null,presetVersion:g.presetVersion??null,finishReason:g.finishReason??null});
}
function contentMismatch(game:QueuedGame){const last=game.operations.at(-1);return !!(last&&game.operations.every(i=>i.status==='applied')&&game.candidate&&game.candidate.serverVersion===last.acknowledgement!.committedVersion&&(!game.projection||scoringContent(game.candidate.view)!==scoringContent(game.projection)))}
export function gameRead(game:QueuedGame):AccountGameRead{
 if(game.tombstone)return {kind:'deleted',serverVersion:game.tombstone.version};
 const review=game.operations.some(i=>i.status==='rejected')||contentMismatch(game);
 const pendingOperations=game.operations.length,serverVersion=game.base?.serverVersion??null;
 const sync=review?'needs-review':pendingOperations||game.candidate?'pending':'confirmed';
 if(!game.projection)return {kind:'pending-delete',sync:review?'needs-review':'pending',pendingOperations,serverVersion};
 return {kind:'game',source:'queue',sync,view:game.projection,pendingOperations,serverVersion};
}
function snapshotContent(value:ConfirmedSnapshot){const g=value.view.game;return canonical({profileId:value.profileId,gameId:value.gameId,serverVersion:value.serverVersion,content:scoringContent(value.view),updated:g.updated,startedAt:g.startedAt??null,endedAt:g.endedAt??null})}
function rejected(game:QueuedGame){return game.operations.find(i=>i.status==='rejected')}
function reviewOf(game:QueuedGame,revision:number):ConflictReview|null{
 const item=rejected(game);if(!item)return null;const ack=item.acknowledgement!;
 let account:ConflictReview['account']|undefined=game.candidate;
 if(ack.errorCode==='GAME_DELETED'&&ack.observedVersion!==null){if(game.candidate&&game.candidate.serverVersion>=ack.observedVersion)return null;account={deleted:true,version:ack.observedVersion}}
 if(!account)return null;const v='deleted'in account?account.version:account.serverVersion;
 const floor=Math.max(game.base?.serverVersion??0,...game.operations.filter(i=>i.status==='applied').map(i=>i.acknowledgement!.committedVersion!),ack.observedVersion??0);
 if(v<floor)return null;
 return {revision,gameId:game.gameId,rejected:ack,device:game.projection,account,dependentCount:game.operations.length-game.operations.indexOf(item)-1};
}
/** One CAS document holds the queue and projection. Neither application opens this layer yet.
 * Never convert an optimistic projection into a confirmed snapshot from receipt metadata alone. */
export function createGameOutbox(documents:AtomicDocuments,access:OutboxAccess){
 async function read(mode:'read'|'write'|'sync'='read'){
  const auth=await access.authorize(mode),key='game-outbox:'+auth.profileId,record=await documents.read(key);
  const state:GameOutbox=record?await decode(record.value,auth.profileId):{schemaVersion:2,profileId:auth.profileId,games:[],archive:[]};
  await access.authorize(mode);return {auth,key,mode,revision:record?.revision??0,state};
 }
 async function validateSave(state:GameOutbox){const size=utf8Size(JSON.stringify(state)),reserve=state.games.reduce((n,g)=>n+g.operations.reduce((m,item)=>m+transitionReserve(item),0),0);if(state.archive.reduce((n,b)=>n+b.operations.length,0)>10000||state.archive.length>10000||state.games.length>50||state.games.reduce((n,g)=>n+g.operations.length,0)>500||size+reserve>8_000_000)throw new OutboxError('QUEUE_FULL','Device queue is full. Connect and review changes before adding more.');await decode(state,state.profileId)}
 async function save(context:Awaited<ReturnType<typeof read>>,guards:readonly DocumentGuard[]=[]){await access.authorize(context.mode);await validateSave(context.state);await access.authorize(context.mode);await documents.write(context.key,context.revision,context.state,[context.auth.guard,...guards]);await access.authorize(context.mode)}
 async function collisionGuard(auth:{profileId:string},gameId:string){
  const saved=await readCollisionFile(documents,auth.profileId,gameId);
  if(saved.file?.active)throw new OutboxError('NEEDS_REVIEW','Conflicting account copies require review. Saved changes have been kept.');
  return {key:gameCollisionKey(auth.profileId,gameId),revision:saved.revision};
 }
 async function settle(ctx:Awaited<ReturnType<typeof read>>,game:QueuedGame){
  if(game.tombstone)return 'deleted' as const;
  const guard=await collisionGuard(ctx.auth,game.gameId);
  if(game.operations.some(i=>i.status==='rejected'))return 'needs-review' as const;
  if(game.operations.some(i=>i.status!=='applied'))return 'pending' as const;
  const last=game.operations.at(-1),lastOp=last?operationFromWire(last.wire):null;
  if(lastOp?.kind==='delete'){
   if(game.candidate&&game.candidate.serverVersion>=last!.acknowledgement!.committedVersion!)throw new OutboxError('NEEDS_REVIEW','A snapshot cannot resurrect a confirmed deleted game.');
   ctx.state.archive.push({id:lastOp.operationId,gameId:game.gameId,kind:'confirmed',serverVersion:last!.acknowledgement!.committedVersion!,operations:game.operations});
   game.tombstone={version:last!.acknowledgement!.committedVersion!};game.base=null;game.projection=null;game.operations=[];delete game.candidate;await save(ctx,[guard]);return 'deleted' as const;
  }
  const candidate=game.candidate;if(!candidate)return 'awaiting-snapshot' as const;
  const floor=last?.acknowledgement?.committedVersion??game.base?.serverVersion??0;
  if(candidate.serverVersion<floor)return 'awaiting-snapshot' as const;
  if(last&&candidate.serverVersion===floor&&(!game.projection||scoringContent(candidate.view)!==scoringContent(game.projection)))throw new OutboxError('NEEDS_REVIEW','Confirmed receipt and server scoring content disagree. Both sources have been kept.');
  if(last)ctx.state.archive.push({id:lastOp!.operationId,gameId:game.gameId,kind:'confirmed',serverVersion:candidate.serverVersion,operations:game.operations});
  game.reservedEntryIds=[...new Set([...game.reservedEntryIds,...candidate.view.game.entries.map(e=>e.id)])];game.base=candidate;game.projection=candidate.view;game.operations=[];delete game.candidate;await save(ctx,[guard]);return 'confirmed' as const;
 }
 return {
  async read(){return (await read()).state},
  async readHomeState(){const ctx=await read();return {state:ctx.state,revision:ctx.revision||undefined}},
  async prepareCollisionResolution(gameId:string,input:ConfirmedSnapshot,reservedEntries:readonly string[]=[]){
   const selected=checkStored(input,input.profileId,gameId),ctx=await read('sync');id(gameId);
   if(selected.profileId!==ctx.auth.profileId)throw new OutboxError('NEEDS_REVIEW','Account copy belongs to a different profile.');
   let game=ctx.state.games.find(g=>g.gameId===gameId);
   if(game&&(game.tombstone||game.operations.length))throw new OutboxError('NEEDS_REVIEW','Pending changes or deletion evidence must stay paused. Nothing has been replaced.');
   const floor=Math.max(game?.base?.serverVersion??0,game?.candidate?.serverVersion??0);
   if(selected.serverVersion<=floor)throw new OutboxError('NEEDS_REVIEW','A newer account copy is required. Existing copies have been kept.');
   const prior=game?.base??(game?null:await access.readConfirmed(gameId));
   if(prior&&selected.serverVersion<=prior.serverVersion)throw new OutboxError('NEEDS_REVIEW','A newer account copy than the saved base is required.');
   if(!game){game={gameId,base:selected,projection:selected.view,operations:[],reservedEntryIds:[]};ctx.state.games.push(game)}
   game.reservedEntryIds=[...new Set([...game.reservedEntryIds,...(prior?.view.game.entries??[]).map(e=>e.id),...reservedEntries,...selected.view.game.entries.map(e=>e.id)])];game.base=selected;game.projection=selected.view;delete game.candidate;
   await validateSave(ctx.state);await access.authorize('sync');
   return {write:{key:ctx.key,expectedRevision:ctx.revision,value:ctx.state},guard:ctx.auth.guard,prior};
  },
  async assertDelivery(gameId:string){const auth=await access.authorize('sync');await collisionGuard(auth,gameId);await access.authorize('sync')},
  /** Null means untracked, not deleted. Never replace a tracked result with cache data. */
  async readGame(gameId:string):Promise<AccountGameRead|null>{
   try{
    const auth=await access.authorize('read'),record=await documents.read('game-outbox:'+auth.profileId);
    let cached=readCaches.get(documents);
    if(!record){readCaches.delete(documents);await access.authorize('read');return null}
    // Check exact bytes as well as revision: even same-revision damaged data
    // must be revalidated, never masked by a previously valid cached result.
    const serialized=JSON.stringify(record.value);
    if(!cached||cached.profileId!==auth.profileId||cached.guard.key!==auth.guard.key||cached.guard.revision!==auth.guard.revision||cached.revision!==record.revision||cached.serialized!==serialized){
     readCaches.delete(documents);
     const state=await decode(record.value,auth.profileId,serialized);
     cached={profileId:auth.profileId,guard:{...auth.guard},revision:record.revision,serialized,games:new Map(state.games.map(game=>[game.gameId,gameRead(game)]))};
     await access.authorize('read');readCaches.set(documents,cached);
    }
    await access.authorize('read');
    const value=cached.games.get(gameId);return value?JSON.parse(JSON.stringify(value)) as AccountGameRead:null;
   }catch(error){readCaches.delete(documents);throw error}
  },
  async seedConfirmed(gameId:string){const ctx=await read('write'),guard=await collisionGuard(ctx.auth,gameId),copy=await access.readConfirmed(gameId);if(!copy||copy.profileId!==ctx.auth.profileId||copy.gameId!==gameId)throw new OutboxError('NEEDS_REVIEW','A complete confirmed account snapshot is required.');const existing=ctx.state.games.find(g=>g.gameId===copy.gameId);if(existing){if(canonical(existing.base)!==canonical(copy))throw new OutboxError('NEEDS_REVIEW','Existing pending or confirmed data requires review.');return}ctx.state.games.push({gameId:copy.gameId,base:copy,projection:copy.view,operations:[],reservedEntryIds:copy.view.game.entries.map(e=>e.id)});await save(ctx,[guard])},
  /** Only complete, account-scoped authenticated GET snapshots belong here; never a list omission/404. */
  async observeSnapshot(input:ConfirmedSnapshot){
   const candidate=checkStored(JSON.parse(JSON.stringify(input)),input.profileId,input.gameId),ctx=await read('sync');if(candidate.profileId!==ctx.auth.profileId)throw new LocalRepositoryError('INVALID_SNAPSHOT','Server snapshot belongs to a different account.');const game=ctx.state.games.find(g=>g.gameId===candidate.gameId);
   if(!game)throw new OutboxError('NEEDS_REVIEW','Seed a confirmed base or an explicit creation/import before reconciliation.');
   if(game.tombstone)throw new OutboxError('NEEDS_REVIEW','A refresh cannot resurrect a deleted game.');
   const guard=await collisionGuard(ctx.auth,game.gameId);
   const prior=game.candidate??game.base;
   if(prior&&candidate.serverVersion<prior.serverVersion)return 'stale' as const;
   if(prior&&candidate.serverVersion===prior.serverVersion&&snapshotContent(candidate)!==snapshotContent(prior)){await keepGameCollision(documents,ctx.auth.guard,prior,candidate);await access.authorize('sync');throw new LocalRepositoryError('VERSION_COLLISION','Different server snapshots have the same version. Both sources have been kept for review.');}
   game.reservedEntryIds=[...new Set([...game.reservedEntryIds,...candidate.view.game.entries.map(e=>e.id)])];game.candidate=candidate;
   // Commit the candidate separately before attempting compaction: a mismatch must keep both sources.
   await save(ctx,[guard]);const latest=await read('sync');return settle(latest,latest.state.games.find(g=>g.gameId===game.gameId)!);
  },
  async settle(gameId:string){const ctx=await read('sync'),game=ctx.state.games.find(g=>g.gameId===gameId);if(!game)throw new OutboxError('NEEDS_REVIEW','Unknown queued game.');return settle(ctx,game)},
  async readRecovery(gameId:string){const ctx=await read(),game=ctx.state.games.find(g=>g.gameId===gameId);return {state:ctx.state,revision:ctx.revision,conflict:game?reviewOf(game,ctx.revision):null,read:game?gameRead(game):null}},
  async review(gameId:string):Promise<ConflictReview|null>{const ctx=await read(),game=ctx.state.games.find(g=>g.gameId===gameId);return game?reviewOf(game,ctx.revision):null},
  async useAccountVersion(gameId:string,expectedRevision:number,resolutionId:string,guards:readonly DocumentGuard[]=[]){
   id(resolutionId);const ctx=await read('sync'),previous=ctx.state.archive.find(b=>b.id===resolutionId);
   if(previous){if(previous.kind!=='account-selected'||previous.gameId!==gameId)throw new OutboxError('OPERATION_ID_REUSED','This review ID belongs to a different decision.');return}
   if(ctx.state.archive.some(b=>b.operations.some(i=>operationFromWire(i.wire).operationId===resolutionId))||ctx.state.games.some(g=>g.operations.some(i=>operationFromWire(i.wire).operationId===resolutionId)))throw new OutboxError('OPERATION_ID_REUSED','Use a new review decision ID, separate from save operations.');
   if(ctx.revision!==expectedRevision)throw new LocalRepositoryError('STORAGE_CONFLICT','Pending changes or the account snapshot changed. Review again before choosing.');
   const game=ctx.state.games.find(g=>g.gameId===gameId),review=game?reviewOf(game,ctx.revision):null;
   if(!game||!review||game.operations.some(i=>i.status==='uncertain'))throw new OutboxError('NEEDS_REVIEW','Resolve uncertain outcomes and refresh the account snapshot before choosing.');
   const v='deleted'in review.account?review.account.version:review.account.serverVersion;
   ctx.state.archive.push({id:resolutionId,gameId,kind:'account-selected',serverVersion:v,operations:game.operations,recovery:{base:game.base,projection:game.projection,reservedEntryIds:[...game.reservedEntryIds]},selected:review.account});
   game.operations=[];delete game.candidate;
   if('deleted'in review.account){game.base=null;game.projection=null;game.tombstone={version:v}}
   else{game.reservedEntryIds=[...new Set([...game.reservedEntryIds,...review.account.view.game.entries.map(e=>e.id)])];game.base=review.account;game.projection=review.account.view}
   const guard=await collisionGuard(ctx.auth,gameId);await save(ctx,[guard,...guards]);
  },
  async enqueue(input:GameOperation){
   // Freeze the exact request before any await; caller changes cannot alter retries.
   const wire=JSON.stringify(input),op=operationFromWire(wire),ctx=await read('write'),guard=await collisionGuard(ctx.auth,op.gameId);
   const duplicate=ctx.state.games.flatMap(g=>g.operations).find(i=>operationFromWire(i.wire).operationId===op.operationId);
   if(duplicate){if(duplicate.wire!==wire)throw new OutboxError('OPERATION_ID_REUSED','This operation ID already has a different immutable request.');return}
   if(ctx.state.archive.some(b=>b.kind==='account-selected'&&b.id===op.operationId))throw new OutboxError('OPERATION_ID_REUSED','This operation ID belongs to a retained review decision.');
   const retained=ctx.state.archive.flatMap(b=>b.operations).find(i=>operationFromWire(i.wire).operationId===op.operationId);
   if(retained){if(retained.wire!==wire)throw new OutboxError('OPERATION_ID_REUSED','This operation ID already has a different immutable request.');if(retained.status!=='applied')throw new OutboxError('NEEDS_REVIEW','This request was retained during conflict review and will not be resubmitted automatically.');return}
   let game=ctx.state.games.find(g=>g.gameId===op.gameId);
   if(!game){if(expected(op)!==0)throw new OutboxError('NEEDS_REVIEW','A confirmed base is required before scoring.');game={gameId:op.gameId,base:null,projection:null,operations:[],reservedEntryIds:[]};ctx.state.games.push(game)}
   if(contentMismatch(game))throw new OutboxError('NEEDS_REVIEW','Receipt and account content disagree. Reconcile before adding changes.');
   if(game.tombstone)throw new OutboxError('NEEDS_REVIEW','This game was deleted. Its original ID cannot be reused.');
   if(game.operations.some(i=>i.status==='rejected'))throw new OutboxError('NEEDS_REVIEW','A rejected change and its dependants require review.');
   const v=game.operations.length?expected(operationFromWire(game.operations.at(-1)!.wire))+1:game.base?.serverVersion??0;
   if(expected(op)!==v)throw new OutboxError('NEEDS_REVIEW','The operation does not match the local game version.');
   if(op.kind==='action'&&op.command.action==='score'){
    const entryId=op.command.entryId;
    if(game.reservedEntryIds.includes(entryId)||ctx.state.archive.some(b=>b.gameId===op.gameId&&b.operations.some(i=>{const prior=operationFromWire(i.wire);return prior.kind==='action'&&prior.command.action==='score'&&prior.command.entryId===entryId||prior.kind==='import'&&prior.game.entries.some(e=>e.id===entryId)}))||game.base?.view.game.entries.some(e=>e.id===entryId)||game.operations.some(i=>{const prior=operationFromWire(i.wire);return prior.kind==='action'&&prior.command.action==='score'&&prior.command.entryId===entryId||(prior.kind==='import'&&prior.game.entries.some(e=>e.id===entryId))}))throw invalid();
   }
   if(op.kind==='action'&&op.command.action==='score')game.reservedEntryIds.push(op.command.entryId);if(op.kind==='import')game.reservedEntryIds.push(...op.game.entries.map(e=>e.id));
   const localTime=new Date().toISOString();game.projection=await project(op,game.projection,localTime);if(game.projection)snapshot(ctx.auth.profileId,game.projection);
   game.operations.push({wire,status:'queued',localTime});await save(ctx,[guard]);
  },
  async prepareDelivery(gameId:string,capability:unknown):Promise<string|null>{
   const ctx=await read('sync'),guard=await collisionGuard(ctx.auth,gameId),game=ctx.state.games.find(g=>g.gameId===gameId);if(!game)return null;if(contentMismatch(game))throw new OutboxError('NEEDS_REVIEW','Receipt and account content disagree. Delivery is paused.');
   const item=game.operations.find(i=>i.status!=='applied');if(!item)return null;if(item.status==='rejected')throw new OutboxError('NEEDS_REVIEW','A rejected change blocks automatic replay of its dependants.');
   const op=operationFromWire(item.wire),cap=capability as {version?:number;receipts?:string;atomicGameAndReceipt?:boolean;kinds?:string[];actions?:string[]}|null;
   if(!cap||cap.version!==1||cap.receipts!=='retained'||cap.atomicGameAndReceipt!==true||(op.kind==='action'?!(Array.isArray(cap.actions)&&cap.actions.includes(op.command.action)):!(Array.isArray(cap.kinds)&&cap.kinds.includes(op.kind))))throw new OutboxError('CAPABILITY_REQUIRED','This server has not advertised compatible replay support.');
   // Persist uncertain BEFORE handing bytes to a transport. Process loss/timeout retries these exact bytes.
   if(item.status!=='uncertain'){item.status='uncertain';await save(ctx,[guard])}return item.wire;
  },
  async acknowledge(operationId:string,input:OperationAcknowledgement){
   const copy=JSON.parse(JSON.stringify(input)),ctx=await read('sync'),game=ctx.state.games.find(g=>g.operations.some(i=>operationFromWire(i.wire).operationId===operationId));if(!game){const retained=ctx.state.archive.flatMap(b=>b.operations).find(i=>operationFromWire(i.wire).operationId===operationId);if(retained?.acknowledgement&&canonical(retained.acknowledgement)===canonical(copy))return;throw new OutboxError('INVALID_ACKNOWLEDGEMENT','Unknown or conflicting retained operation.')}
   const item=game.operations.find(i=>operationFromWire(i.wire).operationId===operationId)!,op=operationFromWire(item.wire);
   let ack:OperationAcknowledgement;try{ack=validateAck(op,copy)}catch{throw new OutboxError('INVALID_ACKNOWLEDGEMENT','The response did not confirm this operation. It remains pending.')}
   if(item.status==='applied'||item.status==='rejected'){if(canonical(item.acknowledgement)!==canonical(ack))throw new OutboxError('INVALID_ACKNOWLEDGEMENT','A conflicting receipt requires review.');return}
   if(item.status!=='uncertain'||game.operations.find(i=>i.status!=='applied')!==item)throw new OutboxError('INVALID_ACKNOWLEDGEMENT','Only the first dispatched change can be acknowledged.');
   item.status=ack.outcome;item.acknowledgement=ack;await save(ctx);
  }
 };
}

