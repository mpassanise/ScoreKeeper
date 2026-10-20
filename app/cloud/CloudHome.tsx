"use client";
import type {AdoptionReview} from '../../shared/repository/adoption-source';
import {createScoringWriter,type DeleteGameTarget} from '../../shared/repository/scoring-writer';
import {gameSummary,homeStatus,type AccountGameHome} from '../../shared/repository/game-home';
import GameRecovery from './GameRecovery';
import {runManualDelivery,createManualSync} from '../../shared/repository/manual-delivery';
import {keepRecoveryReview,type GameRecoveryReview} from '../../shared/repository/game-recovery';
import type {ReadScope} from '../../shared/repository/pilot';
import {setFrequentPlayersAccount,syncFrequentPlayers,clearFrequentPlayersAccount} from "./useFrequentPlayers";
import {startGame,mergeDeviceGames} from '../../shared/game-start';
import {finalRoundMessage,remainingTargetPlayers} from "../../shared/target-ending";
import DragHandle from './DragHandle';
import {isScoreInput} from "../../shared/score-input";

import {openGameScreen,observeGameScreen,gameScreenMessage} from '../../shared/repository/game-screen';
import type {AccountGameRead} from '../../shared/repository/game-read-model';
import {useRepositoryPilot} from './useRepositoryPilot';
import polish from "./WebPolish.module.css";
import {Trophy,Trash2} from "lucide-react";
import {useEffect,useRef,useState,useSyncExternalStore} from "react";
import {createConnectionStatus,isConnectionFailure,RECONNECT_WATCHDOG_MS} from "../../shared/connection-status";
import {createGameListCache} from "../../shared/game-list-cache";
import ConnectionStatus from "./ConnectionStatus";
import {ScorekeeperApi,ApiError,type Game,type GameView,type GameSummary,type Action} from "../../shared/api";
import {auth,cloudEnabled,cloudConfig,signIn,signOut,token} from "./auth";
import {Dialog,DialogContent,DialogTitle} from "@/components/ui/dialog";
import HeaderMenu from "./HeaderMenu";
import SettingsDrawer from "./SettingsDrawer";
import AccountDialog from "./AccountDialog";
const gameScreenPilot=process.env.NEXT_PUBLIC_CONFIRMED_CACHE_PILOT==='true'&&process.env.NEXT_PUBLIC_GAME_SCREEN_PILOT==='true';
const gameRecoveryPilot=gameScreenPilot&&process.env.NEXT_PUBLIC_GAME_RECOVERY_PILOT==='true';
const gameDeliveryPilot=gameRecoveryPilot&&process.env.NEXT_PUBLIC_GAME_DELIVERY_PILOT==='true';
const gameScoringPilot=gameDeliveryPilot&&process.env.NEXT_PUBLIC_GAME_SCORING_PILOT==='true';
const cloudApi=new ScorekeeperApi(cloudConfig.api||"http://localhost:7071/api",token,{readOnlyGames:gameScreenPilot});
import {needsAdvancedRules} from "../../shared/presets";
import GameSetup from "./GameSetup";
import EditGame from './EditGame';
import {canEditGame} from '../../shared/game-edit';
import Standings from "./Standings";
import ScoringGuide from "./ScoringGuide";
import {presets} from "../../shared/presets";
import {defaultSettings,setupRules,type PresetId} from "../../shared/game-setup";
import {pendingImports,importPendingGames,importSummary} from "../../shared/game-import";
import {formatGameTime} from "../../shared/game-time";
import {LocalGames,guestKey,rulesLabel} from "../../shared/local-games";
const localApi=new LocalGames({read:async()=>localStorage.getItem(guestKey),write:async value=>localStorage.setItem(guestKey,value)},()=>crypto.randomUUID());
const listCache=createGameListCache({read:async key=>localStorage.getItem(key),write:async(key,value)=>localStorage.setItem(key,value),remove:async key=>localStorage.removeItem(key)});
const reconnectDraftKey='scorekeeper-reconnect-draft-v1';
type ReconnectDraft={identity:string;gameId?:string;deviceOnly?:boolean;gameVersion?:number;next?:string;points:string;creating:boolean;name:string;names:string[];settings:typeof defaultSettings;presetId:PresetId};
export default function CloudHome({initialSettingsOpen=false,onSettingsClose}:{initialSettingsOpen?:boolean;onSettingsClose?:()=>void}={}){
 const [account,setAccount]=useState<string|null>(null),[loaded,setLoaded]=useState(false),[games,setGames]=useState<GameSummary[]>([]),[view,setView]=useState<GameView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [name,setName]=useState(""),[names,setNames]=useState(["",""]),[points,setPoints]=useState(""),[edit,setEdit]=useState<string|null>(null),[editPoints,setEditPoints]=useState("");
 const [scoringWriter]=useState(()=>createScoringWriter(()=>crypto.randomUUID()));
 const [recovery,setRecovery]=useState<{review:GameRecoveryReview;scope:ReadScope;owner:string|null}|null>(null);
 const recoveryRef=useRef(recovery);recoveryRef.current=recovery;
 useEffect(()=>setRecovery(null),[account]);
 useEffect(()=>setRecovery(current=>current&&keepRecoveryReview(current.review,view)?current:null),[view?.game.id]);
 const [accountRead,setAccountRead]=useState<AccountGameRead|null>(null);
 const rulesEditor=useRef(0);
 const [editingGame,setEditingGame]=useState<Game|null>(null);
 const [adoption,setAdoption]=useState<{review:AdoptionReview;owner:string;attempted:boolean}|null>(null);
 const [deleting,setDeleting]=useState<DeleteGameTarget|null>(null);
 const [reordering,setReordering]=useState(false),[playerOrders,setPlayerOrders]=useState<Record<string,string[]>>({});
 const [creating,setCreating]=useState(false),[completedOpen,setCompletedOpen]=useState(false);
 const [online,setOnline]=useState(true);
 const [settingsOpen,setSettingsOpen]=useState(initialSettingsOpen);
 const [accountOpen,setAccountOpen]=useState(false),[notice,setNotice]=useState("");
 const [guest,setGuest]=useState(false),[rulesEnabled,setRulesEnabled]=useState(false),[localCount,setLocalCount]=useState(0);
 const api=account&&!view?.game.deviceOnly?cloudApi:localApi;
 const [presetId,setPresetId]=useState<PresetId>("custom"),[settings,setSettings]=useState(defaultSettings);
 const {rules,winner}=setupRules(presetId,settings);
 const locked=useRef(false),identity=useRef<string|null>(null),activity=useRef(0),mounted=useRef(true),restoreGame=useRef<ReconnectDraft|null>(null);
 const [manualSync]=useState(()=>createManualSync());
 const [connection]=useState(()=>createConnectionStatus(RECONNECT_WATCHDOG_MS,value=>console.warn('[Scorekeeper connection]',value)));
 const connectionState=useSyncExternalStore(connection.subscribe,connection.getSnapshot,connection.getSnapshot);
 const context=useRef({view,creating,points,edit,editPoints,deleting,editingGame,reordering});context.current={view,creating,points,edit,editPoints,deleting,editingGame,reordering};
 const canUseAccount=(owner:string|null)=>!!owner&&!accountBarrier.current&&identity.current===owner;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;identity.current=null;connection.reset(null)}},[connection]);
 const accountBarrier=useRef(false);
 const pilot=useRepositoryPilot(()=>{accountBarrier.current=true;if(identity.current)try{sessionStorage.setItem(reconnectDraftKey,JSON.stringify({identity:identity.current,gameId:view?.game.id,deviceOnly:view?.game.deviceOnly,gameVersion:view?.game.version,next:view?.game.next,points,creating,name,names,settings,presetId} satisfies ReconnectDraft))}catch{/* Input remains in memory. */}activity.current++;identity.current=null;setView(null);setEditingGame(null);setGames(previous=>previous.filter(g=>g.deviceOnly));connection.fail(Object.assign(new Error('Account changed. Sign in to reconnect.'),{code:'SIGN_IN_REQUIRED'}));setNotice('Account access changed. Your unsent input has been kept. Sign in to reconnect.');});
 const [home,setHome]=useState<{owner:typeof identity.current;selector:string;seeds:GameSummary[];value:AccountGameHome|null;error:boolean}|null>(null);
 const [copiesOpen,setCopiesOpen]=useState(false);
 useEffect(()=>{
  let active=true;const owner=identity.current,repository=pilot.ref.current,scope=repository?.capture();
  if(!gameRecoveryPilot||!canUseAccount(owner)||!scope||scope.selector!==owner){setHome(null);return}
  void repository!.readHome(scope,games).then(value=>{if(active&&canUseAccount(owner))setHome({owner,selector:scope.selector,seeds:games,value,error:false})}).catch(()=>{if(active&&canUseAccount(owner))setHome({owner,selector:scope.selector,seeds:games,value:null,error:true})});
  return()=>{active=false};
 },[games,account,connectionState.status,connectionState.lastConnectedAt]);
 const currentHome=home&&home.owner===identity.current&&home.selector===identity.current&&home.seeds===games&&canUseAccount(home.owner)?home:null;
 const homeGames=gameRecoveryPilot&&account?mergeDeviceGames(currentHome?.value?.games??[],games):games;
 async function reviewHomeCopy(gameId:string){await run(async()=>{
  const owner=identity.current,epoch=activity.current,repository=pilot.ref.current,scope=repository?.capture();
  if(!gameRecoveryPilot||!scope||!canUseAccount(owner)||scope.selector!==owner)return;
  const review=await repository!.readRecovery(scope,gameId,crypto.randomUUID());
  if(!review||!canUseAccount(owner)||activity.current!==epoch)return;
  setAccountRead(review.read);setView(review.read.kind==='game'?review.read.view:null);setCreating(false);setRecovery({review,scope,owner});
 })}
 async function preparePilot(owner:string){try{return await pilot.ref.current?.prepare(owner)??null}catch(error){if(gameScreenPilot)throw error;setNotice('Could not prepare device storage. Account games remain online-only.');return null}}
 async function rememberRead(scope:ReturnType<NonNullable<typeof pilot.ref.current>['capture']>,value:GameView){try{await pilot.ref.current?.record(scope,value)}catch{setNotice('Could not save a device copy. Your account game is still saved.');}}
 async function reconnectSignIn(){
  if(locked.current)return;
  try{
   const draft:ReconnectDraft={identity:identity.current!,gameId:view?.game.id,deviceOnly:view?.game.deviceOnly,gameVersion:view?.game.version,next:view?.game.next,points,creating,name,names,settings,presetId};
   if(identity.current)sessionStorage.setItem(reconnectDraftKey,JSON.stringify(draft));
   await signIn();
  }catch(e){setError(e instanceof Error?e.message:'Could not start sign-in. Your input has been kept.')}
 }
 async function logout(){if(pilot.enabled)accountBarrier.current=true;setView(null);setEditingGame(null);setGames(previous=>previous.filter(g=>g.deviceOnly));identity.current=null;activity.current++;connection.reset(null);await pilot.ref.current?.signOut();await setFrequentPlayersAccount(null,null);await signOut()}
 async function reconnect(){if(connectionState.status==='sign-in')await reconnectSignIn();else await syncGames(true)}
 async function loadCloudGames(){const owner=identity.current,valid=()=>canUseAccount(owner);if(!valid())return;const locals=await localApi.list();if(!valid())return;setGames(previous=>mergeDeviceGames(previous.filter(g=>!g.deviceOnly),locals));const saved=await cloudApi.list();if(!valid())return;await connectPlayers(valid);if(!valid())return;const pending=await (gameScreenPilot?Promise.resolve([]):pendingImports(localApi,cloudApi,saved,valid));if(!valid())return;setGames(mergeDeviceGames(saved,await localApi.list()));if(!valid())return;setLocalCount(pending.length)}
 async function connectPlayers(isCurrent:()=>boolean=()=>true){if(!isCurrent())return;const identity=(await auth()).getActiveAccount()?.homeAccountId;if(!identity||!isCurrent())return;const status=await cloudApi.account();if(!isCurrent()||(await auth()).getActiveAccount()?.homeAccountId!==identity)return;if(!status.profileId)throw new Error('Frequent-player sync requires the API update. Local players are safe.');const user=(await auth()).getActiveAccount();if(!user||!isCurrent())return;try{localStorage.setItem('scorekeeper-player-profile:'+user.homeAccountId,status.profileId)}catch{}await setFrequentPlayersAccount(status.profileId,cloudApi)}
 async function loadGames(){if(account){try{await loadCloudGames()}catch(e){setNotice('Account games could not be refreshed. Games saved on this device are available.'+(e instanceof Error?' '+e.message:''))}}else{setGames(await localApi.list());setLocalCount(0)}}
 async function run(work:()=>Promise<void>){if(locked.current)return;locked.current=true;activity.current++;setBusy(true);setError("");setNotice("");try{await work()}catch(e){if(e instanceof ApiError&&e.status===409&&view){const source=api,owner=identity.current,readScope=pilot.ref.current?.capture()??null;if(source!==cloudApi||canUseAccount(owner))try{const latest=await source.get(view.game.id);if(source!==cloudApi||canUseAccount(owner)){if(source===cloudApi&&gameScreenPilot){if(!pilot.ref.current)throw new Error('Saved game access is unavailable.');const retained=await observeGameScreen(pilot.ref.current,readScope,view.game.id,latest);if(canUseAccount(owner)){setAccountRead(retained);setView(retained.kind==='game'?retained.view:null)}}else setView(latest)}}catch{}}if(isConnectionFailure(e))connection.fail(e);setError(e instanceof Error?e.message:"Unable to connect.")}finally{locked.current=false;setBusy(false)}}
 useEffect(()=>{let active=true;void (async()=>{
  const locals=await localApi.list();if(!active)return;
  if(!cloudEnabled){setGuest(true);setGames(locals);setLoaded(true);return}
  const instance=await auth(),user=instance.getActiveAccount();if(!active)return;
  if(!user){await setFrequentPlayersAccount(null,null);if(active){setGuest(true);setGames(locals);setLoaded(true)}return}
  identity.current=user.homeAccountId;pilot.ref.current?.select(user.homeAccountId);connection.reset(user.homeAccountId);
  const cached=await listCache.read(user.homeAccountId);if(!active)return;
  setAccount(user.name&&user.name!=="unknown"?user.name:user.username||"Your account");
  setGames(mergeDeviceGames(cached,locals));setLoaded(true);
  try{
   const draft=JSON.parse(sessionStorage.getItem(reconnectDraftKey)||'null') as ReconnectDraft|null;
   if(draft?.identity===user.homeAccountId&&typeof draft.points==='string'&&/^-?\d*$/.test(draft.points)&&typeof draft.name==='string'&&Array.isArray(draft.names)&&draft.names.length<=20&&draft.names.every(n=>typeof n==='string')&&['custom','scrabble','phase10'].includes(draft.presetId)){
    if(!draft.gameId)setPoints(draft.points);setName(draft.name);setNames(draft.names);setSettings(draft.settings||defaultSettings);setPresetId(draft.presetId);setCreating(draft.creating===true);
    if(draft.gameId)restoreGame.current=draft;else sessionStorage.removeItem(reconnectDraftKey);
   }
  }catch{/* A malformed draft never replaces saved games. */}
  if(navigator.onLine)void syncGames();else connection.offline();
 })().catch(e=>{if(active){setError(e instanceof Error?e.message:'Could not restore games.');setLoaded(true)}});return()=>{active=false}},[]);
 useEffect(()=>{
  const update=()=>{setOnline(navigator.onLine);if(!navigator.onLine)connection.offline()};
  update();window.addEventListener("online",update);window.addEventListener("offline",update);
  return()=>{window.removeEventListener("online",update);window.removeEventListener("offline",update)};
 },[connection]);
 async function syncGames(manual=false,queued=false):Promise<boolean>{
  const owner=identity.current;if(!owner||locked.current||accountBarrier.current)return false;
  if(manual&&gameDeliveryPilot&&!queued)return manualSync.run(owner,()=>canUseAccount(owner),connection.whenIdle,()=>syncGames(true,true));
  connection.reset(owner);
  return connection.connect(async(isCurrent,signal,step,reportDelivery)=>{
   const valid=()=>mounted.current&&isCurrent()&&identity.current===owner&&!accountBarrier.current;
   const currentContext=context.current,revision=activity.current,draft=restoreGame.current;
   const readApi=new ScorekeeperApi(cloudConfig.api||"http://localhost:7071/api",()=>step('authentication',token),{signal,readAttempts:1,readOnlyGames:gameScreenPilot});
   const selected=currentContext.view&&!currentContext.view.game.deviceOnly?currentContext.view.game.id:(!currentContext.view&&draft?.identity===owner?draft.gameId:undefined);
   const scope=await preparePilot(owner);if(!valid())return;
   const status=await step('account',()=>readApi.account());
   if(!valid())return;
   if((await auth()).getActiveAccount()?.homeAccountId!==owner){identity.current=null;connection.reset(null);return}
   if(!valid())return;
   if(pilot.ref.current&&scope){try{await pilot.ref.current.verify(scope,status)}catch(error){if(gameScreenPilot)throw error;setNotice('Could not prepare device storage. Account games remain online-only.');}if(!valid())return;}
   if(status.deletionStatus)throw new Error('Account deletion is pending. Sync is unavailable.');
   if(manual&&gameDeliveryPilot){
    if(!pilot.ref.current||!scope)throw new Error('Saved game access is not ready. Try Reconnect.');
    await step('delivery',()=>runManualDelivery(pilot.ref.current!,scope,{base:cloudConfig.api,signal,onState:reportDelivery,getToken:async(binding,requestSignal)=>{
     const instance=await auth(),captured=instance.getActiveAccount();
     const current=()=>valid()&&!requestSignal.aborted&&binding.selector===owner&&instance.getActiveAccount()?.homeAccountId===owner;
     if(!captured||!current())throw Object.assign(new Error('Account access changed. Saved changes have been kept.'),{code:'STALE_ACCOUNT'});
     const response=await instance.acquireTokenSilent({scopes:[cloudConfig.scope],account:captured});
     if(!current())throw Object.assign(new Error('Account access changed. Saved changes have been kept.'),{code:'STALE_ACCOUNT'});return response.accessToken;
    }}));if(!valid())return;
   }
   let screenRead:AccountGameRead|null=null,readSelected=selected;
   if(gameScreenPilot&&selected&&pilot.ref.current&&scope&&!(draft?.deviceOnly&&!currentContext.view)){
    const retained=await pilot.ref.current.readGame(scope,selected);if(!valid())return;
    if(retained?.kind==='pending-delete'||retained?.kind==='deleted'){screenRead=retained;readSelected=undefined}
   }
   const [saved,remoteLatest]=await Promise.all([step('games',()=>readApi.list()),readSelected?(draft?.deviceOnly&&!currentContext.view?step('device',()=>localApi.get(readSelected)):step('game',()=>readApi.get(readSelected))):Promise.resolve(null)]);
   if(!valid())return;
   let latest=remoteLatest;
   if(gameScreenPilot&&latest&&!latest.game.deviceOnly){
    if(!pilot.ref.current||!scope||!selected)throw new Error('Saved game access is not ready. Try Reconnect.');
    screenRead=await observeGameScreen(pilot.ref.current,scope,selected,latest);latest=screenRead.kind==='game'?screenRead.view:null;
   }else if(pilot.ref.current&&scope&&latest&&!latest.game.deviceOnly)await rememberRead(scope,latest);
   if(!valid())return;
   const visibleSaved=screenRead&&screenRead.kind!=='game'?saved.filter(g=>g.id!==selected):saved;
   setRulesEnabled((status.scoringRulesVersion||0)>=2);
   const locals=await step('device',()=>localApi.list());if(!valid())return;
   if(revision===activity.current){
    setGames(mergeDeviceGames(visibleSaved,locals));
    if(gameScreenPilot&&screenRead&&screenRead.kind!=='game'&&context.current.view===currentContext.view){setView(null);setAccountRead(screenRead);setNotice(gameScreenMessage(screenRead).title+'. '+gameScreenMessage(screenRead).detail)}
    if(latest&&context.current.view===currentContext.view&&!context.current.creating&&!context.current.points&&!context.current.edit&&!context.current.editingGame&&!context.current.reordering&&(currentContext.view?latest.game.version>=currentContext.view.game.version:!!draft)){
     setView(latest);if(gameScreenPilot)setAccountRead(screenRead);
     if(draft){if(latest.game.version===draft.gameVersion&&latest.game.next===draft.next){setPoints(draft.points);sessionStorage.removeItem(reconnectDraftKey)}else if(draft.points)setNotice('The game changed while you signed in. Your unsent entry of '+draft.points+' was kept in this tab. Review the active player before entering it again.');restoreGame.current=null}
    }
   }
   void listCache.write(owner,visibleSaved).catch(()=>{});
   if(status.profileId){await step('players',()=>setFrequentPlayersAccount(status.profileId!,cloudApi));if(!valid())return;await step('players',()=>syncFrequentPlayers())}
   const pending=await step('imports',()=>(gameScreenPilot?Promise.resolve([]):pendingImports(localApi,readApi,saved,valid)));if(!valid())return;setLocalCount(pending.length);
   const user=(await auth()).getActiveAccount();if(valid()&&user?.homeAccountId===owner&&status.profileId)try{localStorage.setItem('scorekeeper-player-profile:'+owner,status.profileId)}catch{}
  });
 }

 async function enterGuest(){await run(async()=>{setGames(await localApi.list());setView(null);setGuest(true)})}

 useEffect(()=>{if(loaded&&guest&&!account){if(view)localStorage.setItem("scorekeeper-guest-active",view.game.id);else localStorage.removeItem("scorekeeper-guest-active")}},[view,loaded,guest,account]);
 function choosePreset(id:PresetId){setPresetId(id);if(id==="scrabble")setName("Scrabble");else if(id==="phase10")setName("Phase 10");setError("")}
 const game=view?.game;
 const accountReadOnly=gameScreenPilot&&!!account&&!!game&&!game.deviceOnly;
 const accountScoreReadOnly=accountReadOnly&&!(gameScoringPilot&&accountRead?.kind==='game'&&accountRead.canScore);
 const accountCompletionReadOnly=accountReadOnly&&!(gameScoringPilot&&accountRead?.kind==='game'&&accountRead.canChangeCompletion);
 const accountCorrectionReadOnly=accountReadOnly&&!(gameScoringPilot&&accountRead?.kind==='game'&&accountRead.canCorrectEntries);
 const accountRulesReadOnly=accountReadOnly&&!(gameScoringPilot&&accountRead?.kind==='game'&&accountRead.canEditRules);
 const pendingScoreSave=!busy&&!!game&&scoringWriter.pending(pilot.ref.current?.capture()??null,game.id);
 const adoptionPilot=gameScoringPilot&&process.env.NEXT_PUBLIC_GAME_ADOPTION_REVIEW_PILOT==='true';
 const pendingDeletion=!busy&&!!deleting&&scoringWriter.pendingDeletion(pilot.ref.current?.capture()??null,deleting.id);
 const readMessage=pendingScoreSave?{title:'Save not confirmed',detail:'Your input has been kept. Retry checks the original change before allowing another save.'}:gameScreenMessage(accountRead);
 async function reviewSavedCopies(){await run(async()=>{
  if(!gameRecoveryPilot||!view||!pilot.ref.current)return;const owner=identity.current,selected=view.game.id,scope=pilot.ref.current.capture();if(!scope||!canUseAccount(owner))return;
  const review=await pilot.ref.current.readRecovery(scope,selected,crypto.randomUUID());
  if(review&&canUseAccount(owner)&&context.current.view?.game.id===selected){
   setAccountRead(review.read);setView(review.read.kind==='game'?review.read.view:null);
   if(review.read.kind!=='game'){
    if(review.read.kind==='pending-delete'||review.read.kind==='deleted')setGames(previous=>previous.filter(g=>g.id!==selected||g.deviceOnly));
    setNotice(review.read.kind==='missing'?'Saved game access is unavailable on this device. Reconnect to refresh your account.':gameScreenMessage(review.read).title+'. '+gameScreenMessage(review.read).detail);
   }
   setRecovery({review,scope,owner});
  }
 })}
 async function chooseRecoveryCopy(){
  const selected=recovery;if(!selected||!gameRecoveryPilot||!pilot.ref.current||locked.current||!canUseAccount(selected.owner)||!keepRecoveryReview(selected.review,context.current.view))throw new Error('Game or account access changed. Close and reopen this review.');
  locked.current=true;setBusy(true);activity.current++;setError('');
  try{
   const read=await (selected.review.canResolveCollision?pilot.ref.current.resolveCollision(selected.scope,selected.review):pilot.ref.current.chooseAccountRecovery(selected.scope,selected.review));
   if(!canUseAccount(selected.owner)||!keepRecoveryReview(selected.review,context.current.view))return;
   setAccountRead(read);setView(read.kind==='game'?read.view:null);setRecovery(null);
   if(read.kind==='game')setGames(previous=>{
    const summary={...read.view.game,turnCount:read.view.game.entries.length};
    return previous.some(g=>g.id===summary.id&&!g.deviceOnly)?previous.map(g=>g.id===summary.id&&!g.deviceOnly?summary:g):[summary,...previous];
   });
   else if(read.kind==='pending-delete'||read.kind==='deleted')setGames(previous=>previous.filter(g=>g.id!==selected.review.gameId||g.deviceOnly));
   setNotice(read.kind==='game'?'Account copy selected. Your previous device scores are kept in Review saved copies.':gameScreenMessage(read).title+'. '+gameScreenMessage(read).detail);
  }finally{locked.current=false;setBusy(false)}
 }


 async function checkCollisionCopy(){
  const selected=recovery,repository=pilot.ref.current;
  if(!selected||!repository||locked.current)throw new Error('Game or account access changed. Reopen this review.');
  const active=()=>canUseAccount(selected.owner)&&recoveryRef.current===selected&&keepRecoveryReview(selected.review,context.current.view);if(!active())throw new Error('Game or account access changed. Reopen this review.');
  const principal=(await auth()).getActiveAccount();
  if(principal?.homeAccountId!==selected.owner||selected.scope.selector!==selected.owner)throw new Error('Account changed. Reopen this review.');
  let capturedToken:Promise<string>|null=null;
  const readApi=new ScorekeeperApi(cloudConfig.api||'http://localhost:7071/api',async()=>{
   if(!active()||(await auth()).getActiveAccount()?.homeAccountId!==selected.owner)throw new Error('Account changed.');
   const value=await(capturedToken??=(await auth()).acquireTokenSilent({scopes:[cloudConfig.scope],account:principal}).then(result=>result.accessToken));
   if(!active()||(await auth()).getActiveAccount()?.homeAccountId!==selected.owner)throw new Error('Account changed.');return value;
  },{readOnlyGames:true});
  const status=await readApi.account();if(!active())return;
  await repository.verify(selected.scope,status);if(!active())return;
  const latest=await readApi.get(selected.review.gameId);if(!active())return;
  const review=await repository.previewCollisionResolution(selected.scope,selected.review.gameId,latest,crypto.randomUUID());
  if(active())setRecovery({...selected,review});
 }
 async function noPoints(){if(!game||!view||game.finished||busy||reordering)return;await action({action:'score',points:game.scoreMode==='total'?view.totals[game.next]:0,...(game.playStyle==='free'?{playerId:game.next}:{})})}
 async function prepareAccountScoring(){
  const selected=view,profileId=accountRead?.kind==='game'?accountRead.scoreProfileId:'';
  if(!selected||selected.game.deviceOnly||!profileId)return;
  await run(async()=>{
   const owner=identity.current,repository=pilot.ref.current,scope=repository?.capture(),epoch=activity.current;
   if(!gameScoringPilot||!repository||!scope||!canUseAccount(owner))throw new Error('Reconnect before preparing score entry.');
   const read=await repository.prepareScoring(scope,selected,profileId);
   if(!canUseAccount(owner)||activity.current!==epoch||context.current.view?.game.id!==selected.game.id)return;
   setAccountRead(read);setView(read.kind==='game'?read.view:null);
   if(read.kind==='pending-delete'||read.kind==='deleted')setGames(previous=>previous.filter(g=>g.id!==selected.game.id||g.deviceOnly));
  })
 }
 async function reviewDeviceAdoption(){
  const selected=view;if(!selected?.game.deviceOnly)return;
  await run(async()=>{const owner=identity.current,repository=pilot.ref.current,scope=repository?.capture(),epoch=activity.current;
   if(!adoptionPilot||!repository||!scope||!canUseAccount(owner))throw new Error('Reconnect before reviewing an account copy.');
   const raw=localStorage.getItem(guestKey);if(!raw)throw new Error('The device source could not be read. Nothing was changed.');
   const review=await repository.previewAdoption(scope,raw,selected.game.id,crypto.randomUUID());
   if(!canUseAccount(owner)||activity.current!==epoch||context.current.view?.game.id!==selected.game.id)return;
   setAdoption({review,owner:owner!,attempted:false});
  })
 }
 async function confirmDeviceAdoption(){
  const selected=adoption;if(!selected)return;
  await run(async()=>{const repository=pilot.ref.current,scope=repository?.capture(),epoch=activity.current;
   if(!adoptionPilot||!repository||!scope||!canUseAccount(selected.owner))throw new Error('Account access changed. Reopen the review.');
   setAdoption(previous=>previous?.review===selected.review?{...previous,attempted:true}:previous);
   const raw=localStorage.getItem(guestKey);if(!raw)throw new Error('The device source could not be read. Nothing was queued.');
   await repository.confirmAdoptionSource(scope,selected.review,raw);
   if(!canUseAccount(selected.owner)||activity.current!==epoch)return;
   setAdoption(previous=>previous?.review===selected.review?null:previous);
   setNotice('Reviewed copy kept on this device. Your original game is unchanged; nothing was uploaded.');
  })
 }
 async function saveAccountDeletion(target:DeleteGameTarget){
  await run(async()=>{
   const repository=pilot.ref.current,scope=repository?.capture(),owner=target.deleteOwner,profileId=target.deleteProfileId,epoch=activity.current;
   if(!gameScoringPilot||!repository||!scope||typeof owner!=='string'||!canUseAccount(owner)||!profileId)throw new Error('Account access changed. Reopen the game list before deleting.');
   const active=()=>canUseAccount(owner)&&activity.current===epoch;
   const adopt=(read:AccountGameRead)=>{if(read.kind==='pending-delete'||read.kind==='deleted'){setGames(previous=>previous.filter(g=>g.id!==target.id||g.deviceOnly));if(context.current.view?.game.id===target.id&&!context.current.view?.game.deviceOnly){setAccountRead(read);setView(null);setEdit(null);rulesEditor.current++;setEditingGame(null)}}};
   try{const result=await (scoringWriter.pendingDeletion(scope,target.id)?scoringWriter.retry(repository,scope,target.id):scoringWriter.submitDelete(repository,scope,target,profileId));if(!active())return;if(result.read.kind!=='pending-delete'&&result.read.kind!=='deleted')throw Object.assign(new Error('Deletion needs review. Your saved copies have been kept.'),{code:'NEEDS_REVIEW'});adopt(result.read);setNotice(result.read.kind==='deleted'?'Deletion confirmed in your account.':'Deletion saved on this device. Use Sync now to remove it from your account.');if(context.current.deleting===target)setDeleting(null)}catch(error){try{const read=await repository.readGame(scope,target.id);if(read&&active())adopt(read)}catch{/* An unavailable confirmation must not erase the original request. */}throw error}
  })
 }
 async function saveAccountScore(a:Action|null){
  const selected=view;if(!selected)return;
  await run(async()=>{
   const owner=identity.current,repository=pilot.ref.current,scope=repository?.capture();
   if(!gameScoringPilot||!repository||!scope||!canUseAccount(owner))throw new Error('Account score entry is unavailable. Your input has been kept.');
   const epoch=activity.current;
   try{const result=await (a?scoringWriter.submit(repository,scope,selected,a,a.action==='rules'?JSON.stringify({editor:rulesEditor.current,rules:a.rules}):a.action==='edit'?editPoints:points,accountRead?.kind==='game'?accountRead.scoreProfileId??'':''):scoringWriter.retry(repository,scope,selected.game.id));
   if(!canUseAccount(owner)||activity.current!==epoch||context.current.view?.game.id!==selected.game.id)return;
   const read=result.read;setAccountRead(read);setView(read.kind==='game'?read.view:null);
   if(read.kind==='game')setGames(previous=>{const summary=gameSummary(read.view);return previous.some(g=>g.id===summary.id&&!g.deviceOnly)?previous.map(g=>g.id===summary.id&&!g.deviceOnly?summary:g):[summary,...previous]});
   else if(read.kind==='pending-delete'||read.kind==='deleted')setGames(previous=>previous.filter(g=>g.id!==selected.game.id||g.deviceOnly));
   if(result.action==='score'&&context.current.points===result.input)setPoints('');
   if(read.kind!=='game'&&context.current.editingGame){rulesEditor.current++;setEditingGame(null)}
   else if(result.action==='rules'&&context.current.editingGame?.id===selected.game.id&&JSON.parse(result.input).editor===rulesEditor.current){rulesEditor.current++;setEditingGame(null)}
   if(read.kind!=='game'&&context.current.edit)setEdit(null);
   else if(result.action==='edit'&&context.current.edit===result.entryId&&context.current.editPoints===result.input)setEdit(null);
   }catch(error){
    if(['NEEDS_REVIEW','STORAGE_CONFLICT','SYNC_UNAVAILABLE'].includes((error as {code?:string})?.code??''))try{
     const read=await repository.readGame(scope,selected.game.id);
     if(read&&canUseAccount(owner)&&activity.current===epoch&&context.current.view?.game.id===selected.game.id){setAccountRead(read.kind==='game'?{...read,canScore:false,canChangeCompletion:false,canCorrectEntries:false,canEditRules:false,scoreAccess:'paused'}:read);if(read.kind!=='game'){setView(null);if(context.current.editingGame){rulesEditor.current++;setEditingGame(null)}if(context.current.edit)setEdit(null);if(read.kind==='pending-delete'||read.kind==='deleted')setGames(previous=>previous.filter(g=>g.id!==selected.game.id||g.deviceOnly))}}
    }catch{/* Keep input and the last visible copy while storage is unavailable. */}
    throw error;
   }
  })
 }
 async function action(a:Action){if(!game)return;if(accountReadOnly){await saveAccountScore(a);return;}await run(async()=>{const source=api,owner=identity.current;if(source===cloudApi&&!canUseAccount(owner))return;const result=await source.act(game,a);if(source===cloudApi&&!canUseAccount(owner))return;setView(result);if(a.action==="score")setPoints("");if(a.action==="edit")setEdit(null)})}
 async function saveGameRules(a:Action){if(!editingGame)return;if(gameScreenPilot&&account&&!editingGame.deviceOnly){if(view?.game.id!==editingGame.id||view.game.version!==editingGame.version){await run(async()=>{throw new Error('This game changed. Close and reopen the editor.')});return;}await saveAccountScore(a);return;}await run(async()=>{const source=account&&!editingGame.deviceOnly?cloudApi:localApi,owner=identity.current;if(source===cloudApi&&!canUseAccount(owner))return;const updated=await source.act(editingGame,a);if(source===cloudApi&&!canUseAccount(owner))return;setView(updated);setGames(previous=>previous.map(g=>g.id===updated.game.id?{...updated.game,turnCount:updated.game.entries.length}:g));setEditingGame(null)})}
 async function create(){await run(async()=>{const owner=identity.current,signedIn=!!account&&canUseAccount(owner);const result=await startGame({local:localApi,cloud:cloudApi,signedIn:signedIn&&!gameScreenPilot,deviceOnly:gameScreenPilot&&!!account,name,players:names,winner,rules,uuid:()=>crypto.randomUUID()});if(!result.view.game.deviceOnly&&!canUseAccount(owner))return;setAccountRead(null);setView(result.view);setCreating(false);setGames(previous=>[{...result.view.game,turnCount:result.view.game.entries.length},...previous.filter(g=>g.id!==result.view.game.id)]);setNotice(result.message)})}

 async function importLocal(){await run(async()=>{if(gameScreenPilot)throw new Error('Device games are kept here. Adding them to your account is not available yet.');const owner=identity.current,valid=()=>canUseAccount(owner);if(!valid())throw new Error('Account access changed. Sign in to reconnect.');const status=await cloudApi.account();if(!valid())return;const supported=(status.scoringRulesVersion||0)>=2;setRulesEnabled(supported);const result=await importPendingGames(localApi,cloudApi,supported,count=>{if(valid())setLocalCount(count)},(status.scoringRulesVersion||0)>=3,valid);if(!valid())return;await loadCloudGames();if(!valid())return;setNotice(importSummary(result))})}

 useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem("scorekeeper-player-order-v2")||"{}");if(saved&&typeof saved==="object"&&!Array.isArray(saved))setPlayerOrders(Object.fromEntries(Object.entries(saved).filter((entry):entry is [string,string[]]=>Array.isArray(entry[1])&&entry[1].every(id=>typeof id==="string"))))}catch{}},[]);
 useEffect(()=>{setReordering(false)},[game?.id,game?.finished]);
 const savedOrder=game?playerOrders[game.id]:undefined;
 const displayPlayers=game?(savedOrder?[...new Set(savedOrder)].map(id=>game.players.find(p=>p.id===id)).filter((p):p is NonNullable<typeof p>=>!!p).concat(game.players.filter(p=>!savedOrder.includes(p.id))):game.players):[];
 function saveLayout(ids:string[]){if(!game)return false;const updated={...playerOrders,[game.id]:ids};try{localStorage.setItem("scorekeeper-player-order-v2",JSON.stringify(updated));setPlayerOrders(updated);return true}catch{setError("Could not save player positions. Please check browser storage.");return false}}
 function movePlayer(index:number,target:number){const ids=displayPlayers.map(p=>p.id);if(index<0||target<0||index>=ids.length||target>=ids.length||index===target)return;const [id]=ids.splice(index,1);ids.splice(target,0,id);saveLayout(ids)}
 function newGame(){activity.current++;restoreGame.current=null;setName("");setNames(["",""]);setSettings(defaultSettings);setPresetId("custom");setPoints("");setError("");setNotice("");setView(null);setCreating(true)}
 async function openGame(id:string){await run(async()=>{const source=games.find(g=>g.id===id)?.deviceOnly?localApi:account?cloudApi:localApi,owner=identity.current,scope=pilot.ref.current?.capture()??null;if(source===cloudApi&&!canUseAccount(owner))return;if(source===cloudApi&&gameScreenPilot){
   if(!pilot.ref.current)throw new Error('Saved game access is not ready. Try Reconnect.');
   const retained=await openGameScreen(pilot.ref.current,scope,id,()=>source.get(id));if(!canUseAccount(owner))return;
   setAccountRead(retained);setView(retained.kind==='game'?retained.view:null);setPoints('');setCreating(false);
   if(retained.kind!=='game'){setGames(previous=>previous.filter(g=>g.id!==id));setNotice(gameScreenMessage(retained).title+'. '+gameScreenMessage(retained).detail)}return;
  }const result=await source.get(id);if(source===cloudApi&&!canUseAccount(owner))return;setAccountRead(null);setView(result);setPoints('');setCreating(false);if(source===cloudApi)void rememberRead(scope,result)})}
 async function deleteGame(g:DeleteGameTarget){if(gameScreenPilot&&!g.deviceOnly&&(account||g.deleteOwner!==undefined||g.deleteProfileId!==undefined)){await saveAccountDeletion(g);return;}await run(async()=>{const local=!account||g.deviceOnly,source=local?localApi:cloudApi,owner=identity.current;if(source===cloudApi&&!canUseAccount(owner))return;await source.deleteGame(g);if(source===cloudApi&&!canUseAccount(owner))return;setGames(previous=>previous.filter(item=>item.id!==g.id));setDeleting(null);if(!local){try{await localApi.forget(g.id)}catch{setNotice('Game deleted from your account. A local copy could not be removed, but cannot be imported again.')}}setLocalCount(previous=>local?Math.max(0,previous-1):previous)})}
 function savedGame(g:GameSummary){return <div key={g.id} className="game-list-row card"><button className="game-list-card" disabled={busy} onClick={()=>void openGame(g.id)}><span className="game-list-content"><strong>{g.name}</strong><span className="game-list-players">{g.players.map(p=>p.name).join(" · ")}</span>{!g.deviceOnly&&homeStatus(currentHome?.value?.states[g.id])&&<small>{homeStatus(currentHome?.value?.states[g.id])}</small>}<small>{g.deviceOnly?"On this device · ":""}{g.turnCount} {g.turnCount===1?"entry":"entries"}{formatGameTime(g.updated)?` · Updated ${formatGameTime(g.updated)}`:""}</small></span><span className="game-list-action">{(g.finished||(gameScreenPilot&&account&&!g.deviceOnly))?"View":"Resume"} ›</span></button>{!g.finished&&(!(gameScreenPilot&&account&&!g.deviceOnly)||(gameScoringPilot&&currentHome?.value?.states[g.id]?.canDelete===true))&&<button type="button" className="game-delete" disabled={busy} aria-label={`Delete ${g.name}`} title="Delete game" onClick={()=>{setError("");setDeleting({...g,deleteProfileId:currentHome?.value?.profileId,deleteOwner:identity.current??undefined})}}><Trash2 size={18} aria-hidden="true"/></button>}</div>}

 useEffect(()=>{window.scrollTo(0,0);document.getElementById("screen-title")?.focus()},[creating,game?.id]);
 function startReordering(){if(saveLayout(displayPlayers.map(p=>p.id)))setReordering(true)}
 return <main className={polish.app}><header className="top"><button type="button" className="brand brand-home" aria-label="Scorekeeper home" disabled={busy} onClick={()=>void run(async()=>{setView(null);setCreating(false);setEdit(null)})}><img className="brand-icon" src="/scorekeeper-logo.png" width="40" height="40" alt=""/>Scorekeeper</button><div className="header-actions">{account&&<ConnectionStatus state={connectionState} disabled={busy} onReconnect={()=>void reconnect()} onSignIn={()=>void reconnectSignIn()}/ >}{!account&&cloudEnabled&&<button className="header-sign-in" disabled={busy} onClick={()=>void run(signIn)}>Sign in</button>}<HeaderMenu email={account} signedIn={!!account} busy={busy} onSettings={()=>setSettingsOpen(true)} onAccount={()=>setAccountOpen(true)} onSignOut={()=>void run(logout)}/></div></header><div className="wrap">{error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status" className="muted">{notice}</p>}{!loaded?<p>Loading…</p>:<>{!account&&<div className="backrow"><span className="muted">Guest · saved on this device</span></div>}{game&&view?<><div className="title"><div className="game-heading"><button className="link" onClick={()=>void run(async()=>{setView(null);setCreating(false)})}>‹ Home</button><h1>{game.name}</h1><div className="game-description"><p className="game-winner-rule">{game.winner==="high"?"Highest":"Lowest"} score wins</p><p className="game-scoring-rules">{rulesLabel(game)}</p></div></div><div className="game-top-actions">{canEditGame(game)&&!accountRulesReadOnly&&<button disabled={busy} className="outline" onClick={()=>{setError("");setReordering(false);rulesEditor.current++;setEditingGame(game)}}>Edit game</button>}<button disabled={busy||accountCompletionReadOnly||pendingScoreSave} className="outline" onClick={()=>void action({action:game.finished?"resume":"finish"})}>{game.finished?"Resume":"Finish game"}</button>{game.finished&&<button disabled={busy} className="primary" onClick={newGame}>+ New Game</button>}</div></div>{adoptionPilot&&account&&game.deviceOnly&&<button className="outline" disabled={busy} onClick={()=>void reviewDeviceAdoption()}>Review account copy</button>}{game.deviceOnly&&<p role="status" className="muted">Saved on this device. Add it to your account from Home when account saving is available.</p>}{finalRoundMessage(game)&&<p role="status" className="eyebrow">{finalRoundMessage(game)}</p>}<p className="game-time muted">{formatGameTime(game.startedAt)?<>Started <time dateTime={game.startedAt!}>{formatGameTime(game.startedAt)}</time></>:"Start time not recorded"}{game.finished&&formatGameTime(game.endedAt)?<> · Ended <time dateTime={game.endedAt!}>{formatGameTime(game.endedAt)}</time></>:null}</p>{game.finished&&<section className="card panel game-complete" aria-label="Game result"><div className="result-icon" aria-hidden="true"><Trophy size={26}/></div><div className="result-copy"><h2>{view.winnerIds.length>1?"Tie game":"Game complete"}</h2><p className="result-winner">{game.players.filter(p=>view.winnerIds.includes(p.id)).map(p=>p.name).join(" & ")}{view.winnerIds.length?(view.winnerIds.length>1?" tied!":" won!"):""}</p><p className="result-detail">{view.winnerIds.length?`${view.totals[view.winnerIds[0]]} points · ${game.winner==="high"?"Highest":"Lowest"} score wins`:"Game saved"}</p></div><button className="link" disabled={busy||accountCorrectionReadOnly||pendingScoreSave||!game.entries.length||(!!account&&!rulesEnabled&&!gameScoringPilot)} onClick={()=>void action({action:"undo"})}>Undo last score</button></section>}{accountReadOnly&&<section className="card panel" role="status"><strong>{readMessage.title}</strong><p className="muted">{readMessage.detail}</p>{gameScoringPilot&&accountRead?.kind==='game'&&accountRead.scoreAccess==='untracked'&&accountRead.sync==='confirmed'&&!game.finished&&<button className="primary" disabled={busy} onClick={()=>void prepareAccountScoring()}>Enable score entry</button>}{pendingScoreSave&&<button className="outline" disabled={busy} onClick={()=>void saveAccountScore(null)}>Retry save</button>}<div className="entry">{gameRecoveryPilot&&<button className="outline" disabled={busy} onClick={()=>void reviewSavedCopies()}>Review saved copies</button>}<button className="outline" disabled={busy} onClick={()=>void reconnect()}>Reconnect</button>{!game.finished&&<button className="primary" disabled={busy} onClick={newGame}>+ New Game</button>}</div></section>}<div className="standings-toolbar"><Standings view={view}/></div>{!game.finished&&<><ScoringGuide key={game.id} guide={presets.find(p=>p.id===game.presetId)?.scoringGuide}/>{reordering&&<p className="field-help">Drag the handles to arrange your tiles. This does not change turn order.</p>}<section className="scoreboard" data-reorder-list>{displayPlayers.map((p,index)=><div className={`card player-score inline-player ${reordering?"reordering":""} ${p.id===game.next?"active-player":""}`} key={p.id} data-reorder-index={index}><button key={p.id} disabled={busy||accountScoreReadOnly||pendingScoreSave||reordering||game.finished||!!remainingTargetPlayers(game)?.every(r=>r.id!==p.id)} className={`score ${p.id===game.next&&!game.finished?"current":""} ${game.finished?"final-score":""} ${game.finished&&view.winnerIds.includes(p.id)?"winning-score":""}`} onClick={()=>void action({action:"select",playerId:p.id})}><div className="scoretop">{view.winnerIds.includes(p.id)?"WINNER":p.id===game.next&&!game.finished?"PLAYING NOW":""}</div><strong>{view.totals[p.id]}</strong><span className="pname">{p.name}</span></button>{p.id===game.next&&!reordering&&!accountScoreReadOnly&&!pendingScoreSave&&<form className="inline-score-form" aria-label={`Score for ${p.name}`} onSubmit={e=>{e.preventDefault();if(!/^-?\d+$/.test(points)){setError("Enter whole-number points.");return}void action({action:"score",points:Number(points),...(game.playStyle==="free"?{playerId:game.next}:{})})}}><label htmlFor="cloud-points">{game.scoreMode==="total"?"Current total":"Points to add"}</label><div className="entry inline-score-actions"><input id="cloud-points" inputMode="numeric" value={points} onChange={e=>{if(isScoreInput(e.target.value))setPoints(e.target.value)}}/><button disabled={busy} className="primary">{game.scoreMode==="total"?"Set total":"Add score"}</button><button type="button" className="outline no-points-action" disabled={busy||reordering||!!remainingTargetPlayers(game)?.every(p=>p.id!==game.next)} aria-label={`No points for ${game.players.find(p=>p.id===game.next)?.name}; ${game.playStyle==="free"?"record no change to their score":"finish turn and advance to the next player"}`} title={game.playStyle==="free"?"Record no change for the selected player":"Record no change and advance to the next player"} onClick={()=>void noPoints()}>No Points</button></div></form>}{reordering&&<div className="player-move-controls"><DragHandle index={index} label={p.name} onMove={movePlayer}/></div>}</div>)}</section>{!accountReadOnly&&<div className="scoreboard-footer"><div className="scoreboard-actions" role="group" aria-label="Game controls"><button type="button" disabled={busy} className="link" aria-pressed={reordering} onClick={()=>reordering?setReordering(false):startReordering()}>{reordering?"Done reordering":"Reorder players"}</button><button type="button" disabled={busy||reordering||!game.entries.length} className="link" onClick={()=>void action({action:"undo"})}>Undo last score</button></div></div>}{accountReadOnly&&!accountCorrectionReadOnly&&<div className="scoreboard-footer"><button className="link" disabled={busy||pendingScoreSave||reordering||!game.entries.length} onClick={()=>void action({action:"undo"})}>Undo last score</button></div>}</>}<section className="card panel"><h2>{game.scoreMode==="total"?"Total history":"Score history"}</h2><div className="history"><div className="history-heading" aria-hidden="true"><span>Turn #</span><span>Player</span><span>{game.scoreMode==="total"?"Total":"Points"}</span><span></span></div>{[...game.entries].reverse().map((e,index)=><button key={e.id} disabled={busy||accountCorrectionReadOnly||pendingScoreSave} onClick={()=>{setEdit(e.id);setEditPoints(String(e.points))}}><span className="turn-number" aria-label={`Turn ${game.entries.length-index}`}>{game.entries.length-index}</span><span className="history-player">{game.players.find(p=>p.id===e.playerId)?.name}</span><strong>{e.points}</strong><span>Edit ›</span></button>)}</div></section></>:creating?<section className="new-game-screen"><button className="link" disabled={busy} onClick={()=>{setCreating(false);setError("")}}>‹ Home</button><h1 id="screen-title" tabIndex={-1}>New game</h1><GameSetup onManagePlayers={()=>setSettingsOpen(true)} presetId={presetId} onPresetChange={choosePreset} name={name} onNameChange={setName} players={names} onPlayersChange={setNames} settings={settings} onSettingsChange={setSettings} busy={busy} onSubmit={()=>void create()}/></section>:<section className="game-home"><div className="home-intro"><h1 id="screen-title" tabIndex={-1}>Always keep score.</h1><button className="primary new-game-button" disabled={busy} onClick={newGame}>+ New Game</button></div><section className="home-games" aria-labelledby="in-progress-title"><h2 id="in-progress-title">In Progress {homeGames.some(g=>!g.finished)&&<span className="game-count count-active">{homeGames.filter(g=>!g.finished).length}</span>}</h2><div className="game-list">{homeGames.filter(g=>!g.finished).map(savedGame)}</div>{!homeGames.some(g=>!g.finished)&&<div className="card empty-games"><p>{homeGames.length?"No games in progress.":"Your games will appear here."}</p><span className="muted">{homeGames.length?"Start a new game whenever you're ready.":"Start your first game—scores save automatically."}</span></div>}</section>{gameRecoveryPilot&&account&&<section aria-label="Saved account copies">{currentHome?.error?<p role="alert">Saved account games could not be checked. Reconnect to try again. Device games are available.</p>:!currentHome?<p>Checking saved account games…</p>:null}{!!currentHome?.value?.savedCopies.length&&<details className="completed-games"><summary className="completed-toggle">Saved copies ({currentHome.value.savedCopies.length})</summary><p>Review retained copies and deleted games. Opening a copy does not upload or restore it.</p>{currentHome.value.savedCopies.map(row=><div key={row.gameId} className="game-list-row card"><button className="game-list-card" disabled={busy} onClick={()=>void reviewHomeCopy(row.gameId)}><span className="game-list-content"><strong>{row.name}</strong><small>{row.hidden==='pending-delete'?'Deletion waiting to sync':row.hidden==='deleted'?'Deleted from account':homeStatus(row)||'Earlier device copy kept'}</small></span><span className="game-list-action">Review ›</span></button></div>)}</details>}</section>}<section className="completed-games"><button className="completed-toggle" disabled={busy} aria-expanded={completedOpen} aria-controls="completed-game-list" onClick={()=>setCompletedOpen(!completedOpen)}><span>Completed Games {homeGames.some(g=>g.finished)&&<span className="game-count count-completed">{homeGames.filter(g=>g.finished).length}</span>}</span><span aria-hidden="true">{completedOpen?"−":"+"}</span></button>{completedOpen&&<div id="completed-game-list" className="game-list">{homeGames.filter(g=>g.finished).map(savedGame)}{!homeGames.some(g=>g.finished)&&<p className="muted">Finished games will appear here.</p>}</div>}</section>{account&&!gameScreenPilot&&localCount>0&&<button disabled={busy} className="link" onClick={()=>void importLocal()}>Add {localCount} local games to my account</button>}<p className="home-storage muted">{account?(gameScreenPilot?"Saved copies are available here. New games save on this device.":"Saved to your account. Open Account to sync updates from other devices."):"Saved on this device. Sign in for backup and access across devices."}</p></section>}</> }</div>{editingGame&&<EditGame game={editingGame} busy={busy} pending={pendingScoreSave} onRetry={()=>void saveAccountScore(null)} error={error} onClose={()=>{rulesEditor.current++;setEditingGame(null);setError("")}} onSave={saveGameRules}/>}<Dialog open={!!adoption} onOpenChange={open=>{if(!open&&!busy)setAdoption(null)}}><DialogContent style={{maxHeight:'85vh',overflowY:'auto'}}><DialogTitle>Review device copy</DialogTitle><strong>{adoption?.review.view.game.name}</strong><p>{adoption?.review.view.game.entries.length} score entries · Original stays on this device.</p>{adoption?.review.view.game.players.map(player=><p key={player.id}>{player.name}: {adoption.review.view.totals[player.id]}</p>)}<p>Keep a reviewed copy without changing the original game. Nothing will be uploaded.</p>{error&&<p role="alert" className="error">{error}</p>}<div className="entry"><button className="outline" disabled={busy} onClick={()=>setAdoption(null)}>Close</button><button className="primary" disabled={busy} onClick={()=>void confirmDeviceAdoption()}>{adoption?.attempted?'Retry preparation':'Keep reviewed copy'}</button></div></DialogContent></Dialog><Dialog open={!!deleting} onOpenChange={open=>{if(!open&&!busy)setDeleting(null)}}><DialogContent><DialogTitle>Delete {deleting?.name}?</DialogTitle><p>{gameScreenPilot&&!deleting?.deviceOnly&&(account||deleting?.deleteProfileId)?(pendingDeletion?'The deletion save could not be confirmed. Retry checks the original request.':'This queues deletion on this device. The game is removed from your account when sync completes; other devices update after syncing.'):<>This permanently removes the game and its score history{account&&!deleting?.deviceOnly?' from your account and synced devices':' from this device'}. This cannot be undone.</>}</p>{error&&<p role="alert" className="error">{error}</p>}<div className={polish.deleteDialogActions}><button className="outline" disabled={busy} onClick={()=>setDeleting(null)}>{pendingDeletion?'Close':'Keep game'}</button><button className={polish.gameDeleteConfirm} disabled={busy} onClick={()=>deleting&&void deleteGame(deleting)}>{busy?"Deleting…":pendingDeletion?"Retry deletion":"Delete game"}</button></div></DialogContent></Dialog><Dialog open={!!edit} onOpenChange={open=>{if(!open)setEdit(null)}}><DialogContent><DialogTitle>{game?.scoreMode==="total"?"Edit recorded total":"Edit score entry"}</DialogTitle>{error&&<p role="alert" className="error">{error}</p>}<input aria-label="Corrected points" value={editPoints} inputMode="numeric" onChange={e=>{if(isScoreInput(e.target.value))setEditPoints(e.target.value)}}/>{accountReadOnly&&pendingScoreSave&&<><p role="status">Retry checks the original change. Your current input is kept.</p><button className="outline" disabled={busy} onClick={()=>void saveAccountScore(null)}>Retry save</button></>}<button className="primary" disabled={busy||accountCorrectionReadOnly||pendingScoreSave||!/^[-]?\d+$/.test(editPoints)} onClick={()=>void action({action:"edit",entryId:edit!,points:Number(editPoints)})}>Save change</button></DialogContent></Dialog>{recovery&&canUseAccount(recovery.owner)&&<GameRecovery review={recovery.review} onClose={()=>{recoveryRef.current=null;setRecovery(null)}} onChoose={chooseRecoveryCopy} onCheckCollision={checkCollisionCopy}/>}<SettingsDrawer open={settingsOpen} onClose={()=>{setSettingsOpen(false);onSettingsClose?.()}}/><AccountDialog syncSuccessMessage={gameScreenPilot?'Account refreshed. Device changes have been kept.':undefined} deviceSaves={pilot.deviceSaves} onBeforeDelete={pilot.enabled?async()=>{const owner=identity.current;if(!canUseAccount(owner))throw new Error('Account access changed.');const status=await cloudApi.account();if(!canUseAccount(owner))throw new Error('Account changed. Retry from Account.');accountBarrier.current=true;setView(null);setEditingGame(null);setGames(previous=>previous.filter(g=>g.deviceOnly));activity.current++;connection.reset(null);await pilot.ref.current!.beginDeletion(status.profileId)}:undefined} canSync={!!account&&cloudEnabled&&online} working={busy||connectionState.status==='connecting'} onSync={async()=>{const ok=await syncGames(true);if(!ok)throw new Error('Account sync is unavailable. Use Reconnect to try again.');return true}} open={accountOpen} onClose={()=>setAccountOpen(false)} api={cloudApi} onDeleted={async()=>{identity.current=null;activity.current++;connection.reset(null);await clearFrequentPlayersAccount();setGames([]);setView(null);setEdit(null);setPoints("");await signOut()}}/></main>
}
