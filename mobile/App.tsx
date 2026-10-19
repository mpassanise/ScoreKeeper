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
const configured=!!(authority&&clientId&&scope&&apiUrl);
type Session={profileId?:string;accessToken:string;refreshToken?:string;expiresAt:number};
const sessionKey='scorekeeper-session';
const redirectUri=AuthSession.makeRedirectUri({scheme:'scorekeeper',path:'auth'});
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
 const [reordering,setReordering]=useState(false),[layoutsLoaded,setLayoutsLoaded]=useState(false),[playerOrders,setPlayerOrders]=useState<Record<string,string[]>>({});
 const [editingGame,setEditingGame]=useState<Game|null>(null);
 const [accountOpen,setAccountOpen]=useState(false),[notice,setNotice]=useState("");
 const foregroundContext=useRef({view,creating,accountOpen,settingsOpen,editingGame,points,edit,reordering});foregroundContext.current={view,creating,accountOpen,settingsOpen,editingGame,points,edit,reordering};
 const [guest,setGuest]=useState(false),[rulesEnabled,setRulesEnabled]=useState(false),[localCount,setLocalCount]=useState(0),[blockedLocalCount,setBlockedLocalCount]=useState(0);
 const [presetId,setPresetId]=useState<PresetId>("custom"),[settings,setSettings]=useState(defaultSettings);
 const {rules,winner}=setupRules(presetId,settings);
 const identityRevision=useRef(0),sessionWrites=useRef(Promise.resolve());
 const [connection]=useState(()=>createConnectionStatus(RECONNECT_WATCHDOG_MS,value=>console.warn('[Scorekeeper connection]',value)));
 const connectionState=useSyncExternalStore(connection.subscribe,connection.getSnapshot,connection.getSnapshot);
 useEffect(()=>()=>connection.reset(null),[connection]);
 const current=useRef<Session|null>(null),locked=useRef(false),renewing=useRef<Promise<string>|null>(null);
 const accountBarrier=useRef(false);
 const pilot=useRepositoryPilot(()=>{accountBarrier.current=true;activityRevision.current++;identityRevision.current++;setView(null);setEditingGame(null);setGames(previous=>previous.filter(g=>g.deviceOnly));connection.fail(Object.assign(new Error('Account access changed. Sign in to reconnect.'),{code:'SIGN_IN_REQUIRED'}));setNotice('Account access changed. Your unsent input has been kept. Sign in to reconnect.');});
 async function preparePilot(owner:string){try{return await pilot.ref.current?.prepare(owner)??null}catch{setNotice('Could not prepare device storage. Account games remain online-only.');return null}}
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
 const cloudApi=new ScorekeeperApi(apiUrl||'http://localhost:7071/api',()=>latestToken.current());
 const api=session&&!view?.game.deviceOnly?cloudApi:localApi;
 async function loadCloudGames(){const startingIdentity=identityRevision.current,revision=activityRevision.current;const valid=()=>mounted.current&&identityRevision.current===startingIdentity&&activityRevision.current===revision;const locals=await localApi.list();if(!valid())return;setGames(previous=>mergeDeviceGames(previous.filter(g=>!g.deviceOnly),locals));const [saved,status]=await Promise.all([cloudApi.list(),cloudApi.account()]);if(!valid())return;if(status.profileId&&current.current){const next={...current.current,profileId:status.profileId};await persist(next);await setFrequentPlayersAccount(status.profileId,cloudApi)}const supported=(status.scoringRulesVersion||0)>=2;setRulesEnabled(supported);const pending=await pendingImports(localApi,cloudApi,saved);const eligible=pending.filter(g=>(supported||!needsAdvancedRules(g,g.winner))&&(g.targetEnd!=="round"||(status.scoringRulesVersion||0)>=3));const updatedLocals=await localApi.list();if(!valid())return;setGames(mergeDeviceGames(saved,updatedLocals));void gameListCache.write(current.current?.profileId,saved).catch(()=>{});setLocalCount(eligible.length);setBlockedLocalCount(pending.length-eligible.length)}
 async function loadGames(){if(current.current){try{await loadCloudGames()}catch(e){setNotice('Account games could not be refreshed. Games saved on this device are available.'+(e instanceof Error?' '+e.message:''))}}else{setGames(await localApi.list());setLocalCount(0);setBlockedLocalCount(0)}}
 async function run(work:()=>Promise<void>){if(locked.current)return;locked.current=true;activityRevision.current++;setBusy(true);setError('');setNotice('');try{await work()}catch(e){if(e instanceof ApiError&&e.status===409&&view){try{setView(await api.get(view.game.id))}catch{}}if(isConnectionFailure(e))connection.fail(e);setError(e instanceof Error?e.message:'Unable to connect.')}finally{locked.current=false;setBusy(false)}}
 useEffect(()=>{let active=true;void (async()=>{
  try{const raw=await SecureStore.getItemAsync(sessionKey);const restored:Session|null=raw?JSON.parse(raw):null;
   const [cached,locals]=await Promise.all([gameListCache.read(restored?.profileId),localApi.list()]);if(!active)return;
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
  if(!ready||!session||busy||startupIdentity.current===identityRevision.current)return;
  if(current.current&&current.current.expiresAt<=Date.now()+60000&&!discovery)return;
  startupIdentity.current=identityRevision.current;void backgroundRefresh();
 },[ready,!!session,busy,!!discovery]);
 useEffect(()=>{
  const sub=AppState.addEventListener('change',state=>{
   const previous=foregroundState.current;foregroundState.current=state;
   if(state!=='active'){if(previous==='active')backgroundSince.current=Date.now();return}
   const since=backgroundSince.current;backgroundSince.current=null;
   if(since!==null&&Date.now()-since>=30000)void backgroundRefresh();
  });return()=>sub.remove();
 },[discovery]);
 function goHome(){if(locked.current)return;activityRevision.current++;setView(null);setCreating(false);setEdit(null);setError('')}
 useEffect(()=>{if(ready&&session?.profileId&&session.profileId===current.current?.profileId)void gameListCache.write(session.profileId,games).catch(()=>{})},[ready,session?.profileId,games]);
 async function enterGuest(){await run(async()=>{setGames(await localApi.list());setView(null);setGuest(true)})}
 async function importLocal(){await run(async()=>{const status=await cloudApi.account();const supported=(status.scoringRulesVersion||0)>=2;setRulesEnabled(supported);const result=await importPendingGames(localApi,cloudApi,supported,setLocalCount,(status.scoringRulesVersion||0)>=3);await loadCloudGames();setNotice(importSummary(result))})}
 async function login(){await run(async()=>{const result=await promptAsync();if(result.type!=='success')return;if(!discovery||!request?.codeVerifier)throw new Error('Sign-in is not ready.');const t=await AuthSession.exchangeCodeAsync({clientId,code:result.params.code,redirectUri,extraParams:{code_verifier:request.codeVerifier}},discovery);await persist(toSession(t));accountBarrier.current=false;setGames((await localApi.list()).filter(g=>g.deviceOnly));setView(null);setSettings(defaultSettings);setPresetId("custom");})}
 async function logout(){if(pilot.enabled)accountBarrier.current=true;setView(null);setEditingGame(null);setGames(previous=>previous.filter(g=>g.deviceOnly));activityRevision.current++;identityRevision.current++;connection.reset(null);await pilot.ref.current?.signOut();renewing.current=null;const profile=current.current?.profileId;await setFrequentPlayersAccount(null,null);await gameListCache.clear(profile).catch(()=>{});await persist(null);setGames(await localApi.list());setView(null);setGuest(true);if(discovery?.endSessionEndpoint)await WebBrowser.openAuthSessionAsync(discovery.endSessionEndpoint+'?post_logout_redirect_uri='+encodeURIComponent(redirectUri),redirectUri)}
 async function refresh(background=false){
  if(locked.current||!current.current||accountBarrier.current)return false;
  const identity=identityRevision.current,revision=activityRevision.current,context=foregroundContext.current;
  connection.reset(String(identity));
  if(!background)setPullRefreshing(true);
  foregroundFlight.current=true;
  try{return await connection.connect(async(isCurrent,signal,step)=>{
   const valid=()=>mounted.current&&isCurrent()&&!!current.current&&identity===identityRevision.current;
   const readApi=new ScorekeeperApi(apiUrl||'http://localhost:7071/api',()=>step('authentication',()=>latestToken.current()),{signal,readAttempts:2});
   const pilotScope=current.current?.profileId?await preparePilot('native-profile:'+current.current.profileId):null;if(!valid())return;
   const snapshot=await readAccountSnapshot({api:readApi,expectedProfileId:current.current?.profileId,gameId:context.view&&!context.view.game.deviceOnly?context.view.game.id:undefined,isCurrent:valid,step});
   if(!snapshot||!valid())return;
   const {saved,status,latest}=snapshot;
   if(pilot.ref.current&&status.profileId){const scope=pilotScope??(!current.current?.profileId?await preparePilot('native-profile:'+status.profileId):null);if(!valid())return;try{if(scope)await pilot.ref.current.verify(scope,status);if(scope&&latest)await rememberRead(scope,latest)}catch{setNotice('Could not prepare device storage. Account games remain online-only.');}if(!valid())return;}
   setRulesEnabled((status.scoringRulesVersion||0)>=2);
   const locals=await step('device',()=>localApi.list());if(!valid())return;
   if(revision===activityRevision.current){
    setGames(mergeDeviceGames(saved,locals));
    if(latest&&context.view&&foregroundContext.current.view===context.view&&!foregroundContext.current.creating&&!foregroundContext.current.points&&!foregroundContext.current.edit&&!foregroundContext.current.editingGame&&!foregroundContext.current.reordering&&latest.game.version>=context.view.game.version)setView(latest);
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
   void gameListCache.write(current.current?.profileId,saved).catch(()=>{});
   // Import remains explicit. Refresh only discovers candidates.
   const pending=await step('imports',()=>pendingImports(localApi,readApi,saved));
   if(!valid())return;
   const eligible=pending.filter(g=>((status.scoringRulesVersion||0)>=2||!needsAdvancedRules(g,g.winner))&&(g.targetEnd!=='round'||(status.scoringRulesVersion||0)>=3));
   setLocalCount(eligible.length);setBlockedLocalCount(pending.length-eligible.length);
  })}finally{foregroundFlight.current=false;if(mounted.current){setPullRefreshing(false);setForegroundSyncing(false)}}
 }
 async function reconnect(forceSignIn=false){
  if(!forceSignIn&&connectionState.status!=='sign-in'){await refresh();return}
  const original=current.current,identity=identityRevision.current;
  if(!original?.profileId){setError('Reconnect first needs to verify the original account. Your local games and players have been kept.');return}
  await run(async()=>{
   const result=await promptAsync();if(result.type!=='success')return;
   if(!discovery||!request?.codeVerifier)throw new Error('Sign-in is not ready.');
   const t=await AuthSession.exchangeCodeAsync({clientId,code:result.params.code,redirectUri,extraParams:{code_verifier:request.codeVerifier}},discovery);
   const next=toSession(t);
   const status=await new ScorekeeperApi(apiUrl,async()=>next.accessToken,{readAttempts:1}).account();
   if(identity!==identityRevision.current||status.profileId!==original.profileId)throw new Error('Please sign in to the same account to reconnect. Your existing game and input have been kept.');
   if(status.deletionStatus)throw new Error('Account deletion is pending. Sync is unavailable.');
   identityRevision.current++;renewing.current=null;connection.reset(String(identityRevision.current));
   await persist({...next,profileId:original.profileId});
  });
  if(current.current&&identityRevision.current!==identity)await refresh();
 }


 useEffect(()=>{if(ready&&guest&&!session)void (view?AsyncStorage.setItem('scorekeeper-guest-active',view.game.id):AsyncStorage.removeItem('scorekeeper-guest-active')).catch(()=>setError('Could not remember the open game. Your scores are still saved.'))},[view,ready,guest,!!session]);
 function choosePreset(id:PresetId){setPresetId(id);if(id==="scrabble")setName("Scrabble");else if(id==="phase10")setName("Phase 10");setError("")}
 const game=view?.game;
 async function saveGameRules(a:Action){if(!editingGame)return;await run(async()=>{const source=current.current&&!editingGame.deviceOnly?cloudApi:localApi,owner=identityRevision.current,updated=await source.act(editingGame,a);if(source===cloudApi&&owner!==identityRevision.current)return;setView(updated);setGames(previous=>previous.map(g=>g.id===updated.game.id?{...updated.game,turnCount:updated.game.entries.length}:g));setEditingGame(null)})}
 async function create(){await run(async()=>{const owner=identityRevision.current,result=await startGame({local:localApi,cloud:cloudApi,signedIn:!!session,name,players:names,winner,rules,uuid:Crypto.randomUUID});if(session&&owner!==identityRevision.current)return;setView(result.view);setCreating(false);setGames(previous=>[{...result.view.game,turnCount:result.view.game.entries.length},...previous.filter(g=>g.id!==result.view.game.id)]);setNotice(result.message)})}
 async function noPoints(){if(!game||!view||game.finished||busy||reordering)return;Keyboard.dismiss();await action({action:'score',points:game.scoreMode==='total'?view.totals[game.next]:0,...(game.playStyle==='free'?{playerId:game.next}:{})})}
 async function action(a:Action){if(!game)return;await run(async()=>{const owner=identityRevision.current,updated=await api.act(game,a);if(api===cloudApi&&owner!==identityRevision.current)return;setView(updated);setGames(previous=>previous.map(g=>g.id===updated.game.id?{...updated.game,turnCount:updated.game.entries.length}:g));if(a.action==='score')setPoints('');if(a.action==='edit')setEdit(null)})}
 useEffect(()=>{AsyncStorage.getItem('scorekeeper-player-order-v2').then(raw=>{const saved=JSON.parse(raw||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))setPlayerOrders(Object.fromEntries(Object.entries(saved).filter((entry):entry is [string,string[]]=>Array.isArray(entry[1])&&entry[1].every(id=>typeof id==='string'))))}).catch(()=>setError('Could not load player positions.')).finally(()=>setLayoutsLoaded(true))},[]);
 useEffect(()=>{setReordering(false);setGuideExpanded(true)},[game?.id,game?.finished]);
 useEffect(()=>{setPoints('')},[game?.id,game?.next]);
 const savedOrder=game?playerOrders[game.id]:undefined;
 const displayPlayers=game&&savedOrder?[...new Set(savedOrder)].map(id=>game.players.find(p=>p.id===id)).filter((p):p is NonNullable<typeof p>=>!!p).concat(game.players.filter(p=>!savedOrder.includes(p.id))):game?.players||[];
 async function saveLayout(ids:string[],editing=false){if(!game||!layoutsLoaded)return;await run(async()=>{const updated={...playerOrders};updated[game.id]=ids;await AsyncStorage.setItem('scorekeeper-player-order-v2',JSON.stringify(updated));if(editing)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);setPlayerOrders(updated);setReordering(editing)})}
 const playerCards=useRef<(View|null)[]>([]);
 function revealScoreEntry(){requestAnimationFrame(()=>{if(!game||reordering||game.finished)return;const item=playerCards.current[displayPlayers.findIndex(p=>p.id===game.next)];const viewport=scroll.current?.getNativeScrollRef();if(!item||!viewport)return;viewport.measureInWindow((_x:number,top:number,_w:number,height:number)=>{item.measureInWindow((_ix,cardTop,_iw,cardHeight)=>{if(cardTop<top||cardTop+cardHeight>top+height)scroll.current?.scrollTo({y:Math.max(0,scrollOffset.current+cardTop-top-8),animated:true})})})})}

 function movePlayer(index:number,target:number){const ids=displayPlayers.map(p=>p.id);if(index<0||target<0||target>=ids.length||index===target)return;const [id]=ids.splice(index,1);ids.splice(target,0,id);return saveLayout(ids,true)}
 function newGame(){activityRevision.current++;setName('');setNames(['','']);setSettings(defaultSettings);setPresetId('custom');setPoints('');setError('');setNotice('');setView(null);setReordering(false);setCreating(true);scroll.current?.scrollTo({y:0,animated:false})}
 async function openGame(id:string){await run(async()=>{const source=games.find(g=>g.id===id)?.deviceOnly?localApi:session?cloudApi:localApi,owner=identityRevision.current,scope=pilot.ref.current?.capture()??null;const result=await source.get(id);if(source===cloudApi&&owner!==identityRevision.current)return;setView(result);setPoints('');setCreating(false);if(source===cloudApi)void rememberRead(scope,result)})}
 function confirmDelete(g:GameSummary){Alert.alert(`Delete ${g.name}?`,`This permanently removes the game and its score history ${session&&!g.deviceOnly?'from your account and synced devices':'from this device'}. This cannot be undone.`,[{text:'Keep game',style:'cancel'},{text:'Delete game',style:'destructive',onPress:()=>void run(async()=>{const local=!current.current||g.deviceOnly;await(local?localApi:cloudApi).deleteGame(g);setGames(previous=>previous.filter(item=>item.id!==g.id));if(!local){try{await localApi.forget(g.id)}catch{setNotice('Game deleted from your account. A local copy could not be removed, but cannot be imported again.')}}setLocalCount(previous=>local?Math.max(0,previous-1):previous)})}])}
 function savedGame(g:GameSummary){const card=<Pressable key={g.id} accessibilityRole="button" accessibilityHint={g.finished?undefined:"Swipe left or touch and hold to delete. VoiceOver actions include Delete game."} accessibilityActions={g.finished?[]:[{name:"delete",label:"Delete game"}]} onAccessibilityAction={e=>{if(!busy&&!g.finished&&e.nativeEvent.actionName==="delete")confirmDelete(g)}} accessibilityLabel={`${g.finished?'View':'Resume'} ${g.name}`} disabled={busy} style={[s.gameListCard,busy&&s.disabled]} onLongPress={()=>!g.finished&&confirmDelete(g)} onPress={()=>void openGame(g.id)}><View style={{flex:1,gap:6}}><Text style={s.player}>{g.name}</Text><Text style={s.copy}>{g.players.map(p=>p.name).join(' · ')}</Text><Text style={s.gameMeta}>{g.deviceOnly?"On this device · ":""}{g.turnCount} {g.turnCount===1?'entry':'entries'}{formatGameTime(g.updated)?` · Updated ${formatGameTime(g.updated)}`:''}</Text></View><Text style={s.resume}>{g.finished?'View':'Resume'} ›</Text></Pressable>;return g.finished?card:<SwipeGameRow key={g.id} name={g.name} disabled={busy} onDelete={()=>confirmDelete(g)}>{card}</SwipeGameRow>}
 useEffect(()=>{scroll.current?.scrollTo({y:0,animated:false})},[creating,game?.id]);
 useEffect(()=>{if(!game?.finished)return;const frame=requestAnimationFrame(()=>scroll.current?.scrollTo({y:0,animated:true}));return()=>cancelAnimationFrame(frame)},[game?.id,game?.finished]);
 function Button({title,onPress,secondary=false,disabled=false}:{title:string;onPress:()=>void;secondary?:boolean;disabled?:boolean}){const colors=buttonColors(dark,secondary);return <Pressable accessibilityRole="button" disabled={disabled||busy} onPress={onPress} style={[s.button,{backgroundColor:colors.background},(disabled||busy)&&s.disabled]}><Text style={[s.buttonText,{color:colors.text}]}>{title}</Text></Pressable>}
 return <View style={s.safe}><StatusBar barStyle={settingsOpen||accountOpen||!!editingGame?(dark?'light-content':'dark-content'):'light-content'}/><AppHeader syncControl={session?<ConnectionStatus state={connectionState} disabled={busy} onReconnect={()=>void reconnect()} onSignIn={()=>void reconnect(true)}/>:undefined} onHome={goHome} signedIn={!!session} canSignIn={configured} signInReady={!!request} busy={busy} onSettings={()=>setSettingsOpen(true)} onAccount={()=>setAccountOpen(true)} onSignIn={()=>void login()} onSignOut={()=>void run(logout)}/><SafeAreaView edges={['left','right','bottom']} style={{flex:1}}><KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}><ScrollView scrollEnabled={!draggingPlayer} onScroll={event=>{scrollOffset.current=event.nativeEvent.contentOffset.y}} scrollEventThrottle={16} ref={scroll} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" refreshControl={session&&!draggingPlayer?<RefreshControl tintColor={s.resume.color} refreshing={pullRefreshing} onRefresh={()=>void refresh().catch(()=>{})}/>:undefined}>{error&&(!game||game.finished||reordering)?<Text accessibilityRole="alert" style={s.error}>{error}</Text>:null}{notice?<Text accessibilityLiveRegion="polite" style={s.copy}>{notice}</Text>:null}{!ready?<Text>Loading…</Text>:game&&view?<><Button secondary title="‹ Home" onPress={goHome}/><View style={s.gameHeading}><View style={{flexDirection:'row',alignItems:'center',gap:12}}><Text style={[s.heading,{flex:1}]}>{game.name}</Text>{canEditGame(game)&&<Pressable accessibilityRole="button" disabled={busy} style={{minHeight:44,paddingHorizontal:8,justifyContent:'center'}} onPress={()=>{activityRevision.current++;setError('');setReordering(false);setEditingGame(game)}}><Text style={s.noPointsText}>Edit game</Text></Pressable>}</View><View style={s.gameRules}><Text style={s.gameRuleTitle}>{game.winner==='high'?'Highest':'Lowest'} score wins</Text><Text style={s.gameRuleDescription}>{rulesLabel(game)}</Text><Text style={s.gameMeta}>{formatGameTime(game.startedAt)?`Started ${formatGameTime(game.startedAt)}`:"Start time not recorded"}{game.finished&&formatGameTime(game.endedAt)?` · Ended ${formatGameTime(game.endedAt)}`:""}</Text></View></View>{game.finished&&<View style={{flexDirection:'row',gap:10}}><View style={{flex:1}}><Button secondary title="Resume" onPress={()=>void action({action:'resume'})}/></View><View style={{flex:1}}><Button title="+ New Game" onPress={newGame}/></View></View>}{game.finished&&<View accessibilityLiveRegion="polite" style={s.completeCard}><View style={s.completeHeader}><View style={s.completeBadge}><Text style={s.completeBadgeText}>✓</Text></View><View style={{flex:1,gap:4}}><Text style={s.completeKicker}>GAME COMPLETE</Text><Text accessibilityRole="header" style={s.completeTitle}>{view.winnerIds.length>1?"It's a tie!":view.winnerIds.length?"We have a winner!":"Thanks for playing!"}</Text></View></View>{game.players.filter(p=>view.winnerIds.includes(p.id)).map(p=><View key={p.id} style={s.winnerRow}><View style={{flex:1,gap:5}}><Text style={s.completeKicker}>{view.winnerIds.length>1?'TIED WINNER':'WINNER'}</Text><Text style={s.winnerName}>{p.name}</Text></View><View style={s.winnerScoreBlock}><Text style={s.completeKicker}>POINTS</Text><Text accessibilityLabel={`${view.totals[p.id]} points`} style={s.winnerScore}>{view.totals[p.id]}</Text></View></View>)}<Text style={s.completeCopy}>{game.winner==='high'?'Highest score wins.':'Lowest score wins.'} Your final scores are saved.</Text><Button secondary disabled={!game.entries.length||(!!session&&!rulesEnabled)} title="Undo last score" onPress={()=>void action({action:"undo"})}/></View>}{finalRoundMessage(game)?<Text accessibilityRole="alert" style={s.kicker}>{finalRoundMessage(game)}</Text>:null}<Standings view={view}/>{!game.finished&&<View style={s.scores}>{displayPlayers.map((p,index)=><DraggablePlayer style={[s.playerCard,reordering&&s.reorderCard,dragTarget===index&&s.dropTarget]} key={p.id} index={index} items={playerCards} onDraggingChange={setDraggingPlayer} onTargetChange={setDragTarget}><View style={[s.score,reordering&&s.reorderScore,p.id===game.next&&!game.finished&&s.current]}><View style={s.tileRow}><Pressable accessibilityRole="button" accessibilityLabel={`Select ${p.name} for scoring`} accessibilityState={{selected:p.id===game.next}} disabled={busy||reordering||game.finished||p.id===game.next||!!remainingTargetPlayers(game)?.every(r=>r.id!==p.id)} onPress={()=>void action({action:'select',playerId:p.id})} style={s.tileHeader}><View style={{flex:1,gap:4}}>{(view.winnerIds.includes(p.id)||p.id===game.next&&!game.finished)&&<Text style={s.kicker}>{view.winnerIds.includes(p.id)?'WINNER':'PLAYING NOW'}</Text>}<Text style={s.player}>{p.name}</Text></View><Text style={s.total}>{view.totals[p.id]}</Text></Pressable>{!game.finished&&!reordering&&game.playStyle!=='free'&&p.id!==game.next&&<Pressable accessibilityRole="button" accessibilityLabel={`No points for ${p.name}; available on their turn`} disabled style={[s.noPoints,s.disabled]}><Text style={s.noPointsText}>No Points</Text></Pressable>}</View>{!game.finished&&p.id===game.next&&!reordering&&<InlineScoreEntry scoringGuide={presets.find(p=>p.id===game.presetId)?.scoringGuide} guideExpanded={guideExpanded} onToggleGuide={()=>setGuideExpanded(open=>!open)} value={points} onChange={setPoints} busy={busy} totalMode={game.scoreMode==='total'} turnLabel={game.playStyle==='free'?'Scoring for this player':`Turn ${game.entries.length+1}`} showNoPoints noPointsLabel={game.playStyle==='free'?'No points; record no change for this player':'No points; finish turn and advance to the next player'} error={error} onLayout={revealScoreEntry} onNoPoints={()=>void noPoints()} onSubmit={()=>{if(!/^-?\d+$/.test(points)){setError('Enter whole-number points.');return}void action({action:'score',points:Number(points),...(game.playStyle==='free'?{playerId:game.next}:{})})}}/>}</View>{reordering&&<View style={s.moveControls}><DragHandle index={index} label={p.name} items={playerCards} onMove={movePlayer} disabled={busy}/></View>}</DraggablePlayer>)}</View>}{!game.finished&&<View style={{flexDirection:'row',justifyContent:'flex-end',alignItems:'center',flexWrap:'wrap',columnGap:24,rowGap:4}}><Pressable accessibilityRole="button" accessibilityState={{selected:reordering,disabled:busy||!layoutsLoaded}} disabled={busy||!layoutsLoaded} style={{minHeight:44,justifyContent:'center',paddingHorizontal:4}} onPress={()=>reordering?setReordering(false):void saveLayout(displayPlayers.map(p=>p.id),true)}><Text style={s.noPointsText}>{reordering?'Done reordering':'Reorder players'}</Text></Pressable><Pressable accessibilityRole="button" disabled={busy||reordering||!game.entries.length} accessibilityState={{disabled:busy||reordering||!game.entries.length}} style={{minHeight:44,justifyContent:'center',paddingHorizontal:4,opacity:busy||reordering||!game.entries.length?0.5:1}} onPress={()=>void action({action:'undo'})}><Text style={s.noPointsText}>Undo last score</Text></Pressable></View>}{!game.finished&&<Button secondary title="Finish game" onPress={()=>void action({action:'finish'})}/>}<View style={s.panel}><Text style={s.subheading}>{game.scoreMode==='total'?'Total history':'Score history'}</Text><View style={s.historyHeading}><Text style={s.turnNumber}>Turn #</Text><Text style={[s.copy,{flex:1}]}>Player</Text><Text style={s.copy}>{game.scoreMode==='total'?'Total':'Points'}</Text></View>{[...game.entries].reverse().map((e,index)=><Pressable key={e.id} accessibilityRole="button" disabled={busy} style={s.history} onPress={()=>{setEdit(e.id);setEditPoints(String(e.points))}}><Text style={s.turnNumber} accessibilityLabel={`Turn ${game.entries.length-index}`}>{game.entries.length-index}</Text><Text style={[s.copy,{flex:1}]}>{game.players.find(p=>p.id===e.playerId)?.name}</Text><Text style={s.player}>{e.points}   ›</Text></Pressable>)}</View><Text style={s.copy}>{game.deviceOnly?'Saved on this device. Add it to your account from Home when account saving is available.':session?'Pull to refresh changes from another device.':'Guest · saved on this device'}</Text></>:creating?<><Button secondary title="‹ Home" onPress={()=>{setCreating(false);setError('')}}/><Text accessibilityRole="header" style={s.heading}>New game</Text><GameSetup onManagePlayers={()=>setSettingsOpen(true)} onDraggingChange={setDraggingPlayer} presetId={presetId} onPresetChange={choosePreset} name={name} onNameChange={setName} players={names} onPlayersChange={setNames} settings={settings} onSettingsChange={setSettings} busy={busy} onSubmit={()=>void create()}/></>:<><View style={s.homeIntro}><Text accessibilityRole="header" style={s.homeTitle}>{"Always keep score."}</Text><Button title="+ New Game" onPress={newGame}/></View><View style={s.sectionTitle}><Text accessibilityRole="header" style={s.subheading}>In Progress</Text>{games.some(g=>!g.finished)&&<View style={[s.countBadge,s.activeCountBadge]}><Text style={s.activeCountText}>{games.filter(g=>!g.finished).length}</Text></View>}</View>{games.filter(g=>!g.finished).map(savedGame)}{!games.some(g=>!g.finished)&&<View style={s.panel}><Text style={s.player}>{games.length?'No games in progress.':'Your games will appear here.'}</Text><Text style={s.copy}>{games.length?"Start a new game whenever you're ready.":'Start your first game—scores save automatically.'}</Text></View>}<View style={s.completedSection}><Pressable accessibilityRole="button" accessibilityState={{expanded:completedOpen}} disabled={busy} style={s.completedToggle} onPress={()=>setCompletedOpen(!completedOpen)}><View style={s.sectionTitle}><Text style={s.player}>Completed Games</Text>{games.some(g=>g.finished)&&<View style={s.countBadge}><Text style={s.countText}>{games.filter(g=>g.finished).length}</Text></View>}</View><Text style={s.player}>{completedOpen?'−':'+'}</Text></Pressable>{completedOpen&&<View style={{gap:12}}>{games.filter(g=>g.finished).map(savedGame)}{!games.some(g=>g.finished)&&<Text style={s.copy}>Finished games will appear here.</Text>}</View>}</View>{session&&localCount>0&&<Button secondary title={`Add ${localCount} local games to my account`} onPress={()=>void importLocal()}/>}{session&&blockedLocalCount>0&&!notice&&<Text style={s.copy}>{blockedLocalCount} {blockedLocalCount===1?'local game uses':'local games use'} scoring rules that aren't available for account games yet. Saved on this device.</Text>}<Text style={s.copy}>{session?'Saved to your account. Pull to sync updates from other devices.':'Saved on this device. Sign in for backup and access across devices.'}</Text></>}<PolicyLinks/></ScrollView></KeyboardAvoidingView></SafeAreaView>{editingGame&&<EditGame game={editingGame} busy={busy} error={error} onClose={()=>{setEditingGame(null);setError('')}} onSave={saveGameRules}/>}<Modal visible={!!edit} transparent animationType="fade" onRequestClose={()=>setEdit(null)}><View style={s.overlay}><View style={s.dialog}>{error?<Text accessibilityRole="alert" style={s.error}>{error}</Text>:null}<Text style={s.subheading}>{game?.scoreMode==='total'?'Edit recorded total':'Edit score entry'}</Text><View style={{flexDirection:'row',gap:8,alignItems:'stretch'}}><TextInput placeholderTextColor={s.copy.color} accessibilityLabel="Corrected points" value={editPoints} onChangeText={value=>{if(isScoreInput(value))setEditPoints(value)}} keyboardType="number-pad" style={[s.input,{flex:1}]}/><Pressable accessibilityRole="button" accessibilityLabel="Toggle edited score between positive and negative" disabled={busy} onPress={()=>setEditPoints(editPoints.startsWith('-')?editPoints.slice(1):'-'+editPoints)} style={[s.secondary,{padding:14,borderRadius:10,justifyContent:'center',minWidth:50,alignItems:'center'}]}><Text style={[s.buttonText,{color:buttonColors(dark,true).text}]}>±</Text></Pressable></View><Button disabled={!/^-?\d+$/.test(editPoints)} title="Save change" onPress={()=>void action({action:'edit',entryId:edit!,points:Number(editPoints)})}/><Button secondary title="Cancel" onPress={()=>setEdit(null)}/></View></View></Modal><Settings visible={settingsOpen} onClose={()=>setSettingsOpen(false)}/><AccountModal deviceSaves={pilot.deviceSaves} onBeforeDelete={pilot.enabled?async()=>{accountBarrier.current=true;setView(null);setEditingGame(null);setGames(previous=>previous.filter(g=>g.deviceOnly));activityRevision.current++;connection.reset(null);const owner=identityRevision.current,status=await cloudApi.account();if(owner!==identityRevision.current)throw new Error('Account changed. Retry from Account.');await pilot.ref.current!.beginDeletion(status.profileId)}:undefined} working={busy} onSync={async()=>{const ok=await refresh();if(!ok)throw new Error('Account sync is unavailable. Use Reconnect to try again.');return true}} visible={accountOpen} api={cloudApi} onClose={()=>setAccountOpen(false)} onDeleted={async()=>{await clearFrequentPlayersAccount();setAccountOpen(false);setEdit(null);setPoints('');setError('');await logout()}}/></View>
}
const baseStyles=StyleSheet.create({completeCard:{backgroundColor:'white',borderWidth:1,borderColor:'#2b8388',borderRadius:20,padding:20,gap:20},completeHeader:{flexDirection:'row',alignItems:'center',gap:14},completeBadge:{width:44,height:44,borderRadius:22,backgroundColor:'#edf8f5',alignItems:'center',justifyContent:'center'},completeBadgeText:{fontSize:26,fontWeight:'800',color:'#226b73'},completeKicker:{fontSize:12,fontWeight:'800',letterSpacing:1,color:'#226b73'},completeTitle:{fontSize:24,lineHeight:30,fontWeight:'700',color:'#17252a'},winnerRow:{flexDirection:'row',flexWrap:'wrap',alignItems:'flex-start',gap:16,paddingVertical:16,borderTopWidth:1,borderColor:'#dce5e7'},winnerName:{fontSize:32,lineHeight:39,fontWeight:'800',color:'#17252a'},winnerScoreBlock:{alignItems:'center',justifyContent:'center',minWidth:88,maxWidth:'100%',gap:5},winnerScore:{fontSize:36,lineHeight:44,fontWeight:'800',fontVariant:['tabular-nums'],textAlign:'center',color:'#226b73'},completeCopy:{fontSize:14,lineHeight:21,color:'#62777d'},safe:{flex:1,backgroundColor:'#f4f7f8'},body:{padding:18,gap:16,paddingBottom:60},panel:{backgroundColor:'white',borderWidth:1,borderColor:'#dce5e7',borderRadius:16,padding:20,gap:12},heading:{fontSize:32,fontWeight:'800',color:'#17252a',letterSpacing:-1},subheading:{fontSize:22,fontWeight:'700',color:'#17252a'},kicker:{fontSize:12,fontWeight:'800',color:'#417b80',letterSpacing:1},copy:{fontSize:14,color:'#62777d',lineHeight:21},label:{fontSize:14,fontWeight:'700',color:'#385a61'},input:{borderWidth:1,borderColor:'#ccdadd',borderRadius:10,padding:14,fontSize:18,backgroundColor:'white',color:'#17252a',minHeight:50},button:{backgroundColor:'#d4e965',borderRadius:10,padding:15,alignItems:'center',minHeight:48},secondary:{backgroundColor:'#e8f0f1'},disabled:{opacity:.5},buttonText:{fontSize:16,fontWeight:'700',color:'#123f4a'},scores:{gap:10},layoutActions:{flexDirection:'row',gap:8},playerCard:{width:'100%'},reorderCard:{flexDirection:'row',alignItems:'center',gap:8},reorderScore:{flex:1,width:undefined},moveControls:{flexShrink:0,width:48,alignItems:'center',justifyContent:'center'},moveButton:{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center',backgroundColor:'#e8f0f1',borderRadius:10},noPoints:{minHeight:48,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'#ccdadd',borderRadius:10,backgroundColor:'#e8f0f1',paddingHorizontal:10},noPointsText:{fontSize:14,fontWeight:'700',color:'#226b73'},tileRow:{flexDirection:'row',gap:10,alignItems:'center'},tileHeader:{flex:1,flexDirection:'row',alignItems:'center',gap:12,minHeight:48},gameHeading:{gap:8},gameRules:{gap:4},gameRuleTitle:{fontSize:15,lineHeight:22,fontWeight:'600',color:'#226b73'},gameRuleDescription:{fontSize:15,lineHeight:22,color:'#17252a'},score:{width:'100%',backgroundColor:'white',padding:14,borderWidth:1,borderColor:'#dce5e7',borderRadius:14},current:{borderWidth:2,borderColor:'#2b8388'},total:{fontSize:32,fontWeight:'800',color:'#17252a'},player:{fontSize:16,fontWeight:'700',color:'#17252a'},dropTarget:{backgroundColor:'#edf8f5',borderRadius:14,opacity:.55},sectionTitle:{flexDirection:'row',alignItems:'center',gap:9},countBadge:{minWidth:26,height:24,paddingHorizontal:8,borderRadius:12,alignItems:'center',justifyContent:'center',backgroundColor:'#e8f0f1'},activeCountBadge:{backgroundColor:'#edf8f5'},countText:{fontSize:12,fontWeight:'700',color:'#62777d',fontVariant:['tabular-nums']},activeCountText:{fontSize:12,fontWeight:'700',color:'#226b73',fontVariant:['tabular-nums']},homeIntro:{gap:22,marginVertical:12},homeTitle:{fontSize:26,fontWeight:'800',lineHeight:31,color:'#17252a',letterSpacing:-.7},gameListCard:{backgroundColor:'white',borderWidth:1,borderColor:'#dce5e7',borderRadius:14,padding:18,flexDirection:'row',alignItems:'center',gap:12},gameMeta:{fontSize:12,lineHeight:18,color:'#62777d'},resume:{fontSize:14,fontWeight:'700',color:'#226b73'},completedSection:{borderTopWidth:1,borderColor:'#dce5e7',marginTop:8,paddingTop:8,gap:12},completedToggle:{minHeight:48,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},turnNumber:{width:46,fontSize:14,fontWeight:'700',color:'#62777d'},historyHeading:{flexDirection:'row',alignItems:'center',gap:12},history:{flexDirection:'row',gap:12,paddingVertical:14,borderTopWidth:1,borderColor:'#e4ebec'},error:{color:'#ad3838',fontSize:14},overlay:{flex:1,backgroundColor:'#0008',justifyContent:'center',padding:24},dialog:{backgroundColor:'white',borderRadius:18,padding:24,gap:16}});
