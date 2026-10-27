import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Network from 'expo-network';
import {AppState} from 'react-native';
import {configureScoringDevice} from '../shared/scoring-device';
configureScoringDevice({read:key=>AsyncStorage.getItem(key),write:(key,value)=>AsyncStorage.setItem(key,value)},()=>Crypto.randomUUID());
let connected=true;
export function scoringReachableHint(){return connected&&AppState.currentState==='active'}
export function scoringForeground(refresh:()=>void){
 let closed=false,revision=0;
 const observe=(state:Network.NetworkState)=>{if(closed)return;const before=connected;if(state.isConnected===false||state.isInternetReachable===false)connected=false;else if(state.isConnected===true||state.isInternetReachable===true)connected=true;if(!before&&connected)refresh()};
 const app=AppState.addEventListener('change',state=>{if(state==='active')refresh()});
 let network:ReturnType<typeof Network.addNetworkStateListener>|undefined;
 try{network=Network.addNetworkStateListener(state=>{revision++;observe(state)})}catch{/* Connectivity is only a hint. */}
 const initial=revision;try{void Network.getNetworkStateAsync().then(state=>{if(revision===initial)observe(state)},()=>{})}catch{}
 return()=>{closed=true;app.remove();network?.remove()};
}
