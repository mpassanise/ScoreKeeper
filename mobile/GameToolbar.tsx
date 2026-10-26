import {Pressable,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useTheme} from './Theme';
import {gameChromeColors} from './game-chrome-colors';
export default function GameToolbar({busy,finished,disabled,onHome,onFinish,onNewGame}:{busy:boolean;finished:boolean;disabled:boolean;onHome:()=>void;onFinish:()=>void;onNewGame:()=>void}){
 const {dark}=useTheme(),colors=gameChromeColors(dark);
 return <SafeAreaView edges={['bottom']} style={{backgroundColor:colors.surface,borderTopWidth:1,borderColor:colors.border}}><View style={styles.row}><Pressable accessibilityRole="button" disabled={busy} accessibilityLabel="Go to Home" onPress={onHome} style={[styles.button,busy&&styles.disabled]}><Text style={[styles.text,{color:colors.accent}]}>‹ Home</Text></Pressable><Pressable accessibilityRole="button" disabled={busy||(!finished&&disabled)} accessibilityLabel={finished?'Start a new game':'Finish game'} onPress={finished?onNewGame:onFinish} style={[styles.button,{backgroundColor:colors.header},(busy||(!finished&&disabled))&&styles.disabled]}><Text style={[styles.text,{color:colors.accent}]}>{finished?'+ New game':'Finish game'}</Text></Pressable></View></SafeAreaView>;
}
const styles=StyleSheet.create({row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,paddingHorizontal:16,paddingVertical:8},button:{minHeight:44,justifyContent:'center',alignItems:'center',paddingHorizontal:16,paddingVertical:10,borderRadius:12,flexShrink:1},text:{fontSize:16,fontWeight:'600',textAlign:'center'},disabled:{opacity:.5}});
