import type {Game,GameRuleEdit} from './api';
// Inactive v1 wire contract shared by web and iPhone. Not an outbox or API capability.
type TargetedCommand=
 | {action:'score';points:number;playerId:string;entryId:string}
 | {action:'edit';points:number;entryId:string}
 | {action:'undo';entryId:string}
 | {action:'select';playerId:string}
 | {action:'rules';rules:GameRuleEdit}
 | {action:'finish'|'resume'};
export type GameActionOperation={protocolVersion:1;kind:'action';operationId:string;gameId:string;command:TargetedCommand&{expectedVersion:number}};
export type GameLifecycleOperation=
 | {protocolVersion:1;kind:'create'|'import';operationId:string;gameId:string;expectedVersion:0;game:Omit<Game,'deviceOnly'>&{deviceOnly?:never}}
 | {protocolVersion:1;kind:'delete';operationId:string;gameId:string;expectedVersion:number;game?:null};
export type GameOperation=GameActionOperation|GameLifecycleOperation;
export type OperationError='GAME_ALREADY_EXISTS'|'GAME_FINISHED'|'GAME_NOT_FOUND'|'GAME_DELETED'|'VERSION_CONFLICT'|'UNDO_TARGET_CHANGED'|'ENTRY_ID_REUSED'|'INVALID_GAME_COMMAND';
export type OperationAcknowledgement={operationId:string;gameId:string;outcome:'applied'|'rejected';committedVersion:number|null;observedVersion:number|null;errorCode:OperationError|null};
// A receipt acknowledges an operation/version; it is never a replacement game snapshot.
// Missing/false capability means clients MUST retain the legacy online writer.
export type GameOperationCapability={version:1;kinds?:readonly ('action'|'create'|'import'|'delete')[];actions:readonly TargetedCommand['action'][];receipts:'retained';atomicGameAndReceipt:true};

// Lifecycle writers require the corresponding advertised kind; v1 actions alone do not imply support.
