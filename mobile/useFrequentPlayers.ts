import {useEffect,useSyncExternalStore} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {createFrequentPlayersStore,frequentPlayersKey} from '../shared/frequent-players';
const store=createFrequentPlayersStore({read:()=>AsyncStorage.getItem(frequentPlayersKey),write:value=>AsyncStorage.setItem(frequentPlayersKey,value)});
export function useFrequentPlayers(){const snapshot=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);useEffect(()=>{if(!store.getSnapshot().ready)void store.load()},[]);return {...snapshot,save:store.save,remove:store.remove,retry:store.load}}
