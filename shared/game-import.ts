import {ApiError,type Game,type GameSummary,type ScorekeeperApi} from './api';
import type {LocalGames} from './local-games';
import {needsAdvancedRules} from './presets';
type Cloud=Pick<ScorekeeperApi,'list'|'get'|'import'>;
type Local=Pick<LocalGames,'read'>;
// Ownership is established by the authenticated API, not by a device-wide flag.
export async function pendingImports(local:Local,cloud:Cloud,summaries?:GameSummary[]):Promise<Game[]>{
 const [games,saved]=await Promise.all([local.read(),summaries?Promise.resolve(summaries):cloud.list()]);
 const known=new Set(saved.map(g=>g.id));
 const missing=games.filter(g=>!known.has(g.id));
 if(saved.length<200)return missing;
 // The API list is capped at 200; older imported games may be outside that page.
 const pending:Game[]=[];
 for(const game of missing){try{await cloud.get(game.id)}catch(error){if(error instanceof ApiError&&error.status===404)pending.push(game);else throw error}}
 return pending;
}
export async function importPendingGames(local:Local,cloud:Cloud,rulesEnabled:boolean,onPendingCount:(count:number)=>void){
 const pending=await pendingImports(local,cloud);onPendingCount(pending.length);
 if(!rulesEnabled&&pending.some(g=>needsAdvancedRules(g,g.winner)))throw new Error('These games use advanced rules. Please wait until account scoring has been updated before importing them.');
 let imported=0,existing=0;
 for(const game of pending){
  try{await cloud.import(game);imported++}catch(error){if(error instanceof ApiError&&error.status===409)existing++;else throw error}
  // Only confirmed saves or existing-account conflicts remove the option.
  onPendingCount(pending.length-imported-existing);
 }
 return {imported,existing};
}
