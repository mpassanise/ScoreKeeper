import {createAccountAccess} from './account-access';
import {openSQLiteConfirmedGames,type SQLiteConnection} from './sqlite-confirmed-games';
/** Future iPhone integration entry point; no native module is loaded by this factory. */
export async function openNativeAccountRepository(db:SQLiteConnection){
 return createAccountAccess(await openSQLiteConfirmedGames(db));
}
