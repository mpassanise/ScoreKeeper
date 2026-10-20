import {useEffect,useRef} from 'react';
import {AppState} from 'react-native';
import * as Network from 'expo-network';
import {createAutomaticSync,type AutomaticResult} from '../shared/repository/automatic-sync';
/** Connectivity is a scheduling hint, never proof of API reachability or auth.
 * Unknown/failed monitoring falls back to bounded requests and AppState. */
export function useAutomaticSync(enabled:boolean,key:string|null,run:(signal:AbortSignal,refresh:boolean)=>Promise<AutomaticResult>){
 const latest=useRef({key,run});latest.current={key,run};
 const controller=useRef<ReturnType<typeof createAutomaticSync>|null>(null);
 useEffect(()=>{
  if(!enabled||!key)return;
  const value=createAutomaticSync({enabled:true,run:(signal,refresh)=>latest.current.key===key?latest.current.run(signal,refresh):Promise.resolve('cancelled')});controller.current=value;
  let closed=false,foreground=AppState.currentState==='active',online=true,revision=0;
  const active=()=>value.setActive(foreground&&online);
  const observe=(state:Network.NetworkState)=>{
   if(closed)return;
   // Do not interpret missing/unknown reachability as disconnected.
   const next=state.isConnected===false||state.isInternetReachable===false?false:
    state.isConnected===true||state.isInternetReachable===true?true:online;
   if(next!==online){online=next;active()}
  };
  active();
  const sub=AppState.addEventListener('change',state=>{if(!closed){foreground=state==='active';active()}});
  let network:ReturnType<typeof Network.addNetworkStateListener>|undefined;
  // Subscribe before reading. An older asynchronous snapshot must not overwrite
  // an event (or affect an unmounted/account-replaced controller).
  try{network=Network.addNetworkStateListener(state=>{revision++;observe(state)})}catch{/* AppState/manual reconnect remain usable. */}
  const initial=revision;
  try{void Network.getNetworkStateAsync().then(state=>{if(revision===initial)observe(state)},()=>{})}catch{/* Monitoring cannot break local scoring. */}
  return()=>{closed=true;if(controller.current===value)controller.current=null;value.close();sub.remove();network?.remove()};
 },[enabled,key]);
 return {request:()=>controller.current?.request(),recovered:()=>controller.current?.recovered()};
}
