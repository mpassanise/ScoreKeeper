import type {AccountStatus,GameView} from '../api';
import type {ConfirmedGames} from './confirmed-games';

export type AccountLease=Readonly<{id:symbol}>;
export class AccountAccessError extends Error{
 constructor(readonly code:'STALE_ACCOUNT'|'ACCOUNT_UNVERIFIED'|'PROFILE_MISMATCH'|'ACCOUNT_DELETING'|'SYNC_UNAVAILABLE'){super({STALE_ACCOUNT:'This account session is no longer active.',ACCOUNT_UNVERIFIED:'Verify the account before opening saved account games.',PROFILE_MISMATCH:'The account identity did not match. Saved data has been kept.',ACCOUNT_DELETING:'Account deletion has started. Account access is paused.',SYNC_UNAVAILABLE:'Account sync is unavailable. Existing device data has been kept.'}[code]);this.name='AccountAccessError'}
}
/** Shared by web/SQLite integrations. Inactive until repository cutover.
 * An auth selector/remembered profile is a hint, never permission to read data.
 * This guard preserves records; it does not implement durable sign-out/deletion metadata.
 */
export function createAccountAccess(repository:ConfirmedGames){
 type Session={lease:AccountLease;selector:string;expected?:string;profileId?:string;canSync:boolean};
 let active:Session|null=null,closed=false;
 const deleting=new Set<string>();
 function session(lease:AccountLease){if(!active||active.lease!==lease)throw new AccountAccessError('STALE_ACCOUNT');return active}
 function verified(lease:AccountLease){const current=session(lease);if(!current.profileId)throw new AccountAccessError('ACCOUNT_UNVERIFIED');if(deleting.has(current.profileId))throw new AccountAccessError('ACCOUNT_DELETING');return current as Session & {profileId:string}}
 return {
  beginSession(selector:string,expectedProfileId?:string):AccountLease{
   if(closed)throw new AccountAccessError('STALE_ACCOUNT');
   if(!selector.trim()||(expectedProfileId!==undefined&&!expectedProfileId.trim()))throw new AccountAccessError('ACCOUNT_UNVERIFIED');
   const lease=Object.freeze({id:Symbol('account-session')});
   // Even the same selector requires a fresh lease after explicit sign-in.
   active={lease,selector,expected:expectedProfileId,canSync:false};return lease;
  },
  verify(lease:AccountLease,status:AccountStatus){
   const current=session(lease);current.canSync=false;const profile=status.profileId;
   if(!profile?.trim())throw new AccountAccessError('ACCOUNT_UNVERIFIED');
   if((current.expected&&current.expected!==profile)||(current.profileId&&current.profileId!==profile)){active=null;throw new AccountAccessError('PROFILE_MISMATCH')}
   if(status.deletionStatus||deleting.has(profile)){
    deleting.add(profile);active=null;throw new AccountAccessError('ACCOUNT_DELETING');
   }
   current.profileId=profile;current.canSync=true;
  },
  connectionUnavailable(lease:AccountLease){session(lease).canSync=false},
  signOut(){active=null},
  async close(){closed=true;active=null;await repository.close()},
  beginDeletion(lease:AccountLease){const current=verified(lease);deleting.add(current.profileId);active=null},
  state(){return {localReadable:!!active?.profileId,canSync:active?.canSync===true,profileId:active?.profileId}},
  async readConfirmed(lease:AccountLease,gameId:string){
   const current=verified(lease),result=await repository.readConfirmed(current.profileId,gameId);
   verified(lease);return result;
  },
  async saveConfirmed(lease:AccountLease,views:GameView[]){
   const current=verified(lease);if(!current.canSync)throw new AccountAccessError('SYNC_UNAVAILABLE');
   await repository.saveConfirmed(current.profileId,views);
   verified(lease);
  }
 };
}
