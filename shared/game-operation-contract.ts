import type {GameRuleEdit} from './api';
// Inactive v1 wire contract shared by web and iPhone. Not an outbox or API capability.
type TargetedCommand=
 | {action:'score';points:number;playerId:string;entryId:string}
 | {action:'edit';points:number;entryId:string}
 | {action:'undo';entryId:string}
 | {action:'select';playerId:string}
 | {action:'rules';rules:GameRuleEdit}
 | {action:'finish'|'resume'};
export type GameActionOperation={protocolVersion:1;kind:'action';operationId:string;gameId:string;command:TargetedCommand&{expectedVersion:number}};
export type OperationError='GAME_NOT_FOUND'|'GAME_DELETED'|'VERSION_CONFLICT'|'UNDO_TARGET_CHANGED'|'ENTRY_ID_REUSED'|'INVALID_GAME_COMMAND';
export type OperationAcknowledgement={operationId:string;gameId:string;outcome:'applied'|'rejected';committedVersion:number|null;observedVersion:number|null;errorCode:OperationError|null};
// A receipt acknowledges an operation/version; it is never a replacement game snapshot.
// Missing/false capability means clients MUST retain the legacy online writer.
export type GameOperationCapability={version:1;actions:readonly TargetedCommand['action'][];receipts:'retained';atomicGameAndReceipt:true};
