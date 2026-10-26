import {useEffect,useRef} from 'react';
import {Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import type {GameView} from '../shared/api';
import {gameStandings} from '../shared/standings';
import {useThemeStyles} from './Theme';
type Props={view:GameView;selectedId?:string;onSelect?:(id:string)=>void;disabled?:boolean;isPlayerDisabled?:(id:string)=>boolean};
export default function Standings({view,selectedId,onSelect,disabled=false,isPlayerDisabled}:Props){
 const s=useThemeStyles(styles),{players,margin,leadLabel}=gameStandings(view.game,view.totals),strip=useRef<ScrollView>(null),positions=useRef(new Map<string,number>());
 const orderKey=players.map(p=>p.player.id).join(',');
 function reveal(id:string|undefined){const x=id?positions.current.get(id):undefined;if(x!==undefined)strip.current?.scrollTo({x:Math.max(0,x-16),animated:true})}
 useEffect(()=>{reveal(selectedId)},[selectedId,orderKey]);
 function unavailable(id:string){return disabled||!!isPlayerDisabled?.(id)}
 return <View style={s.section}><View style={s.header}><Text accessibilityRole="header" style={s.title}>Players · {players.length}</Text><Text accessibilityLabel={margin} style={s.margin}>{leadLabel}</Text></View><ScrollView ref={strip} horizontal showsHorizontalScrollIndicator contentContainerStyle={s.pills}>{players.map(({player,score,rank})=>{
  const selected=selectedId===player.id,content=<><Text style={s.rank}>{rank}</Text><Text numberOfLines={1} style={s.name}>{player.name}</Text><Text style={s.points}>{score.toLocaleString()}</Text></>;
  const props={onLayout:(event:import('react-native').LayoutChangeEvent)=>{positions.current.set(player.id,event.nativeEvent.layout.x);if(selected)reveal(player.id)},style:[s.pill,rank===1&&s.leader,selected&&s.selected]};
  return onSelect?<Pressable key={player.id} {...props} accessibilityRole="button" accessibilityLabel={`Score for ${player.name}, rank ${rank}, ${score} points`} accessibilityState={{selected,disabled:unavailable(player.id)}} disabled={unavailable(player.id)} onPress={()=>onSelect(player.id)}>{content}</Pressable>:<View key={player.id} {...props} accessible accessibilityLabel={`Rank ${rank}, ${player.name}, ${score} points`}>{content}</View>;
 })}</ScrollView></View>;
}
const styles=StyleSheet.create({section:{backgroundColor:'#f4f7f8',borderBottomWidth:1,borderColor:'#dce5e7',paddingBottom:8},header:{minHeight:44,paddingHorizontal:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},title:{fontSize:14,fontWeight:'600',color:'#226b73'},margin:{fontSize:13,lineHeight:19,color:'#62777d',flexShrink:1,textAlign:'right'},pills:{gap:8,paddingHorizontal:16,paddingBottom:4},pill:{minHeight:48,flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:13,paddingVertical:9,borderRadius:24,borderWidth:2,borderColor:'transparent',backgroundColor:'#e8f0f1',maxWidth:260},leader:{backgroundColor:'#edf8f5'},selected:{borderColor:'#2a8288',backgroundColor:'white'},rank:{fontSize:14,lineHeight:21,color:'#62777d',fontVariant:['tabular-nums']},name:{fontSize:15,lineHeight:22,color:'#17252a',flexShrink:1},points:{fontSize:15,lineHeight:22,fontWeight:'700',fontVariant:['tabular-nums'],color:'#17252a'}});
