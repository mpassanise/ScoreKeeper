import {createAccountAccess} from './account-access';
import {openConfirmedGames} from './indexeddb-confirmed-games';
/** Future web integration entry point; callers receive scoped access, not raw profile keys. */
export async function openWebAccountRepository(factory:IDBFactory,name?:string){
 return createAccountAccess(await openConfirmedGames(factory,name));
}
