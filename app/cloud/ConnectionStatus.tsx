"use client";
import {useState} from 'react';
import {connectionText,connectionFailureText,type ConnectionState} from '../../shared/connection-status';
import styles from './ConnectionStatus.module.css';
export default function ConnectionStatus({state,onReconnect,onSignIn,disabled=false}:{state:ConnectionState;onReconnect:()=>void;onSignIn?:()=>void;disabled?:boolean}){
 const [details,setDetails]=useState(false),working=state.status==='connecting',failure=state.diagnostic;
 return <div className={styles.row}><div role="status" aria-live="polite"><span>{connectionText(state)}</span>{state.lastConnectedAt&&<small>Last connected {new Date(state.lastConnectedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</small>}{failure&&<><small>{connectionFailureText(failure.stage)}</small><button type="button" className="link" aria-expanded={details} onClick={()=>setDetails(!details)}>{details?'Hide connection details':'Connection details'}</button>{details&&<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:12}}>{JSON.stringify(failure,null,2)}</pre>}</>}</div><div>{state.status!=='connected'&&<button type="button" className="outline" disabled={disabled||working} onClick={onReconnect}>{working?'Connecting…':state.status==='sign-in'?'Sign in to sync':'Reconnect'}</button>}{failure?.stage==='authentication'&&state.status==='unavailable'&&onSignIn&&<button type="button" className="link" disabled={disabled||working} onClick={onSignIn}>Sign in again</button>}</div></div>;
}

