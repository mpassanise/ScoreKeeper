"use client";
import {useEffect,useRef} from 'react';
import {createAutomaticSync,type AutomaticResult} from '../../shared/repository/automatic-sync';
export function useAutomaticSync(enabled:boolean,key:string|null,run:(signal:AbortSignal,refresh:boolean)=>Promise<AutomaticResult>){
 const latest=useRef({key,run});latest.current={key,run};
 const controller=useRef<ReturnType<typeof createAutomaticSync>|null>(null);
 useEffect(()=>{
  if(!enabled||!key)return;
  const value=createAutomaticSync({enabled:true,run:(signal,refresh)=>latest.current.key===key?latest.current.run(signal,refresh):Promise.resolve('cancelled')});controller.current=value;
  const update=()=>value.setActive(document.visibilityState==='visible'&&navigator.onLine),wake=()=>{update();value.wake()};
  update();window.addEventListener('online',wake);window.addEventListener('offline',update);window.addEventListener('focus',wake);document.addEventListener('visibilitychange',update);
  return()=>{if(controller.current===value)controller.current=null;value.close();window.removeEventListener('online',wake);window.removeEventListener('offline',update);window.removeEventListener('focus',wake);document.removeEventListener('visibilitychange',update)};
 },[enabled,key]);
 return {request:()=>controller.current?.request(),recovered:()=>controller.current?.recovered()};
}
