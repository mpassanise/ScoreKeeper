import type {ComponentProps} from 'react';
import {Pressable,StyleSheet,Text} from 'react-native';
import {useGameTimer,timerDisplay} from '../shared/use-game-timer';
import AppHeader from './AppHeader';
import GameTimer from './GameTimer';
import {useTheme} from './Theme';
import {gameChromeColors} from './game-chrome-colors';
type Props=ComponentProps<typeof AppHeader>&{timerOpen:boolean;onTimerClose:()=>void};
/** Own clock updates here so score-entry state doesn't rerender every tick. */
export default function TimerHeader({timerOpen,onTimerClose,...props}:Props){
 const timer=useGameTimer(),{dark}=useTheme(),colors=gameChromeColors(dark);
 const visible=!timerOpen&&(timer.running||timer.finished||timer.seconds!==timer.duration);
 const label=timer.finished?'Timer finished; open timer':`Timer ${timer.running?'running':'paused'}, ${timer.seconds} seconds remaining; open timer`;
 const control=visible?<Pressable accessibilityRole="button" accessibilityLabel={label} onPress={props.onTimer} style={[styles.button,{backgroundColor:props.game?colors.surface:'#ffffff15'}]}><Text style={[styles.time,{color:props.game?colors.accent:'#ffffff'}]}>{timerDisplay(timer.seconds)}</Text></Pressable>:undefined;
 return <><AppHeader {...props} timerControl={control}/><GameTimer visible={timerOpen} onClose={onTimerClose} timer={timer}/></>;
}
const styles=StyleSheet.create({button:{minWidth:64,height:48,paddingHorizontal:8,borderRadius:12,justifyContent:'center',alignItems:'center'},time:{fontSize:17,fontWeight:'700',fontVariant:['tabular-nums']}});
