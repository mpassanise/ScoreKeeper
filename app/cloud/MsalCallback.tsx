"use client";
import {useEffect,useState} from 'react';
let flight:Promise<void>|undefined;
function deliver(){return flight??=(async()=>{
 const {broadcastResponseToMainFrame}=await import('@azure/msal-browser/redirect-bridge');
 await broadcastResponseToMainFrame();
})()}
export default function MsalCallback(){
 const [failed,setFailed]=useState(false);
 useEffect(()=>{let active=true;void deliver().catch(()=>{if(active)setFailed(true);console.warn('[Scorekeeper connection]',{stage:'authentication',code:'CALLBACK_BRIDGE_FAILED'})});return()=>{active=false}},[]);
 return <p role={failed?'alert':'status'}>{failed?'Sign-in could not finish. Return to Scorekeeper and try again.':'Completing sign-in…'}</p>;
}

