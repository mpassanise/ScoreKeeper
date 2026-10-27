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
 if(read?.kind==='game'&&read.view.game.finished&&(read.canChangeCompletion||read.canCorrectEntries))return {title:read.sync==='pending'?'Game finished on this device':'Game complete',detail:read.canCorrectEntries?'Your scores are kept. Correct an entry in history or undo the last score. Changes sync automatically when connected.':'Your scores are kept. Resume to continue scoring. Changes sync automatically when connected.'};
 if(read?.kind==='game'&&read.canScore)return {title:read.sync==='pending'?'Scores saved on this device':'Ready to keep score',detail:read.canEditRules?'Changes save on this device first. They sync automatically when connected.':read.canCorrectEntries?'Changes save here first. They sync automatically when connected. Game settings are view only.':'Scores save here first. They sync automatically when connected. Game settings and history are view only.'};
 if(read?.kind==='game'&&read.scoreAccess==='connect')return {title:'Saved copy · view only',detail:'Reconnect to verify account scoring support before entering scores. Your saved games and device games remain available.'};
 if(read?.kind==='game'&&read.scoreAccess==='untracked')return {title:'Saved copy · view only',detail:'Enable score entry to use this saved copy. Scores will save on this device first. They sync automatically when connected.'};
 if(read?.kind==='game'&&read.scoreAccess==='paused'&&read.sync==='pending')return {title:'Save confirmation pending',detail:'Reconnect to check the last save before entering more scores. Existing changes stay on this device.'};
 if(read?.kind==='deleted')return {title:'Game deleted',detail:'The confirmed deletion is saved on this device.'};
 if(read?.kind==='pending-delete')return {title:read.sync==='needs-review'?'Deletion needs review':'Deletion pending',detail:'This game stays hidden while its account deletion is unresolved. Your saved changes have been kept.'};
 if(read?.kind==='game'&&read.sync==='needs-review')return {title:'This game needs attention',detail:'This game could not sync automatically. Your changes are safely saved here. Resolve the sync issue to continue.'};
 if(read?.kind==='game'&&read.scoreAccess==='paused')return {title:'Score entry paused',detail:'Reconnect to load the latest saved state before entering scores. Your input has been kept.'};
 if(read?.kind==='game'&&read.sync==='pending')return {title:'Changes saved on this device',detail:'Account confirmation is pending. You can review these scores while reconnecting.'};
 return {title:'Saved copy · view only',detail:'You can review this account game. Start a new game to keep score on this device.'};
}

/** Routine saves stay quiet; only show help when the game needs user action. */
export function showGameSyncNotice(read:AccountGameRead|null,unconfirmedSave=false){
 if(unconfirmedSave)return true;
 if(!read)return false;
 if(read.kind!=='game')return false;
 if(read.sync==='needs-review')return true;
 return !read.canScore&&!read.canChangeCompletion&&!read.canCorrectEntries;
}
