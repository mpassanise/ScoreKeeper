"use client";
import {useEffect,useState} from 'react';
import CloudHome from './cloud/CloudHome';
import MsalCallback from './cloud/MsalCallback';
import {isSilentCallback} from '../shared/msal-callback';
export default function Home(){
 const [mode,setMode]=useState<'checking'|'app'|'callback'>('checking');
 useEffect(()=>{setMode(isSilentCallback(window.parent!==window,window.location.hash,window.location.search)?'callback':'app')},[]);
 // Never mount CloudHome (and initialize MSAL/API calls) in a silent callback.
 if(mode==='callback')return <MsalCallback/>;
 if(mode==='checking')return <p role="status">Opening Scorekeeper…</p>;
 return <CloudHome/>;
}

