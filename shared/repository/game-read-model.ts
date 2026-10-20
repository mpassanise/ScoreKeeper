import type {GameView} from '../api';

/** Account-scoped local read result. A tracked game never falls back to the
 * generic confirmed cache, including while its deletion is unconfirmed. */
export type AccountGameRead=
 | {kind:'missing'}
 | {kind:'deleted';serverVersion:number}
 | {kind:'pending-delete';sync:'pending'|'needs-review';pendingOperations:number;serverVersion:number|null}
 | {kind:'game';source:'queue'|'cache';sync:'confirmed'|'pending'|'needs-review';view:GameView;canScore?:boolean;canChangeCompletion?:boolean;canCorrectEntries?:boolean;canEditRules?:boolean;canDelete?:boolean;scoreProfileId?:string;scoreAccess?:'ready'|'connect'|'untracked'|'paused';pendingOperations:number;serverVersion:number|null};
