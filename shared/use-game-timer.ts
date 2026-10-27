import {useCallback,useEffect,useRef,useState} from 'react';
/** Deadline-based countdown: background throttling never extends the timer.
 * Local utility only; closing its panel or switching games does not reset it. */
export function useGameTimer(){
 const [duration,setDuration]=useState<30|60>(30),[remaining,setRemaining]=useState(30000),[running,setRunning]=useState(false),[finished,setFinished]=useState(false);
 const deadline=useRef<number|null>(null),leftRef=useRef(30000);
 const update=useCallback(()=>{const left=deadline.current===null?leftRef.current:Math.max(0,deadline.current-Date.now());leftRef.current=left;setRemaining(left);if(deadline.current!==null&&left===0){deadline.current=null;setRunning(false);setFinished(true)}return left},[]);
 useEffect(()=>{if(!running)return;const timer=setInterval(update,200);return()=>clearInterval(timer)},[running]);
 function choose(value:30|60){deadline.current=null;setDuration(value);leftRef.current=value*1000;setRemaining(value*1000);setRunning(false);setFinished(false)}
 function toggle(){if(running){update();deadline.current=null;setRunning(false)}else{const left=remaining>0?remaining:duration*1000;deadline.current=Date.now()+left;leftRef.current=left;setRemaining(left);setFinished(false);setRunning(true)}}
 return {refresh:update,duration,seconds:Math.ceil(remaining/1000),running,finished,choose,toggle,reset:()=>choose(duration)};
}
export function timerDisplay(seconds:number){return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`}
