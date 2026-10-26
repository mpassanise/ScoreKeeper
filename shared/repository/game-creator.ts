import type {Rules,GameView} from '../api';
import {LocalGames} from '../local-games';
import type {GameLifecycleOperation} from '../game-operation-contract';
import type {RepositoryPilot,ReadScope} from './pilot';
/** Retain immutable IDs across uncertain local acknowledgements. The durable
 * outbox owns the only playable account copy; guest storage is never imported. */
export function createAccountGameCreator(uuid:()=>string){
 const pending=new Map<string,{fingerprint:string;profileId:string;operation:Promise<GameLifecycleOperation>;flight?:Promise<import('./game-read-model').AccountGameRead>}>();
 return {async create(repository:RepositoryPilot,scope:ReadScope,name:string,players:string[],winner:'high'|'low'|'zero',rules:Rules){
  const profileId=await repository.creationProfile(scope);
  const fingerprint=JSON.stringify([name,players,winner,rules]);const key=JSON.stringify([scope.selector,profileId,fingerprint]);let intent=pending.get(key);
  // Independent setups must not block each other. Retain each uncertain request
  // under its verified account and setup so retries reuse its original IDs.
  if(!intent){
   let raw:string|null=null;
   const local=new LocalGames({read:async()=>raw,write:async value=>{raw=value}},uuid);
   const operation=local.create(uuid(),name,players,winner,rules).then((view:GameView)=>{const {deviceOnly,...game}=view.game;return {protocolVersion:1 as const,kind:'create' as const,operationId:uuid(),gameId:game.id,expectedVersion:0 as const,game}});
   intent={fingerprint,profileId,operation};pending.set(key,intent);
   // Validation failure happened before any durable save; editing setup is safe.
   void operation.catch(()=>{if(pending.get(key)===intent)pending.delete(key)});
  }
  if(intent.flight)return intent.flight;
  const captured=intent;
  captured.flight=captured.operation.then(operation=>repository.enqueueCreation(scope,operation,captured.profileId)).then(read=>{if(pending.get(key)===captured)pending.delete(key);return read}).finally(()=>{captured.flight=undefined});
  return captured.flight;
 }};
}
