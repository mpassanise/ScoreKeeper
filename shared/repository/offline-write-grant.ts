import type {AccountStatus} from '../api';
import {supportsQueuedScoring,supportsQueuedCompletion,supportsQueuedCorrections,supportsQueuedRules,supportsQueuedDeletion} from './scoring-writer';
/** Local editing permission only. Never a token, server session, import grant,
 * cache-preparation grant or permission to deliver operations. */
export type OfflineWriteGrant={schemaVersion:1;selector:string;profileId:string;completion:boolean;corrections:boolean;rules:boolean;deletion:boolean;creation?:boolean};
export function verifiedOfflineGrant(selector:string,status:AccountStatus):OfflineWriteGrant|undefined{
 if(!status.profileId?.trim()||!selector.trim()||!supportsQueuedScoring(status.gameOperations))return undefined;
 return {schemaVersion:1,selector,profileId:status.profileId,completion:supportsQueuedCompletion(status.gameOperations),corrections:supportsQueuedCorrections(status.gameOperations),rules:supportsQueuedRules(status.gameOperations),deletion:supportsQueuedDeletion(status.gameOperations),...(status.gameOperations?.kinds?.includes('create')?{creation:true}:{})};
}
/** Unknown, malformed, partial or mismatched grants stay read-only. Keep the
 * original metadata intact; only another verified response may replace it. */
export function checkedOfflineGrant(value:unknown,selector:string,profileId:string):OfflineWriteGrant|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const g=value as OfflineWriteGrant;
 if(g.schemaVersion!==1||g.selector!==selector||g.profileId!==profileId||![7,8].includes(Object.keys(g).length)||Object.keys(g).some(k=>!['schemaVersion','selector','profileId','completion','corrections','rules','deletion','creation'].includes(k))||[g.completion,g.corrections,g.rules,g.deletion].some(v=>typeof v!=='boolean'))return null;
 if(g.creation!==undefined&&typeof g.creation!=='boolean')return null;
 return {...g};
}
