import type {Action,GameView,GameSummary} from '../api';
import type {GameActionOperation,GameWriteOperation,GameOperationCapability} from '../game-operation-contract';
import {applyGameEdit} from '../game-edit';
import {validateScoreAction} from '../score-limit';
import type {AccountGameRead} from './game-read-model';
import type {ReadScope,RepositoryPilot} from './pilot';
export function supportsQueuedScoring(cap:GameOperationCapability|null|undefined){return cap?.version===1&&cap.receipts==='retained'&&cap.atomicGameAndReceipt===true&&Array.isArray(cap.actions)&&cap.actions.includes('score')&&cap.actions.includes('select')}
export function supportsQueuedCompletion(cap:GameOperationCapability|null|undefined){return supportsQueuedScoring(cap)&&cap!.actions.includes('finish')&&cap!.actions.includes('resume')}
export function supportsQueuedCorrections(cap:GameOperationCapability|null|undefined){return supportsQueuedScoring(cap)&&cap!.actions.includes('undo')&&cap!.actions.includes('edit')}
export function supportsQueuedRules(cap:GameOperationCapability|null|undefined){return supportsQueuedScoring(cap)&&cap!.actions.includes('rules')}
export function supportsQueuedDeletion(cap:GameOperationCapability|null|undefined){return supportsQueuedScoring(cap)&&Array.isArray(cap?.kinds)&&cap.kinds.includes('delete')}
export type DeleteGameTarget=GameSummary&{deleteProfileId?:string;deleteOwner?:string|number};
export type ScoreSave={read:AccountGameRead;action:'score'|'select'|'finish'|'resume'|'undo'|'edit'|'rules'|'delete';input:string;entryId?:string};
/** One retained immutable intent per account selector/game, pinned to its profile after an ambiguous local save.
 * Retry is explicit; another click/input must not create a second operation. */
export function createScoringWriter(uuid:()=>string){
 type Intent={operation:GameWriteOperation;profileId:string;input:string;fingerprint:string;flight?:Promise<ScoreSave>};
 const pending=new Map<string,Intent>();
 const key=(scope:ReadScope,id:string)=>JSON.stringify([scope.selector,id]);
 const blocked=()=>Object.assign(new Error('The last save could not be confirmed. Use Retry save before changing this game.'),{code:'SAVE_UNCONFIRMED'});
 function send(pilot:RepositoryPilot,scope:ReadScope,id:string,intent:Intent):Promise<ScoreSave>{
  if(intent.flight)return intent.flight;
  const slot=key(scope,id);
  intent.flight=pilot.enqueueScoring(scope,intent.operation,intent.profileId).then(read=>{if(pending.get(slot)===intent)pending.delete(slot);return {read,action:intent.operation.kind==='delete'?'delete':intent.operation.command.action as ScoreSave['action'],input:intent.input,...(intent.operation.kind==='action'&&'entryId' in intent.operation.command?{entryId:intent.operation.command.entryId}:{})}}).catch(error=>{if((error as {definitelyNotSaved?:boolean})?.definitelyNotSaved&&pending.get(slot)===intent)pending.delete(slot);throw error}).finally(()=>{intent.flight=undefined});
  return intent.flight;
 }
 return {
  pending(scope:ReadScope|null,id:string){return !!scope&&pending.has(key(scope,id))},
  pendingDeletion(scope:ReadScope|null,id:string){return !!scope&&pending.get(key(scope,id))?.operation.kind==='delete'},
  submit(pilot:RepositoryPilot,scope:ReadScope,view:GameView,a:Action,input:string,profileId:string):Promise<ScoreSave>{
   if(!profileId)return Promise.reject(new Error('Account scoring must be verified first.'));
   if(!['score','select','finish','resume','undo','edit','rules'].includes(a.action))return Promise.reject(new Error('This game action is not available here.'));
   const fingerprint=JSON.stringify([profileId,view.game.id,view.game.version,a,input]),slot=key(scope,view.game.id),prior=pending.get(slot);
   if(prior)return prior.flight&&prior.fingerprint===fingerprint?prior.flight:Promise.reject(blocked());
   if(view.game.finished?(!['resume','undo','edit'].includes(a.action)):a.action==='resume')return Promise.reject(new Error(view.game.finished?'Resume this game before entering scores.':'This game is already in progress.'));
   const targetEntryId=a.action==='undo'?(a.entryId??view.game.entries.at(-1)?.id):a.action==='edit'?a.entryId:undefined;
   if((a.action==='undo'||a.action==='edit')&&(!targetEntryId||!view.game.entries.some(e=>e.id===targetEntryId)||a.action==='undo'&&view.game.entries.at(-1)?.id!==targetEntryId))return Promise.reject(new Error('This score entry changed. Reopen the saved game before trying again.'));
   if(a.action==='rules')applyGameEdit(view.game,a.rules);
   validateScoreAction(view.game,a);
   const playerId=('playerId' in a?a.playerId:undefined)??view.game.next;if(!view.game.players.some(p=>p.id===playerId))return Promise.reject(new Error('Choose a player in this game.'));
   const operation:GameActionOperation={protocolVersion:1,kind:'action',operationId:uuid(),gameId:view.game.id,command:a.action==='score'?{action:'score',expectedVersion:view.game.version,points:a.points!,playerId,entryId:uuid()}:a.action==='select'?{action:'select',expectedVersion:view.game.version,playerId}:a.action==='edit'?{action:'edit',expectedVersion:view.game.version,entryId:targetEntryId!,points:a.points!}:a.action==='undo'?{action:'undo',expectedVersion:view.game.version,entryId:targetEntryId!}:a.action==='rules'?{action:'rules',expectedVersion:view.game.version,rules:JSON.parse(JSON.stringify(a.rules!))}:{action:a.action as 'finish'|'resume',expectedVersion:view.game.version}};
   const intent:Intent={operation,profileId,input,fingerprint};pending.set(slot,intent);return send(pilot,scope,view.game.id,intent);
  },
  submitDelete(pilot:RepositoryPilot,scope:ReadScope,target:Pick<GameSummary,'id'|'version'|'finished'>,profileId:string):Promise<ScoreSave>{
   if(!profileId||target.finished)return Promise.reject(new Error('Only verified in-progress account games can be deleted.'));
   const slot=key(scope,target.id),fingerprint=JSON.stringify([profileId,target.id,target.version,'delete']),prior=pending.get(slot);
   if(prior)return prior.flight&&prior.fingerprint===fingerprint?prior.flight:Promise.reject(blocked());
   const operation:GameWriteOperation={protocolVersion:1,kind:'delete',operationId:uuid(),gameId:target.id,expectedVersion:target.version};
   const intent:Intent={operation,profileId,input:'',fingerprint};pending.set(slot,intent);return send(pilot,scope,target.id,intent);
  },
  retry(pilot:RepositoryPilot,scope:ReadScope,id:string){const intent=pending.get(key(scope,id));if(!intent)return Promise.reject(new Error('No unconfirmed save to retry. Reopen the saved game.'));return send(pilot,scope,id,intent)}
 };
}
