import {dragTarget,type DragRectangle} from './drag-target';
import {useThemeStyles} from './Theme';
import {createContext,useContext,useEffect,useMemo,useRef,useState} from 'react';
import {Animated,Keyboard,PanResponder,StyleSheet,View,type StyleProp,type ViewStyle} from 'react-native';
type Motion={position:Animated.ValueXY;scale:Animated.Value;setActive:(active:boolean)=>void;onTargetChange?:(index:number|null)=>void};
const DragMotion=createContext<Motion|null>(null);
/** Keep the item's layout slot while moving the entire item above its neighbours. */
export function DraggablePlayer({index,items,style,children,onDraggingChange,onTargetChange}:{index:number;items:React.MutableRefObject<(View|null)[]>;style?:StyleProp<ViewStyle>;children:React.ReactNode;onDraggingChange?:(active:boolean)=>void;onTargetChange?:(index:number|null)=>void}){
 const position=useRef(new Animated.ValueXY()).current,scale=useRef(new Animated.Value(1)).current;
 const [active,setActiveState]=useState(false);
 const activeFlag=useRef(false);activeFlag.current=active;
 const callbacks=useRef({onDraggingChange,onTargetChange});callbacks.current={onDraggingChange,onTargetChange};
 const motion=useMemo(()=>({position,scale,setActive:(value:boolean)=>{setActiveState(value);callbacks.current.onDraggingChange?.(value)},onTargetChange:(value:number|null)=>callbacks.current.onTargetChange?.(value)}),[position,scale]);
 useEffect(()=>()=>{position.stopAnimation();scale.stopAnimation();if(activeFlag.current)callbacks.current.onDraggingChange?.(false)},[position,scale]);
 return <DragMotion.Provider value={motion}><Animated.View collapsable={false} ref={node=>{items.current[index]=node as View|null}} style={[style,{transform:[...position.getTranslateTransform(),{scale}],zIndex:active?100:0},active&&s.lifted]}>{children}</Animated.View></DragMotion.Provider>
}
type Props={index:number;label:string;items:React.MutableRefObject<(View|null)[]>;onMove:(from:number,to:number)=>void|Promise<void>;disabled?:boolean};
export default function DragHandle(props:Props){
 const themed=useThemeStyles(s),motion=useContext(DragMotion);
 const latest=useRef({props,motion});latest.current={props,motion};
 const [dragging,setDragging]=useState(false);
 const active=useRef(false),finishing=useRef(false),rectangles=useRef<DragRectangle[]>([]),timer=useRef<ReturnType<typeof setTimeout>|null>(null),generation=useRef(0),destination=useRef<number|null>(null);
 const clearTimer=()=>{if(timer.current){clearTimeout(timer.current);timer.current=null}};
 function reset(){clearTimer();generation.current++;active.current=false;finishing.current=false;setDragging(false);const current=latest.current.motion;current?.position.setValue({x:0,y:0});current?.scale.setValue(1);current?.setActive(false);current?.onTargetChange?.(null);destination.current=null}
 function activate(){if(active.current||finishing.current)return;active.current=true;clearTimer();Keyboard.dismiss();setDragging(true);latest.current.motion?.setActive(true);Animated.spring(latest.current.motion?.scale||new Animated.Value(1),{toValue:1.035,useNativeDriver:false,speed:30,bounciness:3}).start()}
 function measure(){const ticket=++generation.current;rectangles.current=[];latest.current.props.items.current.forEach((item,index)=>item?.measureInWindow((x,y,width,height)=>{if(ticket===generation.current&&width&&height)rectangles.current.push({index,x,y,width,height})}))}
 const responder=useMemo(()=>PanResponder.create({
  onStartShouldSetPanResponder:()=>!latest.current.props.disabled&&!finishing.current,
  onMoveShouldSetPanResponder:()=>!latest.current.props.disabled&&!finishing.current,
  onPanResponderGrant:()=>{destination.current=latest.current.props.index;measure();timer.current=setTimeout(activate,180)},
  onPanResponderMove:(_,gesture)=>{
   if(gesture.numberActiveTouches!==1)return;
   if(!active.current&&Math.hypot(gesture.dx,gesture.dy)>=5)activate();
   if(!active.current)return;
   const {props,motion}=latest.current;motion?.position.setValue({x:gesture.dx,y:gesture.dy});
   const target=dragTarget(rectangles.current,props.index,gesture.dx,gesture.dy);
   if(destination.current!==target){destination.current=target;motion?.onTargetChange?.(target===props.index?null:target)}
  },
  onPanResponderRelease:(_,gesture)=>{
   clearTimer();const {props,motion}=latest.current;const target=destination.current;
   if(!active.current||Math.hypot(gesture.dx,gesture.dy)<8||target===null||target===props.index){reset();return}
   const origin=rectangles.current.find(r=>r.index===props.index),drop=rectangles.current.find(r=>r.index===target);
   if(!origin||!drop||!motion){reset();return}
   finishing.current=true;
   Animated.parallel([Animated.timing(motion.position,{toValue:{x:drop.x-origin.x,y:drop.y-origin.y},duration:120,useNativeDriver:false}),Animated.timing(motion.scale,{toValue:1,duration:120,useNativeDriver:false})]).start(({finished})=>{if(!finished){reset();return}Promise.resolve(props.onMove(props.index,target)).finally(reset)})
  },
  onPanResponderTerminate:reset,
  onPanResponderTerminationRequest:()=>false,
  onShouldBlockNativeResponder:()=>true
 }),[]);
 useEffect(()=>()=>{clearTimer();generation.current++},[]);
 return <View {...responder.panHandlers} accessible accessibilityRole="button" accessibilityLabel={`Drag to reorder ${props.label}`} accessibilityHint="Press and drag the player to a new position. Accessibility actions move earlier or later." accessibilityState={{disabled:props.disabled}} accessibilityActions={[{name:'increment',label:'Move later'},{name:'decrement',label:'Move earlier'}]} onAccessibilityAction={e=>{if(!props.disabled)void props.onMove(props.index,props.index+(e.nativeEvent.actionName==='increment'?1:-1))}} style={[themed.handle,dragging&&themed.active,props.disabled&&themed.disabled]}><View style={themed.lines}>{[0,1,2].map(line=><View key={line} style={themed.line}/>)}</View></View>
}
const s=StyleSheet.create({lifted:{shadowColor:'#000',shadowOffset:{width:0,height:8},shadowOpacity:.22,shadowRadius:12,elevation:12},handle:{width:48,height:48,alignItems:'center',justifyContent:'center',backgroundColor:'#e8f0f1',borderRadius:8},active:{backgroundColor:'#c5e5e2',borderWidth:2,borderColor:'#2b8388'},disabled:{opacity:.5},lines:{gap:4},line:{width:20,height:2,backgroundColor:'#385a61',borderRadius:2}});
