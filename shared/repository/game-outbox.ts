import type {Game,GameView} from '../api';
import type {GameOperation,OperationAcknowledgement} from '../game-operation-contract';
import {LocalGames,gameView} from '../local-games';
import {canonical,checkStored,LocalRepositoryError,snapshot,type ConfirmedSnapshot} from './confirmed-games';
import type {AtomicDocuments,DocumentGuard} from './documents';

export class OutboxError extends Error{
 constructor(readonly code:'INVALID_OPERATION'|'OPERATION_ID_REUSED'|'QUEUE_FULL'|'NEEDS_REVIEW'|'INVALID_ACKNOWLEDGEMENT'|'CAPABILITY_REQUIRED',message:string){super(message);this.name='OutboxError'}
}
export type QueuedOperation={wire:string;status:'queued'|'uncertain'|'applied'|'rejected';localTime:string;acknowledgement?:OperationAcknowledgement};
export type QueuedGame={gameId:string;base:ConfirmedSnapshot|null;projection:GameView|null;operations:QueuedOperation[]};
export type GameOutbox={schemaVersion:1;profileId:string;games:QueuedGame[]};
export type OutboxAccess={readConfirmed:(gameId:string)=>Promise<ConfirmedSnapshot|null>;authorize:(mode:'read'|'write'|'sync')=>Promise<{profileId:string;guard:DocumentGuard}>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function utf8Size(value:string){let bytes=0;for(const char of value){const cp=char.codePointAt(0)!;bytes+=cp<128?1:cp<2048?2:cp<65536?3:4}return bytes}
const invalid=()=>new OutboxError('INVALID_OPERATION','Use a valid immutable operation with stable IDs.');
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();return value as Record<string,unknown>}
function fields(value:Record<string,unknown>,allowed:string[]){if(Object.keys(value).some(k=>!allowed.includes(k)))throw invalid()}
function id(value:unknown){if(typeof value!=='string'||!uuid.test(value)||value==='00000000-0000-0000-0000-000000000000')throw invalid()}
function version(value:unknown,min:number){if(!Number.isSafeInteger(value)||(value as number)<min||(value as number)>=Number.MAX_SAFE_INTEGER)throw invalid()}
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
   for(const key of allowed[c.action]){if(key==='points'){if(!Number.isInteger(c.points)||Math.abs(c.points as number)>100000)throw invalid()}else if(key==='rules'){const r=object(c.rules);fields(r,['name','winner','endCondition','roundLimit','targetScore','targetEnd']);if(typeof r.name!=='string'||!r.name.trim()||r.name.length>60||!['high','low'].includes(r.winner as string)||!['manual','rounds','target'].includes(r.endCondition as string))throw invalid()}else id(c[key])}
  }else if(op.kind==='create'||op.kind==='import'){
   fields(op,['protocolVersion','kind','operationId','gameId','expectedVersion','game']);if(op.expectedVersion!==0)throw invalid();const g=object(op.game);fields(g,gameFields);
   const checked=snapshot('validation',gameView(g as Game)).view.game;id(checked.id);if(checked.id!==op.gameId)throw invalid();for(const p of checked.players){fields(object(p),['id','name']);id(p.id)}for(const e of checked.entries){fields(object(e),['id','playerId','points']);id(e.id)}version(checked.version,1);
   if(!checked.name.trim()||checked.name.length>60||checked.players.some(p=>!p.name.trim()||p.name.length>30)||new Set(checked.players.map(p=>p.name.trim().toLowerCase())).size!==checked.players.length)throw invalid();
   if(op.kind==='create'&&(checked.version!==1||checked.entries.length||checked.finished||checked.endedAt!=null||checked.finishReason!=null||checked.next!==checked.players[0].id))throw invalid();
  }else if(op.kind==='delete'){
   fields(op,['protocolVersion','kind','operationId','gameId','expectedVersion','game']);version(op.expectedVersion,0);if(op.game!=null)throw invalid();
  }else throw invalid();
  return op as GameOperation;
 }catch{throw invalid()}
}
function expected(op:GameOperation){return op.kind==='action'?op.command.expectedVersion:op.expectedVersion}
function validateAck(op:GameOperation,input:unknown):OperationAcknowledgement{
 const ack=object(input);fields(ack,['operationId','gameId','outcome','committedVersion','observedVersion','errorCode']);
 const errors=op.kind==='action'?['GAME_NOT_FOUND','GAME_DELETED','VERSION_CONFLICT','UNDO_TARGET_CHANGED','ENTRY_ID_REUSED','INVALID_GAME_COMMAND']:['GAME_NOT_FOUND','GAME_DELETED','GAME_ALREADY_EXISTS','VERSION_CONFLICT','GAME_FINISHED'];
 if(ack.operationId!==op.operationId||ack.gameId!==op.gameId||(ack.observedVersion!==null&&(!Number.isSafeInteger(ack.observedVersion)||(ack.observedVersion as number)<1||(ack.observedVersion as number)>Number.MAX_SAFE_INTEGER))||
  (ack.outcome==='applied'?(ack.committedVersion!==expected(op)+1||ack.observedVersion!==(expected(op)===0?null:expected(op))||ack.errorCode!==null):ack.outcome!=='rejected'||ack.committedVersion!==null||!errors.includes(ack.errorCode as string)))throw new OutboxError('INVALID_ACKNOWLEDGEMENT','The server response did not confirm this operation. It remains pending.');
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
async function decode(value:unknown,profileId:string):Promise<GameOutbox>{
 try{
  const state=value as GameOutbox;if(!state||state.schemaVersion!==1||state.profileId!==profileId||!Array.isArray(state.games)||state.games.length>50||new Set(state.games.map(g=>g.gameId)).size!==state.games.length)throw Error();
  const ids=new Set<string>();let count=0;
  for(const g of state.games){id(g.gameId);if(g.base!==null)checkStored(g.base,profileId,g.gameId);if(g.projection!==null&&snapshot(profileId,g.projection).gameId!==g.gameId)throw Error();if(!Array.isArray(g.operations))throw Error();
   let v=g.base?.serverVersion??0,stopped=false;let projection=g.base?.view??null;for(const item of g.operations){const op=operationFromWire(item.wire);if(op.gameId!==g.gameId||expected(op)!==v||ids.has(op.operationId)||!['queued','uncertain','applied','rejected'].includes(item.status))throw Error();ids.add(op.operationId);count++;
    if(item.status==='applied'||item.status==='rejected'){if(stopped)throw Error();const ack=validateAck(op,item.acknowledgement);if(ack.outcome!==item.status)throw Error();if(item.status==='rejected')stopped=true}
    else {if(item.acknowledgement!==undefined)throw Error();stopped=true}projection=await project(op,projection,item.localTime);v++;
   }
   if(canonical(projection)!==canonical(g.projection))throw Error();
   if(!g.operations.length&&(!g.base||canonical(g.projection)!==canonical(g.base.view)))throw Error();
   const last=g.operations.at(-1);if(last){const op=operationFromWire(last.wire);if(op.kind==='delete'?g.projection!==null:!g.projection||g.projection.game.version!==v)throw Error()}
  }
  if(count>500||utf8Size(JSON.stringify(state))>8_000_000)throw Error();return state;
 }catch{throw new LocalRepositoryError('STORAGE_CORRUPT','Pending game changes could not be validated. They have been kept for recovery.')}
}
/** One CAS document holds the queue and projection. Neither application opens this layer yet.
 * Never convert an optimistic projection into a confirmed snapshot from receipt metadata alone. */
export function createGameOutbox(documents:AtomicDocuments,access:OutboxAccess){
 async function read(mode:'read'|'write'|'sync'='read'){
  const auth=await access.authorize(mode),key='game-outbox:'+auth.profileId,record=await documents.read(key);
  const state:GameOutbox=record?await decode(record.value,auth.profileId):{schemaVersion:1,profileId:auth.profileId,games:[]};
  await access.authorize(mode);return {auth,key,mode,revision:record?.revision??0,state};
 }
 async function save(context:Awaited<ReturnType<typeof read>>){await access.authorize(context.mode);if(context.state.games.length>50||context.state.games.reduce((n,g)=>n+g.operations.length,0)>500||utf8Size(JSON.stringify(context.state))>8_000_000)throw new OutboxError('QUEUE_FULL','Device queue is full. Connect and review changes before adding more.');await documents.write(context.key,context.revision,context.state,[context.auth.guard]);await access.authorize(context.mode)}
 return {
  async read(){return (await read()).state},
  async seedConfirmed(gameId:string){const ctx=await read('write'),copy=await access.readConfirmed(gameId);if(!copy||copy.profileId!==ctx.auth.profileId||copy.gameId!==gameId)throw new OutboxError('NEEDS_REVIEW','A complete confirmed account snapshot is required.');const existing=ctx.state.games.find(g=>g.gameId===copy.gameId);if(existing){if(canonical(existing.base)!==canonical(copy))throw new OutboxError('NEEDS_REVIEW','Existing pending or confirmed data requires review.');return}ctx.state.games.push({gameId:copy.gameId,base:copy,projection:copy.view,operations:[]});await save(ctx)},
  async enqueue(input:GameOperation){
   // Freeze the exact request before any await; caller changes cannot alter retries.
   const wire=JSON.stringify(input),op=operationFromWire(wire),ctx=await read('write');
   const duplicate=ctx.state.games.flatMap(g=>g.operations).find(i=>operationFromWire(i.wire).operationId===op.operationId);
   if(duplicate){if(duplicate.wire!==wire)throw new OutboxError('OPERATION_ID_REUSED','This operation ID already has a different immutable request.');return}
   let game=ctx.state.games.find(g=>g.gameId===op.gameId);
   if(!game){if(expected(op)!==0)throw new OutboxError('NEEDS_REVIEW','A confirmed base is required before scoring.');game={gameId:op.gameId,base:null,projection:null,operations:[]};ctx.state.games.push(game)}
   if(game.operations.some(i=>i.status==='rejected'))throw new OutboxError('NEEDS_REVIEW','A rejected change and its dependants require review.');
   const v=game.operations.length?expected(operationFromWire(game.operations.at(-1)!.wire))+1:game.base?.serverVersion??0;
   if(expected(op)!==v)throw new OutboxError('NEEDS_REVIEW','The operation does not match the local game version.');
   if(op.kind==='action'&&op.command.action==='score'){
    const entryId=op.command.entryId;
    if(game.base?.view.game.entries.some(e=>e.id===entryId)||game.operations.some(i=>{const prior=operationFromWire(i.wire);return prior.kind==='action'&&prior.command.action==='score'&&prior.command.entryId===entryId||(prior.kind==='import'&&prior.game.entries.some(e=>e.id===entryId))}))throw invalid();
   }
   const localTime=new Date().toISOString();game.projection=await project(op,game.projection,localTime);if(game.projection)snapshot(ctx.auth.profileId,game.projection);
   game.operations.push({wire,status:'queued',localTime});await save(ctx);
  },
  async prepareDelivery(gameId:string,capability:unknown):Promise<string|null>{
   const ctx=await read('sync'),game=ctx.state.games.find(g=>g.gameId===gameId);if(!game)return null;
   const item=game.operations.find(i=>i.status!=='applied');if(!item)return null;if(item.status==='rejected')throw new OutboxError('NEEDS_REVIEW','A rejected change blocks automatic replay of its dependants.');
   const op=operationFromWire(item.wire),cap=capability as {version?:number;receipts?:string;atomicGameAndReceipt?:boolean;kinds?:string[];actions?:string[]}|null;
   if(!cap||cap.version!==1||cap.receipts!=='retained'||cap.atomicGameAndReceipt!==true||(op.kind==='action'?!(Array.isArray(cap.actions)&&cap.actions.includes(op.command.action)):!(Array.isArray(cap.kinds)&&cap.kinds.includes(op.kind))))throw new OutboxError('CAPABILITY_REQUIRED','This server has not advertised compatible replay support.');
   // Persist uncertain BEFORE handing bytes to a transport. Process loss/timeout retries these exact bytes.
   if(item.status!=='uncertain'){item.status='uncertain';await save(ctx)}return item.wire;
  },
  async acknowledge(operationId:string,input:OperationAcknowledgement){
   const copy=JSON.parse(JSON.stringify(input)),ctx=await read('sync'),game=ctx.state.games.find(g=>g.operations.some(i=>operationFromWire(i.wire).operationId===operationId));if(!game)throw new OutboxError('INVALID_ACKNOWLEDGEMENT','Unknown pending operation.');
   const item=game.operations.find(i=>operationFromWire(i.wire).operationId===operationId)!,op=operationFromWire(item.wire);
   let ack:OperationAcknowledgement;try{ack=validateAck(op,copy)}catch{throw new OutboxError('INVALID_ACKNOWLEDGEMENT','The response did not confirm this operation. It remains pending.')}
   if(item.status==='applied'||item.status==='rejected'){if(canonical(item.acknowledgement)!==canonical(ack))throw new OutboxError('INVALID_ACKNOWLEDGEMENT','A conflicting receipt requires review.');return}
   if(item.status!=='uncertain'||game.operations.find(i=>i.status!=='applied')!==item)throw new OutboxError('INVALID_ACKNOWLEDGEMENT','Only the first dispatched change can be acknowledged.');
   item.status=ack.outcome;item.acknowledgement=ack;await save(ctx);
  }
 };
}
