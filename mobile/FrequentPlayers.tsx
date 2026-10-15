import {useRef,useState} from 'react';
import {Alert,Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import {useThemeStyles} from './Theme';
import {useFrequentPlayers} from './useFrequentPlayers';
export default function FrequentPlayers(){
 const s=useThemeStyles(styles),{names,ready,saving,error,save,remove,retry,account,pending,syncing,syncError,sync}=useFrequentPlayers();
 const [draft,setDraft]=useState(''),[editing,setEditing]=useState<string|undefined>(),[message,setMessage]=useState('');
 const input=useRef<TextInput>(null),disabled=!ready||saving||!draft.trim();
 async function submit(){const original=editing;if(await save(draft,original)){setDraft('');setEditing(undefined);setMessage(original?'Player updated.':'Player added.');input.current?.blur()}}
 function edit(name:string){setEditing(name);setDraft(name);setMessage('');requestAnimationFrame(()=>input.current?.focus())}
 function confirmRemove(name:string){Alert.alert(`Remove ${name}?`,'This only removes the frequent player. Existing games stay unchanged.',[{text:'Cancel',style:'cancel'},{text:'Remove',style:'destructive',onPress:()=>void remove(name).then(ok=>{if(ok){setMessage('Player removed.');if(editing===name){setEditing(undefined);setDraft('')}}})}])}
 return <View style={s.panel}>
  <View style={s.headingRow}><Text accessibilityRole="header" style={s.heading}>Frequent players</Text><View style={s.badge}><Text style={s.badgeText}>{names.length}</Text></View></View>
  <Text style={s.copy}>Save your regulars for quick game setup.</Text>
  <View style={s.editor}>
   <Text style={s.label}>{editing?'Rename player':'Add a player'}</Text>
   <View style={s.inputRow}><TextInput ref={input} accessibilityLabel={editing?'Edit frequent player name':'New frequent player name'} placeholder="Player name" placeholderTextColor={s.copy.color} value={draft} onChangeText={setDraft} maxLength={30} editable={ready&&!saving} autoCorrect={false} autoCapitalize="words" returnKeyType="done" onSubmitEditing={()=>{if(!disabled)void submit()}} style={s.input}/><Pressable accessibilityRole="button" accessibilityLabel={editing?'Save player name':'Add player'} accessibilityState={{disabled}} disabled={disabled} onPress={()=>void submit()} style={[s.save,disabled&&s.disabled]}><Text style={s.startText}>{saving?'Saving…':editing?'Save':'+ Add'}</Text></Pressable></View>
   {editing&&<Pressable accessibilityRole="button" disabled={saving} style={s.cancel} onPress={()=>{setEditing(undefined);setDraft('');input.current?.blur()}}><Text style={s.link}>Cancel rename</Text></Pressable>}
  </View>
  {error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
  {message&&!error&&<Text accessibilityLiveRegion="polite" style={s.feedback}>{message}</Text>}
  {!ready?<View><Text style={s.copy}>Loading players…</Text><Pressable accessibilityRole="button" style={s.action} onPress={()=>void retry()}><Text style={s.link}>Retry loading</Text></Pressable></View>:names.length===0?<View style={s.empty}><Text style={s.emptyTitle}>Your game-night regulars belong here</Text><Text style={s.copy}>Add a name above, then pick it when starting a game.</Text></View>:<View>{[...names].sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'})).map(name=><View key={name} style={s.playerRow}>
   <View accessible={false} style={s.avatar}><Text style={s.avatarText}>{Array.from(name.trim())[0]?.toLocaleUpperCase()}</Text></View><Text style={s.name}>{name}</Text>
   <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${name}`} disabled={saving} style={[s.action,saving&&s.disabled]} onPress={()=>edit(name)}><Text style={s.link}>Edit</Text></Pressable>
   <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${name} from frequent players`} disabled={saving} style={[s.removeAction,saving&&s.disabled]} onPress={()=>confirmRemove(name)}><Text accessible={false} style={s.removeText}>×</Text></Pressable>
  </View>)}</View>}
  <View style={s.footer}>{account?<><View style={s.syncRow}><Text accessibilityLiveRegion="polite" style={s.syncText}>{syncing?'Syncing players…':syncError?'Sync paused':pending?`${pending} waiting to sync`:'Synced across devices'}</Text><Pressable accessibilityRole="button" disabled={syncing||saving} style={[s.action,(syncing||saving)&&s.disabled]} onPress={()=>void sync().catch(()=>{})}><Text style={s.link}>{syncError?'Retry sync':'Sync now'}</Text></Pressable></View>{pending>0&&<Text style={s.footnote}>Saved on this iPhone. Changes will sync when connected.</Text>}</>:<Text style={s.footnote}>Saved on this iPhone. Sign in to sync across devices.</Text>}{syncError&&<Text accessibilityRole="alert" style={s.error}>{syncError}</Text>}<Text style={s.footnote}>Changes won’t rename players in existing games.</Text></View>
 </View>
}
const styles=StyleSheet.create({
 panel:{backgroundColor:'white',borderRadius:16,padding:20,gap:12,borderWidth:1,borderColor:'#dce5e7'},
 headingRow:{flexDirection:'row',alignItems:'center',gap:10,flexWrap:'wrap'},heading:{fontSize:22,fontWeight:'700',color:'#17252a'},badge:{backgroundColor:'#edf8f5',paddingHorizontal:9,paddingVertical:3,borderRadius:12},badgeText:{fontSize:12,fontWeight:'700',color:'#226b73'},
 copy:{fontSize:14,lineHeight:21,color:'#62777d'},editor:{gap:8,marginTop:4},label:{fontSize:13,fontWeight:'700',color:'#385a61'},inputRow:{flexDirection:'row',alignItems:'stretch',gap:8,flexWrap:'wrap'},input:{flex:1,minWidth:130,backgroundColor:'white',borderWidth:1,borderColor:'#ccdadd',borderRadius:10,paddingHorizontal:12,paddingVertical:12,fontSize:16,color:'#17252a',minHeight:48},save:{minHeight:48,paddingHorizontal:16,borderRadius:10,backgroundColor:'#d4e965',justifyContent:'center',alignItems:'center'},startText:{fontSize:15,fontWeight:'700',color:'#123f4a'},
 cancel:{minHeight:44,justifyContent:'center',alignSelf:'flex-start'},playerRow:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:10,minHeight:64,borderBottomWidth:1,borderColor:'#dce5e7'},avatar:{width:32,height:32,borderRadius:16,backgroundColor:'#e8f0f1',alignItems:'center',justifyContent:'center'},avatarText:{fontSize:13,fontWeight:'700',color:'#226b73'},name:{flex:1,minWidth:0,fontSize:17,lineHeight:23,fontWeight:'600',color:'#17252a'},action:{minWidth:44,minHeight:44,paddingHorizontal:6,justifyContent:'center',alignItems:'center'},link:{fontSize:14,fontWeight:'700',color:'#226b73'},removeAction:{width:44,minHeight:44,justifyContent:'center',alignItems:'center',borderRadius:10,backgroundColor:'#f4f7f8'},removeText:{fontSize:25,lineHeight:30,color:'#62777d'},
 footer:{gap:6,paddingTop:4},syncRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap'},syncText:{flexShrink:1,fontSize:12,lineHeight:18,color:'#62777d'},footnote:{fontSize:12,lineHeight:18,color:'#62777d'},feedback:{fontSize:13,lineHeight:19,color:'#226b73'},empty:{paddingVertical:16,gap:6},emptyTitle:{fontSize:15,fontWeight:'600',color:'#17252a'},error:{color:'#ad3838',fontSize:14,lineHeight:20},disabled:{opacity:.5}
});
