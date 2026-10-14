import {createContext,useContext,useEffect,useMemo,useRef,useState} from 'react';
import {StyleSheet,useColorScheme} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
export type ThemeChoice='light'|'dark'|'system';
const ThemeContext=createContext({choice:'system' as ThemeChoice,dark:false,ready:false,error:'',setChoice:async(_choice:ThemeChoice)=>{}});
export function ThemeProvider({children}:{children:React.ReactNode}){
 const system=useColorScheme(),[choice,setChoiceState]=useState<ThemeChoice>('system'),[ready,setReady]=useState(false),[error,setError]=useState(''),saving=useRef(false);
 useEffect(()=>{AsyncStorage.getItem('scorekeeper-theme').then(value=>{if(value==='light'||value==='dark'||value==='system')setChoiceState(value)}).catch(()=>setError('Could not load your theme preference.')).finally(()=>setReady(true))},[]);
 async function setChoice(value:ThemeChoice){if(!ready||saving.current)return;saving.current=true;setError('');try{await AsyncStorage.setItem('scorekeeper-theme',value);setChoiceState(value)}catch{setError('Could not save your theme. Please try again.')}finally{saving.current=false}}
 const dark=choice==='dark'||(choice==='system'&&system==='dark');
 return <ThemeContext.Provider value={{choice,dark,ready,error,setChoice}}>{children}</ThemeContext.Provider>
}
export function useTheme(){return useContext(ThemeContext)}
const backgrounds:Record<string,string>={'#f4f7f8':'#101b20','white':'#19292f','#fff':'#19292f','#e8f0f1':'#243b43','#edf8f5':'#23403e','#c5e5e2':'#23403e','#123f4a':'#12343e'};
const foregrounds:Record<string,string>={'#17252a':'#edf4f5','#385a61':'#c4d9df','#62777d':'#b3c4ca','#123f4a':'#9bd7dc','#226b73':'#9bd7dc','#417b80':'#9bd7dc','#14545b':'#c7eeeb','#ad3838':'#ffaaa5'};
export function useThemeStyles<T extends StyleSheet.NamedStyles<T>>(styles:T):T{const {dark}=useTheme();return useMemo(()=>{if(!dark)return styles;return Object.fromEntries(Object.entries(styles).map(([name,value])=>[name,Object.fromEntries(Object.entries(value as object).map(([key,color])=>{if(typeof color!=='string')return [key,color];if(key==='backgroundColor'&&name==='line')return [key,'#9bd7dc'];if(key==='backgroundColor')return [key,backgrounds[color]||color];if(key==='color'&&!['buttonText','startText','dangerText','brand','logout'].includes(name))return [key,foregrounds[color]||color];if(key==='borderColor')return [key,({'#dce5e7':'#365059','#ccdadd':'#45636d','#e4ebec':'#365059','#2a8288':'#82cbd0','#2b8388':'#82cbd0'} as Record<string,string>)[color]||color];return [key,color]}))])) as T},[dark,styles])}
