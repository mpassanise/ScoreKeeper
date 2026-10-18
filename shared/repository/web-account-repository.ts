import {createDurableAccountRepository} from './durable-account';
import {openConfirmedGames} from './indexeddb-confirmed-games';
/** Future web integration entry point. Durable verification/lifecycle state is mandatory. */
export async function openWebAccountRepository(factory:IDBFactory,name?:string){
 return createDurableAccountRepository(await openConfirmedGames(factory,name));
}
