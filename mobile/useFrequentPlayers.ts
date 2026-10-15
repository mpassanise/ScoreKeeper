import {useEffect,useSyncExternalStore} from 'react';
import {AppState} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {createSyncedPlayersStore} from '../shared/frequent-player-sync';
import type {ScorekeeperApi} from '../shared/api';
const store=createSyncedPlayersStore({read:key=>AsyncStorage.getItem(key),write:(key,value)=>AsyncStorage.setItem(key,value)},()=>Crypto.randomUUID());
export async function setFrequentPlayersAccount(id:string|null,api:ScorekeeperApi|null){await store.activate(id,api);if(id)void store.sync().catch(()=>{})}
export const syncFrequentPlayers=store.sync;
export const clearFrequentPlayersAccount=store.clear;
export function useFrequentPlayers(){const snapshot=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);useEffect(()=>{void store.load();let lastAttempt=Date.now();const resume=AppState.addEventListener('change',state=>{if(state==='active'&&Date.now()-lastAttempt>30000){lastAttempt=Date.now();void store.sync().catch(()=>{})}});const timer=setInterval(()=>{if(AppState.currentState==='active'&&store.getSnapshot().pending)void store.sync().catch(()=>{})},30000);return()=>{resume.remove();clearInterval(timer)}},[]);return {...snapshot,save:store.save,remove:store.remove,retry:store.load,sync:store.sync}}
