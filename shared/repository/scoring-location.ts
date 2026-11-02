import type {ScorekeeperApi} from '../api';

export type ScoringLocation='this-device'|'another-device';

/** Read current ownership for active account games without blocking the home screen.
 * Requests are bounded and individually cancellable; unavailable results stay unknown. */
export async function readScoringLocations(api:Pick<ScorekeeperApi,'withSignal'>,gameIds:string[],signal:AbortSignal,maxConcurrent=3):Promise<Record<string,ScoringLocation>>{
 const ids=[...new Set(gameIds)],locations:Record<string,ScoringLocation>={};
 let next=0;
 const worker=async()=>{
  while(!signal.aborted){
   const index=next++;if(index>=ids.length)return;
   const id=ids[index],controller=new AbortController(),abort=()=>controller.abort();
   if(signal.aborted)return;
   signal.addEventListener('abort',abort,{once:true});
   const timer=setTimeout(()=>controller.abort(),5000);
   try{
    const control=await api.withSignal(controller.signal).scoringControl(id);
    if(!signal.aborted&&control.hasScorer)locations[id]=control.canScore?'this-device':'another-device';
   }catch{/* Unknown ownership must not be presented as a device location. */}
   finally{clearTimeout(timer);signal.removeEventListener('abort',abort)}
  }
 };
 const limit=Math.max(1,Math.min(6,Math.floor(maxConcurrent)||3));
 await Promise.all(Array.from({length:Math.min(limit,ids.length)},worker));
 return locations;
}
