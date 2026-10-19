import {checkDocumentGuard,documentGuards,type DocumentGuard,documentRecord,documentValue,nextDocument,type DocumentRecord} from './documents';
import type {GameView} from '../api';
import {canonical,checkStored,LocalRepositoryError,requireIdentity,snapshot,type ConfirmedGames,type ConfirmedSnapshot} from './confirmed-games';

/** Structural subset of Expo SDK 57 SQLite. No native module is imported or opened here. */
export type SQLiteQueries={
 execAsync(sql:string):Promise<void>;
 runAsync(sql:string,...params:(string|number|null)[]):Promise<unknown>;
 getFirstAsync<T>(sql:string,...params:(string|number|null)[]):Promise<T|null>;
 getAllAsync<T>(sql:string,...params:(string|number|null)[]):Promise<T[]>;
};
export type SQLiteConnection=SQLiteQueries & {
 withExclusiveTransactionAsync(work:(tx:SQLiteQueries)=>Promise<void>):Promise<void>;
 closeAsync():Promise<void>;
};
const CREATE='CREATE TABLE confirmed_games (profile_id TEXT NOT NULL, game_id TEXT NOT NULL, server_version INTEGER NOT NULL, snapshot TEXT NOT NULL, PRIMARY KEY (profile_id, game_id))';
function storageError(error:unknown){return error instanceof LocalRepositoryError?error:new LocalRepositoryError('STORAGE_UNAVAILABLE','Account storage transaction failed. Existing data has been kept.');}
async function durable(tx:SQLiteQueries){
 // Expo exclusive transactions use a separate connection. Verify that connection,
 // rather than assuming a PRAGMA on the original handle applies to it.
 const value=await tx.getFirstAsync<{synchronous:number}>('PRAGMA synchronous');
 if(!value||value.synchronous<2)throw new LocalRepositoryError('STORAGE_UNAVAILABLE','Account storage requires full transaction durability before it can be used.');
}
function decode(row:{server_version:number;snapshot:string},profileId:string,gameId:string){
 try{
  const record=checkStored(JSON.parse(row.snapshot),profileId,gameId);
  if(record.serverVersion!==row.server_version)throw Error();
  return record;
 }catch{throw new LocalRepositoryError('STORAGE_CORRUPT','Saved account data could not be validated. It has been kept for recovery.');}
}
/** Caller supplies a newly opened, dedicated database, not the legacy AsyncStorage source. */
export async function openSQLiteConfirmedGames(db:SQLiteConnection):Promise<ConfirmedGames>{
 try{
  await db.withExclusiveTransactionAsync(async tx=>{
   await durable(tx);
   const version=await tx.getFirstAsync<{user_version:number}>('PRAGMA user_version');
   if(!version||![0,1,2].includes(version.user_version))throw new LocalRepositoryError('STORAGE_CORRUPT','Account storage has an unsupported schema. It has been kept.');
   if(version.user_version===0){
    const existing=await tx.getFirstAsync<{count:number}>("SELECT count(*) AS count FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'");
    if(!existing||existing.count!==0)throw new LocalRepositoryError('STORAGE_CORRUPT','Unrecognized account storage requires review. It has been kept.');
    await tx.execAsync(CREATE);
    await tx.execAsync('PRAGMA user_version = 1');
   }
   const columns=await tx.getAllAsync<{name:string;type:string;notnull:number;pk:number}>('PRAGMA table_info(confirmed_games)');
   const expected=[['profile_id','TEXT',1,1],['game_id','TEXT',1,2],['server_version','INTEGER',1,0],['snapshot','TEXT',1,0]];
   if(canonical(columns.map(c=>[c.name,c.type,c.notnull,c.pk]))!==canonical(expected))throw new LocalRepositoryError('STORAGE_CORRUPT','Account storage schema is incomplete. It has been kept.');
   if(version.user_version<2){
    await tx.execAsync('CREATE TABLE repository_metadata (key TEXT NOT NULL PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL)');
    await tx.execAsync('PRAGMA user_version = 2');
   }
   const metadata=await tx.getAllAsync<{name:string;type:string;notnull:number;pk:number}>('PRAGMA table_info(repository_metadata)');
   if(canonical(metadata.map(c=>[c.name,c.type,c.notnull,c.pk]))!==canonical([['key','TEXT',1,1],['revision','INTEGER',1,0],['document','TEXT',1,0]]))throw new LocalRepositoryError('STORAGE_CORRUPT','Account metadata schema is incomplete. It has been kept.');
  });
  // Journal mode is database-wide and cannot be changed inside a transaction.
  await db.execAsync('PRAGMA journal_mode = WAL');
  const journal=await db.getFirstAsync<{journal_mode:string}>('PRAGMA journal_mode');
  if(journal?.journal_mode.toLowerCase()!=='wal')throw new LocalRepositoryError('STORAGE_UNAVAILABLE','Account storage journal could not be enabled.');
 }catch(error){try{await db.closeAsync()}catch{/* Preserve the original sanitized failure. */}throw storageError(error)}
 let queue:Promise<unknown>=Promise.resolve(),closing=false;
 function serialize<T>(work:()=>Promise<T>):Promise<T>{
  if(closing)return Promise.reject(new LocalRepositoryError('STORAGE_UNAVAILABLE','Account storage is closed.'));
  const result=queue.then(work).catch(error=>{throw storageError(error)});queue=result.catch(()=>{});return result;
 }
 function decodeDocument(row:{revision:number;document:string}){try{return documentRecord({revision:row.revision,value:JSON.parse(row.document)})}catch{throw new LocalRepositoryError('STORAGE_CORRUPT','Repository metadata is invalid. Existing data has been kept.')}}
 return {
  documents:{
   read(key:string){requireIdentity(key);return serialize(async()=>{const row=await db.getFirstAsync<{revision:number;document:string}>('SELECT revision, document FROM repository_metadata WHERE key = ?',key);return row?decodeDocument(row):null})},
   write(key:string,expectedRevision:number,value:unknown,guards?:readonly DocumentGuard[]){requireIdentity(key);const copy=documentValue(value),checks=documentGuards(guards);return serialize(async()=>{let result:DocumentRecord;await db.withExclusiveTransactionAsync(async tx=>{await durable(tx);for(const guard of checks){const checked=await tx.getFirstAsync<{revision:number;document:string}>('SELECT revision, document FROM repository_metadata WHERE key = ?',guard.key);checkDocumentGuard(checked?decodeDocument(checked):undefined,guard)}const row=await tx.getFirstAsync<{revision:number;document:string}>('SELECT revision, document FROM repository_metadata WHERE key = ?',key);result=nextDocument(row?decodeDocument(row):undefined,expectedRevision,copy);await tx.runAsync('INSERT INTO repository_metadata (key, revision, document) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET revision = excluded.revision, document = excluded.document',key,result.revision,JSON.stringify(result.value))});return result!})}
  },
  readConfirmed(profileId:string,gameId:string){
   requireIdentity(profileId);requireIdentity(gameId);
   return serialize(async()=>{
    const row=await db.getFirstAsync<{server_version:number;snapshot:string}>('SELECT server_version, snapshot FROM confirmed_games WHERE profile_id = ? AND game_id = ?',profileId,gameId);
    return row?decode(row,profileId,gameId):null;
   });
  },
  saveConfirmed(profileId:string,views:GameView[]){
   requireIdentity(profileId);const records=views.map(view=>snapshot(profileId,view));
   if(new Set(records.map(r=>r.gameId)).size!==records.length)throw new LocalRepositoryError('INVALID_SNAPSHOT','Duplicate game IDs require review. Existing data has been kept.');
   return serialize(()=>db.withExclusiveTransactionAsync(async tx=>{
    await durable(tx);
    for(const record of records){
     const row=await tx.getFirstAsync<{server_version:number;snapshot:string}>('SELECT server_version, snapshot FROM confirmed_games WHERE profile_id = ? AND game_id = ?',profileId,record.gameId);
     if(row){
      const existing:ConfirmedSnapshot=decode(row,profileId,record.gameId);
      if(existing.serverVersion>record.serverVersion)continue;
      if(existing.serverVersion===record.serverVersion){
       if(canonical(existing.view)!==canonical(record.view))throw new LocalRepositoryError('VERSION_COLLISION','Different game content has the same server version. Both sources require review.');
       continue;
      }
     }
     await tx.runAsync('INSERT INTO confirmed_games (profile_id, game_id, server_version, snapshot) VALUES (?, ?, ?, ?) ON CONFLICT(profile_id, game_id) DO UPDATE SET server_version = excluded.server_version, snapshot = excluded.snapshot',profileId,record.gameId,record.serverVersion,JSON.stringify(record));
    }
   }));
  },
  close(){if(closing)return queue.then(()=>{});closing=true;const result=queue.then(()=>db.closeAsync());queue=result;return result}
 };
}
