"use client";
import GameTimer from './GameTimer';
import {useGameTimer,timerDisplay} from '../../shared/use-game-timer';
import styles from './AccountIdentity.module.css';
import {useRef} from 'react';
import {DropdownMenu} from 'radix-ui';
import {Timer,Settings,UserRound,LogOut,ChevronDown} from 'lucide-react';
type Props={timerOpen:boolean;onTimerClose:()=>void;onTimer:()=>void;email?:string|null;signedIn:boolean;busy:boolean;onSettings:()=>void;onAccount:()=>void;onSignOut:()=>void};
function AccountMenu({email,busy,onAccount,onSignOut}:Props){
 const pending=useRef<null|(()=>void)>(null);
 return <DropdownMenu.Root><DropdownMenu.Trigger asChild><button id="header-account-trigger" type="button" className="header-nav-control" aria-label="Account menu" title="Account"><UserRound size={20} aria-hidden="true"/><span className="header-nav-label">Account</span><ChevronDown size={15} aria-hidden="true" className="header-nav-label"/></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={8} collisionPadding={12} className="header-menu" onCloseAutoFocus={event=>{const action=pending.current;pending.current=null;if(action){event.preventDefault();document.getElementById('header-account-trigger')?.focus();queueMicrotask(action)}}}><DropdownMenu.Label className="header-menu-label">Account</DropdownMenu.Label>{email&&<><div className={styles.identity}><span>Signed in as</span><strong>{email}</strong></div><DropdownMenu.Separator className="header-menu-separator"/></>}<DropdownMenu.Item className="header-menu-item" disabled={busy} onSelect={()=>{pending.current=onAccount}}><UserRound size={18} aria-hidden="true"/>Manage account</DropdownMenu.Item><DropdownMenu.Separator className="header-menu-separator"/><DropdownMenu.Item className="header-menu-item" disabled={busy} onSelect={()=>{pending.current=onSignOut}}><LogOut size={18} aria-hidden="true"/>Sign out</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
}
export default function HeaderMenu(props:Props){
 const timer=useGameTimer(),showCountdown=!props.timerOpen&&(timer.running||timer.finished||timer.seconds!==timer.duration);
 const timerLabel=timer.finished?'Timer finished; open timer':`Timer${timer.running?' running':' paused'}, ${timer.seconds} seconds remaining; open timer`;
 return <><nav className="header-tools" aria-label="Tools, account and settings"><button type="button" className="header-nav-control" aria-label={showCountdown?timerLabel:'Open timer'} title={showCountdown?timerLabel:'Timer'} onClick={props.onTimer}>{showCountdown?<span className="header-countdown">{timerDisplay(timer.seconds)}</span>:<Timer size={20} aria-hidden="true"/>}<span className="header-nav-label">Timer</span></button><button id="header-settings-trigger" type="button" className="header-nav-control" aria-label="Settings" title="Settings" onClick={props.onSettings}><Settings size={20} aria-hidden="true"/><span className="header-nav-label">Settings</span></button>{props.signedIn&&<AccountMenu {...props}/>}</nav><GameTimer open={props.timerOpen} onClose={props.onTimerClose} timer={timer}/></>
}
