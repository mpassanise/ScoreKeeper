import {useState} from 'react';
import type {GameRecoveryReview} from '../../shared/repository/game-recovery';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
export default function GameRecovery({review,onClose,onChoose,onCheckCollision}:{review:GameRecoveryReview;onClose:()=>void;onChoose:()=>Promise<void>;onCheckCollision?:()=>Promise<void>}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function act(work:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await work()}catch{setError('Could not update this game. Your changes are safe. Close this message and try again.')}finally{setBusy(false)}}
 const canUseLatest=review.canChooseAccount||review.canResolveCollision;
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose()}}><DialogContent showCloseButton={!busy}><DialogTitle>Update this game</DialogTitle><DialogDescription>{canUseLatest?'This game changed on another device. Use the latest synced game to continue here. Changes that could not sync will remain safely stored on this device.':'We could not update this game automatically. Your changes are safely saved on this device.'}</DialogDescription>{error&&<p role="alert" className="error">{error}</p>}<div className="entry"><button className="outline" disabled={busy} onClick={onClose}>Close</button>{review.canCheckCollision&&onCheckCollision&&<button className="outline" disabled={busy} onClick={()=>void act(onCheckCollision)}>{busy?'Checking…':'Check for updates'}</button>}{canUseLatest&&<button className="primary" disabled={busy} onClick={()=>void act(onChoose)}>{busy?'Updating…':'Use latest synced game'}</button>}</div></DialogContent></Dialog>;
}
