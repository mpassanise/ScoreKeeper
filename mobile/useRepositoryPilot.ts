import {useEffect,useRef,useState} from 'react';
import {AppState} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {createRepositoryPilot,type RepositoryPilot,type DeviceSaveReview} from '../shared/repository/pilot';
import {openSQLiteConfirmedGames} from '../shared/repository/sqlite-confirmed-games';
import {guestKey} from '../shared/local-games';
const enabled=process.env.EXPO_PUBLIC_CONFIRMED_CACHE_PILOT==='true';
const staging=process.env.EXPO_PUBLIC_LEGACY_STAGING_PILOT==='true';
export function useRepositoryPilot(onInvalidated:()=>void){
 const ref=useRef<RepositoryPilot|null>(null),callback=useRef(onInvalidated);callback.current=onInvalidated;
 const [review,setReview]=useState({busy:false,message:''});
 useEffect(()=>{
  if(!enabled)return;
  const pilot=createRepositoryPilot({enabled:true,onInvalidated:()=>callback.current(),open:async()=>{
   // Only load the native module inside the enabled pilot. Enabling requires a new binary.
   const SQLite=await import('expo-sqlite');return openSQLiteConfirmedGames(await SQLite.openDatabaseAsync('scorekeeper-repository-v1.db'));
  }});ref.current=pilot;
  const sub=AppState.addEventListener('change',state=>{if(state==='active')void pilot.recheck().catch(error=>{if(ref.current===pilot&&(error as {code?:string})?.code!=='STALE_ACCOUNT')callback.current()})});
  return()=>{ref.current=null;sub.remove();void pilot.close()};
 },[]);
 const deviceSaves:DeviceSaveReview|undefined=enabled&&staging?{...review,onReview:()=>{if(review.busy)return;const pilot=ref.current;if(!pilot)return;setReview({busy:true,message:''});void(async()=>{
  try{const raw=await AsyncStorage.getItem(guestKey);if(raw===null){setReview({busy:false,message:'No device games to review.'});return}const journal=await pilot.stage(raw);if(ref.current!==pilot)return;setReview({busy:false,message:journal.status==='validated'?`${journal.versions[0].count} device games checked. Originals kept; nothing uploaded.`:'Device saves need review. Every source copy has been kept; nothing uploaded.'})}catch{if(ref.current===pilot)setReview({busy:false,message:'Could not check device saves. Originals have been kept. Try again.'})}
 })()}}:undefined;
 return {ref,enabled,deviceSaves};
}
