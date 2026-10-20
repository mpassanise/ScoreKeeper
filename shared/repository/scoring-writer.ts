import type {Action,GameView} from '../api';
import type {GameActionOperation,GameOperationCapability} from '../game-operation-contract';
import {validateScoreAction} from '../score-limit';
import type {AccountGameRead} from './game-read-model';
import type {ReadScope,RepositoryPilot} from './pilot';
export function supportsQueuedScoring(cap:GameOperationCapability|null|undefined){return cap?.version===1&&cap.receipts==='retained'&&cap.atomicGameAndReceipt===true&&Array.isArray(cap.actions)&&cap.actions.includes('score')&&cap.actions.includes('select')}
export type ScoreSave={read:AccountGameRead;action:'score'|'select';input:string};
/** One retained immutable intent per account selector/game, pinned to its profile after an ambiguous local save.
 * Retry is explicit; another click/input must not create a second operation. */
export function createScoringWriter(uuid:()=>string){
 type Intent={operation:GameActionOperation;profileId:string;input:string;fingerprint:string;flight?:Promise<ScoreSave>};
 const pending=new Map<string,Intent>();
 const key=(scope:ReadScope,id:string)=>JSON.stringify([scope.selector,id]);
 const blocked=()=>Object.assign(new Error('The last save could not be confirmed. Use Retry save before entering another score.'),{code:'SAVE_UNCONFIRMED'});
 function send(pilot:RepositoryPilot,scope:ReadScope,id:string,intent:Intent):Promise<ScoreSave>{
  if(intent.flight)return intent.flight;
  const slot=key(scope,id);
  intent.flight=pilot.enqueueScoring(scope,intent.operation,intent.profileId).then(read=>{if(pending.get(slot)===intent)pending.delete(slot);return {read,action:intent.operation.command.action as 'score'|'select',input:intent.input}}).catch(error=>{if((error as {definitelyNotSaved?:boolean})?.definitelyNotSaved&&pending.get(slot)===intent)pending.delete(slot);throw error}).finally(()=>{intent.flight=undefined});
  return intent.flight;
 }
 return {
  pending(scope:ReadScope|null,id:string){return !!scope&&pending.has(key(scope,id))},
  submit(pilot:RepositoryPilot,scope:ReadScope,view:GameView,a:Action,input:string,profileId:string):Promise<ScoreSave>{
   if(!profileId)return Promise.reject(new Error('Account scoring must be verified first.'));
   if(a.action!=='score'&&a.action!=='select')return Promise.reject(new Error('Only score entry and player selection are available here.'));
   const fingerprint=JSON.stringify([profileId,view.game.id,view.game.version,a,input]),slot=key(scope,view.game.id),prior=pending.get(slot);
   if(prior)return prior.flight&&prior.fingerprint===fingerprint?prior.flight:Promise.reject(blocked());
   if(view.game.finished)return Promise.reject(new Error('This game has finished.'));
   validateScoreAction(view.game,a);
   const playerId=a.playerId??view.game.next;if(!view.game.players.some(p=>p.id===playerId))return Promise.reject(new Error('Choose a player in this game.'));
   const operation:GameActionOperation={protocolVersion:1,kind:'action',operationId:uuid(),gameId:view.game.id,command:a.action==='score'?{action:'score',expectedVersion:view.game.version,points:a.points!,playerId,entryId:uuid()}:{action:'select',expectedVersion:view.game.version,playerId}};
   const intent:Intent={operation,profileId,input,fingerprint};pending.set(slot,intent);return send(pilot,scope,view.game.id,intent);
  },
  retry(pilot:RepositoryPilot,scope:ReadScope,id:string){const intent=pending.get(key(scope,id));if(!intent)return Promise.reject(new Error('No unconfirmed save to retry. Reopen the saved game.'));return send(pilot,scope,id,intent)}
 };
}
