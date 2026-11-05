import {useEffect,useRef,useState,type ComponentProps} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {setAudioModeAsync,useAudioPlayer} from 'expo-audio';
import {useGameTimer,timerDisplay} from '../shared/use-game-timer';
import AppHeader from './AppHeader';
import GameTimer from './GameTimer';
import {useTheme} from './Theme';
import {gameChromeColors} from './game-chrome-colors';
type Props=ComponentProps<typeof AppHeader>&{timerOpen:boolean;onTimerClose:()=>void};
const soundPreferenceKey='scorekeeper-timer-sound-enabled';
/** Own clock updates here so score-entry state doesn't rerender every tick. */
export default function TimerHeader({timerOpen,onTimerClose,...props}:Props){
 const timer=useGameTimer(),{dark}=useTheme(),colors=gameChromeColors(dark);
 const player=useAudioPlayer(require('./assets/timer-beep.wav'));
 const [soundEnabled,setSoundEnabled]=useState(true),[showTimerEnded,setShowTimerEnded]=useState(false);
 const soundEnabledRef=useRef(true),soundChanged=useRef(false),lastCompletion=useRef(timer.completionCount),hideAlert=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>{
  let active=true;
  void AsyncStorage.getItem(soundPreferenceKey).then(value=>{if(active&&!soundChanged.current&&(value==='true'||value==='false')){const enabled=value==='true';soundEnabledRef.current=enabled;setSoundEnabled(enabled)}}).catch(()=>{});
  // Short UI sounds should mix with other audio and remain audible when the
  // iPhone's silent switch is on, like a conventional timer alert.
  void setAudioModeAsync({interruptionMode:'mixWithOthers',playsInSilentMode:true}).catch(()=>{});
  return()=>{active=false;if(hideAlert.current)clearTimeout(hideAlert.current)};
 },[]);
 useEffect(()=>{
  if(lastCompletion.current===timer.completionCount)return;
  lastCompletion.current=timer.completionCount;
  setShowTimerEnded(true);
  if(hideAlert.current)clearTimeout(hideAlert.current);
  hideAlert.current=setTimeout(()=>{setShowTimerEnded(false);hideAlert.current=null},1600);
  if(soundEnabledRef.current){try{void player.seekTo(0).then(()=>player.play()).catch(()=>{})}catch{/* Timer completion must remain visible if audio is unavailable. */}}
 },[timer.completionCount,player]);
 function changeSoundEnabled(enabled:boolean){soundChanged.current=true;soundEnabledRef.current=enabled;setSoundEnabled(enabled);void AsyncStorage.setItem(soundPreferenceKey,String(enabled)).catch(()=>{});}
 const visible=!timerOpen&&(timer.running||timer.finished||timer.seconds!==timer.duration);
 const label=timer.finished?'Timer finished; open timer':`Timer ${timer.running?'running':'paused'}, ${timer.seconds} seconds remaining; open timer`;
 const control=visible?<Pressable accessibilityRole="button" accessibilityLabel={label} onPress={props.onTimer} style={[styles.button,{backgroundColor:(props.game||props.screenTitle)?colors.surface:'#ffffff15'}]}><Text style={[styles.time,{color:(props.game||props.screenTitle)?colors.accent:'#ffffff'}]}>{timerDisplay(timer.seconds)}</Text></Pressable>:undefined;
 return <><AppHeader {...props} timerControl={control}/><GameTimer visible={timerOpen} onClose={onTimerClose} timer={timer} soundEnabled={soundEnabled} onSoundEnabledChange={changeSoundEnabled}/>{showTimerEnded&&<View pointerEvents="none" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[styles.alert,{backgroundColor:colors.accent}]}><Text style={[styles.alertText,{color:dark?'#12343e':'#ffffff'}]}>Timer ended</Text></View>}</>;
}
const styles=StyleSheet.create({button:{minWidth:64,height:48,paddingHorizontal:8,borderRadius:12,justifyContent:'center',alignItems:'center'},time:{fontSize:17,fontWeight:'700',fontVariant:['tabular-nums']},alert:{position:'absolute',top:'38%',alignSelf:'center',paddingVertical:14,paddingHorizontal:24,borderRadius:16,elevation:12,shadowColor:'#000',shadowOpacity:.24,shadowRadius:12,shadowOffset:{width:0,height:4}},alertText:{fontSize:20,fontWeight:'800'}});
