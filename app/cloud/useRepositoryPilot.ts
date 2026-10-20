"use client";
import {useEffect,useRef,useState} from 'react';
import {createRepositoryPilot,type RepositoryPilot,type DeviceSaveReview} from '../../shared/repository/pilot';
import {openConfirmedGames} from '../../shared/repository/indexeddb-confirmed-games';
import {guestKey} from '../../shared/local-games';
const enabled=process.env.NEXT_PUBLIC_CONFIRMED_CACHE_PILOT==='true';
const recovery=process.env.NEXT_PUBLIC_GAME_SCREEN_PILOT==='true'&&process.env.NEXT_PUBLIC_GAME_RECOVERY_PILOT==='true';
const resolution=recovery&&process.env.NEXT_PUBLIC_GAME_COLLISION_RESOLUTION_PILOT==='true';
const delivery=recovery&&process.env.NEXT_PUBLIC_GAME_DELIVERY_PILOT==='true';
const staging=process.env.NEXT_PUBLIC_LEGACY_STAGING_PILOT==='true';
const channelName='scorekeeper-repository-invalidated';
export function useRepositoryPilot(onInvalidated:()=>void){
 const ref=useRef<RepositoryPilot|null>(null),callback=useRef(onInvalidated);callback.current=onInvalidated;
 const [review,setReview]=useState({busy:false,message:''});
 useEffect(()=>{
  if(!enabled)return;
  const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel(channelName);
  const pilot=createRepositoryPilot({enabled:true,recoveryEnabled:recovery,collisionResolutionEnabled:resolution,deliveryEnabled:delivery,open:()=>openConfirmedGames(indexedDB),onInvalidated:()=>callback.current(),publish:()=>{channel?.postMessage('changed');try{localStorage.setItem(channelName,crypto.randomUUID())}catch{/* Focus recheck remains available. */}}});ref.current=pilot;
  const recheck=()=>{void pilot.recheck().catch(error=>{if(ref.current===pilot&&(error as {code?:string})?.code!=='STALE_ACCOUNT')callback.current()})};
  const storage=(e:StorageEvent)=>{if(e.key===channelName)recheck()};
  channel?.addEventListener('message',recheck);window.addEventListener('storage',storage);window.addEventListener('focus',recheck);
  return()=>{ref.current=null;channel?.close();window.removeEventListener('storage',storage);window.removeEventListener('focus',recheck);void pilot.close()};
 },[]);
 const deviceSaves:DeviceSaveReview|undefined=enabled&&staging?{...review,onReview:()=>{if(review.busy)return;const pilot=ref.current;if(!pilot)return;setReview({busy:true,message:''});void(async()=>{
  try{const raw=localStorage.getItem(guestKey);if(raw===null){setReview({busy:false,message:'No device games to review.'});return}const journal=await pilot.stage(raw);if(ref.current!==pilot)return;setReview({busy:false,message:journal.status==='validated'?`${journal.versions[0].count} device games checked. Originals kept; nothing uploaded.`:'Device saves need review. Every source copy has been kept; nothing uploaded.'})}catch{if(ref.current===pilot)setReview({busy:false,message:'Could not check device saves. Originals have been kept. Try again.'})}
 })()}}:undefined;
 return {ref,enabled,deviceSaves};
}
