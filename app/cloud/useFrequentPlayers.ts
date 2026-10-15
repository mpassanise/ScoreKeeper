"use client";
import {useEffect,useSyncExternalStore} from 'react';
import {createSyncedPlayersStore} from '../../shared/frequent-player-sync';
import type {ScorekeeperApi} from '../../shared/api';
const store=createSyncedPlayersStore({read:async key=>localStorage.getItem(key),write:async(key,value)=>localStorage.setItem(key,value)},()=>crypto.randomUUID());
const serverSnapshot={names:[] as readonly string[],ready:false,saving:false,error:'',syncing:false,syncError:'',account:false,pending:0};
export async function setFrequentPlayersAccount(id:string|null,api:ScorekeeperApi|null){await store.activate(id,api);if(id)void store.sync().catch(()=>{})}
export const syncFrequentPlayers=store.sync;
export const clearFrequentPlayersAccount=store.clear;
export function useFrequentPlayers(){const snapshot=useSyncExternalStore(store.subscribe,store.getSnapshot,()=>serverSnapshot);useEffect(()=>{void store.load();const retry=()=>{if(navigator.onLine)void store.sync().catch(()=>{})};window.addEventListener('online',retry);window.addEventListener('focus',retry);const timer=setInterval(()=>{if(navigator.onLine&&document.visibilityState==='visible'&&store.getSnapshot().pending)retry()},30000);return()=>{window.removeEventListener('online',retry);window.removeEventListener('focus',retry);clearInterval(timer)}},[]);return {...snapshot,save:store.save,remove:store.remove,retry:store.load,sync:store.sync}}
