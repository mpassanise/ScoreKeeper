import {Pressable,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useTheme} from './Theme';
import {gameChromeColors} from './game-chrome-colors';
type Props={busy:boolean;finished:boolean;disabled:boolean;undoDisabled:boolean;onHome:()=>void;onFinish:()=>void;onNewGame:()=>void;onUndo:()=>void;onHistory:()=>void};
export default function GameToolbar({busy,finished,disabled,undoDisabled,onHome,onFinish,onNewGame,onUndo,onHistory}:Props){
 const {dark}=useTheme(),colors=gameChromeColors(dark);
 function button(label:string,onPress:()=>void,blocked=false,emphasis=false){return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled:blocked}} disabled={blocked} onPress={onPress} style={[styles.button,{backgroundColor:emphasis?colors.header:colors.surface,borderColor:colors.border},blocked&&styles.disabled]}><Text style={[styles.text,{color:colors.accent}]}>{label}</Text></Pressable>}
 return <SafeAreaView edges={['bottom']} style={{backgroundColor:colors.surface,borderTopWidth:1,borderColor:colors.border}}><View style={styles.tray}><View style={styles.row}>{button('Undo last score',onUndo,busy||undoDisabled)}{button('Score history',onHistory,busy)}</View><View style={styles.row}>{button('Home',onHome,busy)}{button(finished?'+ New game':'Finish game',finished?onNewGame:onFinish,busy||(!finished&&disabled),true)}</View></View></SafeAreaView>;
}
const styles=StyleSheet.create({tray:{gap:8,paddingHorizontal:16,paddingVertical:8},row:{flexDirection:'row',alignItems:'stretch',gap:8},button:{flex:1,minWidth:0,minHeight:44,justifyContent:'center',alignItems:'center',paddingHorizontal:8,paddingVertical:10,borderWidth:1,borderRadius:12},text:{fontSize:15,fontWeight:'600',textAlign:'center'},disabled:{opacity:.5}});
