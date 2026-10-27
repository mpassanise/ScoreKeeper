import {Image,Pressable,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useTheme} from './Theme';
import {gameChromeColors} from './game-chrome-colors';
type Props={busy:boolean;finished:boolean;disabled:boolean;undoDisabled:boolean;onHome:()=>void;onFinish:()=>void;onNewGame:()=>void;onUndo:()=>void;onHistory:()=>void};
export default function GameToolbar({busy,finished,disabled,undoDisabled,onHome,onFinish,onNewGame,onUndo,onHistory}:Props){
 const {dark}=useTheme(),colors=gameChromeColors(dark);
 function button(label:string,shortLabel:string,icon:keyof typeof icons,onPress:()=>void,blocked=false,emphasis=false){return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled:blocked}} disabled={blocked} onPress={onPress} style={[styles.button,{backgroundColor:emphasis?colors.header:colors.surface},blocked&&styles.disabled]}><Image accessible={false} accessibilityIgnoresInvertColors source={icons[icon]} style={[styles.icon,{tintColor:colors.accent}]}/><Text accessible={false} style={[styles.text,{color:colors.accent}]}>{shortLabel}</Text></Pressable>}
 return <SafeAreaView edges={['bottom']} style={{backgroundColor:colors.surface,borderTopWidth:1,borderColor:colors.border}}><View style={styles.tray}>{button('Home','Home','home',onHome,busy)}{button('Undo last score','Undo','undo',onUndo,busy||undoDisabled)}{button('Score history','History','history',onHistory,busy)}{button(finished?'+ New game':'Finish game',finished?'New game':'Finish',finished?'new':'finish',finished?onNewGame:onFinish,busy||(!finished&&disabled),true)}</View></SafeAreaView>;
}
const icons={home:require('./assets/tray-home.png'),undo:require('./assets/tray-undo.png'),history:require('./assets/tray-history.png'),finish:require('./assets/tray-finish.png'),new:require('./assets/tray-new.png')};
const styles=StyleSheet.create({tray:{flexDirection:'row',alignItems:'stretch',gap:4,paddingHorizontal:12,paddingVertical:6},button:{flex:1,minWidth:0,minHeight:52,justifyContent:'center',alignItems:'center',paddingHorizontal:4,paddingVertical:6,borderRadius:12,gap:2},icon:{width:24,height:24},text:{fontSize:11,fontWeight:'600',textAlign:'center'},disabled:{opacity:.5}});
