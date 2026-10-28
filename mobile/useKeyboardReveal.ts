import {useCallback,useEffect,useRef,type RefObject} from 'react';
import {Keyboard,Platform,type ScrollView,type TextInput} from 'react-native';
/** Measure in window coordinates so the fixed header/safe area is respected.
 * Native keyboard insets provide scroll space; this only reveals the input. */
export function createKeyboardReveal(scroll:RefObject<ScrollView|null>,offset:RefObject<number>){
 let closed=false,active:TextInput|null=null,frame:number|undefined,revision=0;
 const valid=(input:TextInput,version:number)=>!closed&&active===input&&revision===version&&input.isFocused();
 function reveal(){
  if(closed)return;revision++;if(frame!==undefined)cancelAnimationFrame(frame);
  frame=requestAnimationFrame(()=>{
   frame=undefined;const input=active,container=scroll.current,keyboard=Keyboard.metrics(),version=revision;
   if(!input||!container||!keyboard||keyboard.height<=0||!valid(input,version))return;
   container.getNativeScrollRef()?.measureInWindow((_x,top,_width,height)=>{
    if(!valid(input,version)||scroll.current!==container)return;
    input.measureInWindow((_inputX,y,_inputWidth,inputHeight)=>{
     if(!valid(input,version)||scroll.current!==container)return;
     const bottom=Math.min(top+height,keyboard.screenY)-12,delta=y<top+12?y-top-12:y+inputHeight>bottom?y+inputHeight-bottom:0;
     if(Math.abs(delta)>1)container.scrollTo({y:Math.max(0,offset.current+delta),animated:true});
    });
   });
  });
 }
 return {focus(input:TextInput|null){active=input;revision++;reveal()},reveal,close(){closed=true;active=null;revision++;if(frame!==undefined)cancelAnimationFrame(frame)}};
}
export function useKeyboardReveal(scroll:RefObject<ScrollView|null>,offset:RefObject<number>,enabled:boolean){
 const controller=useRef<ReturnType<typeof createKeyboardReveal>|null>(null);
 useEffect(()=>{
  if(!enabled||Platform.OS!=='ios')return;
  const value=createKeyboardReveal(scroll,offset);controller.current=value;
  const shown=Keyboard.addListener('keyboardDidShow',value.reveal),changed=Keyboard.addListener('keyboardDidChangeFrame',value.reveal),hidden=Keyboard.addListener('keyboardDidHide',value.reveal);
  return()=>{if(controller.current===value)controller.current=null;value.close();shown.remove();changed.remove();hidden.remove()};
 },[scroll,offset,enabled]);
 return useCallback((input:TextInput|null)=>controller.current?.focus(input),[]);
}
