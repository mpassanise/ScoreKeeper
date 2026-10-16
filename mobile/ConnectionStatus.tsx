import {Pressable,StyleSheet,Text,View} from 'react-native';
import {connectionText,type ConnectionState} from '../shared/connection-status';
import {useThemeStyles} from './Theme';
export default function ConnectionStatus({state,onReconnect,disabled=false}:{state:ConnectionState;onReconnect:()=>void;disabled?:boolean}){
 const s=useThemeStyles(styles),working=state.status==='connecting';
 return <View style={s.row}><View style={s.copy}><Text accessibilityLiveRegion="polite" style={s.text}>{connectionText(state)}</Text>{state.lastConnectedAt&&<Text style={s.time}>Last connected {new Date(state.lastConnectedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</Text>}</View>{state.status!=='connected'&&<Pressable accessibilityRole="button" accessibilityState={{disabled:disabled||working}} disabled={disabled||working} onPress={onReconnect} style={[s.button,(disabled||working)&&s.disabled]}><Text style={s.action}>{working?'Connecting…':state.status==='sign-in'?'Sign in to sync':'Reconnect'}</Text></Pressable>}</View>;
}
const styles=StyleSheet.create({row:{flexDirection:'row',alignItems:'center',flexWrap:'wrap',gap:10,borderBottomWidth:1,borderColor:'#dce5e7',paddingBottom:10},copy:{flex:1,minWidth:170,gap:2},text:{fontSize:14,lineHeight:21,color:'#62777d'},time:{fontSize:12,lineHeight:18,color:'#62777d'},button:{minHeight:44,paddingHorizontal:12,justifyContent:'center',borderRadius:10,backgroundColor:'#e8f0f1'},action:{fontSize:14,fontWeight:'700',color:'#226b73'},disabled:{opacity:0.5}});

