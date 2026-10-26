import {winnerLabel} from '../shared/scoring';
import {createAccountGameCreator} from '../shared/repository/game-creator';
import {useAutomaticSync} from './useAutomaticSync';
import {automaticResult} from '../shared/repository/automatic-sync';
import type {AdoptionReview} from '../shared/repository/adoption-source';
import {createScoringWriter,type DeleteGameTarget} from '../shared/repository/scoring-writer';
import {gameSummary,homeStatus,type AccountGameHome} from '../shared/repository/game-home';
import GameRecovery from './GameRecovery';
import {runManualDelivery,createManualSync} from '../shared/repository/manual-delivery';
import {keepRecoveryReview,type GameRecoveryReview} from '../shared/repository/game-recovery';
import type {ReadScope} from '../shared/repository/pilot';
import {openGameScreen,observeGameScreen,gameScreenMessage,showGameSyncNotice} from '../shared/repository/game-screen';
import type {AccountGameRead} from '../shared/repository/game-read-model';
import {useRepositoryPilot} from './useRepositoryPilot';
import {readAccountSnapshot} from '../shared/account-refresh';
import {setFrequentPlayersAccount,syncFrequentPlayers,clearFrequentPlayersAccount} from './useFrequentPlayers';
import {createGameListCache} from '../shared/game-list-cache';
import SwipeGameRow from './SwipeGameRow';
import EditGame from './EditGame';
import {canEditGame} from '../shared/game-edit';
import Standings from './Standings';
import InlineScoreEntry from './InlineScoreEntry';
import {startGame,mergeDeviceGames} from '../shared/game-start';
import {finalRoundMessage,remainingTargetPlayers} from '../shared/target-ending';
import {buttonColors} from './button-colors';
import AppHeader from './AppHeader';
import GameToolbar from './GameToolbar';
import SideDrawer from './SideDrawer';
import Settings from './Settings';
import {useThemeStyles,useTheme,ThemeProvider} from './Theme';
import DragHandle,{DraggablePlayer} from './DragHandle';
import {isScoreInput} from '../shared/score-input';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {createConnectionStatus,isConnectionFailure,RECONNECT_WATCHDOG_MS} from '../shared/connection-status';
import ConnectionStatus from './ConnectionStatus';
import {Alert,AppState,Keyboard,KeyboardAvoidingView,LayoutAnimation,Modal,Platform,Pressable,RefreshControl,ScrollView,StatusBar,StyleSheet,Text,TextInput,View} from 'react-native';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import {ScorekeeperApi,ApiError,type Game,type Action,type GameView,type GameSummary} from '../shared/api';
import AccountModal,{PolicyLinks} from './AccountModal';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {presets,needsAdvancedRules} from "../shared/presets";
import GameSetup from "./GameSetup";
import {defaultSettings,setupRules,type PresetId} from "../shared/game-setup";
import {pendingImports,importPendingGames,importSummary} from "../shared/game-import";
import {formatGameTime} from "../shared/game-time";
import {LocalGames,guestKey,rulesLabel} from '../shared/local-games';
const localApi=new LocalGames({read:()=>AsyncStorage.getItem(guestKey),write:value=>AsyncStorage.setItem(guestKey,value)},()=>Crypto.randomUUID());
const gameListCache=createGameListCache({read:key=>AsyncStorage.getItem(key),write:(key,value)=>AsyncStorage.setItem(key,value),remove:key=>AsyncStorage.removeItem(key)});
WebBrowser.maybeCompleteAuthSession();
const authority=process.env.EXPO_PUBLIC_AUTHORITY||'';
const clientId=process.env.EXPO_PUBLIC_CLIENT_ID||'';
const scope=process.env.EXPO_PUBLIC_SCOPE||'';
const apiUrl=process.env.EXPO_PUBLIC_API_URL||'';
const gameScreenPilot=process.env.EXPO_PUBLIC_CONFIRMED_CACHE_PILOT==='true'&&process.env.EXPO_PUBLIC_GAME_SCREEN_PILOT==='true';
const gameRecoveryPilot=gameScreenPilot&&process.env.EXPO_PUBLIC_GAME_RECOVERY_PILOT==='true';
const gameDeliveryPilot=gameRecoveryPilot&&process.env.EXPO_PUBLIC_GAME_DELIVERY_PILOT==='true';
const gameScoringPilot=gameDeliveryPilot&&process.env.EXPO_PUBLIC_GAME_SCORING_PILOT==='true';
const automaticDeliveryPilot=gameScoringPilot&&process.env.EXPO_PUBLIC_GAME_COLD_WRITES_PILOT==='true'&&process.env.EXPO_PUBLIC_GAME_AUTOMATIC_SYNC_PILOT==='true';
const configured=!!(authority&&clientId&&scope&&apiUrl);
type Session={profileId?:string;accessToken:string;refreshToken?:string;expiresAt:number};
const sessionKey='scorekeeper-session';
const redirectUri=AuthSession.makeRedirectUri({scheme:'scorekeeper',path:'auth'});
const scoreRecoveryKey='scorekeeper-score-recovery-v1';
type ScoreRecoveryDraft={profileId:string;gameId:string;gameVersion:number;next:string;points:string};
export default function App(){return <SafeAreaProvider><ThemeProvider><Scorekeeper/></ThemeProvider></SafeAreaProvider>}
function Scorekeeper(){
 const s=useThemeStyles(baseStyles);
 const {dark}=useTheme();
 const [draggingPlayer,setDraggingPlayer]=useState(false),[dragTarget,setDragTarget]=useState<number|null>(null);
 const [creating,setCreating]=useState(false),[completedOpen,setCompletedOpen]=useState(false);
 const scroll=useRef<ScrollView>(null);
 const [foregroundSyncing,setForegroundSyncing]=useState(false),[pullRefreshing,setPullRefreshing]=useState(false);
 const startupIdentity=useRef<number|null>(null),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 const foregroundState=useRef(AppState.currentState),backgroundSince=useRef<number|null>(null),foregroundFlight=useRef(false),activityRevision=useRef(0);

 const [settingsOpen,setSettingsOpen]=useState(false);
 const [guideExpanded,setGuideExpanded]=useState(true);
 const scrollOffset=useRef(0);
 const discovery=AuthSession.useAutoDiscovery(authority);
 const [request,,promptAsync]=AuthSession.useAuthRequest({clientId,redirectUri,scopes:['openid','profile','offline_access',scope].filter(Boolean),usePKCE:true,responseType:AuthSession.ResponseType.Code},discovery);
 const [session,setSession]=useState<Session|null>(null),[ready,setReady]=useState(false),[games,setGames]=useState<GameSummary[]>([]),[view,setView]=useState<GameView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [name,setName]=useState(''),[names,setNames]=useState(['','']),[points,setPoints]=useState(''),[edit,setEdit]=useState<string|null>(null),[editPoints,setEditPoints]=useState('');
 const [gameDetailsOpen,setGameDetailsOpen]=useState(false),[historyOpen,setHistoryOpen]=useState(false);
 const [reordering,setReordering]=useState(false),[layoutsLoaded,setLayoutsLoaded]=useState(false),[playerOrders,setPlayerOrders]=useState<Record<string,string[]>>({});
 const [accountGameCreator]=useState(()=>createAccountGameCreator(()=>Crypto.randomUUID()));
 const [scoringWriter]=useState(()=>createScoringWriter(()=>Crypto.randomUUID()));
 const [recovery,setRecovery]=useState<{review:GameRecoveryReview;scope:ReadScope;owner:number}|null>(null);
 const recoveryRef=useRef(recovery);recoveryRef.current=recovery;
 useEffect(()=>setRecovery(null),[session?.profileId]);
 useEffect(()=>setRecovery(current=>current&&keepRecoveryReview(current.review,view)?current:null),[view?.game.id]);
 const [accountRead,setAccountRead]=useState<AccountGameRead|null>(null);
 const rulesEditor=useRef(0);
 const [adoption,setAdoption]=useState<{review:AdoptionReview;owner:number;attempted:boolean}|null>(null);
 const [deleting,setDeleting]=useState<DeleteGameTarget|null>(null);
 const [editingGame,setEditingGame]=useState<Game|null>(null);
 const [accountOpen,setAccountOpen]=useState(false),[notice,setNotice]=useState("");
 const foregroundContext=useRef({view,creating,accountOpen,settingsOpen,editingGame,points,edit,editPoints,deleting,reordering});foregroundContext.current={view,creating,accountOpen,settingsOpen,editingGame,points,edit,editPoints,deleting,reordering};
 const [guest,setGuest]=useState(false),[rulesEnabled,setRulesEnabled]=useState(false),[localCount,setLocalCount]=useState(0),[blockedLocalCount,setBlockedLocalCount]=useState(0);
 const [presetId,setPresetId]=useState<PresetId>("custom"),[settings,setSettings]=useState(defaultSettings);
 const {rules,winner}=setupRules(presetId,settings);
 const identityRevision=useRef(0),sessionWrites=useRef(Promise.resolve());
 const [manualSync]=useState(()=>createManualSync());
 const [connection]=useState(()=>createConnectionStatus(RECONNECT_WATCHDOG_MS,value=>console.warn('[Scorekeeper connection]',value)));
 const connectionState=useSyncExternalStore(connection.subscribe,connection.getSnapshot,connection.getSnapshot);
 useEffect(()=>()=>connection.reset(null),[connection]);
 const current=useRef<Session|null>(null),locked=useRef(false),renewing=useRef<Promise<string>|null>(null);
 const accountBarrier=useRef(false),accountIntent=useRef<'sign-out'|'deletion'|null>(null),recoveryDraft=useRef<ScoreRecoveryDraft|null>(null),restoringScoreDraft=useRef(false);
 const canUseAccount=(owner:number)=>!!current.current&&!accountBarrier.current&&identityRevision.current===owner;
 const automatic=useAutomaticSync(automaticDeliveryPilot,ready&&configured&&session&&(session.expiresAt>Date.now()+60000||!!discovery)?String(identityRevision.current):null,async (signal,refreshReads)=>{const ok=await refresh(true,true,false,signal,refreshReads);return signal.aborted?'cancelled':automaticResult(ok,connection.getSnapshot())});
 const pilot=useRepositoryPilot(()=>{accountBarrier.current=true;const context=foregroundContext.current,game=context.view?.game,profileId=current.current?.profileId;if(profileId&&game&&!game.deviceOnly&&context.points){const draft={profileId,gameId:game.id,gameVersion:game.version,next:game.next,points:context.points};recoveryDraft.current=draft;void AsyncStorage.setItem(scoreRecoveryKey,JSON.stringify(draft)).catch(()=>{})}activityRevision.current++;identityRevision.current++;setView(null);setEditingGame(null);setGames(previous=>previous.filter(g=>g.deviceOnly));connection.fail(Object.assign(new Error('Account access changed. Sign in to reconnect.'),{code:'SIGN_IN_REQUIRED'}));setNotice('Account access changed. Your unsent input has been kept. Sign in to reconnect.');},automatic.request);
 const [home,setHome]=useState<{owner:typeof identityRevision.current;selector:string;seeds:GameSummary[];value:AccountGameHome|null;error:boolean}|null>(null);
 useEffect(()=>{
  let active=true;const owner=identityRevision.current,repository=pilot.ref.current,scope=repository?.capture();
  if(!gameRecoveryPilot||!canUseAccount(owner)||!scope||scope.selector!=='native-profile:'+current.current?.profileId){setHome(null);return}
  void repository!.readHome(scope,games).then(value=>{if(active&&canUseAccount(owner))setHome({owner,selector:scope.selector,seeds:games,value,error:false})}).catch(()=>{if(active&&canUseAccount(owner))setHome({owner,selector:scope.selector,seeds:games,value:null,error:true})});
  return()=>{active=false};
 },[games,session?.profileId,connectionState.status,connectionState.lastConnectedAt]);
 const currentHome=home&&home.owner===identityRevision.current&&home.selector==='native-profile:'+current.current?.profileId&&home.seeds===games&&canUseAccount(home.owner)?home:null;
 const admissionPilot=gameScoringPilot&&process.env.EXPO_PUBLIC_GAME_ADOPTION_REVIEW_PILOT==='true'&&process.env.EXPO_PUBLIC_GAME_ADOPTION_IMPORT_PILOT==='true';
 const homeGames=gameRecoveryPilot&&session?mergeDeviceGames(currentHome?.value?.games??[],gameScoringPilot&&!currentHome?.value?[]:games,currentHome?.value?.adoptedGameIds??[]):games;
 async function reviewHomeCopy(gameId:string){await run(async()=>{
  const owner=identityRevision.current,epoch=activityRevision.current,repository=pilot.ref.current,scope=repository?.capture();
  if(!gameRecoveryPilot||!scope||!canUseAccount(owner)||scope.selector!=='native-profile:'+current.current?.profileId)return;
  const review=await repository!.readRecovery(scope,gameId,Crypto.randomUUID());
  if(!review||!canUseAccount(owner)||activityRevision.current!==epoch)return;
  setAccountRead(review.read);setView(review.read.kind==='game'?review.read.view:null);setCreating(false);setRecovery({review,scope,owner});
 })}
 async function preparePilot(owner:string,keepScope=false){try{return await pilot.ref.current?.prepare(owner,keepScope)??null}catch(error){if(gameScreenPilot)throw error;setNotice('Could not prepare device storage. Account games remain online-only.');return null}}
 async function rememberRead(scope:ReturnType<NonNullable<typeof pilot.ref.current>['capture']>,value:GameView){try{await pilot.ref.current?.record(scope,value)}catch{setNotice('Could not save a device copy. Your account game is still saved.');}}
 async function persist(s:Session|null,expectedIdentity?:number){
  if(expectedIdentity!==undefined&&identityRevision.current!==expectedIdentity)return;
  if(!s||!current.current)identityRevision.current++;
  const revision=identityRevision.current;
  const work=sessionWrites.current.then(async()=>{
   if(revision!==identityRevision.current)return;
   await(s?SecureStore.setItemAsync(sessionKey,JSON.stringify(s)):SecureStore.deleteItemAsync(sessionKey));
   if(revision===identityRevision.current&&mounted.current){current.current=s;setSession(s)}
  });sessionWrites.current=work.catch(()=>{});await work;
 }
 function toSession(t:AuthSession.TokenResponse):Session{return{accessToken:t.accessToken,refreshToken:t.refreshToken,expiresAt:Date.now()+(t.expiresIn||3600)*1000}}
 async function token(){
  const s=current.current,identity=identityRevision.current;
  if(!s)throw Object.assign(new Error('Sign in to sync.'),{code:'SIGN_IN_REQUIRED'});
  if(s.expiresAt>Date.now()+60000)return s.accessToken;
  if(renewing.current)return renewing.current;
  const flight=(async()=>{
   if(!s.refreshToken)throw Object.assign(new Error('Sign in to sync.'),{code:'SIGN_IN_REQUIRED'});
   if(!discovery)throw new Error('Sign-in service is not ready. Try Reconnect again.');
   const t=await AuthSession.refreshAsync({clientId,refreshToken:s.refreshToken,scopes:[scope]},discovery);
   if(identityRevision.current!==identity||!current.current)throw new Error('Account changed during token refresh.');
   const next={...s,...toSession(t),refreshToken:t.refreshToken||s.refreshToken};
   await persist(next,identity);
   if(identityRevision.current!==identity||!current.current)throw new Error('Account changed during token refresh.');
   return next.accessToken;
  })();
  renewing.current=flight;
  try{return await flight}finally{if(renewing.current===flight)renewing.current=null}
 }

 const latestToken=useRef(token);latestToken.current=token;
 const cloudApi=new ScorekeeperApi(apiUrl||'http://localhost:7071/api',()=>latestToken.current(),{readOnlyGames:gameScreenPilot});
 const api=session&&!view?.game.deviceOnly?cloudApi:localApi;
 async function loadCloudGames(){const startingIdentity=identityRevision.current,revision=activityRevision.current;const valid=()=>mounted.current&&identityRevision.current===startingIdentity&&activityRevision.current===revision&&!accountBarrier.current&&!!current.current;const locals=await localApi.list();if(!valid())return;setGames(previous=>mergeDeviceGames(previous.filter(g=>!g.deviceOnly),locals));const [saved,status]=await Promise.all([cloudApi.list(),cloudApi.account()]);if(!valid())return;if(status.profileId&&current.current){const next={...current.current,profileId:status.profileId};await persist(next);if(!valid())return;await setFrequentPlayersAccount(status.profileId,cloudApi)}const supported=(status.scoringRulesVersion||0)>=2;setRulesEnabled(supported);const pending=await (gameScreenPilot?Promise.resolve([]):pendingImports(localApi,cloudApi,saved,valid));if(!valid())return;const eligible=pending.filter(g=>(supported||!needsAdvancedRules(g,g.winner))&&(g.targetEnd!=="round"||(status.scoringRulesVersion||0)>=3));const updatedLocals=await localApi.list();if(!valid())return;setGames(mergeDeviceGames(saved,updatedLocals));void gameListCache.write(current.current?.profileId,saved).catch(()=>{});setLocalCount(eligible.length);setBlockedLocalCount(pending.length-eligible.length)}
 async function loadGames(){if(current.current){try{await loadCloudGames()}catch(e){setNotice('Account games could not be refreshed. Games saved on this device are available.'+(e instanceof Error?' '+e.message:''))}}else{setGames(await localApi.list());setLocalCount(0);setBlockedLocalCount(0)}}
 async function run(work:()=>Promise<void>){if(locked.current)return;locked.current=true;activityRevision.current++;setBusy(true);setError('');setNotice('');try{await work()}catch(e){if(e instanceof ApiError&&e.status===409&&view){const source=api,owner=identityRevision.current,readScope=pilot.ref.current?.capture()??null;if(source!==cloudApi||canUseAccount(owner))try{const latest=await source.get(view.game.id);if(source!==cloudApi||canUseAccount(owner)){if(source===cloudApi&&gameScreenPilot){if(!pilot.ref.current)throw new Error('Saved game access is unavailable.');const retained=await observeGameScreen(pilot.ref.current,readScope,view.game.id,latest);if(canUseAccount(owner)){setAccountRead(retained);setView(retained.kind==='game'?retained.view:null)}}else setView(latest)}}catch{}}if(isConnectionFailure(e))connection.fail(e);setError(e instanceof Error?e.message:'Unable to connect.')}finally{locked.current=false;setBusy(false)}}
 useEffect(()=>{let active=true;void (async()=>{
  try{const raw=await SecureStore.getItemAsync(sessionKey);const restored:Session|null=raw?JSON.parse(raw):null;
   const [cached,locals,recoveryRaw]=await Promise.all([gameListCache.read(restored?.profileId),localApi.list(),AsyncStorage.getItem(scoreRecoveryKey)]);if(!active)return;
   if(recoveryRaw)try{const draft=JSON.parse(recoveryRaw) as ScoreRecoveryDraft;if(typeof draft.profileId==='string'&&typeof draft.gameId==='string'&&Number.isInteger(draft.gameVersion)&&typeof draft.next==='string'&&typeof draft.points==='string'&&/^-?\d*$/.test(draft.points)&&draft.profileId===restored?.profileId)recoveryDraft.current=draft}catch{}
   current.current=restored;pilot.ref.current?.select(restored?.profileId?'native-profile:'+restored.profileId:null);setSession(restored);setGames(restored?mergeDeviceGames(cached,locals):locals);setGuest(!restored);
   void setFrequentPlayersAccount(restored?.profileId||null,null,{sync:false}).catch(()=>{});
  }catch{if(active)setError('Could not restore saved data. Please sign in again.')}
  finally{if(active)setReady(true)}
 })();return()=>{active=false}},[]);
 async function backgroundRefresh(){
  const context=foregroundContext.current;
  if(!current.current||locked.current||foregroundFlight.current||context.creating||context.accountOpen||context.settingsOpen||context.editingGame)return;
  await refresh(true);
 }

 useEffect(()=>{
  if(automaticDeliveryPilot||!ready||!session||busy||startupIdentity.current===identityRevision.current)return;
  if(current.current&&current.current.expiresAt<=Date.now()+60000&&!discovery)return;
  startupIdentity.current=identityRevision.current;void backgroundRefresh();
 },[ready,!!session,busy,!!discovery]);
 useEffect(()=>{
  const sub=AppState.addEventListener('change',state=>{
   const previous=foregroundState.current;foregroundState.current=state;
   if(state!=='active'){if(previous==='active')backgroundSince.current=Date.now();return}
   const since=backgroundSince.current;backgroundSince.current=null;
   if(!automaticDeliveryPilot&&since!==null&&Date.now()-since>=30000)void backgroundRefresh();
  });return()=>sub.remove();
 },[discovery]);
 useEffect(()=>{setGameDetailsOpen(false);setHistoryOpen(false);setEdit(null)},[view?.game.id]);
 function goHome(){if(locked.current)return;activityRevision.current++;setView(null);setCreating(false);setEdit(null);setError('')}
 useEffect(()=>{if(ready&&session?.profileId&&session.profileId===current.current?.profileId)void gameListCache.write(session.profileId,games).catch(()=>{})},[ready,session?.profileId,games]);
 async function enterGuest(){await run(async()=>{setGames(await localApi.list());setView(null);setGuest(true)})}
 async function importLocal(){await run(async()=>{if(gameScreenPilot)throw new Error('Device games are kept here. Adding them to your account is not available yet.');const owner=identityRevision.current,valid=()=>canUseAccount(owner);if(!valid())throw new Error('Account access changed. Sign in to reconnect.');const status=await cloudApi.account();if(!valid())return;const supported=(status.scoringRulesVersion||0)>=2;setRulesEnabled(supported);const result=await importPendingGames(localApi,cloudApi,supported,count=>{if(valid())setLocalCount(count)},(status.scoringRulesVersion||0)>=3,valid);if(!valid())return;await loadCloudGames();if(!valid())return;setNotice(importSummary(result))})}
 async function login(){await run(async()=>{if(accountIntent.current)throw new Error('Complete the pending sign-out or deletion before signing in again.');const result=await promptAsync();if(result.type!=='success')return;if(!discovery||!request?.codeVerifier)throw new Error('Sign-in is not ready.');const t=await AuthSession.exchangeCodeAsync({clientId,code:result.params.code,redirectUri,extraParams:{code_verifier:request.codeVerifier}},discovery);await persist(toSession(t));if(accountIntent.current)return;accountBarrier.current=false;setGames((await localApi.list()).filter(g=>g.deviceOnly));setView(null);setSettings(defaultSettings);setPresetId("custom");})}
 async function logout(){if(accountIntent.current!=='deletion')accountIntent.current='sign-out';if(pilot.enabled)accountBarrier.current=true;setView(null);setEditingGame(null);setGames(previous=>previous.filter(g=>g.deviceOnly));activityRevision.current++;identityRevision.current++;connection.reset(null);await pilot.ref.current?.signOut();renewing.current=null;const profile=current.current?.profileId;await setFrequentPlayersAccount(null,null);await gameListCache.clear(profile).catch(()=>{});await persist(null);if(accountIntent.current==='sign-out')accountIntent.current=null;setGames(await localApi.list());setView(null);setGuest(true);if(discovery?.endSessionEndpoint)await WebBrowser.openAuthSessionAsync(discovery.endSessionEndpoint+'?post_logout_redirect_uri='+encodeURIComponent(redirectUri),redirectUri)}
 async function refresh(background=false,manual=false,queued=false,automaticSignal?:AbortSignal,refreshReads=true):Promise<boolean>{
  if(automaticSignal?.aborted)return false;
  if(locked.current||!current.current||accountBarrier.current)return false;
  if(manual&&gameDeliveryPilot&&!queued){const owner=identityRevision.current;const result=await (automaticSignal?manualSync.runAfter:manualSync.run)(String(owner),()=>canUseAccount(owner)&&!automaticSignal?.aborted,connection.whenIdle,()=>refresh(background,true,true,automaticSignal,refreshReads));if(result&&!automaticSignal&&canUseAccount(owner))automatic.recovered();return result}
  const identity=identityRevision.current,revision=activityRevision.current,context=foregroundContext.current;
  connection.reset(String(identity));
  if(!background)setPullRefreshing(true);
  foregroundFlight.current=true;
  try{return await connection.connect(async(isCurrent,signal,step,reportDelivery)=>{
   const valid=()=>mounted.current&&isCurrent()&&!automaticSignal?.aborted&&!!current.current&&identity===identityRevision.current&&!accountBarrier.current;
   if(!valid())return;
   const readApi=new ScorekeeperApi(apiUrl||'http://localhost:7071/api',()=>step('authentication',()=>latestToken.current()),{signal,readAttempts:2,readOnlyGames:gameScreenPilot});
   let pilotScope=current.current?.profileId?await preparePilot('native-profile:'+current.current.profileId,!!automaticSignal):null;let pilotVerified=false,deliveredRead:AccountGameRead|null=null;if(!valid())return;
   const recovery=recoveryDraft.current;
   const selectedGame=context.view&&!context.view.game.deviceOnly?context.view.game.id:(!context.view&&recovery&&recovery.profileId===current.current?.profileId?recovery.gameId:undefined);
   const snapshot=await readAccountSnapshot({deliveryOnly:!!automaticSignal&&!refreshReads,api:readApi,expectedProfileId:current.current?.profileId,gameId:selectedGame,isCurrent:valid,step,onAccountStatus:async status=>{
    if(!pilot.ref.current||!status.profileId)return;
    if(current.current?.profileId&&status.profileId!==current.current.profileId){pilot.ref.current.invalidate(pilotScope??pilot.ref.current.capture());return}
    const scope=pilotScope??(!current.current?.profileId?await preparePilot('native-profile:'+status.profileId):null);
    if(!valid())return;
    if(scope){pilotScope=scope;try{await pilot.ref.current.verify(scope,status);pilotVerified=true}catch(error){if(gameScreenPilot)throw error;setNotice('Could not prepare device storage. Account games remain online-only.');}}
   },afterAccountVerified:async status=>{
    if(manual&&gameDeliveryPilot){
     if(!pilotScope||!pilotVerified||!status.profileId)throw new Error('Saved game access is not ready. Try Reconnect.');
     const profileId=status.profileId;
     await step('delivery',()=>runManualDelivery(pilot.ref.current!,pilotScope,{base:apiUrl,signal,onState:reportDelivery,getToken:async(binding,requestSignal)=>{
      const currentAccount=()=>valid()&&!requestSignal.aborted&&binding.selector==='native-profile:'+profileId&&binding.profileId===profileId&&(!current.current?.profileId||current.current.profileId===profileId);
      if(!currentAccount())throw Object.assign(new Error('Account access changed. Saved changes have been kept.'),{code:'STALE_ACCOUNT'});
      const token=await latestToken.current();if(!currentAccount())throw Object.assign(new Error('Account access changed. Saved changes have been kept.'),{code:'STALE_ACCOUNT'});return token;
     }}));
    }
   },resolveGameId:async id=>{
    if(gameScreenPilot&&id&&pilot.ref.current&&pilotScope){const retained=await pilot.ref.current.readGame(pilotScope,id);if(retained?.kind==='pending-delete'||retained?.kind==='deleted'){deliveredRead=retained;return undefined}}
    return id;
   }});
   if(!snapshot||!valid())return;
   if(automaticSignal&&!refreshReads){
    const read=selectedGame&&pilotScope?await pilot.ref.current!.readGame(pilotScope,selectedGame):null;if(!valid())return;
    setGames(previous=>[...previous]);
    if(read&&revision===activityRevision.current&&foregroundContext.current.view===context.view){
     if(read.kind!=='game'){setAccountRead(read);setView(null);rulesEditor.current++;setEditingGame(null);setEdit(null)}
     else if(!foregroundContext.current.points&&!foregroundContext.current.edit&&!foregroundContext.current.editingGame&&!foregroundContext.current.reordering){setAccountRead(read);setView(read.view)}
     else if(read.sync==='needs-review')setAccountRead(read);
    }
    return;
   }
   let {saved,status,latest}=snapshot;let screenRead:AccountGameRead|null=deliveredRead;
   if(pilot.ref.current&&status.profileId){const scope=pilotScope??(!current.current?.profileId?await preparePilot('native-profile:'+status.profileId):null);if(!valid())return;try{if(scope&&!pilotVerified)await pilot.ref.current.verify(scope,status);if(scope&&latest){if(gameScreenPilot){screenRead=await observeGameScreen(pilot.ref.current,scope,selectedGame!,latest);latest=screenRead.kind==='game'?screenRead.view:null}else await rememberRead(scope,latest)}}catch(error){if(gameScreenPilot)throw error;setNotice('Could not prepare device storage. Account games remain online-only.');}if(!valid())return;}
   if(gameScreenPilot&&latest&&!screenRead)throw new Error('Saved game access is not ready. Try Reconnect.');
   const visibleSaved=screenRead&&screenRead.kind!=='game'?saved.filter(g=>g.id!==selectedGame):saved;
   setRulesEnabled((status.scoringRulesVersion||0)>=2);
   const locals=await step('device',()=>localApi.list());if(!valid())return;
   if(revision===activityRevision.current){
    setGames(mergeDeviceGames(visibleSaved,locals));
    if(gameScreenPilot&&screenRead&&screenRead.kind!=='game'&&foregroundContext.current.view===context.view){setView(null);setAccountRead(screenRead);setNotice(gameScreenMessage(screenRead).title+'. '+gameScreenMessage(screenRead).detail)}
    if(latest&&context.view&&foregroundContext.current.view===context.view&&!foregroundContext.current.creating&&!foregroundContext.current.points&&!foregroundContext.current.edit&&!foregroundContext.current.editingGame&&!foregroundContext.current.reordering&&latest.game.version>=context.view.game.version){setView(latest);if(gameScreenPilot)setAccountRead(screenRead)}
    if(latest&&recovery&&recovery.profileId===status.profileId&&recovery.gameId===latest.game.id&&!context.view&&!context.creating&&!context.points){
     if(latest.game.version===recovery.gameVersion&&latest.game.next===recovery.next){restoringScoreDraft.current=true;setView(latest);if(gameScreenPilot)setAccountRead(screenRead);setPoints(recovery.points);recoveryDraft.current=null;void AsyncStorage.removeItem(scoreRecoveryKey).catch(()=>{})}
     else setNotice(`The game changed while reconnecting. Your unsent score of ${recovery.points} is kept; review the active player before entering it again.`);
    }
   }
   if(status.profileId){
    if(current.current?.profileId&&current.current.profileId!==status.profileId)throw new Error('Account identity could not be verified.');
    await persist({...current.current!,profileId:status.profileId},identity);
    if(!valid())return;
    await step('players',()=>setFrequentPlayersAccount(status.profileId!,cloudApi,{sync:false}));
    if(!valid())return;
    await step('players',()=>syncFrequentPlayers());
   }
   if(!valid())return;
   void gameListCache.write(current.current?.profileId,visibleSaved).catch(()=>{});
   // Import remains explicit. Refresh only discovers candidates.
   const pending=await step('imports',()=>(gameScreenPilot?Promise.resolve([]):pendingImports(localApi,readApi,saved,valid)));
   if(!valid())return;
   const eligible=pending.filter(g=>((status.scoringRulesVersion||0)>=2||!needsAdvancedRules(g,g.winner))&&(g.targetEnd!=='round'||(status.scoringRulesVersion||0)>=3));
   setLocalCount(eligible.length);setBlockedLocalCount(pending.length-eligible.length);
  },automaticSignal)}finally{foregroundFlight.current=false;if(mounted.current){setPullRefreshing(false);setForegroundSyncing(false)}}
 }
 async function reconnect(forceSignIn=false){
  if(accountIntent.current){setError('Complete the pending sign-out or deletion before reconnecting.');return}
  if(!forceSignIn&&connectionState.status!=='sign-in'){await refresh(false,true);return}
  const original=current.current,identity=identityRevision.current;
  if(!original?.profileId){setError('Reconnect first needs to verify the original account. Your local games and players have been kept.');return}
  await run(async()=>{
   const result=await promptAsync();if(result.type!=='success')return;
   if(!discovery||!request?.codeVerifier)throw new Error('Sign-in is not ready.');
   const t=await AuthSession.exchangeCodeAsync({clientId,code:result.params.code,redirectUri,extraParams:{code_verifier:request.codeVerifier}},discovery);
   const next=toSession(t);
   const status=await new ScorekeeperApi(apiUrl,async()=>next.accessToken,{readAttempts:1}).account();
   if(accountIntent.current)throw new Error('Complete the pending sign-out or deletion before reconnecting.');
   if(identity!==identityRevision.current||status.profileId!==original.profileId)throw new Error('Please sign in to the same account to reconnect. Your existing game and input have been kept.');
   if(status.deletionStatus)throw new Error('Account deletion is pending. Sync is unavailable.');
   identityRevision.current++;renewing.current=null;connection.reset(String(identityRevision.current));
   await persist({...next,profileId:original.profileId});
   if(accountIntent.current)return;
   accountBarrier.current=false;
  });
  if(current.current&&identityRevision.current!==identity)await refresh(false,true);
 }


 useEffect(()=>{if(ready&&guest&&!session)void (view?AsyncStorage.setItem('scorekeeper-guest-active',view.game.id):AsyncStorage.removeItem('scorekeeper-guest-active')).catch(()=>setError('Could not remember the open game. Your scores are still saved.'))},[view,ready,guest,!!session]);
 function choosePreset(id:PresetId){setPresetId(id);if(id==="scrabble")setName("Scrabble");else if(id==="phase10")setName("Phase 10");setError("")}
 const game=view?.game;
 const accountReadOnly=gameScreenPilot&&!!session&&!!game&&!game.deviceOnly;
 const accountScoreReadOnly=accountReadOnly&&!(gameScoringPilot&&accountRead?.kind==='game'&&accountRead.canScore);
 const accountCompletionReadOnly=accountReadOnly&&!(gameScoringPilot&&accountRead?.kind==='game'&&accountRead.canChangeCompletion);
 const accountCorrectionReadOnly=accountReadOnly&&!(gameScoringPilot&&accountRead?.kind==='game'&&accountRead.canCorrectEntries);
 const accountRulesReadOnly=accountReadOnly&&!(gameScoringPilot&&accountRead?.kind==='game'&&accountRead.canEditRules);
 const pendingScoreSave=!busy&&!!game&&scoringWriter.pending(pilot.ref.current?.capture()??null,game.id);
 const undoBlocked=accountCorrectionReadOnly||pendingScoreSave||reordering||!game?.entries.length||!!(game.finished&&session&&!rulesEnabled&&!gameScoringPilot);
 const correctionState=useRef({blocked:undoBlocked});correctionState.current={blocked:undoBlocked};
 const adoptionPilot=gameScoringPilot&&process.env.EXPO_PUBLIC_GAME_ADOPTION_REVIEW_PILOT==='true';
 const pendingDeletion=!busy&&!!deleting&&scoringWriter.pendingDeletion(pilot.ref.current?.capture()??null,deleting.id);
 const readMessage=pendingScoreSave?{title:'Save not confirmed',detail:'Your input has been kept. Retry checks the original change before allowing another save.'}:gameScreenMessage(accountRead);
 async function reviewSavedCopies(){await run(async()=>{
  if(!gameRecoveryPilot||!view||!pilot.ref.current)return;const owner=identityRevision.current,selected=view.game.id,scope=pilot.ref.current.capture();if(!scope||!canUseAccount(owner))return;
  const review=await pilot.ref.current.readRecovery(scope,selected,Crypto.randomUUID());
  if(review&&canUseAccount(owner)&&foregroundContext.current.view?.game.id===selected){
   setAccountRead(review.read);setView(review.read.kind==='game'?review.read.view:null);
   if(review.read.kind!=='game'){
    if(review.read.kind==='pending-delete'||review.read.kind==='deleted')setGames(previous=>previous.filter(g=>g.id!==selected||g.deviceOnly));
    setNotice(review.read.kind==='missing'?'Saved game access is unavailable on this device. Reconnect to refresh your account.':gameScreenMessage(review.read).title+'. '+gameScreenMessage(review.read).detail);
   }
   setRecovery({review,scope,owner});
  }
 })}
 async function chooseRecoveryCopy(){
  const selected=recovery;if(!selected||!gameRecoveryPilot||!pilot.ref.current||locked.current||!canUseAccount(selected.owner)||!keepRecoveryReview(selected.review,foregroundContext.current.view))throw new Error('Game or account access changed. Close and reopen this review.');
  locked.current=true;setBusy(true);activityRevision.current++;setError('');
  try{
   const read=await (selected.review.canResolveCollision?pilot.ref.current.resolveCollision(selected.scope,selected.review):pilot.ref.current.chooseAccountRecovery(selected.scope,selected.review));
   if(!canUseAccount(selected.owner)||!keepRecoveryReview(selected.review,foregroundContext.current.view))return;
   setAccountRead(read);setView(read.kind==='game'?read.view:null);setRecovery(null);
   if(read.kind==='game')setGames(previous=>{
    const summary={...read.view.game,turnCount:read.view.game.entries.length};
    return previous.some(g=>g.id===summary.id&&!g.deviceOnly)?previous.map(g=>g.id===summary.id&&!g.deviceOnly?summary:g):[summary,...previous];
   });
   else if(read.kind==='pending-delete'||read.kind==='deleted')setGames(previous=>previous.filter(g=>g.id!==selected.review.gameId||g.deviceOnly));
   setNotice(read.kind==='game'?'Game updated. Your earlier changes are safely kept on this device.':gameScreenMessage(read).title+'. '+gameScreenMessage(read).detail);
  }finally{locked.current=false;setBusy(false)}
 }


 async function checkCollisionCopy(){
  const selected=recovery,repository=pilot.ref.current;
  if(!selected||!repository||locked.current)throw new Error('Game or account access changed. Reopen this review.');
  const active=()=>canUseAccount(selected.owner)&&recoveryRef.current===selected&&keepRecoveryReview(selected.review,foregroundContext.current.view);if(!active())throw new Error('Game or account access changed. Reopen this review.');
  const capturedProfile=current.current?.profileId;
  if(selected.scope.selector!=='native-profile:'+capturedProfile)throw new Error('Account changed. Reopen this review.');
  let capturedToken:Promise<string>|null=null;
  const readApi=new ScorekeeperApi(apiUrl||'http://localhost:7071/api',async()=>{
   if(!active()||current.current?.profileId!==capturedProfile)throw new Error('Account changed.');
   const value=await(capturedToken??=latestToken.current());
   if(!active()||current.current?.profileId!==capturedProfile)throw new Error('Account changed.');return value;
  },{readOnlyGames:true});
  const status=await readApi.account();if(!active())return;
  await repository.verify(selected.scope,status);if(!active())return;
  const latest=await readApi.get(selected.review.gameId);if(!active())return;
  const review=await repository.previewCollisionResolution(selected.scope,selected.review.gameId,latest,Crypto.randomUUID());
  if(active())setRecovery({...selected,review});
 }
 async function saveGameRules(a:Action){if(!editingGame)return;if(gameScreenPilot&&session&&!editingGame.deviceOnly){if(view?.game.id!==editingGame.id||view.game.version!==editingGame.version){await run(async()=>{throw new Error('This game changed. Close and reopen the editor.')});return;}await saveAccountScore(a);return;}await run(async()=>{const source=current.current&&!editingGame.deviceOnly?cloudApi:localApi,owner=identityRevision.current;if(source===cloudApi&&!canUseAccount(owner))return;if(source===localApi)await checkDeviceWriter(editingGame.id);const updated=await source.act(editingGame,a);if(source===cloudApi&&!canUseAccount(owner))return;setView(updated);setGames(previous=>previous.map(g=>g.id===updated.game.id?{...updated.game,turnCount:updated.game.entries.length}:g));setEditingGame(null)})}
 function selectScorer(playerId:string){
  const selected=foregroundContext.current.view,owner=identityRevision.current,draft=foregroundContext.current.points;
  if(!selected||selected.game.finished||selected.game.next===playerId||busy||locked.current||accountScoreReadOnly||pendingScoreSave||reordering)return;
  if(!selected.game.players.some(p=>p.id===playerId)||remainingTargetPlayers(selected.game)?.every(p=>p.id!==playerId))return;
  const proceed=()=>{
   const latest=foregroundContext.current;
   if(locked.current||owner!==identityRevision.current||latest.view?.game.id!==selected.game.id||latest.view.game.version!==selected.game.version||latest.points!==draft){setError('The game changed. Review the current player before switching.');return}
   setPoints('');setError('');void action({action:'select',playerId});
  };
  if(draft)Alert.alert('Switch player?','These points have not been added. Discard this entry and switch players?',[{text:'Keep editing',style:'cancel'},{text:'Discard entry',style:'destructive',onPress:proceed}]);else proceed();
 }
 function leaveGame(){
  if(locked.current)return;
  const selected=foregroundContext.current.view,draft=foregroundContext.current.points,owner=identityRevision.current;
  if(!draft){goHome();return}
  Alert.alert('Go Home?','These points have not been added. Discard this entry and return Home?',[{text:'Keep editing',style:'cancel'},{text:'Discard entry',style:'destructive',onPress:()=>{if(locked.current||owner!==identityRevision.current||foregroundContext.current.view?.game.id!==selected?.game.id||foregroundContext.current.points!==draft)return;setPoints('');goHome()}}]);
 }
 function finishGame(){
  const selected=foregroundContext.current.view,draft=foregroundContext.current.points,owner=identityRevision.current;
  if(!selected||selected.game.finished||locked.current||accountCompletionReadOnly||pendingScoreSave||reordering)return;
  Alert.alert('Finish game?',draft?'The points currently entered have not been added. Finish without adding them?':'Your final scores will be saved. You can resume this game later.',[{text:'Keep playing',style:'cancel'},{text:draft?'Finish without entry':'Finish game',onPress:()=>{
   const latest=foregroundContext.current;
   if(locked.current||owner!==identityRevision.current||latest.view?.game.id!==selected.game.id||latest.view.game.version!==selected.game.version||latest.points!==draft){setError('The game changed. Review the scores before finishing.');return}
   setPoints('');void action({action:'finish'});
  }}]);
 }
 function undoLastScore(){
  const selected=foregroundContext.current.view,owner=identityRevision.current,draft=foregroundContext.current.points;
  if(!selected||locked.current||correctionState.current.blocked)return;
  const last=selected.game.entries[selected.game.entries.length-1];if(!last)return;
  const player=selected.game.players.find(p=>p.id===last.playerId)?.name??'Player';
  const summary=`${player}: ${last.points} ${selected.game.scoreMode==='total'?'recorded total':selected.game.winner==='zero'?'points subtracted':'points'} (turn ${selected.game.entries.length}).`;
  Alert.alert('Undo last score?',`${summary}\nThis removes the latest entry and recalculates the scores.${selected.game.finished?' The winner and game status will be recalculated.':''}${draft?' Unadded points will be discarded.':''}`,[{text:'Keep score',style:'cancel'},{text:'Undo score',style:'destructive',onPress:()=>{
   const latest=foregroundContext.current;
   if(locked.current||correctionState.current.blocked||owner!==identityRevision.current||latest.view?.game.id!==selected.game.id||latest.view.game.version!==selected.game.version||latest.view.game.entries.at(-1)?.id!==last.id||latest.points!==draft){setError('The game changed. Review the latest score before undoing.');return}
   setPoints('');void action({action:'undo'});
  }}]);
 }
 async function create(){await run(async()=>{
  const owner=identityRevision.current,signedIn=!!current.current&&!accountBarrier.current;
  if(automaticDeliveryPilot&&signedIn){
   const repository=pilot.ref.current,profile=current.current?.profileId;
   if(!repository||!profile)throw new Error('Connect your account once before starting a synced game. Your setup is kept.');
   const scope=await preparePilot('native-profile:'+profile,true);if(!scope||!canUseAccount(owner))return;
   const read=await accountGameCreator.create(repository,scope,name,names,winner,rules);
   if(!canUseAccount(owner))return;
   if(read.kind!=='game')throw new Error('The saved game needs review. Its account copy has been kept.');
   setAccountRead(read);setView(read.view);setCreating(false);setGames(previous=>[{...read.view.game,turnCount:read.view.game.entries.length},...previous.filter(g=>g.id!==read.view.game.id)]);setNotice('');return;
  }
  const result=await startGame({local:localApi,cloud:cloudApi,signedIn:signedIn&&!gameScreenPilot,deviceOnly:gameScreenPilot&&!!session,name,players:names,winner,rules,uuid:Crypto.randomUUID});if(!result.view.game.deviceOnly&&!canUseAccount(owner))return;setAccountRead(null);setView(result.view);setCreating(false);setGames(previous=>[{...result.view.game,turnCount:result.view.game.entries.length},...previous.filter(g=>g.id!==result.view.game.id)]);setNotice(result.message)
 })}
 async function noPoints(){if(!game||!view||game.finished||busy||reordering)return;Keyboard.dismiss();await action({action:'score',points:game.scoreMode==='total'?view.totals[game.next]:0,...(game.playStyle==='free'?{playerId:game.next}:{})})}
 async function prepareAccountScoring(){
  const selected=view,profileId=accountRead?.kind==='game'?accountRead.scoreProfileId:'';
  if(!selected||selected.game.deviceOnly||!profileId)return;
  await run(async()=>{
   const owner=identityRevision.current,repository=pilot.ref.current,scope=repository?.capture(),epoch=activityRevision.current;
   if(!gameScoringPilot||!repository||!scope||!canUseAccount(owner))throw new Error('Reconnect before preparing score entry.');
   const read=await repository.prepareScoring(scope,selected,profileId);
   if(!canUseAccount(owner)||activityRevision.current!==epoch||foregroundContext.current.view?.game.id!==selected.game.id)return;
   setAccountRead(read);setView(read.kind==='game'?read.view:null);
   if(read.kind==='pending-delete'||read.kind==='deleted')setGames(previous=>previous.filter(g=>g.id!==selected.game.id||g.deviceOnly));
  })
 }
 async function reviewDeviceAdoption(){
  Keyboard.dismiss();const selected=view;if(!selected?.game.deviceOnly)return;
  await run(async()=>{const owner=identityRevision.current,repository=pilot.ref.current,scope=repository?.capture(),epoch=activityRevision.current;
   if(!adoptionPilot||!repository||!scope||!canUseAccount(owner))throw new Error('Reconnect before reviewing an account copy.');
   const raw=await AsyncStorage.getItem(guestKey);if(!raw)throw new Error('The device source could not be read. Nothing was changed.');
   const review=await repository.previewAdoption(scope,raw,selected.game.id,Crypto.randomUUID());
   if(!canUseAccount(owner)||activityRevision.current!==epoch||foregroundContext.current.view?.game.id!==selected.game.id)return;
   setAdoption({review,owner:owner!,attempted:false});
  })
 }
 async function confirmDeviceAdoption(){
  const selected=adoption;if(!selected)return;
  await run(async()=>{const repository=pilot.ref.current,scope=repository?.capture(),epoch=activityRevision.current;
   if(!adoptionPilot||!repository||!scope||!canUseAccount(selected.owner))throw new Error('Account access changed. Reopen the review.');
   setAdoption(previous=>previous?.review===selected.review?{...previous,attempted:true}:previous);
   const raw=await AsyncStorage.getItem(guestKey);if(!raw)throw new Error('The device source could not be read. Nothing was queued.');
   await repository.confirmAdoptionSource(scope,selected.review,raw);
   const currentRaw=admissionPilot?await AsyncStorage.getItem(guestKey):raw;
   if(!currentRaw)throw new Error('The device source could not be read. Retry this reviewed copy.');
   const admitted=admissionPilot?await repository.admitAdoption(scope,selected.review,currentRaw):null;
   if(!canUseAccount(selected.owner)||activityRevision.current!==epoch)return;
   setAdoption(previous=>previous?.review===selected.review?null:previous);
   if(admitted&&foregroundContext.current.view?.game.id===selected.review.gameId){
    if(admitted.kind==='game'){setAccountRead(admitted);setView(admitted.view);setGames(previous=>previous.filter(g=>g.id!==selected.review.gameId).concat({...admitted.view.game,turnCount:admitted.view.game.entries.length}))}
    else{setAccountRead(admitted);setView(null);setGames(previous=>previous.filter(g=>g.id!==selected.review.gameId))}
   }
   setNotice(!admitted?'Reviewed copy kept on this device. Your original game is unchanged; nothing was uploaded.':admitted.kind==='deleted'?'This game has been deleted from your account.':admitted.kind==='game'&&admitted.sync==='needs-review'?'This game has a sync issue. Your changes are safely kept on this device.':'Game added to your account. Changes sync automatically when connected.');
  })
 }
 async function saveAccountDeletion(target:DeleteGameTarget){
  await run(async()=>{
   const repository=pilot.ref.current,scope=repository?.capture(),owner=target.deleteOwner,profileId=target.deleteProfileId,epoch=activityRevision.current;
   if(!gameScoringPilot||!repository||!scope||typeof owner!=='number'||!canUseAccount(owner)||!profileId)throw new Error('Account access changed. Reopen the game list before deleting.');
   const active=()=>canUseAccount(owner)&&activityRevision.current===epoch;
   const adopt=(read:AccountGameRead)=>{if(read.kind==='pending-delete'||read.kind==='deleted'){setGames(previous=>previous.filter(g=>g.id!==target.id||g.deviceOnly));if(foregroundContext.current.view?.game.id===target.id&&!foregroundContext.current.view?.game.deviceOnly){setAccountRead(read);setView(null);setEdit(null);rulesEditor.current++;setEditingGame(null)}}};
   try{const result=await (scoringWriter.pendingDeletion(scope,target.id)?scoringWriter.retry(repository,scope,target.id):scoringWriter.submitDelete(repository,scope,target,profileId));if(!active())return;if(result.read.kind!=='pending-delete'&&result.read.kind!=='deleted')throw Object.assign(new Error('Deletion needs review. Your saved copies have been kept.'),{code:'NEEDS_REVIEW'});adopt(result.read);setNotice(result.read.kind==='deleted'?'Deletion confirmed in your account.':'Game deleted. The deletion will sync automatically when connected.');if(foregroundContext.current.deleting===target)setDeleting(null)}catch(error){try{const read=await repository.readGame(scope,target.id);if(read&&active())adopt(read)}catch{/* An unavailable confirmation must not erase the original request. */}throw error}
  })
 }
 async function saveAccountScore(a:Action|null){
  const selected=view;if(!selected)return;
  await run(async()=>{
   const owner=identityRevision.current,repository=pilot.ref.current,scope=repository?.capture();
   if(!gameScoringPilot||!repository||!scope||!canUseAccount(owner))throw new Error('Account score entry is unavailable. Your input has been kept.');
   const epoch=activityRevision.current;
   try{const result=await (a?scoringWriter.submit(repository,scope,selected,a,a.action==='rules'?JSON.stringify({editor:rulesEditor.current,rules:a.rules}):a.action==='edit'?editPoints:points,accountRead?.kind==='game'?accountRead.scoreProfileId??'':''):scoringWriter.retry(repository,scope,selected.game.id));
   if(!canUseAccount(owner)||activityRevision.current!==epoch||foregroundContext.current.view?.game.id!==selected.game.id)return;
   const read=result.read;setAccountRead(read);setView(read.kind==='game'?read.view:null);
   if(read.kind==='game')setGames(previous=>{const summary=gameSummary(read.view);return previous.some(g=>g.id===summary.id&&!g.deviceOnly)?previous.map(g=>g.id===summary.id&&!g.deviceOnly?summary:g):[summary,...previous]});
   else if(read.kind==='pending-delete'||read.kind==='deleted')setGames(previous=>previous.filter(g=>g.id!==selected.game.id||g.deviceOnly));
   if(result.action==='score'&&foregroundContext.current.points===result.input)setPoints('');
   if(read.kind!=='game'&&foregroundContext.current.editingGame){rulesEditor.current++;setEditingGame(null)}
   else if(result.action==='rules'&&foregroundContext.current.editingGame?.id===selected.game.id&&JSON.parse(result.input).editor===rulesEditor.current){rulesEditor.current++;setEditingGame(null)}
   if(read.kind!=='game'&&foregroundContext.current.edit)setEdit(null);
   else if(result.action==='edit'&&foregroundContext.current.edit===result.entryId&&foregroundContext.current.editPoints===result.input)setEdit(null);
   }catch(error){
    if(['NEEDS_REVIEW','STORAGE_CONFLICT','SYNC_UNAVAILABLE'].includes((error as {code?:string})?.code??''))try{
     const read=await repository.readGame(scope,selected.game.id);
     if(read&&canUseAccount(owner)&&activityRevision.current===epoch&&foregroundContext.current.view?.game.id===selected.game.id){setAccountRead(read.kind==='game'?{...read,canScore:false,canChangeCompletion:false,canCorrectEntries:false,canEditRules:false,scoreAccess:'paused'}:read);if(read.kind!=='game'){setView(null);if(foregroundContext.current.editingGame){rulesEditor.current++;setEditingGame(null)}if(foregroundContext.current.edit)setEdit(null);if(read.kind==='pending-delete'||read.kind==='deleted')setGames(previous=>previous.filter(g=>g.id!==selected.game.id||g.deviceOnly))}}
    }catch{/* Keep input and the last visible copy while storage is unavailable. */}
    throw error;
   }
  })
 }
 async function checkDeviceWriter(id:string){
  if(!gameScoringPilot||!session)return;
  const repository=pilot.ref.current,scope=repository?.capture(),owner=identityRevision.current;
  if(!repository||!scope||!canUseAccount(owner))throw new Error('Saved copy access is not ready. Your input is kept. Try Reconnect.');
  const adopted=await repository.deviceAuthority(scope,id);
  if(!canUseAccount(owner)||adopted)throw new Error('This device original is retained for recovery. Reopen the game from Home to use the account copy.');
 }
 async function action(a:Action){if(!game)return;if(accountReadOnly){await saveAccountScore(a);return;}await run(async()=>{const source=api,owner=identityRevision.current;if(source===cloudApi&&!canUseAccount(owner))return;if(source===localApi)await checkDeviceWriter(game.id);const updated=await source.act(game,a);if(source===cloudApi&&!canUseAccount(owner))return;setView(updated);setGames(previous=>previous.map(g=>g.id===updated.game.id?{...updated.game,turnCount:updated.game.entries.length}:g));if(a.action==='score')setPoints('');if(a.action==='edit')setEdit(null)})}
 useEffect(()=>{AsyncStorage.getItem('scorekeeper-player-order-v2').then(raw=>{const saved=JSON.parse(raw||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))setPlayerOrders(Object.fromEntries(Object.entries(saved).filter((entry):entry is [string,string[]]=>Array.isArray(entry[1])&&entry[1].every(id=>typeof id==='string'))))}).catch(()=>setError('Could not load player positions.')).finally(()=>setLayoutsLoaded(true))},[]);
 useEffect(()=>{setReordering(false);setGuideExpanded(true)},[game?.id,game?.finished]);
 useEffect(()=>{if(restoringScoreDraft.current){restoringScoreDraft.current=false;return}setPoints('')},[game?.id,game?.next]);
 const savedOrder=game?playerOrders[game.id]:undefined;
 const displayPlayers=game&&savedOrder?[...new Set(savedOrder)].map(id=>game.players.find(p=>p.id===id)).filter((p):p is NonNullable<typeof p>=>!!p).concat(game.players.filter(p=>!savedOrder.includes(p.id))):game?.players||[];
 async function saveLayout(ids:string[],editing=false){if(!game||!layoutsLoaded)return;await run(async()=>{const updated={...playerOrders};updated[game.id]=ids;await AsyncStorage.setItem('scorekeeper-player-order-v2',JSON.stringify(updated));if(editing)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);setPlayerOrders(updated);setReordering(editing)})}
 const playerCards=useRef<(View|null)[]>([]);
 function revealScoreEntry(){requestAnimationFrame(()=>{if(!game||reordering||game.finished)return;const item=playerCards.current[0];const viewport=scroll.current?.getNativeScrollRef();if(!item||!viewport)return;viewport.measureInWindow((_x:number,top:number,_w:number,height:number)=>{item.measureInWindow((_ix,cardTop,_iw,cardHeight)=>{if(cardTop<top||cardTop+cardHeight>top+height)scroll.current?.scrollTo({y:Math.max(0,scrollOffset.current+cardTop-top-8),animated:true})})})})}

 function movePlayer(index:number,target:number){const ids=displayPlayers.map(p=>p.id);if(index<0||target<0||target>=ids.length||index===target)return;const [id]=ids.splice(index,1);ids.splice(target,0,id);return saveLayout(ids,true)}
 function newGame(){activityRevision.current++;setName('');setNames(['','']);setSettings(defaultSettings);setPresetId('custom');setPoints('');setError('');setNotice('');setView(null);setReordering(false);setCreating(true);scroll.current?.scrollTo({y:0,animated:false})}
 async function openGame(id:string){await run(async()=>{let source=games.find(g=>g.id===id)?.deviceOnly?localApi:session?cloudApi:localApi;const owner=identityRevision.current,scope=pilot.ref.current?.capture()??null;if(gameScoringPilot&&session){if(!scope||!canUseAccount(owner))throw new Error('Saved copy access is not ready. Try Reconnect.');if(await pilot.ref.current!.deviceAuthority(scope,id))source=cloudApi;if(!canUseAccount(owner))return;}if(source===cloudApi&&!canUseAccount(owner))return;if(source===cloudApi&&gameScreenPilot){
   if(!pilot.ref.current)throw new Error('Saved game access is not ready. Try Reconnect.');
   const retained=await openGameScreen(pilot.ref.current,scope,id,()=>source.get(id));if(!canUseAccount(owner))return;
   setAccountRead(retained);setView(retained.kind==='game'?retained.view:null);setPoints('');setCreating(false);
   if(retained.kind!=='game'){setGames(previous=>previous.filter(g=>g.id!==id));setNotice(gameScreenMessage(retained).title+'. '+gameScreenMessage(retained).detail)}return;
  }const result=await source.get(id);if(source===cloudApi&&!canUseAccount(owner))return;setAccountRead(null);setView(result);setPoints('');setCreating(false);if(source===cloudApi)void rememberRead(scope,result)})}
 function confirmDelete(g:GameSummary){if(gameScreenPilot&&session&&!g.deviceOnly){if(gameScoringPilot&&currentHome?.value?.states[g.id]?.canDelete){setError('');setDeleting({...g,deleteProfileId:currentHome.value.profileId,deleteOwner:identityRevision.current})}return;}Alert.alert(`Delete ${g.name}?`,`This permanently removes the game and its score history ${session&&!g.deviceOnly?'from your account and synced devices':'from this device'}. This cannot be undone.`,[{text:'Keep game',style:'cancel'},{text:'Delete game',style:'destructive',onPress:()=>void run(async()=>{const local=!current.current||g.deviceOnly,owner=identityRevision.current,source=local?localApi:cloudApi;if(source===cloudApi&&!canUseAccount(owner))return;if(source===localApi)await checkDeviceWriter(g.id);await source.deleteGame(g);if(source===cloudApi&&!canUseAccount(owner))return;setGames(previous=>previous.filter(item=>item.id!==g.id));if(!local){try{await localApi.forget(g.id)}catch{setNotice('Game deleted from your account. A local copy could not be removed, but cannot be imported again.')}}setLocalCount(previous=>local?Math.max(0,previous-1):previous)})}])}
 function savedGame(g:GameSummary){const canDelete=!g.finished&&(!(gameScreenPilot&&session&&!g.deviceOnly)||(gameScoringPilot&&currentHome?.value?.states[g.id]?.canDelete===true));const card=<Pressable key={g.id} accessibilityRole="button" accessibilityHint={!canDelete?undefined:"Swipe left or touch and hold to delete. VoiceOver actions include Delete game."} accessibilityActions={!canDelete?[]:[{name:"delete",label:"Delete game"}]} onAccessibilityAction={e=>{if(!busy&&canDelete&&e.nativeEvent.actionName==="delete")confirmDelete(g)}} accessibilityLabel={`${(g.finished||(gameScreenPilot&&session&&!g.deviceOnly))?'View':'Resume'} ${g.name}`} disabled={busy} style={[s.gameListCard,busy&&s.disabled]} onLongPress={()=>canDelete&&confirmDelete(g)} onPress={()=>void openGame(g.id)}><View style={{flex:1,gap:6}}><Text style={s.player}>{g.name}</Text><Text style={s.copy}>{g.players.map(p=>p.name).join(' · ')}</Text>{!g.deviceOnly&&homeStatus(currentHome?.value?.states[g.id])?<Text style={s.kicker}>{homeStatus(currentHome?.value?.states[g.id])}</Text>:null}<Text style={s.gameMeta}>{g.deviceOnly?"On this device · ":""}{g.turnCount} {g.turnCount===1?'entry':'entries'}{formatGameTime(g.updated)?` · Updated ${formatGameTime(g.updated)}`:''}</Text></View><Text style={s.resume}>{(g.finished||(gameScreenPilot&&session&&!g.deviceOnly))?'View':'Resume'} ›</Text></Pressable>;return !canDelete?card:<SwipeGameRow key={g.id} name={g.name} disabled={busy} onDelete={()=>confirmDelete(g)}>{card}</SwipeGameRow>}
 useEffect(()=>{scroll.current?.scrollTo({y:0,animated:false})},[creating,game?.id]);
 useEffect(()=>{if(!game?.finished)return;const frame=requestAnimationFrame(()=>scroll.current?.scrollTo({y:0,animated:true}));return()=>cancelAnimationFrame(frame)},[game?.id,game?.finished]);
 function Button({title,onPress,secondary=false,disabled=false}:{title:string;onPress:()=>void;secondary?:boolean;disabled?:boolean}){const colors=buttonColors(dark,secondary);return <Pressable accessibilityRole="button" disabled={disabled||busy} onPress={onPress} style={[s.button,{backgroundColor:colors.background},(disabled||busy)&&s.disabled]}><Text style={[s.buttonText,{color:colors.text}]}>{title}</Text></Pressable>}
 return <View style={s.safe}><StatusBar barStyle={settingsOpen||accountOpen||gameDetailsOpen||historyOpen||!!editingGame||!!recovery||!!game?(dark?'light-content':'dark-content'):'light-content'}/><AppHeader game={game??undefined} onGameDetails={game?()=>setGameDetailsOpen(true):undefined} onEditGame={game&&canEditGame(game)&&!accountRulesReadOnly?()=>{if(locked.current||foregroundContext.current.view?.game!==game)return;activityRevision.current++;setError('');setReordering(false);rulesEditor.current++;setEditingGame(game)}:undefined} onReorderPlayers={game&&!game.finished&&!accountReadOnly?()=>{if(locked.current||foregroundContext.current.view?.game!==game)return;void saveLayout(displayPlayers.map(p=>p.id),true)}:undefined} syncControl={session?<ConnectionStatus tintColor={game?(dark?'#ffffff':'#123f4a'):undefined} state={connectionState} disabled={busy} onReconnect={()=>void reconnect()} onSignIn={()=>void reconnect(true)}/>:undefined} onHome={goHome} signedIn={!!session} canSignIn={configured} signInReady={!!request} busy={busy} onSettings={()=>setSettingsOpen(true)} onAccount={()=>setAccountOpen(true)} onSignIn={()=>void login()} onSignOut={()=>void run(logout)}/><SafeAreaView edges={game?['left','right']:['left','right','bottom']} style={{flex:1}}>{game&&view&&<Standings key={game.id} view={view} selectedId={game.next} onSelect={!game.finished?selectScorer:undefined} disabled={busy||accountScoreReadOnly||pendingScoreSave||reordering} isPlayerDisabled={id=>!!remainingTargetPlayers(game)?.every(p=>p.id!==id)}/>}<KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}><ScrollView scrollEnabled={!draggingPlayer} onScroll={event=>{scrollOffset.current=event.nativeEvent.contentOffset.y}} scrollEventThrottle={16} ref={scroll} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" refreshControl={session&&!draggingPlayer?<RefreshControl tintColor={s.resume.color} refreshing={pullRefreshing} onRefresh={()=>void refresh(false,true).catch(()=>{})}/>:undefined}>{error&&(!game||game.finished||reordering)?<Text accessibilityRole="alert" style={s.error}>{error}</Text>:null}{notice?<Text accessibilityLiveRegion="polite" style={s.copy}>{notice}</Text>:null}{!ready?<Text>Loading…</Text>:game&&view?<>{adoptionPilot&&session&&game.deviceOnly&&<Button secondary title="Add to account" onPress={()=>void reviewDeviceAdoption()}/>}{game.finished&&<Button secondary disabled={accountCompletionReadOnly||pendingScoreSave} title="Resume game" onPress={()=>void action({action:'resume'})}/>}{game.finished&&<View accessibilityLiveRegion="polite" style={s.completeCard}><View style={s.completeHeader}><View style={s.completeBadge}><Text style={s.completeBadgeText}>✓</Text></View><View style={{flex:1,gap:4}}><Text style={s.completeKicker}>GAME COMPLETE</Text><Text accessibilityRole="header" style={s.completeTitle}>{view.winnerIds.length>1?"It's a tie!":view.winnerIds.length?"We have a winner!":"Thanks for playing!"}</Text></View></View>{game.players.filter(p=>view.winnerIds.includes(p.id)).map(p=><View key={p.id} style={s.winnerRow}><View style={{flex:1,gap:5}}><Text style={s.completeKicker}>{view.winnerIds.length>1?'TIED WINNER':'WINNER'}</Text><Text style={s.winnerName}>{p.name}</Text></View><View style={s.winnerScoreBlock}><Text style={s.completeKicker}>{game.winner==='zero'?'REMAINING':'POINTS'}</Text><Text accessibilityLabel={`${view.totals[p.id]} points`} style={s.winnerScore}>{view.totals[p.id]}</Text></View></View>)}<Text style={s.completeCopy}>{winnerLabel(game)+'.'} Your final scores are saved.</Text></View>}{finalRoundMessage(game)?<Text accessibilityRole="alert" style={s.kicker}>{finalRoundMessage(game)}</Text>:null}{accountReadOnly&&showGameSyncNotice(accountRead,pendingScoreSave)&&<View style={s.panel} accessibilityLiveRegion="polite"><Text style={s.player}>{readMessage.title}</Text><Text style={s.copy}>{readMessage.detail}</Text>{gameScoringPilot&&accountRead?.kind==='game'&&accountRead.scoreAccess==='untracked'&&accountRead.sync==='confirmed'&&!game.finished&&<Button title="Enable score entry" disabled={busy} onPress={()=>void prepareAccountScoring()}/>}{pendingScoreSave&&<Button secondary title="Retry save" onPress={()=>void saveAccountScore(null)}/>}{gameRecoveryPilot&&accountRead?.kind==='game'&&accountRead.sync==='needs-review'&&<Button secondary title="Resolve sync issue" disabled={busy} onPress={()=>void reviewSavedCopies()}/>}{error?<Text accessibilityRole="alert" style={s.error}>{error}</Text>:null}<View style={{flexDirection:'row',gap:10}}><View style={{flex:1}}><Button secondary title="Reconnect" onPress={()=>void reconnect()}/></View>{!game.finished&&<View style={{flex:1}}><Button title="+ New Game" onPress={newGame}/></View>}</View></View>}{!game.finished&&<View style={s.scores}>{(reordering?displayPlayers:displayPlayers.filter(p=>p.id===game.next)).map((p,index)=><DraggablePlayer style={[s.playerCard,reordering&&s.reorderCard,dragTarget===index&&s.dropTarget]} key={p.id} index={index} items={playerCards} onDraggingChange={setDraggingPlayer} onTargetChange={setDragTarget}><View style={[s.score,reordering&&s.reorderScore,p.id===game.next&&!game.finished&&s.current]}><View style={s.tileRow}><Pressable accessibilityRole="button" accessibilityLabel={`Select ${p.name} for scoring`} accessibilityState={{selected:p.id===game.next}} disabled={busy||accountScoreReadOnly||pendingScoreSave||reordering||game.finished||p.id===game.next||!!remainingTargetPlayers(game)?.every(r=>r.id!==p.id)} onPress={()=>selectScorer(p.id)} style={s.tileHeader}><View style={{flex:1,gap:4}}><Text style={s.player}>{p.name}</Text></View><View style={{flexDirection:'row',alignItems:'baseline',gap:5}}><Text style={s.total}>{view.totals[p.id]}</Text><Text style={s.copy}>{game.winner==='zero'?'remaining':'total'}</Text></View></Pressable>{!game.finished&&!accountScoreReadOnly&&!pendingScoreSave&&!reordering&&game.playStyle!=='free'&&p.id!==game.next&&<Pressable accessibilityRole="button" accessibilityLabel={`No points for ${p.name}; available on their turn`} disabled style={[s.noPoints,s.disabled]}><Text style={s.noPointsText}>No Points</Text></Pressable>}</View>{!game.finished&&p.id===game.next&&!reordering&&!accountScoreReadOnly&&!pendingScoreSave&&<InlineScoreEntry countdown={game.winner==='zero'} scoringGuide={presets.find(p=>p.id===game.presetId)?.scoringGuide} guideExpanded={guideExpanded} onToggleGuide={()=>setGuideExpanded(open=>!open)} value={points} onChange={setPoints} busy={busy} totalMode={game.scoreMode==='total'} turnLabel={game.playStyle==='free'?'Scoring for this player':`Turn ${game.entries.length+1}`} showNoPoints noPointsLabel={game.playStyle==='free'?'No points; record no change for this player':'No points; finish turn and advance to the next player'} error={error} onLayout={revealScoreEntry} onNoPoints={()=>void noPoints()} onSubmit={()=>{if(!/^-?\d+$/.test(points)){setError('Enter whole-number points.');return}void action({action:'score',points:Number(points),...(game.playStyle==='free'?{playerId:game.next}:{})})}}/>}</View>{reordering&&<View style={s.moveControls}><DragHandle index={index} label={p.name} items={playerCards} onMove={movePlayer} disabled={busy}/></View>}</DraggablePlayer>)}</View>}{!game.finished&&!accountReadOnly&&<View style={{flexDirection:'row',justifyContent:'flex-end',alignItems:'center',flexWrap:'wrap',columnGap:24,rowGap:4}}><Pressable accessibilityRole="button" accessibilityState={{selected:reordering,disabled:busy||!layoutsLoaded}} disabled={busy||!layoutsLoaded} style={{minHeight:44,justifyContent:'center',paddingHorizontal:4}} onPress={()=>reordering?setReordering(false):void saveLayout(displayPlayers.map(p=>p.id),true)}><Text style={s.noPointsText}>{reordering?'Done reordering':'Reorder players'}</Text></Pressable></View>}<Text style={s.copy}>{game.deviceOnly?'Saved on this device. Add it to your account from Home when account saving is available.':session?'Pull to refresh changes from another device.':'Guest · saved on this device'}</Text></>:creating?<><Button secondary title="‹ Home" onPress={()=>{setCreating(false);setError('')}}/><Text accessibilityRole="header" style={s.heading}>New game</Text><GameSetup onManagePlayers={()=>setSettingsOpen(true)} onDraggingChange={setDraggingPlayer} presetId={presetId} onPresetChange={choosePreset} name={name} onNameChange={setName} players={names} onPlayersChange={setNames} settings={settings} onSettingsChange={setSettings} busy={busy} onSubmit={()=>void create()}/></>:<><View style={s.homeIntro}><Text accessibilityRole="header" style={s.homeTitle}>{"Always keep score."}</Text><Button title="+ New Game" onPress={newGame}/></View><View style={s.sectionTitle}><Text accessibilityRole="header" style={s.subheading}>In Progress</Text>{homeGames.some(g=>!g.finished)&&<View style={[s.countBadge,s.activeCountBadge]}><Text style={s.activeCountText}>{homeGames.filter(g=>!g.finished).length}</Text></View>}</View>{homeGames.filter(g=>!g.finished).map(savedGame)}{!homeGames.some(g=>!g.finished)&&<View style={s.panel}><Text style={s.player}>{homeGames.length?'No games in progress.':'Your games will appear here.'}</Text><Text style={s.copy}>{homeGames.length?"Start a new game whenever you're ready.":'Start your first game—scores save automatically.'}</Text></View>}<View style={s.completedSection}><Pressable accessibilityRole="button" accessibilityState={{expanded:completedOpen}} disabled={busy} style={s.completedToggle} onPress={()=>setCompletedOpen(!completedOpen)}><View style={s.sectionTitle}><Text style={s.player}>Completed Games</Text>{homeGames.some(g=>g.finished)&&<View style={s.countBadge}><Text style={s.countText}>{homeGames.filter(g=>g.finished).length}</Text></View>}</View><Text style={s.player}>{completedOpen?'−':'+'}</Text></Pressable>{completedOpen&&<View style={{gap:12}}>{homeGames.filter(g=>g.finished).map(savedGame)}{!homeGames.some(g=>g.finished)&&<Text style={s.copy}>Finished games will appear here.</Text>}</View>}</View>{session&&!gameScreenPilot&&localCount>0&&<Button secondary title={`Add ${localCount} local games to my account`} onPress={()=>void importLocal()}/>}{session&&blockedLocalCount>0&&!notice&&<Text style={s.copy}>{blockedLocalCount} {blockedLocalCount===1?'local game uses':'local games use'} scoring rules that aren't available for account games yet. Saved on this device.</Text>}<Text style={s.copy}>{session?(gameScreenPilot?'Account games save on this device and sync automatically when connected.':'Saved to your account. Pull to sync updates from other devices.'):'Saved on this device. Sign in for backup and access across devices.'}</Text></>}{!game&&<PolicyLinks/>}</ScrollView></KeyboardAvoidingView>{game&&<GameToolbar undoDisabled={undoBlocked} onUndo={undoLastScore} onHistory={()=>{setEdit(null);setHistoryOpen(true)}} busy={busy} finished={game.finished} disabled={accountCompletionReadOnly||pendingScoreSave||reordering} onHome={leaveGame} onFinish={finishGame} onNewGame={newGame}/>}</SafeAreaView>{game&&<SideDrawer visible={gameDetailsOpen} title="Game details" onClose={()=>setGameDetailsOpen(false)}><Text accessibilityRole="header" style={s.subheading}>{game.name}</Text><Text style={s.gameRuleTitle}>{winnerLabel(game)}</Text><Text style={s.gameRuleDescription}>{rulesLabel(game)}</Text><Text style={s.gameMeta}>{formatGameTime(game.startedAt)?`Started ${formatGameTime(game.startedAt)}`:'Start time not recorded'}{game.finished&&formatGameTime(game.endedAt)?` · Ended ${formatGameTime(game.endedAt)}`:''}</Text></SideDrawer>}{editingGame&&<EditGame game={editingGame} busy={busy} pending={pendingScoreSave} onRetry={()=>void saveAccountScore(null)} error={error} onClose={()=>{rulesEditor.current++;setEditingGame(null);setError('')}} onSave={saveGameRules}/>}<Modal visible={!!adoption} transparent animationType="fade" onRequestClose={()=>{if(!busy)setAdoption(null)}}><View style={s.overlay}><View style={s.dialog}><Text style={s.subheading}>Add game to account</Text><Text style={s.player}>{adoption?.review.view.game.name}</Text><Text style={s.copy}>{adoption?.review.view.game.entries.length} score entries · Original stays on this device.</Text><ScrollView style={{maxHeight:180}}>{adoption?.review.view.game.players.map(player=><Text key={player.id} style={s.copy}>{player.name}: {adoption.review.view.totals[player.id]}</Text>)}</ScrollView><Text style={s.copy}>{admissionPilot?'Add this game to your account so it syncs across your devices. Your original game stays safely stored on this device.':'Keep a reviewed copy without changing the original game. Nothing will be uploaded.'}</Text>{error?<Text accessibilityRole="alert" style={s.error}>{error}</Text>:null}<Button secondary title="Close" onPress={()=>setAdoption(null)}/><Button title={adoption?.attempted?(admissionPilot?'Try again':'Retry preparation'):(admissionPilot?'Add to account':'Keep reviewed copy')} onPress={()=>void confirmDeviceAdoption()}/></View></View></Modal><Modal visible={!!deleting} transparent animationType="fade" onRequestClose={()=>{if(!busy)setDeleting(null)}}><View style={s.overlay}><View style={s.dialog}><Text style={s.subheading}>Delete {deleting?.name}?</Text><Text style={s.copy}>{pendingDeletion?'The deletion save could not be confirmed. Retry checks the original request.':'This queues deletion on this device. The game is removed from your account when sync completes; other devices update after syncing.'}</Text>{error?<Text accessibilityRole="alert" style={s.error}>{error}</Text>:null}<Button secondary title={pendingDeletion?'Close':'Keep game'} onPress={()=>setDeleting(null)}/><Pressable accessibilityRole="button" disabled={busy} style={[s.button,s.secondary,busy&&s.disabled]} onPress={()=>deleting&&void saveAccountDeletion(deleting)}><Text style={[s.buttonText,{color:s.error.color}]}>{pendingDeletion?'Retry deletion':'Delete game'}</Text></Pressable></View></View></Modal>{game&&<SideDrawer visible={historyOpen} title={edit?'Edit score':game.scoreMode==='total'?'Total history':'Score history'} locked={busy} onClose={()=>{setHistoryOpen(false);setEdit(null);setError('')}}>{edit?<View style={{gap:16}}>{error?<Text accessibilityRole="alert" style={s.error}>{error}</Text>:null}<Text style={s.subheading}>{game?.winner==='zero'?'Edit points subtracted':game?.scoreMode==='total'?'Edit recorded total':'Edit score entry'}</Text><View style={{flexDirection:'row',gap:8,alignItems:'stretch'}}><TextInput placeholderTextColor={s.copy.color} accessibilityLabel="Corrected points" value={editPoints} onChangeText={value=>{if(isScoreInput(value)&&(game?.winner!=='zero'||/^\d*$/.test(value)))setEditPoints(value)}} keyboardType="number-pad" style={[s.input,{flex:1}]}/><Pressable accessibilityRole="button" accessibilityLabel="Toggle edited score between positive and negative" disabled={busy||game?.winner==='zero'} onPress={()=>setEditPoints(editPoints.startsWith('-')?editPoints.slice(1):'-'+editPoints)} style={[s.secondary,{padding:14,borderRadius:10,justifyContent:'center',minWidth:50,alignItems:'center'}]}><Text style={[s.buttonText,{color:buttonColors(dark,true).text}]}>±</Text></Pressable></View>{accountReadOnly&&pendingScoreSave&&<><Text accessibilityLiveRegion="polite" style={s.copy}>Retry checks the original change. Your current input is kept.</Text><Button secondary title="Retry save" onPress={()=>void saveAccountScore(null)}/></>}<Button disabled={accountCorrectionReadOnly||pendingScoreSave||!/^-?\d+$/.test(editPoints)} title="Save change" onPress={()=>void action({action:'edit',entryId:edit!,points:Number(editPoints)})}/><Button secondary title="Back to history" onPress={()=>{setEdit(null);setError('')}}/></View>:<><View style={s.panel}><View style={s.historyHeading}><Text style={s.turnNumber}>Turn #</Text><Text style={[s.copy,{flex:1}]}>Player</Text><Text style={s.copy}>{game.winner==='zero'?'Subtracted':game.scoreMode==='total'?'Total':'Points'}</Text></View>{[...game.entries].reverse().map((e,index)=><Pressable key={e.id} accessibilityRole="button" disabled={busy||accountCorrectionReadOnly||pendingScoreSave} style={s.history} onPress={()=>{setEdit(e.id);setEditPoints(String(e.points))}}><Text style={s.turnNumber} accessibilityLabel={`Turn ${game.entries.length-index}`}>{game.entries.length-index}</Text><Text style={[s.copy,{flex:1}]}>{game.players.find(p=>p.id===e.playerId)?.name}</Text><Text style={s.player}>{e.points}   ›</Text></Pressable>)}</View>{!game.entries.length&&<Text style={s.copy}>No scores recorded yet.</Text>}</>}</SideDrawer>}<Settings visible={settingsOpen} onClose={()=>setSettingsOpen(false)}/>{recovery&&canUseAccount(recovery.owner)&&<GameRecovery review={recovery.review} onClose={()=>{recoveryRef.current=null;setRecovery(null)}} onChoose={chooseRecoveryCopy} onCheckCollision={checkCollisionCopy}/>}<AccountModal syncSuccessMessage={gameScreenPilot?'Account refreshed. Device changes have been kept.':undefined} deviceSaves={pilot.deviceSaves} onBeforeDelete={pilot.enabled?async()=>{const owner=identityRevision.current;if(!canUseAccount(owner))throw new Error('Account access changed.');const status=await cloudApi.account();if(!canUseAccount(owner))throw new Error('Account changed. Retry from Account.');accountIntent.current='deletion';accountBarrier.current=true;identityRevision.current++;setView(null);setEditingGame(null);setGames(previous=>previous.filter(g=>g.deviceOnly));activityRevision.current++;connection.reset(null);await pilot.ref.current!.beginDeletion(status.profileId)}:undefined} working={busy} onSync={async()=>{const ok=await refresh(false,true);if(!ok)throw new Error('Account sync is unavailable. Use Reconnect to try again.');return true}} visible={accountOpen} api={cloudApi} onClose={()=>setAccountOpen(false)} onDeleted={async()=>{await clearFrequentPlayersAccount();setAccountOpen(false);setEdit(null);setPoints('');setError('');await logout()}}/></View>
}
const baseStyles=StyleSheet.create({completeCard:{backgroundColor:'white',borderWidth:1,borderColor:'#2b8388',borderRadius:20,padding:20,gap:20},completeHeader:{flexDirection:'row',alignItems:'center',gap:14},completeBadge:{width:44,height:44,borderRadius:22,backgroundColor:'#edf8f5',alignItems:'center',justifyContent:'center'},completeBadgeText:{fontSize:26,fontWeight:'800',color:'#226b73'},completeKicker:{fontSize:12,fontWeight:'800',letterSpacing:1,color:'#226b73'},completeTitle:{fontSize:24,lineHeight:30,fontWeight:'700',color:'#17252a'},winnerRow:{flexDirection:'row',flexWrap:'wrap',alignItems:'flex-start',gap:16,paddingVertical:16,borderTopWidth:1,borderColor:'#dce5e7'},winnerName:{fontSize:32,lineHeight:39,fontWeight:'800',color:'#17252a'},winnerScoreBlock:{alignItems:'center',justifyContent:'center',minWidth:88,maxWidth:'100%',gap:5},winnerScore:{fontSize:36,lineHeight:44,fontWeight:'800',fontVariant:['tabular-nums'],textAlign:'center',color:'#226b73'},completeCopy:{fontSize:14,lineHeight:21,color:'#62777d'},safe:{flex:1,backgroundColor:'#f4f7f8'},body:{padding:18,gap:16,paddingBottom:60},panel:{backgroundColor:'white',borderWidth:1,borderColor:'#dce5e7',borderRadius:16,padding:20,gap:12},heading:{fontSize:32,fontWeight:'800',color:'#17252a',letterSpacing:-1},subheading:{fontSize:22,fontWeight:'700',color:'#17252a'},kicker:{fontSize:12,fontWeight:'800',color:'#417b80',letterSpacing:1},copy:{fontSize:14,color:'#62777d',lineHeight:21},label:{fontSize:14,fontWeight:'700',color:'#385a61'},input:{borderWidth:1,borderColor:'#ccdadd',borderRadius:10,padding:14,fontSize:18,backgroundColor:'white',color:'#17252a',minHeight:50},button:{backgroundColor:'#d4e965',borderRadius:10,padding:15,alignItems:'center',minHeight:48},secondary:{backgroundColor:'#e8f0f1'},disabled:{opacity:.5},buttonText:{fontSize:16,fontWeight:'700',color:'#123f4a'},scores:{gap:10},layoutActions:{flexDirection:'row',gap:8},playerCard:{width:'100%'},reorderCard:{flexDirection:'row',alignItems:'center',gap:8},reorderScore:{flex:1,width:undefined},moveControls:{flexShrink:0,width:48,alignItems:'center',justifyContent:'center'},moveButton:{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center',backgroundColor:'#e8f0f1',borderRadius:10},noPoints:{minHeight:48,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'#ccdadd',borderRadius:10,backgroundColor:'#e8f0f1',paddingHorizontal:10},noPointsText:{fontSize:14,fontWeight:'700',color:'#226b73'},tileRow:{flexDirection:'row',gap:10,alignItems:'center'},tileHeader:{flex:1,flexDirection:'row',alignItems:'center',gap:12,minHeight:48},gameHeading:{gap:8},gameRules:{gap:4},gameRuleTitle:{fontSize:15,lineHeight:22,fontWeight:'600',color:'#226b73'},gameRuleDescription:{fontSize:15,lineHeight:22,color:'#17252a'},score:{width:'100%',backgroundColor:'white',padding:14,borderWidth:1,borderColor:'#dce5e7',borderRadius:14},current:{borderWidth:2,borderColor:'#2b8388'},total:{fontSize:32,fontWeight:'800',color:'#17252a'},player:{fontSize:16,fontWeight:'700',color:'#17252a'},dropTarget:{backgroundColor:'#edf8f5',borderRadius:14,opacity:.55},sectionTitle:{flexDirection:'row',alignItems:'center',gap:9},countBadge:{minWidth:26,height:24,paddingHorizontal:8,borderRadius:12,alignItems:'center',justifyContent:'center',backgroundColor:'#e8f0f1'},activeCountBadge:{backgroundColor:'#edf8f5'},countText:{fontSize:12,fontWeight:'700',color:'#62777d',fontVariant:['tabular-nums']},activeCountText:{fontSize:12,fontWeight:'700',color:'#226b73',fontVariant:['tabular-nums']},homeIntro:{gap:22,marginVertical:12},homeTitle:{fontSize:26,fontWeight:'800',lineHeight:31,color:'#17252a',letterSpacing:-.7},gameListCard:{backgroundColor:'white',borderWidth:1,borderColor:'#dce5e7',borderRadius:14,padding:18,flexDirection:'row',alignItems:'center',gap:12},gameMeta:{fontSize:12,lineHeight:18,color:'#62777d'},resume:{fontSize:14,fontWeight:'700',color:'#226b73'},completedSection:{borderTopWidth:1,borderColor:'#dce5e7',marginTop:8,paddingTop:8,gap:12},completedToggle:{minHeight:48,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},turnNumber:{width:46,fontSize:14,fontWeight:'700',color:'#62777d'},historyHeading:{flexDirection:'row',alignItems:'center',gap:12},history:{flexDirection:'row',gap:12,paddingVertical:14,borderTopWidth:1,borderColor:'#e4ebec'},error:{color:'#ad3838',fontSize:14},overlay:{flex:1,backgroundColor:'#0008',justifyContent:'center',padding:24},dialog:{backgroundColor:'white',borderRadius:18,padding:24,gap:16}});
