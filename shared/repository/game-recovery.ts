import type {GameView} from '../api';
import type {AccountGameRead} from './game-read-model';
import type {GameCollision,CollisionDecision} from './game-collisions';
import type {ConflictReview,GameOutbox} from './game-outbox';

export type RecoveryCopy={id:string;label:string;view:GameView|null;version:number|null;deleted:boolean};
export type GameRecoveryReview={gameId:string;read:AccountGameRead;copies:RecoveryCopy[];canChooseAccount:boolean;message:string;dependentCount:number;canCheckCollision?:boolean;canResolveCollision?:boolean};
/** Presentation only. A rendered DTO is never authority to choose a version. */
export function recoveryReview(gameId:string,read:AccountGameRead,state:GameOutbox,conflict:ConflictReview|null,collision:GameCollision|null,history:CollisionDecision[]=[]):GameRecoveryReview{
 const game=state.games.find(g=>g.gameId===gameId),copies:RecoveryCopy[]=[];
 const add=(id:string,label:string,view:GameView|null,deleted=false,version:number|null=view?.game.version??null)=>copies.push({id,label,view,deleted,version});
 if(read.kind==='game')add('device','On this device',read.view);
 else if(read.kind==='pending-delete'){add('device','On this device',null,true);if(game?.beforeDelete||game?.base)add('before-delete','Before device deletion',game.beforeDelete??game.base!.view)}
 else if(read.kind==='deleted'){add('deleted','Account deletion confirmed',null,true,read.serverVersion);if(game?.beforeDelete)add('before-delete','Before device deletion',game.beforeDelete)}
 if(collision){add('retained','Earlier account copy',collision.retained.view);add('observed','Conflicting account copy',collision.observed.view)}
 else if(conflict){if('deleted'in conflict.account)add('account','Account copy',null,true,conflict.account.version);else add('account','Account copy',conflict.account.view)}
 else if(game?.candidate)add('account','Last account copy',game.candidate.view);
 for(const batch of [...state.archive].reverse())if(batch.gameId===gameId&&batch.kind==='account-selected'&&batch.recovery){
  add(batch.id,batch.recovery.projection?'Retained device copy':'Before device deletion',batch.recovery.beforeDelete??batch.recovery.projection??batch.recovery.base?.view??null,!batch.recovery.beforeDelete&&!batch.recovery.projection&&!batch.recovery.base);
 }
 for(const d of [...history].reverse()){add(d.id+'-retained','Archived account copy',d.pair.retained.view);add(d.id+'-observed','Archived conflicting copy',d.pair.observed.view);if(d.prior)add(d.id+'-prior','Before collision resolution',d.prior.view);add(d.id+'-selected','Chosen newer account copy',d.selected.view)}
 const uncertain=!!game?.operations.some(op=>op.status==='uncertain');
 const canChooseAccount=!!conflict&&!collision&&!uncertain&&!('deleted'in conflict.account);
 const message=read.kind==='deleted'?'Deletion is confirmed in your account. Retained records stay on this device; opening this review does not restore or upload the game.':collision?'Two account copies disagree at the same version. Both are kept; choosing a version is paused.':uncertain?'A save has an unknown outcome. Reconnect before choosing a version so scores cannot be submitted twice.':conflict&&'deleted'in conflict.account?'This game was deleted in your account. Your device copy is kept for recovery.':canChooseAccount?'Compare your saved copies. Choosing the account copy keeps the current device scores in recovery; it does not combine or upload them.':read.kind==='game'&&read.sync==='needs-review'?'Saved copies still need review. Reconnect to refresh account information; your device scores stay here.':'These are saved copies, not a live connection. Reconnect to check for account updates.';
 return {gameId,read,copies,canChooseAccount,message,dependentCount:conflict?.dependentCount??0,canCheckCollision:!!collision&&!game?.tombstone&&!game?.operations.length};
}

/** Keep non-live evidence inspectable after suppressing its stale game screen. */
export function keepRecoveryReview(review:GameRecoveryReview,view:GameView|null){
 return view?view.game.id===review.gameId:review.read.kind!=='game';
}
