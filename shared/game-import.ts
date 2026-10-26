import {ApiError,type Game,type GameSummary,type ScorekeeperApi} from './api';
import type {LocalGames} from './local-games';
import {needsAdvancedRules} from './presets';
type Cloud=Pick<ScorekeeperApi,'list'|'get'|'import'>;
type Local=Pick<LocalGames,'read'> & Partial<Pick<LocalGames,'markDeviceOnly'|'forget'>>;
function current(isCurrent?:()=>boolean){if(isCurrent&&!isCurrent())throw new Error('Account changed during import.');}
// Ownership is established by the authenticated API, not by a device-wide flag.
export async function pendingImports(local:Local,cloud:Cloud,summaries?:GameSummary[],isCurrent?:()=>boolean):Promise<Game[]>{
 const games=await local.read();current(isCurrent);const saved=summaries??await cloud.list();current(isCurrent);
 const known=new Set(saved.map(g=>g.id));
 const unconfirmed=new Set<string>();
 for(const game of games.filter(g=>g.deviceOnly&&known.has(g.id))){current(isCurrent);const accountGame=(await cloud.get(game.id)).game;current(isCurrent);if(sameSavedGame(game,accountGame))await local.markDeviceOnly?.(game.id,false);else unconfirmed.add(game.id)}
 const missing=games.filter(g=>!known.has(g.id)||unconfirmed.has(g.id));
 if(saved.length<200)return missing;
 // The API list is capped at 200; older imported games may be outside that page.
 const pending:Game[]=[];
 for(const game of missing){if(unconfirmed.has(game.id)){pending.push(game);continue}current(isCurrent);try{await cloud.get(game.id);current(isCurrent)}catch(error){current(isCurrent);if(error instanceof ApiError&&error.status===404)pending.push(game);else throw error}}
 return pending;
}
export async function importPendingGames(local:Local,cloud:Cloud,rulesEnabled:boolean,onPendingCount:(count:number)=>void,roundEndingEnabled=false,isCurrent?:()=>boolean){
 const pending=await pendingImports(local,cloud,undefined,isCurrent);current(isCurrent);onPendingCount(pending.length);
 const blocked=pending.filter(g=>(!rulesEnabled&&needsAdvancedRules(g,g.winner))||(g.targetEnd==='round'&&!roundEndingEnabled));
 const blockedIds=new Set(blocked.map(g=>g.id));
 let imported=0,existing=0,deleted=0;
 for(const game of pending.filter(g=>!blockedIds.has(g.id))){
   current(isCurrent);try{await cloud.import(game);current(isCurrent);if(game.deviceOnly)await local.markDeviceOnly?.(game.id,false);imported++}catch(error){current(isCurrent);if(error instanceof ApiError&&error.status===410&&error.code==='GAME_DELETED'){await local.forget?.(game.id);deleted++}else if(error instanceof ApiError&&error.status===409){if(game.deviceOnly){const saved=(await cloud.get(game.id)).game;current(isCurrent);if(!sameSavedGame(game,saved))throw new ApiError(409,'An account copy has different scores. Your device copy was kept.');await local.markDeviceOnly?.(game.id,false)}existing++}else throw error}
  // Only confirmed saves or existing-account conflicts remove the option.
   current(isCurrent);onPendingCount(pending.length-imported-existing-deleted);
 }
 return {imported,existing,blocked:blocked.length,...(deleted?{deleted}:{})};
}

export function importSummary(result:{imported:number;existing:number;blocked:number;deleted?:number}){return [result.imported?`${result.imported} ${result.imported===1?"game added":"games added"} to your account.`:result.blocked?"No games were added.":"These games are already in your account.",result.blocked?`${result.blocked} ${result.blocked===1?"game uses":"games use"} scoring rules that aren't available for account games yet. ${result.blocked===1?"It remains":"They remain"} saved on this device.`:result.deleted?`${result.deleted} previously deleted ${result.deleted===1?"game was":"games were"} removed from this device.`:"Local copies were kept."].join(" ")}

function sameSavedGame(a:Game,b:Game){const content=(g:Game)=>JSON.stringify([g.id,g.name,g.players,g.winner,g.entries,g.next,g.finished,g.playStyle||'turns',g.scoreMode||'add',g.endCondition||'manual',g.roundLimit,g.targetScore,g.startingScore,g.exactZero,g.targetEnd||'immediate',g.presetId,g.presetVersion]);return content(a)===content(b)}
