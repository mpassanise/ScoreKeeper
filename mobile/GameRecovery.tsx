import {useState} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import type {GameRecoveryReview} from '../shared/repository/game-recovery';
import SideDrawer from './SideDrawer';
import {useThemeStyles} from './Theme';
export default function GameRecovery({review,onClose,onChoose,onCheckCollision}:{review:GameRecoveryReview;onClose:()=>void;onChoose:()=>Promise<void>;onCheckCollision?:()=>Promise<void>}){
 const s=useThemeStyles(styles),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function act(work:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await work()}catch{setError('Could not update this game. Your changes are safe. Close this message and try again.')}finally{setBusy(false)}}
 const canUseLatest=review.canChooseAccount||review.canResolveCollision;
 function button(label:string,work:()=>void,primary=false){return <Pressable accessibilityRole="button" accessibilityState={{disabled:busy}} disabled={busy} onPress={work} style={[s.button,primary?s.save:s.outline,busy&&s.disabled]}><Text style={primary?s.startText:s.action}>{label}</Text></Pressable>}
 return <SideDrawer visible title="Update this game" locked={busy} onClose={onClose}><Text style={s.help}>{canUseLatest?'This game changed on another device. Use the latest synced game to continue here. Changes that could not sync will remain safely stored on this device.':'We could not update this game automatically. Your changes are safely saved on this device.'}</Text>{error?<Text accessibilityRole="alert" style={s.error}>{error}</Text>:null}<View style={s.actions}>{review.canCheckCollision&&onCheckCollision&&button(busy?'Checking…':'Check for updates',()=>void act(onCheckCollision))}{canUseLatest&&button(busy?'Updating…':'Use latest synced game',()=>void act(onChoose),true)}{button('Close',onClose)}</View></SideDrawer>;
}
const styles=StyleSheet.create({help:{fontSize:16,lineHeight:24,color:'#62777d'},actions:{gap:12},button:{minHeight:48,padding:14,alignItems:'center',justifyContent:'center',borderRadius:10},outline:{borderWidth:1,borderColor:'#ccdadd',backgroundColor:'white'},save:{backgroundColor:'#d4e965'},action:{fontSize:15,fontWeight:'600',color:'#226b73',textAlign:'center'},startText:{fontSize:15,fontWeight:'700',color:'#123f4a',textAlign:'center'},disabled:{opacity:.5},error:{fontSize:14,lineHeight:21,color:'#ad3838'}});
