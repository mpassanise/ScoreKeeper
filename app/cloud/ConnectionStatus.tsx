"use client";
import {connectionText,type ConnectionState} from '../../shared/connection-status';
import styles from './ConnectionStatus.module.css';
export default function ConnectionStatus({state,onReconnect,disabled=false}:{state:ConnectionState;onReconnect:()=>void;disabled?:boolean}){
 const working=state.status==='connecting';
 return <div className={styles.row}><div role="status" aria-live="polite"><span>{connectionText(state)}</span>{state.lastConnectedAt&&<small>Last connected {new Date(state.lastConnectedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</small>}</div>{state.status!=='connected'&&<button type="button" className="outline" disabled={disabled||working} onClick={onReconnect}>{working?'Connecting…':state.status==='sign-in'?'Sign in to sync':'Reconnect'}</button>}</div>;
}

