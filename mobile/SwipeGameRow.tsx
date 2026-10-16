import {useEffect,useMemo,useRef,useState} from 'react';
import {Animated,PanResponder,Pressable,StyleSheet,Text,View} from 'react-native';
/** Horizontal gestures reveal an explicit action; vertical gestures remain with ScrollView. */
export default function SwipeGameRow({children,name,disabled,onDelete}:{children:React.ReactNode;name:string;disabled:boolean;onDelete:()=>void}){
 const position=useRef(new Animated.Value(0)).current,offset=useRef(0),start=useRef(0),[open,setOpen]=useState(false);
 const latest=useRef({disabled,onDelete});latest.current={disabled,onDelete};
 function settle(value:number){offset.current=value;setOpen(value<0);Animated.spring(position,{toValue:value,useNativeDriver:true,bounciness:0,speed:24}).start()}
 const responder=useMemo(()=>PanResponder.create({
  onMoveShouldSetPanResponder:(_,g)=>!latest.current.disabled&&Math.abs(g.dx)>12&&Math.abs(g.dx)>Math.abs(g.dy)*1.5&&(g.dx<0||offset.current<0),
  onPanResponderGrant:()=>{position.stopAnimation();start.current=offset.current},
  onPanResponderMove:(_,g)=>position.setValue(Math.max(-88,Math.min(0,start.current+g.dx))),
  onPanResponderRelease:(_,g)=>settle(start.current+g.dx<-44?-88:0),
  onPanResponderTerminate:()=>settle(0),
  onPanResponderTerminationRequest:()=>true
 }),[position]);
 useEffect(()=>{if(disabled)settle(0)},[disabled]);
 useEffect(()=>()=>position.stopAnimation(),[position]);
 return <View style={s.row}><Pressable accessibilityRole="button" accessibilityLabel={`Delete ${name}`} accessibilityElementsHidden={!open} importantForAccessibility={open?'yes':'no-hide-descendants'} disabled={disabled||!open} onPress={()=>{settle(0);latest.current.onDelete()}} style={s.delete}><Text style={s.dangerText}>Delete</Text></Pressable><Animated.View {...responder.panHandlers} style={{transform:[{translateX:position}]}}>{children}</Animated.View></View>;
}
const s=StyleSheet.create({row:{borderRadius:14,overflow:'hidden'},delete:{position:'absolute',right:0,top:0,bottom:0,width:88,backgroundColor:'#ad3838',alignItems:'center',justifyContent:'center'},dangerText:{color:'#fff',fontSize:15,fontWeight:'700'}});
