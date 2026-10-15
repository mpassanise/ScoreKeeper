"use client";
import {useEffect,useSyncExternalStore} from 'react';
import {createFrequentPlayersStore,frequentPlayersKey} from '../../shared/frequent-players';
const store=createFrequentPlayersStore({read:async()=>localStorage.getItem(frequentPlayersKey),write:async value=>localStorage.setItem(frequentPlayersKey,value)});
const serverSnapshot={names:[] as readonly string[],ready:false,saving:false,error:''};
export function useFrequentPlayers(){const snapshot=useSyncExternalStore(store.subscribe,store.getSnapshot,()=>serverSnapshot);useEffect(()=>{if(!store.getSnapshot().ready)void store.load()},[]);return {...snapshot,save:store.save,remove:store.remove,retry:store.load}}
