import {ApiError,type AccountStatus,type GameSummary,type GameView} from './api';
import type {ConnectionStep} from './connection-status';
type ReadApi={account:()=>Promise<AccountStatus>;list:()=>Promise<GameSummary[]>;get:(id:string)=>Promise<GameView>};
/** Verify ownership before starting game reads; never writes or imports a game. */
export async function readAccountSnapshot({api,expectedProfileId,gameId,isCurrent,step}:{api:ReadApi;expectedProfileId?:string;gameId?:string;isCurrent:()=>boolean;step:ConnectionStep}){
 if(!isCurrent())return null;
 const status=await step('account',async()=>{
  const account=await api.account();
  if(!isCurrent())return account;
  if(account.deletionStatus)throw new ApiError(403,'Account deletion is pending. Sync is unavailable.','ACCOUNT_DELETION_PENDING');
  if(expectedProfileId&&account.profileId!==expectedProfileId)throw new ApiError(409,'Account identity could not be verified.','PROFILE_MISMATCH');
  return account;
 });
 if(!isCurrent())return null;
 const [saved,latest]=await Promise.all([step('games',()=>api.list()),gameId?step('game',()=>api.get(gameId)):Promise.resolve(null)]);
 return isCurrent()?{status,saved,latest}:null;
}
