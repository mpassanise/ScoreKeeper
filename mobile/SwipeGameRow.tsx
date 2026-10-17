import {useEffect,useMemo,useRef,useState} from 'react';
import {Animated,PanResponder,Pressable,StyleSheet,Text,View} from 'react-native';
/** Horizontal gestures reveal an explicit action; vertical gestures remain with ScrollView. */
export default function SwipeGameRow({children,name,disabled,onDelete}:{children:React.ReactNode;name:string;disabled:boolean;onDelete:()=>void}){
 const position=useRef(new Animated.Value(0)).current,offset=useRef(0),start=useRef(0),drag=useRef(0),[open,setOpen]=useState(false),[revealed,setRevealed]=useState(false);
 const latest=useRef({disabled,onDelete});latest.current={disabled,onDelete};
 function reset(){position.stopAnimation();position.setValue(0);offset.current=0;setOpen(false);setRevealed(false)}
 function settle(value:number){if(latest.current.disabled){reset();return}offset.current=value;setOpen(value<0);if(value<0)setRevealed(true);Animated.spring(position,{toValue:value,useNativeDriver:true,bounciness:0,speed:24}).start(({finished})=>{if(finished&&value===0&&offset.current===0)setRevealed(false)})}
 const responder=useMemo(()=>PanResponder.create({
  onMoveShouldSetPanResponder:(_,g)=>!latest.current.disabled&&Math.abs(g.dx)>12&&Math.abs(g.dx)>Math.abs(g.dy)*1.5&&(g.dx<0||offset.current<0),
  onPanResponderGrant:()=>{if(latest.current.disabled){reset();return}position.stopAnimation();start.current=offset.current;drag.current=start.current;setRevealed(true)},
  onPanResponderMove:(_,g)=>{if(!latest.current.disabled){drag.current=Math.max(-88,Math.min(0,start.current+g.dx));position.setValue(drag.current)}},
  onPanResponderRelease:(_,g)=>settle(g.vx<-.3?-88:g.vx>.3?0:start.current+g.dx<-44?-88:0),
  // Once a deliberate horizontal gesture owns the row, keep ScrollView from
  // stealing it and snapping the action shut at finger-up. Vertical movement
  // never claims the responder in the first place.
  onPanResponderTerminationRequest:()=>false,
  onPanResponderTerminate:()=>settle(drag.current<-44?-88:0)
 }),[position]);
 useEffect(()=>{if(disabled)reset()},[disabled,position]);
 useEffect(()=>()=>position.stopAnimation(),[position]);
 // A disabled card becomes translucent while Resume loads. Never leave the
 // destructive action underneath it unless a horizontal swipe revealed it.
 return <View style={s.row}>{revealed&&!disabled&&<Pressable accessibilityRole="button" accessibilityLabel={`Delete ${name}`} accessibilityElementsHidden={!open} importantForAccessibility={open?'yes':'no-hide-descendants'} disabled={!open} onPress={()=>{settle(0);latest.current.onDelete()}} style={s.delete}><Text style={s.dangerText}>Delete</Text></Pressable>}<Animated.View {...responder.panHandlers} style={{transform:[{translateX:position}]}}>{children}</Animated.View></View>;
}
const s=StyleSheet.create({row:{borderRadius:14,overflow:'hidden'},delete:{position:'absolute',right:0,top:0,bottom:0,width:88,backgroundColor:'#ad3838',alignItems:'center',justifyContent:'center'},dangerText:{color:'#fff',fontSize:15,fontWeight:'700'}});
