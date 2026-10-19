import {createDurableAccountRepository} from './durable-account';
import {openSQLiteConfirmedGames,type SQLiteConnection} from './sqlite-confirmed-games';
/** Future iPhone integration entry point; no native module is loaded here. */
export async function openNativeAccountRepository(db:SQLiteConnection){
 return createDurableAccountRepository(await openSQLiteConfirmedGames(db));
}
