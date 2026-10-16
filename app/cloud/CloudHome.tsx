"use client";
import {setFrequentPlayersAccount,syncFrequentPlayers,clearFrequentPlayersAccount} from "./useFrequentPlayers";
import {startGame,mergeDeviceGames} from '../../shared/game-start';
import {finalRoundMessage,remainingTargetPlayers} from "../../shared/target-ending";
import DragHandle from './DragHandle';
import {isScoreInput} from "../../shared/score-input";

import polish from "./WebPolish.module.css";
import {Trophy,Trash2} from "lucide-react";
import {useEffect,useRef,useState,useSyncExternalStore} from "react";
import {createConnectionStatus,isConnectionFailure} from "../../shared/connection-status";
import {createGameListCache} from "../../shared/game-list-cache";
import ConnectionStatus from "./ConnectionStatus";
import {ScorekeeperApi,ApiError,type Game,type GameView,type GameSummary,type Action} from "../../shared/api";
import {auth,cloudEnabled,cloudConfig,signIn,signOut,token} from "./auth";
import {Dialog,DialogContent,DialogTitle} from "@/components/ui/dialog";
import HeaderMenu from "./HeaderMenu";
import SettingsDrawer from "./SettingsDrawer";
import AccountDialog from "./AccountDialog";
const cloudApi=new ScorekeeperApi(cloudConfig.api||"http://localhost:7071/api",token);
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
 const [editingGame,setEditingGame]=useState<Game|null>(null);
 const [deleting,setDeleting]=useState<GameSummary|null>(null);
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
 const [connection]=useState(()=>createConnectionStatus(15000,value=>console.warn('[Scorekeeper connection]',value)));
 const connectionState=useSyncExternalStore(connection.subscribe,connection.getSnapshot,connection.getSnapshot);
 const context=useRef({view,creating,points,edit,editingGame,reordering});context.current={view,creating,points,edit,editingGame,reordering};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;identity.current=null;connection.reset(null)}},[connection]);
 async function reconnectSignIn(){
  if(locked.current)return;
  try{
   const draft:ReconnectDraft={identity:identity.current!,gameId:view?.game.id,deviceOnly:view?.game.deviceOnly,gameVersion:view?.game.version,next:view?.game.next,points,creating,name,names,settings,presetId};
   sessionStorage.setItem(reconnectDraftKey,JSON.stringify(draft));
   await signIn();
  }catch(e){setError(e instanceof Error?e.message:'Could not start sign-in. Your input has been kept.')}
 }
 async function logout(){identity.current=null;activity.current++;connection.reset(null);await setFrequentPlayersAccount(null,null);await signOut()}
 async function reconnect(){if(connectionState.status==='sign-in')await reconnectSignIn();else await syncGames()}
 async function loadCloudGames(){const locals=await localApi.list();setGames(previous=>mergeDeviceGames(previous.filter(g=>!g.deviceOnly),locals));const saved=await cloudApi.list();await connectPlayers();const pending=await pendingImports(localApi,cloudApi,saved);setGames(mergeDeviceGames(saved,await localApi.list()));setLocalCount(pending.length)}
 async function connectPlayers(){const identity=(await auth()).getActiveAccount()?.homeAccountId;if(!identity)return;const status=await cloudApi.account();if((await auth()).getActiveAccount()?.homeAccountId!==identity)return;if(!status.profileId)throw new Error('Frequent-player sync requires the API update. Local players are safe.');const user=(await auth()).getActiveAccount();if(!user)return;try{localStorage.setItem('scorekeeper-player-profile:'+user.homeAccountId,status.profileId)}catch{}await setFrequentPlayersAccount(status.profileId,cloudApi)}
 async function loadGames(){if(account){try{await loadCloudGames()}catch(e){setNotice('Account games could not be refreshed. Games saved on this device are available.'+(e instanceof Error?' '+e.message:''))}}else{setGames(await localApi.list());setLocalCount(0)}}
 async function run(work:()=>Promise<void>){if(locked.current)return;locked.current=true;activity.current++;setBusy(true);setError("");setNotice("");try{await work()}catch(e){if(e instanceof ApiError&&e.status===409&&view){try{setView(await api.get(view.game.id))}catch{}}if(isConnectionFailure(e))connection.fail(e);setError(e instanceof Error?e.message:"Unable to connect.")}finally{locked.current=false;setBusy(false)}}
 useEffect(()=>{let active=true;void (async()=>{
  const locals=await localApi.list();if(!active)return;
  if(!cloudEnabled){setGuest(true);setGames(locals);setLoaded(true);return}
  const instance=await auth(),user=instance.getActiveAccount();if(!active)return;
  if(!user){await setFrequentPlayersAccount(null,null);if(active){setGuest(true);setGames(locals);setLoaded(true)}return}
  identity.current=user.homeAccountId;connection.reset(user.homeAccountId);
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
 async function syncGames(){
  const owner=identity.current;if(!owner||locked.current)return false;
  connection.reset(owner);
  return connection.connect(async(isCurrent,signal,step)=>{
   const valid=()=>mounted.current&&isCurrent()&&identity.current===owner;
   const currentContext=context.current,revision=activity.current,draft=restoreGame.current;
   const readApi=new ScorekeeperApi(cloudConfig.api||"http://localhost:7071/api",()=>step('authentication',token),{signal,readAttempts:1});
   const selected=currentContext.view&&!currentContext.view.game.deviceOnly?currentContext.view.game.id:(!currentContext.view&&draft?.identity===owner?draft.gameId:undefined);
   const [saved,status,latest]=await Promise.all([step('games',()=>readApi.list()),step('account',()=>readApi.account()),selected?(draft?.deviceOnly&&!currentContext.view?step('device',()=>localApi.get(selected)):step('game',()=>readApi.get(selected))):Promise.resolve(null)]);
   if(!valid())return;
   if(status.deletionStatus)throw new Error('Account deletion is pending. Sync is unavailable.');
   if((await auth()).getActiveAccount()?.homeAccountId!==owner){identity.current=null;connection.reset(null);return}
   if(!valid())return;
   setRulesEnabled((status.scoringRulesVersion||0)>=2);
   const locals=await step('device',()=>localApi.list());if(!valid())return;
   if(revision===activity.current){
    setGames(mergeDeviceGames(saved,locals));
    if(latest&&context.current.view===currentContext.view&&!context.current.creating&&!context.current.points&&!context.current.edit&&!context.current.editingGame&&!context.current.reordering&&(currentContext.view?latest.game.version>=currentContext.view.game.version:!!draft)){
     setView(latest);
     if(draft){if(latest.game.version===draft.gameVersion&&latest.game.next===draft.next){setPoints(draft.points);sessionStorage.removeItem(reconnectDraftKey)}else if(draft.points)setNotice('The game changed while you signed in. Your unsent entry of '+draft.points+' was kept in this tab. Review the active player before entering it again.');restoreGame.current=null}
    }
   }
   void listCache.write(owner,saved).catch(()=>{});
   if(status.profileId){await step('players',()=>setFrequentPlayersAccount(status.profileId!,cloudApi));if(!valid())return;await step('players',()=>syncFrequentPlayers())}
   const pending=await step('imports',()=>pendingImports(localApi,readApi,saved));if(!valid())return;setLocalCount(pending.length);
   const user=(await auth()).getActiveAccount();if(valid()&&user?.homeAccountId===owner&&status.profileId)try{localStorage.setItem('scorekeeper-player-profile:'+owner,status.profileId)}catch{}
  });
 }

 async function enterGuest(){await run(async()=>{setGames(await localApi.list());setView(null);setGuest(true)})}

 useEffect(()=>{if(loaded&&guest&&!account){if(view)localStorage.setItem("scorekeeper-guest-active",view.game.id);else localStorage.removeItem("scorekeeper-guest-active")}},[view,loaded,guest,account]);
 function choosePreset(id:PresetId){setPresetId(id);if(id==="scrabble")setName("Scrabble");else if(id==="phase10")setName("Phase 10");setError("")}
 const game=view?.game;
 async function noPoints(){if(!game||!view||game.finished||busy||reordering)return;await action({action:'score',points:game.scoreMode==='total'?view.totals[game.next]:0,...(game.playStyle==='free'?{playerId:game.next}:{})})}
 async function action(a:Action){if(!game)return;await run(async()=>{setView(await api.act(game,a));if(a.action==="score")setPoints("");if(a.action==="edit")setEdit(null)})}
 async function saveGameRules(a:Action){if(!editingGame)return;await run(async()=>{const updated=await(account&&!editingGame.deviceOnly?cloudApi:localApi).act(editingGame,a);setView(updated);setGames(previous=>previous.map(g=>g.id===updated.game.id?{...updated.game,turnCount:updated.game.entries.length}:g));setEditingGame(null)})}
 async function create(){await run(async()=>{const result=await startGame({local:localApi,cloud:cloudApi,signedIn:!!account,name,players:names,winner,rules,uuid:()=>crypto.randomUUID()});setView(result.view);setCreating(false);setGames(previous=>[{...result.view.game,turnCount:result.view.game.entries.length},...previous.filter(g=>g.id!==result.view.game.id)]);setNotice(result.message)})}

 async function importLocal(){await run(async()=>{const status=await cloudApi.account();const supported=(status.scoringRulesVersion||0)>=2;setRulesEnabled(supported);const result=await importPendingGames(localApi,cloudApi,supported,setLocalCount,(status.scoringRulesVersion||0)>=3);await loadCloudGames();setNotice(importSummary(result))})}

 useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem("scorekeeper-player-order-v2")||"{}");if(saved&&typeof saved==="object"&&!Array.isArray(saved))setPlayerOrders(Object.fromEntries(Object.entries(saved).filter((entry):entry is [string,string[]]=>Array.isArray(entry[1])&&entry[1].every(id=>typeof id==="string"))))}catch{}},[]);
 useEffect(()=>{setReordering(false)},[game?.id,game?.finished]);
 const savedOrder=game?playerOrders[game.id]:undefined;
 const displayPlayers=game?(savedOrder?[...new Set(savedOrder)].map(id=>game.players.find(p=>p.id===id)).filter((p):p is NonNullable<typeof p>=>!!p).concat(game.players.filter(p=>!savedOrder.includes(p.id))):game.players):[];
 function saveLayout(ids:string[]){if(!game)return false;const updated={...playerOrders,[game.id]:ids};try{localStorage.setItem("scorekeeper-player-order-v2",JSON.stringify(updated));setPlayerOrders(updated);return true}catch{setError("Could not save player positions. Please check browser storage.");return false}}
 function movePlayer(index:number,target:number){const ids=displayPlayers.map(p=>p.id);if(index<0||target<0||index>=ids.length||target>=ids.length||index===target)return;const [id]=ids.splice(index,1);ids.splice(target,0,id);saveLayout(ids)}
 function newGame(){activity.current++;restoreGame.current=null;setName("");setNames(["",""]);setSettings(defaultSettings);setPresetId("custom");setPoints("");setError("");setNotice("");setView(null);setCreating(true)}
 async function openGame(id:string){await run(async()=>{setView(await ((games.find(g=>g.id===id)?.deviceOnly)?localApi:account?cloudApi:localApi).get(id));setPoints("");setCreating(false)})}
 async function deleteGame(g:GameSummary){await run(async()=>{const local=!account||g.deviceOnly;await (local?localApi:cloudApi).deleteGame(g);setGames(previous=>previous.filter(item=>item.id!==g.id));setDeleting(null);if(!local){try{await localApi.forget(g.id)}catch{setNotice('Game deleted from your account. A local copy could not be removed, but cannot be imported again.')}}setLocalCount(previous=>local?Math.max(0,previous-1):previous)})}
 function savedGame(g:GameSummary){return <div key={g.id} className="game-list-row card"><button className="game-list-card" disabled={busy} onClick={()=>void openGame(g.id)}><span className="game-list-content"><strong>{g.name}</strong><span className="game-list-players">{g.players.map(p=>p.name).join(" · ")}</span><small>{g.deviceOnly?"On this device · ":""}{g.turnCount} {g.turnCount===1?"entry":"entries"}{formatGameTime(g.updated)?` · Updated ${formatGameTime(g.updated)}`:""}</small></span><span className="game-list-action">{g.finished?"View":"Resume"} ›</span></button>{!g.finished&&<button type="button" className="game-delete" disabled={busy} aria-label={`Delete ${g.name}`} title="Delete game" onClick={()=>setDeleting(g)}><Trash2 size={18} aria-hidden="true"/></button>}</div>}

 useEffect(()=>{window.scrollTo(0,0);document.getElementById("screen-title")?.focus()},[creating,game?.id]);
 function startReordering(){if(saveLayout(displayPlayers.map(p=>p.id)))setReordering(true)}
 return <main className={polish.app}><header className="top"><button type="button" className="brand brand-home" aria-label="Scorekeeper home" disabled={busy} onClick={()=>void run(async()=>{setView(null);setCreating(false);setEdit(null)})}><img className="brand-icon" src="/scorekeeper-logo.png" width="40" height="40" alt=""/>Scorekeeper</button><div className="header-actions">{!account&&cloudEnabled&&<button className="header-sign-in" disabled={busy} onClick={()=>void run(signIn)}>Sign in</button>}<HeaderMenu email={account} signedIn={!!account} busy={busy} onSettings={()=>setSettingsOpen(true)} onAccount={()=>setAccountOpen(true)} onSignOut={()=>void logout()}/></div></header><div className="wrap">{account&&<ConnectionStatus state={connectionState} disabled={busy} onReconnect={()=>void reconnect()} onSignIn={()=>void reconnectSignIn()}/ >}{error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status" className="muted">{notice}</p>}{!loaded?<p>Loading…</p>:<>{!account&&<div className="backrow"><span className="muted">Guest · saved on this device</span></div>}{game&&view?<><div className="title"><div className="game-heading"><button className="link" onClick={()=>void run(async()=>{setView(null);setCreating(false)})}>‹ Home</button><h1>{game.name}</h1><div className="game-description"><p className="game-winner-rule">{game.winner==="high"?"Highest":"Lowest"} score wins</p><p className="game-scoring-rules">{rulesLabel(game)}</p></div></div><div className="game-top-actions">{canEditGame(game)&&<button disabled={busy} className="outline" onClick={()=>{setError("");setReordering(false);setEditingGame(game)}}>Edit game</button>}<button disabled={busy} className="outline" onClick={()=>void action({action:game.finished?"resume":"finish"})}>{game.finished?"Resume":"Finish game"}</button>{game.finished&&<button disabled={busy} className="primary" onClick={newGame}>+ New Game</button>}</div></div>{game.deviceOnly&&<p role="status" className="muted">Saved on this device. Add it to your account from Home when account saving is available.</p>}{finalRoundMessage(game)&&<p role="status" className="eyebrow">{finalRoundMessage(game)}</p>}<p className="game-time muted">{formatGameTime(game.startedAt)?<>Started <time dateTime={game.startedAt!}>{formatGameTime(game.startedAt)}</time></>:"Start time not recorded"}{game.finished&&formatGameTime(game.endedAt)?<> · Ended <time dateTime={game.endedAt!}>{formatGameTime(game.endedAt)}</time></>:null}</p>{game.finished&&<section className="card panel game-complete" aria-label="Game result"><div className="result-icon" aria-hidden="true"><Trophy size={26}/></div><div className="result-copy"><h2>{view.winnerIds.length>1?"Tie game":"Game complete"}</h2><p className="result-winner">{game.players.filter(p=>view.winnerIds.includes(p.id)).map(p=>p.name).join(" & ")}{view.winnerIds.length?(view.winnerIds.length>1?" tied!":" won!"):""}</p><p className="result-detail">{view.winnerIds.length?`${view.totals[view.winnerIds[0]]} points · ${game.winner==="high"?"Highest":"Lowest"} score wins`:"Game saved"}</p></div><button className="link" disabled={busy||!game.entries.length||(!!account&&!rulesEnabled)} onClick={()=>void action({action:"undo"})}>Undo last score</button></section>}<div className="standings-toolbar"><Standings view={view}/></div>{!game.finished&&<><ScoringGuide key={game.id} guide={presets.find(p=>p.id===game.presetId)?.scoringGuide}/>{reordering&&<p className="field-help">Drag the handles to arrange your tiles. This does not change turn order.</p>}<section className="scoreboard" data-reorder-list>{displayPlayers.map((p,index)=><div className={`card player-score inline-player ${reordering?"reordering":""} ${p.id===game.next?"active-player":""}`} key={p.id} data-reorder-index={index}><button key={p.id} disabled={busy||reordering||game.finished||!!remainingTargetPlayers(game)?.every(r=>r.id!==p.id)} className={`score ${p.id===game.next&&!game.finished?"current":""} ${game.finished?"final-score":""} ${game.finished&&view.winnerIds.includes(p.id)?"winning-score":""}`} onClick={()=>void action({action:"select",playerId:p.id})}><div className="scoretop">{view.winnerIds.includes(p.id)?"WINNER":p.id===game.next&&!game.finished?"PLAYING NOW":""}</div><strong>{view.totals[p.id]}</strong><span className="pname">{p.name}</span></button>{p.id===game.next&&!reordering&&<form className="inline-score-form" aria-label={`Score for ${p.name}`} onSubmit={e=>{e.preventDefault();if(!/^-?\d+$/.test(points)){setError("Enter whole-number points.");return}void action({action:"score",points:Number(points),...(game.playStyle==="free"?{playerId:game.next}:{})})}}><label htmlFor="cloud-points">{game.scoreMode==="total"?"Current total":"Points to add"}</label><div className="entry inline-score-actions"><input id="cloud-points" inputMode="numeric" value={points} onChange={e=>{if(isScoreInput(e.target.value))setPoints(e.target.value)}}/><button disabled={busy} className="primary">{game.scoreMode==="total"?"Set total":"Add score"}</button><button type="button" className="outline no-points-action" disabled={busy||reordering||!!remainingTargetPlayers(game)?.every(p=>p.id!==game.next)} aria-label={`No points for ${game.players.find(p=>p.id===game.next)?.name}; ${game.playStyle==="free"?"record no change to their score":"finish turn and advance to the next player"}`} title={game.playStyle==="free"?"Record no change for the selected player":"Record no change and advance to the next player"} onClick={()=>void noPoints()}>No Points</button></div></form>}{reordering&&<div className="player-move-controls"><DragHandle index={index} label={p.name} onMove={movePlayer}/></div>}</div>)}</section><div className="scoreboard-footer"><div className="scoreboard-actions" role="group" aria-label="Game controls"><button type="button" disabled={busy} className="link" aria-pressed={reordering} onClick={()=>reordering?setReordering(false):startReordering()}>{reordering?"Done reordering":"Reorder players"}</button><button type="button" disabled={busy||reordering||!game.entries.length} className="link" onClick={()=>void action({action:"undo"})}>Undo last score</button></div></div></>}<section className="card panel"><h2>{game.scoreMode==="total"?"Total history":"Score history"}</h2><div className="history"><div className="history-heading" aria-hidden="true"><span>Turn #</span><span>Player</span><span>{game.scoreMode==="total"?"Total":"Points"}</span><span></span></div>{[...game.entries].reverse().map((e,index)=><button key={e.id} disabled={busy} onClick={()=>{setEdit(e.id);setEditPoints(String(e.points))}}><span className="turn-number" aria-label={`Turn ${game.entries.length-index}`}>{game.entries.length-index}</span><span className="history-player">{game.players.find(p=>p.id===e.playerId)?.name}</span><strong>{e.points}</strong><span>Edit ›</span></button>)}</div></section></>:creating?<section className="new-game-screen"><button className="link" disabled={busy} onClick={()=>{setCreating(false);setError("")}}>‹ Home</button><h1 id="screen-title" tabIndex={-1}>New game</h1><GameSetup onManagePlayers={()=>setSettingsOpen(true)} presetId={presetId} onPresetChange={choosePreset} name={name} onNameChange={setName} players={names} onPlayersChange={setNames} settings={settings} onSettingsChange={setSettings} busy={busy} onSubmit={()=>void create()}/></section>:<section className="game-home"><div className="home-intro"><h1 id="screen-title" tabIndex={-1}>Always keep score.</h1><button className="primary new-game-button" disabled={busy} onClick={newGame}>+ New Game</button></div><section className="home-games" aria-labelledby="in-progress-title"><h2 id="in-progress-title">In Progress {games.some(g=>!g.finished)&&<span className="game-count count-active">{games.filter(g=>!g.finished).length}</span>}</h2><div className="game-list">{games.filter(g=>!g.finished).map(savedGame)}</div>{!games.some(g=>!g.finished)&&<div className="card empty-games"><p>{games.length?"No games in progress.":"Your games will appear here."}</p><span className="muted">{games.length?"Start a new game whenever you're ready.":"Start your first game—scores save automatically."}</span></div>}</section><section className="completed-games"><button className="completed-toggle" disabled={busy} aria-expanded={completedOpen} aria-controls="completed-game-list" onClick={()=>setCompletedOpen(!completedOpen)}><span>Completed Games {games.some(g=>g.finished)&&<span className="game-count count-completed">{games.filter(g=>g.finished).length}</span>}</span><span aria-hidden="true">{completedOpen?"−":"+"}</span></button>{completedOpen&&<div id="completed-game-list" className="game-list">{games.filter(g=>g.finished).map(savedGame)}{!games.some(g=>g.finished)&&<p className="muted">Finished games will appear here.</p>}</div>}</section>{account&&localCount>0&&<button disabled={busy} className="link" onClick={()=>void importLocal()}>Add {localCount} local games to my account</button>}<p className="home-storage muted">{account?"Saved to your account. Open Account to sync updates from other devices.":"Saved on this device. Sign in for backup and access across devices."}</p></section>}</> }</div>{editingGame&&<EditGame game={editingGame} busy={busy} error={error} onClose={()=>{setEditingGame(null);setError("")}} onSave={saveGameRules}/>}<Dialog open={!!deleting} onOpenChange={open=>{if(!open&&!busy)setDeleting(null)}}><DialogContent><DialogTitle>Delete {deleting?.name}?</DialogTitle><p>This permanently removes the game and its score history{account&&!deleting?.deviceOnly?" from your account and synced devices":" from this device"}. This cannot be undone.</p>{error&&<p role="alert" className="error">{error}</p>}<div className={polish.deleteDialogActions}><button className="outline" disabled={busy} onClick={()=>setDeleting(null)}>Keep game</button><button className={polish.gameDeleteConfirm} disabled={busy} onClick={()=>deleting&&void deleteGame(deleting)}>{busy?"Deleting…":"Delete game"}</button></div></DialogContent></Dialog><Dialog open={!!edit} onOpenChange={open=>{if(!open)setEdit(null)}}><DialogContent><DialogTitle>{game?.scoreMode==="total"?"Edit recorded total":"Edit score entry"}</DialogTitle>{error&&<p role="alert" className="error">{error}</p>}<input aria-label="Corrected points" value={editPoints} inputMode="numeric" onChange={e=>{if(isScoreInput(e.target.value))setEditPoints(e.target.value)}}/><button className="primary" disabled={busy||!/^[-]?\d+$/.test(editPoints)} onClick={()=>void action({action:"edit",entryId:edit!,points:Number(editPoints)})}>Save change</button></DialogContent></Dialog><SettingsDrawer open={settingsOpen} onClose={()=>{setSettingsOpen(false);onSettingsClose?.()}}/><AccountDialog canSync={!!account&&cloudEnabled&&online} working={busy||connectionState.status==='connecting'} onSync={async()=>{const ok=await syncGames();if(!ok)throw new Error('Account sync is unavailable. Use Reconnect to try again.');return true}} open={accountOpen} onClose={()=>setAccountOpen(false)} api={cloudApi} onDeleted={async()=>{identity.current=null;activity.current++;connection.reset(null);await clearFrequentPlayersAccount();setGames([]);setView(null);setEdit(null);setPoints("");await signOut()}}/></main>
}
