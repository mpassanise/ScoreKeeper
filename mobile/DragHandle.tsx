import {useMemo,useRef,useState} from 'react';
import {PanResponder,StyleSheet,View} from 'react-native';
type Props={index:number;label:string;items:React.MutableRefObject<(View|null)[]>;onMove:(from:number,to:number)=>void;disabled?:boolean};
export default function DragHandle(props:Props){
 const latest=useRef(props);latest.current=props;
 const [dragging,setDragging]=useState(false);
 const rectangles=useRef<{index:number;x:number;y:number;width:number;height:number}[]>([]);
 const responder=useMemo(()=>PanResponder.create({
  onStartShouldSetPanResponder:()=>!latest.current.disabled,
  onMoveShouldSetPanResponder:()=>!latest.current.disabled,
  onPanResponderGrant:()=>{setDragging(true);rectangles.current=[];latest.current.items.current.forEach((item,index)=>item?.measureInWindow((x,y,width,height)=>{if(width&&height)rectangles.current.push({index,x,y,width,height})}))},
  onPanResponderRelease:(_,gesture)=>{setDragging(false);if(Math.hypot(gesture.dx,gesture.dy)<8)return;const {index,onMove}=latest.current;let target=index,distance=Infinity;for(const r of rectangles.current){const d=Math.hypot(gesture.moveX-(r.x+r.width/2),gesture.moveY-(r.y+r.height/2));if(d<distance){distance=d;target=r.index}}if(target!==index)onMove(index,target)},
  onPanResponderTerminate:()=>setDragging(false),
  onPanResponderTerminationRequest:()=>false
 }),[]);
 return <View {...responder.panHandlers} accessible accessibilityRole="button" accessibilityLabel={`Drag to reorder ${props.label}`} accessibilityHint="Drag to a new position. Accessibility actions move earlier or later." accessibilityState={{disabled:props.disabled}} accessibilityActions={[{name:'increment',label:'Move later'},{name:'decrement',label:'Move earlier'}]} onAccessibilityAction={e=>{if(!props.disabled)props.onMove(props.index,props.index+(e.nativeEvent.actionName==='increment'?1:-1))}} style={[s.handle,dragging&&s.active,props.disabled&&s.disabled]}><View style={s.lines}>{[0,1,2].map(line=><View key={line} style={s.line}/>)}</View></View>
}
const s=StyleSheet.create({handle:{width:44,height:44,alignItems:'center',justifyContent:'center',backgroundColor:'#e8f0f1',borderRadius:8},active:{backgroundColor:'#c5e5e2',borderWidth:2,borderColor:'#2b8388'},disabled:{opacity:.5},lines:{gap:4},line:{width:20,height:2,backgroundColor:'#385a61',borderRadius:2}});
