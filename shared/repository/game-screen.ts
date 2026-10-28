import type {GameView} from '../api';
import {LocalRepositoryError} from './confirmed-games';
import type {AccountGameRead} from './game-read-model';
import type {ReadScope,RepositoryPilot} from './pilot';

/** Never expose a raw GET in place of a tracked projection or deletion marker. */
export async function observeGameScreen(pilot:RepositoryPilot,scope:ReadScope|null,gameId:string,view:GameView):Promise<AccountGameRead>{
 if(view.game.id!==gameId)throw new LocalRepositoryError('INVALID_SNAPSHOT','The account response belongs to a different game.');
 try{await pilot.record(scope,view)}catch(error){
  const code=(error as {code?:string})?.code;
  if(code!=='NEEDS_REVIEW'&&code!=='VERSION_COLLISION')throw error;
  const retained=await pilot.readGame(scope,gameId);
  if((retained?.kind==='game'||retained?.kind==='pending-delete')&&retained.sync==='needs-review')return retained;
  if(retained?.kind==='deleted')return retained;
  throw error;
 }
 const result=await pilot.readGame(scope,gameId);
 if(!result||result.kind==='missing')throw new LocalRepositoryError('STORAGE_UNAVAILABLE','The saved game could not be read. Existing copies have been kept.');
 return result;
}
export async function openGameScreen(pilot:RepositoryPilot,scope:ReadScope|null,gameId:string,fetchGame:()=>Promise<GameView>):Promise<AccountGameRead>{
 const retained=await pilot.readGame(scope,gameId);
 if(!retained)throw new LocalRepositoryError('STORAGE_UNAVAILABLE','Saved game access is unavailable.');
 if(retained.kind!=='missing')return retained;
 return observeGameScreen(pilot,scope,gameId,await fetchGame());
}
export function gameScreenMessage(read:AccountGameRead|null):{title:string;detail:string}{
 if(read?.kind==='game'&&read.view.game.finished&&(read.canChangeCompletion||read.canCorrectEntries))return {title:'Game complete',detail:read.canCorrectEntries?'Your scores are saved here. You can correct a turn in history or undo the last score. Changes update your account when connected.':'Your scores are saved here. Resume to keep playing. Changes update your account when connected.'};
 if(read?.kind==='game'&&read.canScore)return {title:read.sync==='pending'?'Saved on this device':'Ready to score',detail:read.canEditRules?'Scores and changes save on this device first, then update your account when connected.':read.canCorrectEntries?'Scores save on this device first and update your account when connected. Game settings are view only.':'Scores save on this device first and update your account when connected. Game settings and history are view only.'};
 if(read?.kind==='game'&&read.scoreAccess==='connect')return {title:'Reconnect to score',detail:'Reconnect to check whether this game can be scored on this device. Your saved games remain available.'};
 if(read?.kind==='game'&&read.scoreAccess==='untracked')return {title:'Set up scoring on this device',detail:'Enable score entry to continue. Scores save on this device first and update your account when connected.'};
 if(read?.kind==='game'&&read.scoreAccess==='paused'&&read.sync==='pending')return {title:'We couldn’t confirm the last save',detail:'Reconnect to check whether your last score reached your account. The saved changes on this device are kept.'};
 if(read?.kind==='deleted')return {title:'Game deleted',detail:'The deletion is saved on this device.'};
 if(read?.kind==='pending-delete')return {title:read.sync==='needs-review'?'Deletion needs attention':'Deletion waiting to update',detail:'This game stays hidden while its deletion is checked. Saved changes are kept.'};
 if(read?.kind==='game'&&read.sync==='needs-review')return {title:'Saved changes need attention',detail:'Your changes are kept on this device. Reconnect to review them before continuing.'};
 if(read?.kind==='game'&&read.scoreAccess==='paused')return {title:'Scoring paused',detail:'Reconnect to load the latest saved game before entering more scores. Your current input is kept.'};
 if(read?.kind==='game'&&read.sync==='pending')return {title:'Saved on this device',detail:'Your changes will update your account when connected.'};
 return {title:'View only',detail:'Reconnect to check this game, or start a new game to score on this device.'};
}

/** Routine saves stay quiet; only show help when the game needs user action. */
export function showGameSyncNotice(read:AccountGameRead|null,unconfirmedSave=false){
 if(unconfirmedSave)return true;
 if(!read)return false;
 if(read.kind!=='game')return false;
 if(read.sync==='needs-review')return true;
 return !read.canScore&&!read.canChangeCompletion&&!read.canCorrectEntries;
}
