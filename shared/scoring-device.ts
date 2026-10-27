/** Install identity only. Never part of game snapshots or immutable operation bytes. */
type Storage={read:(key:string)=>Promise<string|null>;write:(key:string,value:string)=>Promise<void>;exclusive?:<T>(work:()=>Promise<T>)=>Promise<T>};
let storage:Storage|undefined,uuid:(()=>string)|undefined,identity:Promise<string>|undefined;
const listeners=new Set<(gameId:string)=>void>();
export function configureScoringDevice(value:Storage,createId:()=>string){storage=value;uuid=createId}
export function scoringDeviceId():Promise<string|undefined>{
 if(!storage||!uuid)return Promise.resolve(undefined);
 if(!identity){const target=storage,create=uuid;const initialize=async()=>{const key='scorekeeper-scoring-device-v1',saved=await target.read(key);if(saved&&/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(saved))return saved;const id=create();await target.write(key,id);return id};const work=target.exclusive?target.exclusive(initialize):initialize();identity=work;work.catch(()=>{if(identity===work)identity=undefined})}
 return identity;
}
export function scoringControlChanged(gameId:string){for(const listener of listeners)try{listener(gameId)}catch{/* UI subscribers cannot change delivery outcomes. */}}
export function subscribeScoringControl(listener:(gameId:string)=>void){listeners.add(listener);return()=>{listeners.delete(listener)}}
let permissionWrites=Promise.resolve();
export async function readScoringPermission(owner:string,id:string):Promise<boolean|undefined>{if(!storage)return;await permissionWrites;const raw=await storage.read('scorekeeper-scoring-permission:'+JSON.stringify([owner,id]));return raw==='yes'?true:raw==='no'||raw==='pending'?false:undefined}
function writePermission(owner:string,id:string,value:string){const target=storage,write=permissionWrites.then(()=>target?.write('scorekeeper-scoring-permission:'+JSON.stringify([owner,id]),value));permissionWrites=write.catch(()=>{});return write}
export function rememberScoringPermission(owner:string,id:string,value:boolean){return writePermission(owner,id,value?'yes':'no')}
export function rememberScoringActivation(owner:string,id:string){return writePermission(owner,id,'pending')}
export async function readScoringActivation(owner:string,id:string){await permissionWrites;return (await storage?.read('scorekeeper-scoring-permission:'+JSON.stringify([owner,id])))==='pending'}
/** Deletion can originate on Home, outside the selected game's controller. */
export async function assertScoringDevice(api:import('./api').ScorekeeperApi,owner:string,gameId:string){
 if(await readScoringActivation(owner,gameId))throw Object.assign(new Error('Open this game and choose Score here before deleting it.'),{code:'SCORING_ELSEWHERE'});
 const previous=await readScoringPermission(owner,gameId);
 let allowed=previous;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
 try{const source=api.withSignal(controller.signal);if((await source.account()).scoringControlEnabled){const control=await source.scoringControl(gameId);if(typeof control.canScore!=='boolean'||!Number.isSafeInteger(control.epoch))throw new Error('Invalid scoring permission.');allowed=control.canScore;await rememberScoringPermission(owner,gameId,allowed)}}catch(error){if(error&&typeof error==='object'&&'status'in error&&[401,403,404,410].includes(Number(error.status)))throw error}finally{clearTimeout(timer)}
 if(allowed===false)throw Object.assign(new Error('Scoring is on another device. Open the game and choose Score here before deleting it.'),{code:'SCORING_ELSEWHERE'});
}
