import {useEffect,useRef} from 'react';
import {AppState} from 'react-native';
import {createAutomaticSync,type AutomaticResult} from '../shared/repository/automatic-sync';
/** Uses existing native APIs. No background entitlement or new native module.
 * Network errors retry within a bounded budget; foreground/manual connect can
 * wake it again. Native connectivity event subscriptions are a later gate. */
export function useAutomaticSync(enabled:boolean,key:string|null,run:(signal:AbortSignal,refresh:boolean)=>Promise<AutomaticResult>){
 const latest=useRef({key,run});latest.current={key,run};
 const controller=useRef<ReturnType<typeof createAutomaticSync>|null>(null);
 useEffect(()=>{
  if(!enabled||!key)return;
  const value=createAutomaticSync({enabled:true,run:(signal,refresh)=>latest.current.key===key?latest.current.run(signal,refresh):Promise.resolve('cancelled')});controller.current=value;
  value.setActive(AppState.currentState==='active');
  const sub=AppState.addEventListener('change',state=>value.setActive(state==='active'));
  return()=>{if(controller.current===value)controller.current=null;value.close();sub.remove()};
 },[enabled,key]);
 return {request:()=>controller.current?.request(),recovered:()=>controller.current?.recovered()};
}
