import {useEffect,useRef,useState} from 'react';
import {ApiError,ScorekeeperApi,type ScoringControl} from './api';
import {readScoringPermission,rememberScoringPermission,rememberScoringActivation,readScoringActivation,subscribeScoringControl} from './scoring-device';
export const scoringControlCopy={title:'This game is being scored on another device',detail:'You can view scores here. Move scoring to this device to enter scores here; the other device will stop scoring this game.',button:'Score here',confirm:'Move scoring here?',confirmation:'The other device will no longer be able to enter scores for this game.'};
type State={key:string;enabled:boolean;checking:boolean;canScore:boolean;hasScorer:boolean;epoch:number;working:boolean;error:string};
const reachable=()=>true;
const initial=(key:string):State=>({key,enabled:false,checking:!!key,canScore:true,hasScorer:false,epoch:0,working:false,error:''});
/** Ownership stays outside the game/cache/outbox model. A lost connection preserves
 * the last permission and offline scoring; it never erases a draft or queued work. */
export function useScoringControl(owner:string|null,gameId:string|undefined,api:ScorekeeperApi,onForeground:(refresh:()=>void)=>()=>void,isAvailable:()=>boolean=reachable){
 const key=owner&&gameId?JSON.stringify([owner,gameId]):'',current=useRef(key);current.current=key;
 const apiRef=useRef(api);apiRef.current=api;
 const [state,setState]=useState(()=>initial(key));const value=state.key===key?state:initial(key),latest=useRef(value);latest.current=value;
 const refreshRef=useRef<()=>void>(()=>{}),generation=useRef(0),taking=useRef(false),activationPending=useRef(false),lifecycle=useRef(0);
 useEffect(()=>{
  lifecycle.current++;generation.current++;taking.current=false;activationPending.current=false;
  if(!owner||!gameId){setState(initial(''));return}
  let active=true,flight=false,serial=0;const controllers=new Set<AbortController>();
  const valid=()=>active&&current.current===key;
  const update=(next:Partial<State>)=>{if(valid())setState(previous=>({...((previous.key===key)?previous:initial(key)),...next}))};
  async function refresh(){
   if(!valid()||flight||taking.current)return;if(!isAvailable()){update({checking:false});return}flight=true;const requestGeneration=generation.current,version=++serial,controller=new AbortController();controllers.add(controller);
   const timer=setTimeout(()=>controller.abort(),5000);
   try{
    const source=apiRef.current.withSignal(controller.signal),account=await source.account();if(!valid())return;
    if(requestGeneration!==generation.current)return;
    if(!account.scoringControlEnabled){update({enabled:false,checking:false,canScore:true});return}
    const control=await source.scoringControl(gameId!);if(!valid()||version!==serial||requestGeneration!==generation.current)return;
    validate(control);if(!activationPending.current)await rememberScoringPermission(owner!,gameId!,control.canScore);if(!valid()||requestGeneration!==generation.current)return;
    update({...control,canScore:control.canScore&&!activationPending.current,enabled:true,checking:false,...(control.canScore&&!activationPending.current?{error:''}:{})});
   }catch{if(valid()&&!taking.current&&requestGeneration===generation.current)update({checking:false})}finally{clearTimeout(timer);controllers.delete(controller);flight=false}
  }
  refreshRef.current=()=>{void refresh()};
  void (async()=>{try{const saved=await readScoringPermission(owner,gameId),pending=await readScoringActivation(owner,gameId);if(valid())activationPending.current=pending;if(valid()&&saved!==undefined)update({enabled:true,checking:false,canScore:saved})}catch{}if(valid())void refresh()})();
  const timer=setInterval(()=>void refresh(),30000),unsubscribe=subscribeScoringControl(id=>{if(id===gameId){generation.current++;update({enabled:true,canScore:false,hasScorer:true,checking:false});void (activationPending.current?rememberScoringActivation(owner,gameId):rememberScoringPermission(owner,gameId,false)).catch(()=>{});void refresh()}}),foreground=onForeground(()=>void refresh());
  return()=>{active=false;lifecycle.current++;serial++;clearInterval(timer);unsubscribe();foreground();for(const controller of controllers)controller.abort()};
 },[key,onForeground,isAvailable]);
 function assertAllowed(){const now=latest.current;if(current.current!==key||now.key!==key||now.checking||now.working||!now.canScore)throw new ApiError(423,'This game is being scored on another device. Choose “Score here” to continue.','SCORING_ELSEWHERE')}
 async function verifyAllowed(){
  assertAllowed();const captured=latest.current,lease=lifecycle.current,requestGeneration=generation.current,valid=()=>current.current===key&&lifecycle.current===lease;
  if(!captured.enabled||!owner||!gameId||!isAvailable())return;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3000);
  try{
   const control=await apiRef.current.guarded(valid).withSignal(controller.signal).scoringControl(gameId);validate(control);if(!valid())throw new ApiError(499,'Game changed.','REQUEST_CANCELLED');
   if(requestGeneration!==generation.current)throw new ApiError(423,'Scoring moved.','SCORING_ELSEWHERE');
   generation.current++;await rememberScoringPermission(owner,gameId,control.canScore);if(!valid())throw new ApiError(499,'Game changed.','REQUEST_CANCELLED');
   setState({...captured,...control,checking:false});
   if(!control.canScore)throw new ApiError(423,'This game is being scored on another device. Choose “Score here” to continue.','SCORING_ELSEWHERE');
  }catch(error){
   if(!valid())throw new ApiError(499,'Game changed.','REQUEST_CANCELLED');
   // Unreachable network keeps offline scoring available. Explicit denials and
   // authentication failures are not interpreted as an offline connection.
   if(!(error instanceof TypeError)&&!(error instanceof ApiError&&(['REQUEST_TIMEOUT','REQUEST_CANCELLED','DATABASE_WAKING'].includes(error.code??'')||error.status>=500)))throw error;
  }finally{clearTimeout(timer)}
 }
 async function take(before:()=>Promise<void>,ready:()=>Promise<void>,source=apiRef.current){
  const lease=lifecycle.current,valid=()=>current.current===key&&lifecycle.current===lease,captured=latest.current;if(!owner||!gameId||captured.key!==key||captured.working||!captured.enabled||captured.checking)return;
  if(taking.current)return;taking.current=true;generation.current++;
  setState({...captured,working:true,error:''});
  try{
   await before();if(!valid())return;
   activationPending.current=true;await rememberScoringActivation(owner,gameId);if(!valid())return;
   const control=await source.takeScoringControl(gameId,captured.epoch);validate(control);if(!valid())return;activationPending.current=true;
   // Caller's account/game fencing and fresh repository read complete before enabling entry.
   await ready();if(!valid())return;
   await rememberScoringPermission(owner,gameId,true);if(!valid())return;
   activationPending.current=false;setState({...captured,...control,checking:false,working:false,error:''});
  }catch(error){if(valid()){if(error instanceof ApiError&&[400,401,403,404,409,410].includes(error.status)){activationPending.current=false;await rememberScoringPermission(owner!,gameId!,false).catch(()=>{})}if(!valid())return;setState({...captured,working:false,error:(error as {code?:string})?.code==='SCORING_PENDING'?'Your saved scores are waiting to update your account. Reconnect before moving scoring here.':error instanceof ApiError&&error.code==='SCORING_CONTROL_CHANGED'?'Scoring moved again. Choose “Score here” to try again.':'Could not move scoring here. Try again.'});}}finally{if(valid()){taking.current=false;refreshRef.current()}}
 }
 return {...value,blocked:value.checking||value.working||!value.canScore,assertAllowed,verifyAllowed,take,refresh:()=>refreshRef.current()};
}
function validate(value:ScoringControl){if(!value||typeof value.canScore!=='boolean'||typeof value.hasScorer!=='boolean'||!Number.isSafeInteger(value.epoch)||value.epoch<0)throw new Error('Invalid scoring control.')}
